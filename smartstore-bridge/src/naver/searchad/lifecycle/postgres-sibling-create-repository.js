import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_APPROVAL_CONFIRMATION } from '../write/approval-service.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { campaignResponse } from './postgres-campaign-create-repository.js';
import { adgroupResponse } from './adgroup-create-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { KEYWORD_FIELDS, CREATIVE_FIELDS, keywordBatchOutcome, keywordBatchResponse, keywordReadResponse, creativeResponse } from './sibling-create-contract.js';
import { ADGROUP_GENERATION_UUID, resolveAdgroupGenerationHistory } from './adgroup-generation-contract.js';
import { resolveSiblingGenerationHistory, buildSiblingReplacementBinding } from './sibling-generation-contract.js';

const IDENTITY={specSha:'spec_sha',credentialFingerprint:'credential_fingerprint',upstreamBaseUrl:'upstream_base_url'};
const epoch=v=>v instanceof Date?v.getTime():Date.parse(v);
const active=(a,b,n)=>Number.isFinite(epoch(a))&&epoch(a)<=n&&Number.isFinite(epoch(b))&&epoch(b)>n;
const sameSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&a.every(v=>b.includes(v));
const fail=(code,message,status=409)=>{throw new SearchAdWriteError(`SEARCHAD_SIBLING_${code}`,message,{},status);};

export class PostgresSiblingCreateRepository {
  #pool;#rootRecipe;#recipe;#current;#gate;#clock;#ttl;#age;#units;#capacity;#tickets=new WeakMap();
  constructor({pool,dailyBudget,keywordTexts,current,gate,clock,planTtlSeconds,preflightMaxAgeMs,riskUnits,dailyCapacityUnits}){
    this.#pool=pool;this.#rootRecipe=createHierarchyCampaignRecipe({dailyBudget});this.#recipe=createHierarchyChildRecipe({keywordTexts});this.#current=current;this.#gate=gate;this.#clock=clock;this.#ttl=planTtlSeconds;this.#age=preflightMaxAgeMs;this.#units=riskUnits;this.#capacity=dailyCapacityUnits;
  }
  #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||!Number.isFinite(new Date(n).getTime()))fail('CLOCK','Invalid server clock.',503);return n;}
  #identity(run){const v=this.#current(run.customer_id);if(!v||typeof v.then==='function'||Object.entries(IDENTITY).some(([k,c])=>!v[k]||v[k]!==run[c]))fail('CONTEXT','Current identity differs from the persisted hierarchy.',409);return v;}
  async #tx(work){let c,committing=false,discard=false;try{c=await this.#pool.connect();await c.query('BEGIN');const v=await work(c);committing=true;await c.query('COMMIT');return v;}catch(e){if(committing){discard=true;fail('COMMIT_UNKNOWN','Commit acknowledgement is unknown; no send permission is issued.',503);}if(c)try{await c.query('ROLLBACK');}catch{discard=true;}if(e instanceof SearchAdWriteError)throw e;fail('STORE','Sibling persistence failed; inspect without replay.',503);}finally{if(c)c.release(discard);}}
  async #graph(c,s){
    const account=(await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',[s.customerId])).rows[0];
    const run=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE',[s.hierarchyRunId,s.customerId])).rows[0];
    if(!run)fail('NOT_FOUND','Hierarchy run not found.',404);
    const objects=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 OR parent_object_id IN (SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1) ORDER BY hierarchy_object_id FOR UPDATE',[s.hierarchyRunId])).rows;
    const holds=(await c.query('SELECT *,xmin::text AS version FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) OR parent_hierarchy_object_id=ANY($2::uuid[]) ORDER BY ownership_id FOR UPDATE',[s.hierarchyRunId,objects.map(o=>o.hierarchy_object_id)])).rows;
    const events=(await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) ORDER BY event_id',[s.hierarchyRunId,objects.map(o=>o.hierarchy_object_id)])).rows;
    if(objects.some(o=>o.customer_id!==s.customerId||o.hierarchy_run_id!==s.hierarchyRunId)||
      holds.some(h=>h.customer_id!==s.customerId||h.owner_kind!=='hierarchy_canary'||h.owner_run_id!==s.hierarchyRunId)||
      events.some(e=>e.customer_id!==s.customerId||e.hierarchy_run_id!==s.hierarchyRunId))fail('GRAPH','Foreign linked hierarchy history cannot be ignored.');
    const root=objects.find(o=>o.object_type==='campaign');
    if(!root||root.parent_object_id!==null||root.state!=='owned'||root.deleted_at||run.completed_at!==null)fail('GRAPH','Exact owned campaign root is required.');
    const rootHold=holds.find(h=>h.hierarchy_object_id===root.hierarchy_object_id);
    if(!rootHold||rootHold.state!=='owned'||rootHold.remote_id!==root.remote_id)fail('GRAPH','Owned root hold is required.');
    const allPlanIds=[...new Set(events.map(e=>e.details_json?.planId).filter(id=>typeof id==='string'&&ADGROUP_GENERATION_UUID.test(id)))];
    if(s.planId&&ADGROUP_GENERATION_UUID.test(s.planId)&&!allPlanIds.includes(s.planId))allPlanIds.push(s.planId);
    if(s.predecessorPlanId&&!allPlanIds.includes(s.predecessorPlanId))allPlanIds.push(s.predecessorPlanId);
    const plans=(await c.query("SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=ANY($1::uuid[]) OR before_json->>'hierarchyRunId'=$2 ORDER BY plan_id FOR UPDATE",[allPlanIds,s.hierarchyRunId])).rows;
    if(plans.some(p=>p.customer_id!==s.customerId))fail('GRAPH','Foreign linked plans cannot be ignored.');
    for(const p of plans)if(!allPlanIds.includes(p.plan_id))allPlanIds.push(p.plan_id);
    const approvals=allPlanIds.length?(await c.query('SELECT *,xmin::text AS version FROM searchad_write_approvals WHERE plan_id=ANY($1::uuid[]) ORDER BY approval_id FOR UPDATE',[allPlanIds])).rows:[];
    const locks=allPlanIds.length?(await c.query('SELECT *,xmin::text AS version FROM searchad_write_locks WHERE plan_id=ANY($1::uuid[]) ORDER BY plan_id FOR UPDATE',[allPlanIds])).rows:[];
    const attempts=allPlanIds.length?(await c.query('SELECT *,xmin::text AS version FROM searchad_write_attempts WHERE plan_id=ANY($1::uuid[]) ORDER BY attempt_id FOR UPDATE',[allPlanIds])).rows:[];
    const risks=(await c.query('SELECT *,xmin::text AS version FROM searchad_risk_reservations WHERE owner_run_id=$1 OR intent_id LIKE ANY($2::text[]) ORDER BY reservation_id FOR UPDATE',[s.hierarchyRunId,allPlanIds.map(id=>`%:${id}`)])).rows;
    const rootResults=events.filter(e=>e.hierarchy_object_id===root.hierarchy_object_id&&e.phase==='create_result');
    const rootPlan=rootResults.length===1?plans.find(p=>p.plan_id===rootResults[0].details_json?.planId):null;
    const rootDescriptor=this.#rootRecipe.createCampaign({customerId:s.customerId,hierarchyRunId:s.hierarchyRunId});
    const rootSnapshot={customerId:s.customerId,nccCampaignId:root.remote_id,...rootDescriptor.body};
    if(!rootPlan||rootPlan.status!=='applied'||!equal(rootPlan.mutation_json,rootDescriptor)||!equal(rootPlan.applied_after_json,rootSnapshot)||rootPlan.applied_after_hash!==contentHash(rootSnapshot))fail('PROVENANCE','Verified server-created root snapshot is required.');
    const g={account,run,objects,holds,events,plans,approvals,locks,attempts,risks,root,rootPlan};
    g.generation=resolveAdgroupGenerationHistory(g,s.parentObjectId,(code,message)=>fail(code,message));
    const parent=g.generation.active;
    if(!parent||parent.state!=='owned'||parent.deleted_at!==null)fail('GRAPH','Sibling creation requires the current verified owned adgroup generation.');
    const parentHold=holds.find(h=>h.hierarchy_object_id===parent.hierarchy_object_id);
    if(!parentHold||parentHold.state!=='owned'||parentHold.remote_id!==parent.remote_id||parentHold.customer_id!==s.customerId||parentHold.parent_hierarchy_object_id!==root.hierarchy_object_id)fail('GRAPH','Current adgroup ownership hold is required.');
    const parentPlan=g.generation.activeBinding.plan;
    const parentDescriptor=g.generation.descriptor;
    const parentSnapshot={customerId:s.customerId,nccAdgroupId:parent.remote_id,...parentDescriptor.body};
    if(parentPlan.status!=='applied'||!equal(parentPlan.applied_after_json,parentSnapshot)||parentPlan.applied_after_hash!==contentHash(parentSnapshot))fail('PROVENANCE','Current adgroup must retain its verified applied snapshot.');
    const plan=s.planId?plans.find(p=>p.plan_id===s.planId&&p.customer_id===s.customerId):null;
    const childObjects=objects.filter(o=>['keyword','creative'].includes(o.object_type));
    if(childObjects.some(o=>o.parent_object_id!==parent.hierarchy_object_id))fail('GRAPH','All sibling leaves must belong to the current adgroup generation.');
    this.#identity(run);
    return {...g,parent,parentHold,parentPlan,rootDescriptor,parentDescriptor,plan,childObjects};
  }
  #available(g){if(!g.account||g.account.suspended!==false)fail('SUSPENDED','Customer is suspended or unavailable.',403);if(g.run.status!=='cleanup_pending')fail('STATE','Sibling creation requires cleanup_pending hierarchy state.');if(g.events.some(e=>e.phase.startsWith('tree_cleanup_')))fail('CLEANUP','Cleanup has begun; no sibling creation is allowed.');}
  async #authority(c,g,id,kind,now){
    this.#identity(g.run);const op=kind==='keywords'?OPS.keyword.create:OPS.creative.create,fields=kind==='keywords'?KEYWORD_FIELDS:CREATIVE_FIELDS,lifecycle=kind==='keywords'?'batch_create':'create';
    const grant=(await c.query('SELECT * FROM searchad_activation_grants WHERE activation_id=$1',[id])).rows[0],e=grant?(await c.query('SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1',[grant.evidence_id])).rows[0]:null;
    if(!grant||!e||[grant,e].some(v=>v.customer_id!==g.run.customer_id||v.evidence_type!=='active_canary'||Object.values(IDENTITY).some(k=>v[k]!==g.run[k])||!equal(v.operation_keys_json,[op])||!equal(v.lifecycle_kinds_json,[lifecycle])||!sameSet(v.field_scope_json,fields))||e.result!=='verified'||!active(grant.activated_at,grant.expires_at,now)||!active(e.created_at,e.expires_at,now))fail('AUTHORITY','Exact current sibling creation authority is required.',403);
    return Math.min(epoch(grant.expires_at),epoch(e.expires_at));
  }
  #descriptor(g,kind){const parent={customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,objectType:'adgroup',state:'owned',remoteId:g.parent.remote_id};return kind==='keywords'?this.#recipe.createKeywords({customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,parent}):this.#recipe.createCreative({customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,parent});}
  #signature(g){return JSON.stringify([g.run.version,g.objects.map(o=>[o.hierarchy_object_id,o.version]),g.holds.map(h=>[h.ownership_id,h.version]),g.plans.map(p=>[p.plan_id,p.version]),g.approvals.map(a=>[a.approval_id,a.version]),g.locks.map(l=>[l.plan_id,l.version]),g.attempts.map(a=>[a.attempt_id,a.version]),g.risks.map(r=>[r.reservation_id,r.version]),g.events.map(e=>e.event_id)]);}
  #issue(g,s,stage,extra={}){const t=Object.freeze({});this.#tickets.set(t,{scope:structuredClone(s),signature:this.#signature(g),stage,...extra});return t;}
  #take(t,stage){const v=this.#tickets.get(t);this.#tickets.delete(t);if(!v||v.stage!==stage)fail('TICKET','Unused internal ticket required.');return v;}
  #same(g,v){if(this.#signature(g)!==v.signature)fail('STALE','Hierarchy changed during I/O; do not replay.');}
  async #audit(c,s,phase,status,op,lifecycle,details,at=new Date(this.#now()).toISOString()){await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[randomUUID(),s.hierarchyRunId,s.objectIds?.[0]??null,s.customerId,phase,status,op,lifecycle,JSON.stringify({planId:s.planId,...details}),at]);await c.query('INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,response_json,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[randomUUID(),s.planId,phase,status,JSON.stringify(details),at]);}
  async prepare(s,kind){return this.#tx(async c=>{
    const g=await this.#graph(c,s);this.#available(g);if(g.childObjects.length)fail('PRIOR_CHILD','This bounded slice requires no existing keyword/creative siblings.');
    const until=await this.#authority(c,g,s.activationId,kind,this.#now()),descriptor=this.#descriptor(g,kind),count=kind==='keywords'?descriptor.body.length:1,objectIds=Array.from({length:count},()=>randomUUID()),planId=randomUUID(),op=kind==='keywords'?OPS.keyword.create:OPS.creative.create,lifecycle=kind==='keywords'?'batch_create':'create';
    const meta={kind:`haar_${kind}_create_v1`,customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,parentObjectId:s.parentObjectId,parentRemoteId:g.parent.remote_id,rootObjectId:g.root.hierarchy_object_id,rootRemoteId:g.root.remote_id,activationId:s.activationId,objectIds};const now=this.#now(),at=new Date(now).toISOString(),expiresAt=new Date(Math.min(until,now+this.#ttl*1000)).toISOString();
    for(const id of objectIds)await c.query(`INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9,$9)`,[id,s.hierarchyRunId,s.customerId,kind==='keywords'?'keyword':'creative',s.parentObjectId,op,kind==='keywords'?OPS.keyword.read:OPS.creative.read,kind==='keywords'?OPS.keyword.delete:OPS.creative.delete,at]);
    await c.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,rollback_json,reason,status,created_by,created_at,expires_at) VALUES($1,$2,$3,$4::jsonb,'{}',$5::jsonb,$6,$7::jsonb,NULL,$8,'planned',$9,$10,$11)`,[planId,s.customerId,op,JSON.stringify(descriptor),JSON.stringify(meta),contentHash(meta),JSON.stringify(descriptor.body),`Create bounded ${kind} sibling(s) under verified adgroup.`,s.actorPrincipalId,at,expiresAt]);
    const scope={...s,planId,objectIds};await this.#audit(c,scope,'sibling_plan','planned',op,lifecycle,{kind,activationId:s.activationId,beforeHash:contentHash(meta),requestFingerprint:contentHash(descriptor),objectIds},at);await this.#authority(c,g,s.activationId,kind,this.#now());if(this.#now()>=Date.parse(expiresAt))fail('EXPIRED','Plan expired before commit.');return {customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,parentObjectId:s.parentObjectId,planId,objectIds,kind,state:'planned',expiresAt};
  });}
  #binding(g,s,kind){
    const e=g.events.find(e=>e.phase==='sibling_plan'&&e.details_json?.planId===s.planId),p=g.plan,descriptor=this.#descriptor(g,kind);
    if(!e||!p||e.details_json.kind!==kind||p.mutation_operation_key!==descriptor.operationKey||!equal(p.mutation_json,descriptor)||!equal(p.expected_after_json,descriptor.body)||p.rollback_json!==null)fail('PLAN','Exact separately approved sibling plan is required.');
    let history=null;
    if(p.before_json?.generation!==undefined||g.events.some(e=>e.phase==='sibling_plan_retired')){
      history=resolveSiblingGenerationHistory(g,{kind,descriptor,now:this.#now()});
      if(history.active?.planId!==s.planId)fail('PLAN','Only the current proven sibling generation may execute.');
    }
    const b={e,p,descriptor,meta:p.before_json,history};
    b.objects=this.#planObjects(g,s,kind,b);return b;
  }
  #planObjects(g,s,kind,b){
    const ids=b.meta?.objectIds,type=kind==='keywords'?'keyword':'creative';
    if(!Array.isArray(ids)||ids.length!==(kind==='keywords'?b.descriptor.body.length:1)||
      ids.some(id=>typeof id!=='string'||!ADGROUP_GENERATION_UUID.test(id))||new Set(ids).size!==ids.length||
      !equal(b.e.details_json?.objectIds,ids))fail('PLAN','Exact unique plan-local object IDs are required.');
    const selected=g.objects.filter(o=>ids.includes(o.hierarchy_object_id));
    if(selected.length!==ids.length||selected.some(o=>o.customer_id!==s.customerId||o.hierarchy_run_id!==s.hierarchyRunId||
      o.parent_object_id!==s.parentObjectId||o.object_type!==type||o.create_operation_key!==OPS[type].create||
      o.read_operation_key!==OPS[type].read||o.delete_operation_key!==OPS[type].delete))fail('PLAN','Every selected object must belong to this exact plan scope.');
    if(!b.history&&g.childObjects.length!==selected.length)fail('PLAN','Unproven additional siblings are not an execution target.');
    // Do not reinterpret generation-1 snapshots, which historically used SQL UUID order.
    return b.history?.active?.generation===2?ids.map(id=>selected.find(o=>o.hierarchy_object_id===id)):selected;
  }
  async prepareReplacement(input,kind){
    const keys=['customerId','hierarchyRunId','parentObjectId','predecessorPlanId','activationId','actorPrincipalId'];
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||
      Object.keys(input).some(k=>!keys.includes(k))||!['keywords','creative'].includes(kind))fail('INPUT_INVALID','Exact internal replacement scope is required.',400);
    const s=Object.freeze(Object.fromEntries(keys.map(k=>[k,input[k]])));
    if(typeof s.customerId!=='string'||!/^\d{1,30}$/.test(s.customerId)||
      keys.filter(k=>k.endsWith('Id')&&k!=='customerId'&&k!=='actorPrincipalId').some(k=>typeof s[k]!=='string'||!ADGROUP_GENERATION_UUID.test(s[k]))||
      typeof s.actorPrincipalId!=='string'||!s.actorPrincipalId.trim()||s.actorPrincipalId!==s.actorPrincipalId.trim())fail('INPUT_INVALID','Invalid internal replacement identifiers.',400);
    return this.#tx(async c=>{
      let g=await this.#graph(c,s);this.#available(g);
      const signature=this.#signature(g),started=this.#now(),descriptor=this.#descriptor(g,kind);
      const until=await this.#authority(c,g,s.activationId,kind,started);
      // Authority I/O must not make a previously checked graph a stale capability.
      g=await this.#graph(c,s);this.#available(g);
      if(this.#signature(g)!==signature||this.#now()<started)fail('STALE','Replacement history changed during authority verification.');
      const now=this.#now(),history=resolveSiblingGenerationHistory(g,{kind,descriptor,now});
      if(history.predecessor?.planId!==s.predecessorPlanId||history.nextGeneration!==2||history.active!==null)fail('PLAN','One exact retired predecessor without a successor is required.');
      const objectIds=history.predecessor.objectIds.map(()=>randomUUID()),planId=randomUUID(),at=new Date(now).toISOString();
      const expiresAt=new Date(Math.min(until,now+this.#ttl*1000)).toISOString();
      if(Date.parse(expiresAt)<=now)fail('EXPIRED','Replacement authority has expired.');
      const binding=buildSiblingReplacementBinding(history,{planId,objectIds,activationId:s.activationId,createdAt:at}),meta=binding.metadata;
      const type=kind==='keywords'?'keyword':'creative',op=OPS[type],lifecycle=kind==='keywords'?'batch_create':'create';
      for(const id of objectIds)await c.query(`INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9,$9)`,[id,s.hierarchyRunId,s.customerId,type,s.parentObjectId,op.create,op.read,op.delete,at]);
      await c.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,rollback_json,reason,status,created_by,created_at,expires_at) VALUES($1,$2,$3,$4::jsonb,'{}',$5::jsonb,$6,$7::jsonb,NULL,$8,'planned',$9,$10,$11)`,[planId,s.customerId,op.create,JSON.stringify(descriptor),JSON.stringify(meta),contentHash(meta),JSON.stringify(descriptor.body),`Prepare one proof-bound replacement ${kind} plan.`,s.actorPrincipalId,at,expiresAt]);
      await this.#audit(c,{...s,planId,objectIds},'sibling_plan','planned',op.create,lifecycle,binding.planningAttemptDetails,at);
      const after=await this.#graph(c,{...s,planId});this.#available(after);
      const activeHistory=resolveSiblingGenerationHistory(after,{kind,descriptor,now:this.#now()});
      if(activeHistory.active?.planId!==planId||!equal(activeHistory.active.objectIds,objectIds))fail('PLAN','Replacement history was not persisted exactly.');
      await this.#authority(c,after,s.activationId,kind,this.#now());
      const finalGraph=await this.#graph(c,{...s,planId});this.#available(finalGraph);
      if(this.#signature(finalGraph)!==this.#signature(after))fail('STALE','Replacement graph changed during final authority verification.');
      this.#binding(finalGraph,{...s,planId},kind);this.#identity(finalGraph.run);
      const end=this.#now();if(end<now||end>=Date.parse(expiresAt))fail('EXPIRED','Replacement expired or clock changed before commit.');
      return Object.freeze({customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,parentObjectId:s.parentObjectId,
        planId,objectIds:Object.freeze([...objectIds]),kind,generation:2,predecessorPlanId:s.predecessorPlanId,state:'planned',expiresAt,requiresNewApproval:true,targetRemoteDispatched:false});
    });
  }
  async #approved(c,g,s,kind,b){this.#available(g);if(b.p.status!=='approved')fail('REPLAY','Only a separately approved, unclaimed sibling plan may execute.');const a=(await c.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1 AND token_hash=$2 FOR UPDATE',[s.planId,s.tokenHash])).rows[0];if(!a||a.used_at!==null||a.confirmation!==SEARCHAD_APPROVAL_CONFIRMATION||!a.actor?.trim())fail('APPROVAL','Unused approval token required.',403);const n=this.#now(),until=await this.#authority(c,g,b.meta.activationId,kind,n);if(!active(b.p.created_at,b.p.expires_at,n)||!active(a.created_at,a.expires_at,n))fail('EXPIRED','Plan or approval expired.');return {a,until:Math.min(until,epoch(a.expires_at),epoch(b.p.expires_at))};}
  async executionSnapshot(s,kind){return this.#tx(async c=>{const g=await this.#graph(c,s),b=this.#binding(g,s,kind);await this.#approved(c,g,s,kind,b);this.#gate(b.descriptor);return {ticket:this.#issue(g,s,'preflight',{startedAt:this.#now(),kind}),reads:[{operationKey:OPS.campaign.read,customerId:s.customerId,pathParams:{campaignId:g.root.remote_id}},{operationKey:OPS.adgroup.read,customerId:s.customerId,pathParams:{adgroupId:g.parent.remote_id}}],identity:this.#identity(g.run)};});}
  async claim(ticket,observations){const v=this.#take(ticket,'preflight'),s=v.scope,kind=v.kind;return this.#tx(async c=>{const g=await this.#graph(c,s);this.#same(g,v);const b=this.#binding(g,s,kind);let a=await this.#approved(c,g,s,kind,b);if(!Array.isArray(observations)||observations.length!==2||!campaignResponse(observations[0],g.rootDescriptor,false,g.root.remote_id)||!adgroupResponse(observations[1],g.parentDescriptor,false,g.parent.remote_id))fail('PREFLIGHT','Exact stopped ancestor and adgroup observations required.');const intentId=`hierarchy:sibling:${kind}:${s.planId}`,day=new Date(this.#now()).toISOString().slice(0,10);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[intentId]);if((await c.query('SELECT 1 FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE',[intentId])).rowCount)fail('REPLAY','Prior sibling intent cannot be replayed.');await c.query(`INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at) VALUES($1,$2::date,$3,0,0,$4) ON CONFLICT(customer_id,risk_date) DO NOTHING`,[s.customerId,day,this.#capacity,new Date(this.#now()).toISOString()]);const cap=(await c.query('SELECT * FROM searchad_daily_risk_capacity WHERE customer_id=$1 AND risk_date=$2::date FOR UPDATE',[s.customerId,day])).rows[0];a=await this.#approved(c,g,s,kind,b);const now=this.#now(),at=new Date(now).toISOString();if(now-v.startedAt>=this.#age||at.slice(0,10)!==day||!cap||cap.capacity_units!==this.#capacity||cap.reserved_units+cap.consumed_units+this.#units>cap.capacity_units)fail('STALE','Freshness or risk capacity changed.');const used=await c.query('UPDATE searchad_write_approvals SET used_at=$2 WHERE approval_id=$1 AND used_at IS NULL RETURNING approval_id',[a.a.approval_id,at]);if(used.rowCount!==1)fail('APPROVAL','Approval already used.');await c.query('UPDATE searchad_daily_risk_capacity SET consumed_units=consumed_units+$3,updated_at=$4 WHERE customer_id=$1 AND risk_date=$2::date',[s.customerId,day,this.#units,at]);await c.query(`INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,consumed_at) VALUES($1,$2,$3,$4::date,$5,$6,$7,'consumed','hierarchy_canary',$8,$9,$9,$9)`,[randomUUID(),intentId,s.customerId,day,b.descriptor.operationKey,kind==='keywords'?'batch_create':'create',this.#units,s.hierarchyRunId,at]);const claimed=await c.query("UPDATE searchad_hierarchy_objects SET state='dispatching',updated_at=$2 WHERE hierarchy_run_id=$1 AND object_type=$3 AND hierarchy_object_id=ANY($4::uuid[]) AND customer_id=$5 AND parent_object_id=$6 AND state='planned' AND remote_id IS NULL AND deleted_at IS NULL RETURNING hierarchy_object_id",[s.hierarchyRunId,at,kind==='keywords'?'keyword':'creative',b.meta.objectIds,s.customerId,s.parentObjectId]);if(claimed.rowCount!==b.meta.objectIds.length)fail('STATE','The complete current-plan batch must be claimed together.');await c.query("UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1",[s.planId]);await c.query("UPDATE searchad_hierarchy_canary_runs SET status='unknown_outcome' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);await this.#audit(c,{...s,objectIds:b.meta.objectIds},'sibling_dispatch_intent','attempt_once',b.descriptor.operationKey,kind==='keywords'?'batch_create':'create',{kind,intentId,approvalId:a.a.approval_id,riskDate:day,riskUnits:this.#units},at);const after=await this.#graph(c,s),validUntil=Math.min(a.until,v.startedAt+this.#age);if(this.#now()>=validUntil)fail('EXPIRED','Authority expired before commit.');return {ticket:this.#issue(after,s,'send',{kind}),ownedObjectIds:Object.freeze([...b.meta.objectIds]),descriptor:structuredClone(b.descriptor),identity:this.#identity(g.run),validUntil,riskDate:day};});}
  async #settle(ticket,stage,work){const v=this.#take(ticket,stage);return this.#tx(async c=>{const g=await this.#graph(c,v.scope);this.#same(g,v);return work(c,g,v.scope,v.kind);});}
  async capture(ticket,result,{unavailable=false}={}){return this.#settle(ticket,'send',async(c,g,s,kind)=>{
    const b=this.#binding(g,s,kind),objects=b.objects;const at=new Date(this.#now()).toISOString();let ids=null,keywordOutcome=null;
    if(!unavailable){
      if(kind==='keywords'){keywordOutcome=keywordBatchOutcome(result,b.descriptor);ids=keywordOutcome?.kind==='exact'?keywordBatchResponse(result,b.descriptor):null;}
      else{const d=creativeResponse(result,b.descriptor,true);ids=d?[d.nccAdId]:null;}
    }
    if(!ids){
      const state=unavailable?'create_unknown':'manual_review';
      if(!unavailable&&kind==='keywords'&&keywordOutcome?.kind==='partial'){
        const recovered=new Map(keywordOutcome.items.map(item=>[item.index,item.remoteId]));
        for(let i=0;i<objects.length;i+=1){
          const remoteId=recovered.get(i);
          if(remoteId){
            await c.query("UPDATE searchad_hierarchy_objects SET remote_id=$2,state='manual_review',updated_at=$3 WHERE hierarchy_object_id=$1",[objects[i].hierarchy_object_id,remoteId,at]);
            await c.query(`INSERT INTO searchad_remote_object_ownership(ownership_id,customer_id,object_type,remote_id,owner_kind,owner_run_id,hierarchy_object_id,parent_hierarchy_object_id,created_operation_key,state,created_at,updated_at) VALUES($1,$2,'keyword',$3,'hierarchy_canary',$4,$5,$6,$7,'manual_review',$8,$8)`,[randomUUID(),s.customerId,remoteId,s.hierarchyRunId,objects[i].hierarchy_object_id,s.parentObjectId,b.descriptor.operationKey,at]);
          }else await c.query("UPDATE searchad_hierarchy_objects SET state='manual_review',updated_at=$2 WHERE hierarchy_object_id=$1",[objects[i].hierarchy_object_id,at]);
        }
        await c.query("UPDATE searchad_write_change_plans SET status='manual_review' WHERE plan_id=$1",[s.planId]);
        await c.query("UPDATE searchad_hierarchy_canary_runs SET status='manual_review' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);
        const quarantined=keywordOutcome.items.map(item=>({index:item.index,objectId:objects[item.index].hierarchy_object_id,remoteId:item.remoteId}));
        const remoteIds=quarantined.map(item=>item.remoteId);
        await this.#audit(c,{...s,objectIds:b.meta.objectIds},'sibling_create_result','partial_ids_recorded',b.descriptor.operationKey,'batch_create',{kind,returnedIdsRecorded:true,count:remoteIds.length,partial:true,quarantined},at);
        return {projection:{...s,kind,state:'manual_review',remoteIds},ticket:null};
      }
      for(const o of objects)await c.query('UPDATE searchad_hierarchy_objects SET state=$2,updated_at=$3 WHERE hierarchy_object_id=$1',[o.hierarchy_object_id,state,at]);
      await c.query('UPDATE searchad_write_change_plans SET status=$2 WHERE plan_id=$1',[s.planId,state==='manual_review'?'manual_review':'unknown_outcome']);
      await c.query('UPDATE searchad_hierarchy_canary_runs SET status=$2 WHERE hierarchy_run_id=$1',[s.hierarchyRunId,state==='manual_review'?'manual_review':'unknown_outcome']);
      await this.#audit(c,{...s,objectIds:b.meta.objectIds},'sibling_create_result',unavailable?'outcome_unknown':'mismatch',b.descriptor.operationKey,kind==='keywords'?'batch_create':'create',{kind,returnedIdsRecorded:false},at);
      return {projection:{...s,kind,state},ticket:null};
    }
    for(let i=0;i<objects.length;i+=1){await c.query("UPDATE searchad_hierarchy_objects SET remote_id=$2,state='create_unknown',updated_at=$3 WHERE hierarchy_object_id=$1",[objects[i].hierarchy_object_id,ids[i],at]);await c.query(`INSERT INTO searchad_remote_object_ownership(ownership_id,customer_id,object_type,remote_id,owner_kind,owner_run_id,hierarchy_object_id,parent_hierarchy_object_id,created_operation_key,state,created_at,updated_at) VALUES($1,$2,$3,$4,'hierarchy_canary',$5,$6,$7,$8,'manual_review',$9,$9)`,[randomUUID(),s.customerId,kind==='keywords'?'keyword':'creative',ids[i],s.hierarchyRunId,objects[i].hierarchy_object_id,s.parentObjectId,b.descriptor.operationKey,at]);}
    await this.#audit(c,{...s,objectIds:b.meta.objectIds},'sibling_create_result','returned_ids_recorded',b.descriptor.operationKey,kind==='keywords'?'batch_create':'create',{kind,returnedIdsRecorded:true,count:ids.length},at);const after=await this.#graph(c,s);return {projection:{...s,kind,state:'create_unknown',remoteIds:ids},ticket:this.#issue(after,s,'verify',{kind})};
  });}
  async verify(ticket,results,{unavailable=false,contextMismatch=false}={}){return this.#settle(ticket,'verify',async(c,g,s,kind)=>{const b=this.#binding(g,s,kind),objects=b.objects;if(objects.some(o=>o.state!=='create_unknown'||!o.remote_id))fail('STATE','Returned IDs must be held pending verification.');let ok=!unavailable&&!contextMismatch;if(ok&&kind==='keywords'){if(!Array.isArray(results)||results.length!==objects.length)ok=false;else for(let i=0;i<objects.length;i+=1)ok=ok&&Boolean(keywordReadResponse(results[i],{customerId:s.customerId,parentRemoteId:g.parent.remote_id,remoteId:objects[i].remote_id,keyword:b.descriptor.body[i].keyword}));}else if(ok)ok=Boolean(creativeResponse(results,b.descriptor,false,objects[0].remote_id));const state=ok?'owned':unavailable&&!contextMismatch?'create_unknown':'manual_review',at=new Date(this.#now()).toISOString();for(const o of objects){await c.query('UPDATE searchad_hierarchy_objects SET state=$2,updated_at=$3 WHERE hierarchy_object_id=$1',[o.hierarchy_object_id,state,at]);const h=g.holds.find(h=>h.hierarchy_object_id===o.hierarchy_object_id);await c.query('UPDATE searchad_remote_object_ownership SET state=$2,updated_at=$3 WHERE ownership_id=$1',[h.ownership_id,ok?'owned':state==='manual_review'?'manual_review':'manual_review',at]);}if(ok){const applied=objects.map(o=>({objectType:o.object_type,remoteId:o.remote_id,parentObjectId:s.parentObjectId}));await c.query("UPDATE searchad_write_change_plans SET status='applied',applied_at=$2,applied_after_json=$3::jsonb,applied_after_hash=$4 WHERE plan_id=$1",[s.planId,at,JSON.stringify(applied),contentHash(applied)]);await c.query("UPDATE searchad_hierarchy_canary_runs SET status='cleanup_pending' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);}else if(state==='manual_review'){await c.query("UPDATE searchad_write_change_plans SET status='manual_review' WHERE plan_id=$1",[s.planId]);await c.query("UPDATE searchad_hierarchy_canary_runs SET status='manual_review' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);}await this.#audit(c,{...s,objectIds:b.meta.objectIds},'sibling_create_verification',ok?'verified':state==='manual_review'?'mismatch':'unavailable',b.descriptor.operationKey,kind==='keywords'?'batch_create':'create',{kind,readOnly:true},at);if(ok)this.#identity(g.run);return {...s,kind,state,remoteIds:objects.map(o=>o.remote_id)};});}
}
