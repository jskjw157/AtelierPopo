import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { SearchAdWriteError } from '../write/errors.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { campaignResponse } from './postgres-campaign-create-repository.js';
import { adgroupResponse } from './adgroup-create-contract.js';
import { keywordReadResponse, creativeResponse } from './sibling-create-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { hasUnprovenInventory } from './inventory-cleanup-fence.js';
import { problem, IDENTITY, UUID, REMOTE, epoch, active, creationProof, siblingCreationProof, siblingQuarantineProof, cleanupMetadata, targetDescriptor, fullTarget, claimedProof } from './child-first-cleanup-contract.js';
import { resolveAdgroupGenerationHistory } from './adgroup-generation-contract.js';
import { selectSiblingCleanupGeneration } from './sibling-cleanup-generation.js';
import { cleanupBinding, deletedProof, assertUnusedCleanupPlan, assertCleanupTargetUntouched, cleanupRetirementProof, cleanupRetirementDetails, cleanupReplacementProof, replacementCleanupMetadata, CLEANUP_RETIREMENT_REASON } from './cleanup-plan-lifecycle.js';

function presentNode(g,node,observation){
  if(observation?.kind!=='present')return false;
  if(node===g.root)return Boolean(campaignResponse(observation.result,g.rootDescriptor,false,g.root.remote_id));
  if(node===g.child)return Boolean(adgroupResponse(observation.result,g.childDescriptor,false,g.child.remote_id));
  if(node.object_type==='keyword'){
    const mapping=g.siblingCreate?.partial===true?g.siblingCreate.quarantined.find(item=>item.objectId===node.hierarchy_object_id):null;
    const index=g.siblingCreate?.partial===true?mapping?.index:g.leaves.findIndex(leaf=>leaf.hierarchy_object_id===node.hierarchy_object_id),expected=g.siblingCreate?.descriptor?.body?.[index]?.keyword;
    return typeof expected==='string'&&Boolean(keywordReadResponse(observation.result,{customerId:g.run.customer_id,parentRemoteId:g.child.remote_id,remoteId:node.remote_id,keyword:expected}));
  }
  if(node.object_type==='creative')return Boolean(creativeResponse(observation.result,g.siblingCreate.descriptor,false,node.remote_id));
  return false;
}

/** Internal bounded hierarchy coordinator. Never issues tokens or performs network I/O. */
export class PostgresChildFirstCleanupRepository {
  #pool; #rootRecipe; #childRecipe=createHierarchyChildRecipe(); #current; #gate; #confirm; #clock; #ttl; #age; #units; #capacity; #tickets=new WeakMap();
  constructor({pool,dailyBudget,current,gate,confirmation,clock,planTtlSeconds,preflightMaxAgeMs,riskUnits,dailyCapacityUnits}) {
    this.#pool=pool;this.#rootRecipe=createHierarchyCampaignRecipe({dailyBudget});this.#current=current;this.#gate=gate;this.#confirm=confirmation;this.#clock=clock;this.#ttl=planTtlSeconds;this.#age=preflightMaxAgeMs;this.#units=riskUnits;this.#capacity=dailyCapacityUnits;
  }
  #now() {const n=this.#clock();if(!Number.isSafeInteger(n)||!Number.isFinite(new Date(n).getTime()))problem('CLOCK','Invalid server time.',503);return n;}
  #identity(run) {const v=this.#current(run.customer_id);if(!v||typeof v.then==='function'||Object.entries(IDENTITY).some(([k,col])=>!v[k]||v[k]!==run[col]))problem('CONTEXT','Current identity no longer matches the recorded run.');return v;}
  async #tx(work) {
    let c,committing=false,discard=false;
    try {c=await this.#pool.connect();await c.query('BEGIN');const value=await work(c);committing=true;await c.query('COMMIT');return value;}
    catch(error){if(committing){discard=true;problem('COMMIT_UNKNOWN','Commit acknowledgement is unknown; no send permission is returned.',503);}if(c)try{await c.query('ROLLBACK');}catch{discard=true;}if(error instanceof SearchAdWriteError)throw error;problem('STORE','Cleanup storage failed; inspect without replay.',503);}
    finally{if(c)c.release(discard);}
  }
  async #graph(c,s) {
    const account=(await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',[s.customerId])).rows[0];
    const run=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE',[s.hierarchyRunId,s.customerId])).rows[0];
    if(!run)problem('NOT_FOUND','Exact local hierarchy scope was not found.',404);
    const local=(await c.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1',[s.hierarchyRunId])).rows.map(o=>o.hierarchy_object_id);
    const objects=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 OR parent_object_id=ANY($2::uuid[]) ORDER BY hierarchy_object_id FOR UPDATE',[s.hierarchyRunId,local])).rows;
    const holds=(await c.query('SELECT *,xmin::text AS version FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) OR parent_hierarchy_object_id=ANY($2::uuid[]) ORDER BY ownership_id FOR UPDATE',[s.hierarchyRunId,local])).rows;
    const events=(await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) ORDER BY event_id',[s.hierarchyRunId,local])).rows;
    if(events.some(e=>e.customer_id!==s.customerId||e.hierarchy_run_id!==s.hierarchyRunId||(e.hierarchy_object_id!==null&&!local.includes(e.hierarchy_object_id))||e.phase.startsWith('cleanup_')))problem('GRAPH','Foreign or competing cleanup events are not supported.');
    const planIds=[...new Set([...events.map(e=>e.details_json?.planId).filter(id=>typeof id==='string'&&UUID.test(id)),s.planId].filter(Boolean))];
    const plans=(await c.query("SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=ANY($1::uuid[]) OR before_json->>'hierarchyRunId'=$2 ORDER BY plan_id FOR UPDATE",[planIds,s.hierarchyRunId])).rows;
    if(plans.some(p=>p.customer_id!==s.customerId))problem('GRAPH','Foreign linked plans are not supported.');
    for(const p of plans)if(!planIds.includes(p.plan_id))planIds.push(p.plan_id);
    const approvals=planIds.length?(await c.query('SELECT *,xmin::text AS version FROM searchad_write_approvals WHERE plan_id=ANY($1::uuid[]) ORDER BY approval_id FOR UPDATE',[planIds])).rows:[];
    const locks=planIds.length?(await c.query('SELECT *,xmin::text AS version FROM searchad_write_locks WHERE plan_id=ANY($1::uuid[]) ORDER BY plan_id FOR UPDATE',[planIds])).rows:[];
    const attempts=planIds.length?(await c.query('SELECT *,xmin::text AS version FROM searchad_write_attempts WHERE plan_id=ANY($1::uuid[]) ORDER BY attempt_id FOR UPDATE',[planIds])).rows:[];
    const risks=(await c.query('SELECT *,xmin::text AS version FROM searchad_risk_reservations WHERE owner_run_id=$1 OR intent_id LIKE ANY($2::text[]) ORDER BY reservation_id FOR UPDATE',[s.hierarchyRunId,planIds.map(id=>`%:${id}`)])).rows;
    const root=objects.find(o=>o.object_type==='campaign');
    const rootResults=events.filter(e=>e.hierarchy_object_id===root?.hierarchy_object_id&&e.phase==='create_result');
    const rootPlan=rootResults.length===1?plans.find(p=>p.plan_id===rootResults[0].details_json?.planId):null;
    if(!root||root.parent_object_id!==null||run.recipe_id!==this.#rootRecipe.id||run.completed_at!==null||!rootPlan)problem('GRAPH','One verified campaign root and its creation plan are required.');
    const g={account,run,objects,holds,events,plans,approvals,locks,attempts,risks,root,rootPlan};
    g.generation=resolveAdgroupGenerationHistory(g,null,(code,message)=>problem(code,message));
    g.adgroupGeneration=g.generation;
    const child=g.generation.active;
    if(!child)problem('GRAPH','Cleanup requires a current adgroup generation; a retired predecessor alone is not a remote target.');
    const predecessor=g.generation.predecessor?.object??null;
    for(const o of [root,child]){
      const h=holds.find(x=>x.hierarchy_object_id===o.hierarchy_object_id),op=OPS[o.object_type];
      if(!op||o.customer_id!==s.customerId||o.hierarchy_run_id!==s.hierarchyRunId||typeof o.remote_id!=='string'||!REMOTE.test(o.remote_id)||o.create_operation_key!==op.create||o.read_operation_key!==op.read||o.delete_operation_key!==op.delete||!h||h.customer_id!==s.customerId||h.object_type!==o.object_type||h.remote_id!==o.remote_id||h.owner_kind!=='hierarchy_canary'||h.owner_run_id!==s.hierarchyRunId||h.hierarchy_object_id!==o.hierarchy_object_id||h.parent_hierarchy_object_id!==o.parent_object_id||h.created_operation_key!==op.create)problem('GRAPH','Object, returned ID, Customer, parent and ownership must agree.');
    }
    g.child=child;
    g.rootDescriptor=this.#rootRecipe.createCampaign({customerId:s.customerId,hierarchyRunId:s.hierarchyRunId});
    g.rootCreate=creationProof(g,root,g.rootDescriptor);
    g.childDescriptor=g.generation.descriptor;
    g.childCreate=creationProof(g,child,g.childDescriptor);
    // Keep ALL original rows in g/signatures and in the inventory fence. Only
    // the current producer batch is selected after proving the entire history.
    const selection=selectSiblingCleanupGeneration(g,this.#now());
    const leaves=selection.leaves,retiredSiblingIds=selection.retiredObjectIds;
    g.siblingGeneration=selection.history;
    const leafTypes=[...new Set(leaves.map(o=>o.object_type))];
    const leavesSupported=leaves.length===0||(leafTypes.length===1&&((leafTypes[0]==='keyword'&&leaves.length>=1)||(leafTypes[0]==='creative'&&leaves.length===1))&&leaves.every(o=>o.parent_object_id===child.hierarchy_object_id));
    const expectedObjects=2+leaves.length+retiredSiblingIds.length+(predecessor?1:0);
    if(objects.length!==expectedObjects||!leavesSupported||child.parent_object_id!==root.hierarchy_object_id)problem('GRAPH','Only proven historical generations and one current bounded sibling result are supported.');
    for(const o of leaves){
      const op=OPS[o.object_type];
      if(!op||o.customer_id!==s.customerId||o.hierarchy_run_id!==s.hierarchyRunId||o.parent_object_id!==child.hierarchy_object_id||o.create_operation_key!==op.create||o.read_operation_key!==op.read||o.delete_operation_key!==op.delete)problem('GRAPH','Leaf Customer, parent and operations must agree before provenance evaluation.');
    }
    g.leaves=leaves;
    g.siblingCreate=leaves.length?(run.status==='manual_review'?siblingQuarantineProof(g):siblingCreationProof(g)):null;
    if(g.siblingCreate?.partial===true){
      if(holds.length!==2+g.siblingCreate.quarantined.length)problem('GRAPH','Partial quarantine graph contains unexpected ownership holds.');
    } else {
      const expectedHolds=objects.length-(predecessor?1:0)-retiredSiblingIds.length;
      if(holds.length!==expectedHolds)problem('GRAPH','Only remotely returned objects may have holds; proved retired predecessors have none.');
      for(const o of leaves){
        const h=holds.find(x=>x.hierarchy_object_id===o.hierarchy_object_id),op=OPS[o.object_type];
        if(typeof o.remote_id!=='string'||!REMOTE.test(o.remote_id)||!h||h.customer_id!==s.customerId||h.object_type!==o.object_type||h.remote_id!==o.remote_id||h.owner_kind!=='hierarchy_canary'||h.owner_run_id!==s.hierarchyRunId||h.hierarchy_object_id!==o.hierarchy_object_id||h.parent_hierarchy_object_id!==o.parent_object_id||h.created_operation_key!==op.create)problem('GRAPH','Verified leaf returned ID and ownership must agree.');
      }
    }
    g.target=objects.find(o=>o.hierarchy_object_id===s.hierarchyObjectId);
    if(!g.target||g.target===predecessor||retiredSiblingIds.includes(s.hierarchyObjectId))problem('NOT_FOUND','A historical never-dispatched object cannot be selected for cleanup.',404);
    g.hold=holds.find(h=>h.hierarchy_object_id===g.target.hierarchy_object_id);
    g.cleanupNow=this.#now();
    this.#identity(run);return g;
  }
  #available(g) {
    if(!g.account||g.account.suspended!==false)problem('SUSPENDED','Customer is suspended or unavailable.',403);
    if(hasUnprovenInventory(g))problem('INVENTORY_UNPROVEN','Recorded descendant inventory is not complete remote-absence proof; parent deletion remains blocked.');
    if(g.siblingCreate?.partial===true){
      const mapping=g.siblingCreate.quarantined.find(item=>item.objectId===g.target.hierarchy_object_id);
      if(g.run.status!=='manual_review'||!mapping||g.target.object_type!=='keyword'||g.target.state!=='manual_review'||g.hold?.state!=='manual_review'||g.target.remote_id!==mapping.remoteId||g.target.deleted_at!==null)problem('STATE','Partial quarantine permits deletion of an explicitly returned manual-review keyword leaf only.');
      const rootHold=g.holds.find(h=>h.hierarchy_object_id===g.root.hierarchy_object_id),childHold=g.holds.find(h=>h.hierarchy_object_id===g.child.hierarchy_object_id);
      if(g.root.state!=='owned'||g.child.state!=='owned'||rootHold?.state!=='owned'||childHold?.state!=='owned'||g.root.deleted_at!==null||g.child.deleted_at!==null||g.events.some(e=>[g.root.hierarchy_object_id,g.child.hierarchy_object_id].includes(e.hierarchy_object_id)&&e.phase.startsWith('tree_cleanup_')))problem('PARENT','Partial leaf cleanup requires untouched owned ancestors.');
      return;
    }
    if(g.run.status!=='cleanup_pending'||g.target.state!=='owned'||g.hold.state!=='owned'||g.target.deleted_at!==null)problem('STATE','Only a verified owned target with no prior dispatch can be deleted.');
    if(g.leaves.includes(g.target)){
      const rootHold=g.holds.find(h=>h.hierarchy_object_id===g.root.hierarchy_object_id),childHold=g.holds.find(h=>h.hierarchy_object_id===g.child.hierarchy_object_id);
      if(g.root.state!=='owned'||g.child.state!=='owned'||rootHold?.state!=='owned'||childHold?.state!=='owned'||g.root.deleted_at!==null||g.child.deleted_at!==null||g.events.some(e=>[g.root.hierarchy_object_id,g.child.hierarchy_object_id].includes(e.hierarchy_object_id)&&e.phase.startsWith('tree_cleanup_')))problem('PARENT','Leaf cleanup requires unresolved-free owned ancestors.');
    } else if(g.target===g.child){
      const h=g.holds.find(h=>h.hierarchy_object_id===g.root.hierarchy_object_id);
      if(g.root.state!=='owned'||h.state!=='owned'||g.root.deleted_at!==null||g.events.some(e=>e.hierarchy_object_id===g.root.hierarchy_object_id&&e.phase.startsWith('tree_cleanup_')))problem('PARENT','Parent is unresolved or cleanup has already begun.');
      for(const leaf of g.leaves)deletedProof(g,leaf);
    } else {
      for(const leaf of g.leaves)deletedProof(g,leaf);
      deletedProof(g,g.child);
    }
  }
  async #authority(c,g,id,now) {
    this.#identity(g.run);const grant=(await c.query('SELECT * FROM searchad_activation_grants WHERE activation_id=$1',[id])).rows[0];
    const e=grant?(await c.query('SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1',[grant.evidence_id])).rows[0]:null;
    if(!grant||!e||[grant,e].some(v=>v.customer_id!==g.run.customer_id||v.evidence_type!=='active_canary'||Object.values(IDENTITY).some(k=>v[k]!==g.run[k])||!equal(v.operation_keys_json,[OPS[g.target.object_type].delete])||!equal(v.lifecycle_kinds_json,['delete'])||!equal(v.field_scope_json,[]))||e.result!=='verified'||!active(grant.activated_at,grant.expires_at,now)||!active(e.created_at,e.expires_at,now))problem('AUTHORITY','Separate current delete-only authority for this object type is required.',403);
    return Math.min(epoch(grant.expires_at),epoch(e.expires_at));
  }
  #signature(g){return JSON.stringify([g.run.version,g.objects.map(o=>[o.hierarchy_object_id,o.version]),g.holds.map(h=>[h.ownership_id,h.version]),g.plans.map(p=>[p.plan_id,p.version]),g.approvals.map(a=>[a.approval_id,a.version]),g.locks.map(l=>[l.plan_id,l.version]),g.attempts.map(a=>[a.attempt_id,a.version]),g.risks.map(r=>[r.reservation_id,r.version]),g.events.map(e=>e.event_id)]);}
  #issue(g,s,stage,extra={}){const ticket=Object.freeze({});this.#tickets.set(ticket,{scope:structuredClone(s),signature:this.#signature(g),stage,...extra});return ticket;}
  #take(ticket,stage){const v=this.#tickets.get(ticket);this.#tickets.delete(ticket);if(!v||v.stage!==stage)problem('TICKET','An unused internal stage ticket is required.');return v;}
  #same(g,v){if(this.#signature(g)!==v.signature)problem('STALE','Stored graph or approval changed during I/O; do not replay.');}
  #fresh(v){const now=this.#now();if(now<v.startedAt||now-v.startedAt>=this.#age)problem('STALE','Read-only observation is too old to settle.');}
  #view(g,s){return {customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,hierarchyObjectId:s.hierarchyObjectId,planId:s.planId,objectType:g.target.object_type,remoteId:g.target.remote_id,state:g.target.state};}
  async #audit(c,g,s,phase,status,details,at=new Date(this.#now()).toISOString()){
    const safe={planId:s.planId,...details};
    await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'delete',$8::jsonb,$9)`,[randomUUID(),s.hierarchyRunId,s.hierarchyObjectId,s.customerId,phase,status,OPS[g.target.object_type].delete,JSON.stringify(safe),at]);
    await c.query('INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,response_json,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[randomUUID(),s.planId,phase,status,JSON.stringify(safe),at]);
  }
  async prepare(s){return this.#tx(async c=>{
    const g=await this.#graph(c,s);this.#available(g);const until=await this.#authority(c,g,s.activationId,this.#now());
    if(g.events.some(e=>e.hierarchy_object_id===s.hierarchyObjectId&&e.phase.startsWith('tree_cleanup_')))problem('PRIOR_PLAN','An existing cleanup plan must not be replaced or reused.');
    const scope={...s,planId:randomUUID()},meta=cleanupMetadata(g,g.target,s.activationId),d=targetDescriptor(s.customerId,g.target,'delete'),read=targetDescriptor(s.customerId,g.target,'read');
    const at=new Date(this.#now()).toISOString(),expiresAt=new Date(Math.min(until,this.#now()+this.#ttl*1000)).toISOString();
    await c.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,rollback_json,reason,status,created_by,created_at,expires_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb,NULL,$9,'planned',$10,$11,$12)`,[scope.planId,s.customerId,d.operationKey,JSON.stringify(d),JSON.stringify(read),JSON.stringify(meta),contentHash(meta),JSON.stringify({absent:true,remoteId:g.target.remote_id}),g.siblingCreate?.partial===true?'Separately approved deletion of one explicitly returned partial keyword quarantine target.':g.leaves.length?'Separately approved deletion of one verified bounded hierarchy target.':'Separately approved deletion of one verified two-node target.',s.actorPrincipalId,at,expiresAt]);
    await this.#audit(c,g,scope,'tree_cleanup_plan','planned',{activationId:s.activationId,beforeHash:contentHash(meta),requestFingerprint:contentHash(d),actorPrincipalId:s.actorPrincipalId});
    await this.#authority(c,g,s.activationId,this.#now());if(this.#now()>=Date.parse(expiresAt))problem('EXPIRED','Planning authority expired before commit.');
    return {...this.#view(g,scope),state:'planned',expiresAt,requiredConfirmation:this.#confirm(g.target.object_type),requiredSecondConfirmation:fullTarget(s.customerId,g.target)};
  });}
  async retirePlan(input){
    const s=Object.freeze({...input});
    return this.#tx(async c=>{
      const g=await this.#graph(c,s),now=this.#now(),b=cleanupBinding(g,g.target,s.planId,{allowRetired:true});
      assertCleanupTargetUntouched(g,g.target);assertUnusedCleanupPlan(g,g.target,b,now);
      const previous=cleanupRetirementProof(g,g.target,b,now);
      const result=changed=>({...this.#view(g,s),planStatus:'expired',changed,targetRemoteDispatched:false,replacementCreated:false,requiresNewApproval:true,cleanupAuthority:false});
      if(previous){this.#identity(g.run);if(this.#now()<now)problem('CLOCK','Server clock moved backwards.');return result(false);}
      const details=cleanupRetirementDetails(b,g.target,s.actorPrincipalId,b.plan.status),at=new Date(now).toISOString();
      await c.query("UPDATE searchad_write_change_plans SET status='expired',last_error_json=$2::jsonb WHERE plan_id=$1",[s.planId,JSON.stringify(CLEANUP_RETIREMENT_REASON)]);
      await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) VALUES($1,$2,$3,$4,'tree_cleanup_plan_retired','expired_unused',$5,NULL,$6::jsonb,$7)`,[randomUUID(),s.hierarchyRunId,s.hierarchyObjectId,s.customerId,b.mutation.operationKey,JSON.stringify(details),at]);
      await c.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,response_json,created_at) VALUES($1,$2,'tree_cleanup_plan_retired','expired_unused',$3::jsonb,$4)`,[randomUUID(),s.planId,JSON.stringify(details),at]);
      const after=await this.#graph(c,s),finalNow=this.#now();
      if(finalNow<now)problem('CLOCK','Server clock moved backwards during retirement.');
      const settled=cleanupBinding(after,after.target,s.planId,{allowRetired:true});
      if(!cleanupRetirementProof(after,after.target,settled,finalNow))problem('RETIREMENT_PROVENANCE','Retirement did not retain its exact audit proof.');
      this.#identity(after.run);return result(true);
    });
  }
  async replan(input){
    const s=Object.freeze({...input});
    return this.#tx(async c=>{
      const g=await this.#graph(c,s);this.#available(g);
      const now=this.#now(),proof=cleanupReplacementProof(g,g.target,s.predecessorPlanId,now);
      const until=await this.#authority(c,g,s.activationId,now);
      const scope={...s,planId:randomUUID()},meta=replacementCleanupMetadata(g,g.target,s.activationId,proof),d=targetDescriptor(s.customerId,g.target,'delete'),read=targetDescriptor(s.customerId,g.target,'read');
      const at=new Date(now).toISOString(),expiresAt=new Date(Math.min(until,now+this.#ttl*1000)).toISOString();
      await c.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,rollback_json,reason,status,created_by,created_at,expires_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb,NULL,$9,'planned',$10,$11,$12)`,[scope.planId,s.customerId,d.operationKey,JSON.stringify(d),JSON.stringify(read),JSON.stringify(meta),contentHash(meta),JSON.stringify({absent:true,remoteId:g.target.remote_id}),'Explicit replacement of one retired unused cleanup plan; new approval required.',s.actorPrincipalId,at,expiresAt]);
      await this.#audit(c,g,scope,'tree_cleanup_plan','planned',{activationId:s.activationId,beforeHash:contentHash(meta),requestFingerprint:contentHash(d),actorPrincipalId:s.actorPrincipalId},at);
      const after=await this.#graph(c,scope);this.#available(after);cleanupBinding(after,after.target,scope.planId);
      await this.#authority(c,after,s.activationId,this.#now());
      const end=this.#now();if(end<now||end>=Date.parse(expiresAt))problem('EXPIRED','Replacement context or authority expired before commit.');
      return {...this.#view(after,scope),state:'planned',expiresAt,requiredConfirmation:this.#confirm(g.target.object_type),requiredSecondConfirmation:fullTarget(s.customerId,g.target)};
    });
  }
  async #approved(c,g,s,b){
    this.#available(g);
    if(s.confirmation!==this.#confirm(g.target.object_type)||s.secondConfirmation!==fullTarget(s.customerId,g.target))problem('CONFIRMATION','Exact operation and full target confirmations are required.',400);
    const a=g.approvals.find(a=>a.plan_id===s.planId&&a.token_hash===s.tokenHash);
    if(b.plan.status!=='approved'||!a||a.used_at!==null||a.confirmation!=='APPROVE_SEARCHAD_CHANGE'||!a.actor?.trim()||g.events.some(e=>e.hierarchy_object_id===s.hierarchyObjectId&&e.phase==='tree_cleanup_intent'))problem('APPROVAL','Unused separate approval and unclaimed plan are required.',403);
    const now=this.#now(),until=await this.#authority(c,g,b.meta.activationId,now);
    if(!active(b.plan.created_at,b.plan.expires_at,now)||!active(a.created_at,a.expires_at,now)||!Number.isFinite(epoch(b.plan.approved_at))||epoch(b.plan.approved_at)>now)problem('EXPIRED','Plan or token expired.');
    return {approval:a,until:Math.min(until,epoch(a.expires_at),epoch(b.plan.expires_at))};
  }
  async executionSnapshot(s){return this.#tx(async c=>{
    const g=await this.#graph(c,s),b=cleanupBinding(g,g.target,s.planId);await this.#approved(c,g,s,b);this.#gate(b.mutation);
    const order=g.leaves.includes(g.target)?[g.root,g.child,g.target]:g.target===g.child?(g.leaves.length?[...g.leaves,g.root,g.child]:[g.root,g.child]):(g.leaves.length?[...g.leaves,g.child,g.root]:[g.child,g.root]);
    return {ticket:this.#issue(g,s,'preflight',{startedAt:this.#now()}),reads:order.map(o=>targetDescriptor(s.customerId,o,'read')),identity:this.#identity(g.run)};
  });}
  async claim(ticket,observations){const v=this.#take(ticket,'preflight'),s=v.scope;return this.#tx(async c=>{
    const g=await this.#graph(c,s);this.#same(g,v);const b=cleanupBinding(g,g.target,s.planId);let a=await this.#approved(c,g,s,b);
    let valid=false;
    if(g.leaves.includes(g.target))valid=Array.isArray(observations)&&observations.length===3&&presentNode(g,g.root,observations[0])&&presentNode(g,g.child,observations[1])&&presentNode(g,g.target,observations[2]);
    else if(g.target===g.child&&g.leaves.length){
      const count=g.leaves.length;
      valid=Array.isArray(observations)&&observations.length===count+2&&observations.slice(0,count).every(observation=>observation?.kind==='absent')&&presentNode(g,g.root,observations[count])&&presentNode(g,g.child,observations[count+1]);
    } else if(g.target===g.root&&g.leaves.length){
      const count=g.leaves.length;
      valid=Array.isArray(observations)&&observations.length===count+2&&observations.slice(0,count).every(observation=>observation?.kind==='absent')&&observations[count]?.kind==='absent'&&presentNode(g,g.root,observations[count+1]);
    } else if(Array.isArray(observations)&&observations.length===2)valid=g.target===g.child?presentNode(g,g.root,observations[0])&&presentNode(g,g.child,observations[1]):observations[0]?.kind==='absent'&&presentNode(g,g.root,observations[1]);
    if(!valid)problem('PREFLIGHT','Exact stopped ancestors, descendant absence, and target observations are required.');
    const intentId=`hierarchy:tree:delete:${s.planId}`,day=new Date(this.#now()).toISOString().slice(0,10);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[intentId]);
    if((await c.query('SELECT reservation_id FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE',[intentId])).rowCount)problem('REPLAY','Previously claimed risk is never recycled.');
    await c.query(`INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at) VALUES($1,$2::date,$3,0,0,$4) ON CONFLICT(customer_id,risk_date) DO NOTHING`,[s.customerId,day,this.#capacity,new Date(this.#now()).toISOString()]);
    const balance=(await c.query('SELECT * FROM searchad_daily_risk_capacity WHERE customer_id=$1 AND risk_date=$2::date FOR UPDATE',[s.customerId,day])).rows[0];
    a=await this.#approved(c,g,s,b);const now=this.#now(),at=new Date(now).toISOString();
    if(now<v.startedAt||now-v.startedAt>=this.#age||at.slice(0,10)!==day)problem('STALE','Observation expired during the lock wait.');
    if(!balance||balance.capacity_units!==this.#capacity||balance.consumed_units+balance.reserved_units+this.#units>balance.capacity_units)problem('CAPACITY','Shared capacity is exhausted or differs from policy.');
    const used=await c.query('UPDATE searchad_write_approvals SET used_at=$2 WHERE approval_id=$1 AND used_at IS NULL RETURNING approval_id',[a.approval.approval_id,at]);if(used.rowCount!==1)problem('APPROVAL','Approval was already used.');
    await c.query('UPDATE searchad_daily_risk_capacity SET consumed_units=consumed_units+$3,updated_at=$4 WHERE customer_id=$1 AND risk_date=$2::date',[s.customerId,day,this.#units,at]);
    await c.query(`INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,consumed_at) VALUES($1,$2,$3,$4::date,$5,'delete',$6,'consumed','hierarchy_canary',$7,$8,$8,$8)`,[randomUUID(),intentId,s.customerId,day,b.mutation.operationKey,this.#units,s.hierarchyRunId,at]);
    await c.query("UPDATE searchad_hierarchy_objects SET state='delete_pending',updated_at=$2 WHERE hierarchy_object_id=$1",[s.hierarchyObjectId,at]);
    await c.query("UPDATE searchad_remote_object_ownership SET state='delete_unknown',updated_at=$2 WHERE ownership_id=$1",[g.hold.ownership_id,at]);
    await c.query("UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1",[s.planId]);
    await this.#audit(c,g,s,'tree_cleanup_intent','attempt_once',{intentId,approvalId:a.approval.approval_id,riskUnits:this.#units,riskDate:day,beforeHash:b.plan.before_hash,requestFingerprint:contentHash(b.mutation),actorPrincipalId:s.actorPrincipalId},at);
    const after=await this.#graph(c,s);await this.#authority(c,after,b.meta.activationId,this.#now());this.#gate(b.mutation);const validUntil=Math.min(a.until,v.startedAt+this.#age);
    if(this.#now()>=validUntil||new Date(this.#now()).toISOString().slice(0,10)!==day)problem('EXPIRED','Dispatch authority or observation expired before commit.');
    return {ticket:this.#issue(after,s,'send'),descriptor:b.mutation,identity:this.#identity(g.run),validUntil,riskDate:day};
  });}
  async recordSend(ticket,status){const v=this.#take(ticket,'send'),s=v.scope;return this.#tx(async c=>{
    const g=await this.#graph(c,s);this.#same(g,v);const b=cleanupBinding(g,g.target,s.planId);claimedProof(g,g.target,b);
    await this.#audit(c,g,s,'tree_cleanup_result',[200,204].includes(status)?'accepted':'unknown',{upstreamStatus:Number.isInteger(status)?status:null,beforeHash:b.plan.before_hash});this.#identity(g.run);
    return this.#view(g,s);
  });}
  async observationSnapshot(s){return this.#tx(async c=>{
    const g=await this.#graph(c,s),b=cleanupBinding(g,g.target,s.planId);claimedProof(g,g.target,b);
    if(g.target===g.root)deletedProof(g,g.child);
    if(g.target.state==='deleted'){deletedProof(g,g.target);return {projection:this.#view(g,s)};}
    if(!['delete_pending','delete_unknown','manual_review'].includes(g.target.state)||!['delete_unknown','manual_review'].includes(g.hold.state)||!['unknown_outcome','manual_review'].includes(b.plan.status))problem('STATE','No pending approved deletion can be observed.');
    return {ticket:this.#issue(g,s,'observation',{startedAt:this.#now()}),descriptor:b.read,identity:this.#identity(g.run)};
  });}
  async observe(ticket,observation){const v=this.#take(ticket,'observation'),s=v.scope;return this.#tx(async c=>{
    const g=await this.#graph(c,s);this.#same(g,v);const b=cleanupBinding(g,g.target,s.planId);claimedProof(g,g.target,b);if(g.target===g.root)deletedProof(g,g.child);
    this.#fresh(v);const kind=observation?.kind;
    const present=kind==='present'&&presentNode(g,g.target,observation);
    const observed=kind==='absent'?'absent':kind==='unavailable'?'unavailable':present?'present':'mismatch';
    const state=observed==='absent'?'deleted':observed==='mismatch'?'manual_review':'delete_unknown',at=new Date(this.#now()).toISOString();
    await c.query('UPDATE searchad_hierarchy_objects SET state=$2,updated_at=$3,deleted_at=$4 WHERE hierarchy_object_id=$1',[s.hierarchyObjectId,state,at,state==='deleted'?at:null]);
    await c.query('UPDATE searchad_remote_object_ownership SET state=$2,updated_at=$3 WHERE ownership_id=$1',[g.hold.ownership_id,state==='deleted'?'deleted':state==='manual_review'?'manual_review':'delete_unknown',at]);
    if(state==='deleted')await c.query("UPDATE searchad_write_change_plans SET status='applied',applied_at=$2,applied_after_json=$3::jsonb,applied_after_hash=$4 WHERE plan_id=$1",[s.planId,at,JSON.stringify(b.plan.expected_after_json),contentHash(b.plan.expected_after_json)]);
    else await c.query('UPDATE searchad_write_change_plans SET status=$2 WHERE plan_id=$1',[s.planId,state==='manual_review'?'manual_review':'unknown_outcome']);
    await c.query('UPDATE searchad_hierarchy_canary_runs SET status=$2 WHERE hierarchy_run_id=$1',[s.hierarchyRunId,g.siblingCreate?.partial===true?'manual_review':'cleanup_pending']);
    await this.#audit(c,g,s,'tree_cleanup_observation',observed,{readOnly:true,remoteId:g.target.remote_id,beforeHash:b.plan.before_hash,upstreamStatus:observed==='absent'?404:kind==='present'?200:null},at);
    this.#identity(g.run);this.#fresh(v);return {...this.#view(g,s),state};
  });}
}
