import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_APPROVAL_CONFIRMATION } from '../write/approval-service.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { fail, record } from './postgres-campaign-create-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { hasUnprovenInventory } from './inventory-cleanup-fence.js';
import { ROOT_CLEANUP_RETIREMENT_REASON, rootCleanupMetadata, rootCleanupHistory, rootCleanupRetirementProof, rootCleanupRetirementDetails, rootCleanupReplacementMetadata } from './campaign-cleanup-plan-lifecycle.js';

const IDENTITY = { specSha:'spec_sha', credentialFingerprint:'credential_fingerprint', upstreamBaseUrl:'upstream_base_url' };
const epoch = v => v instanceof Date ? v.getTime() : Date.parse(v);
const active = (start,end,now) => Number.isFinite(epoch(start)) && epoch(start)<=now && Number.isFinite(epoch(end)) && epoch(end)>now;
const targetKey = s => `searchad:${s.customerId}:campaign:${s.remoteId}`;
const problem = (suffix,message,status=409) => fail(`SEARCHAD_CAMPAIGN_CLEANUP_${suffix}`,message,status);

/** Internal default-OFF service owns this store. No HTTP, token issuer or network I/O here. */
export class PostgresCampaignCleanupRepository {
  #pool; #recipe; #current; #gate; #clock; #ttl; #maxAge; #units; #capacity; #confirmation; #tickets=new WeakMap();
  constructor({pool,dailyBudget,current,gate,clock,planTtlSeconds,preflightMaxAgeMs,riskUnits,dailyCapacityUnits,confirmation}) {
    this.#pool=pool; this.#recipe=createHierarchyCampaignRecipe({dailyBudget}); this.#current=current; this.#gate=gate;
    this.#clock=clock; this.#ttl=planTtlSeconds; this.#maxAge=preflightMaxAgeMs; this.#units=riskUnits; this.#capacity=dailyCapacityUnits; this.#confirmation=confirmation;
  }
  #now() { const n=this.#clock(); if(!Number.isSafeInteger(n)||!Number.isFinite(new Date(n).getTime()))problem('CLOCK','Invalid server clock.',503); return n; }
  #identity(run) {
    const current=this.#current(run.customer_id);
    if(!record(current)||typeof current.then==='function'||Object.entries(IDENTITY).some(([key,column])=>typeof current[key]!=='string'||!current[key]||current[key]!==run[column]))problem('CONTEXT','Current identity differs from the stored campaign.');
    return current;
  }
  async #tx(work) {
    let c,committing=false,discard=false;
    try { c=await this.#pool.connect(); await c.query('BEGIN'); const result=await work(c); committing=true; await c.query('COMMIT'); return result; }
    catch(e) {
      if(committing) {discard=true; problem('COMMIT_UNKNOWN','Commit acknowledgement is unknown; no send permission is issued.',503);}
      if(c)try {await c.query('ROLLBACK');}catch {discard=true;}
      if(e instanceof SearchAdWriteError)throw e;
      problem('STORE_FAILED','Cleanup persistence failed; inspect state without blind replay.',503);
    } finally {if(c)c.release(discard);}
  }
  async #graph(c,s) {
    // Compatible order: account -> run -> objects -> holds -> create plan -> cleanup plans.
    const account=(await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',[s.customerId])).rows[0];
    const run=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE',[s.hierarchyRunId,s.customerId])).rows[0];
    if(!run)problem('NOT_FOUND','Campaign scope was not found.',404);
    const objects=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 ORDER BY hierarchy_object_id FOR UPDATE',[s.hierarchyRunId])).rows;
    const holds=(await c.query('SELECT *,xmin::text AS version FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=$2 OR parent_hierarchy_object_id=$2 ORDER BY ownership_id FOR UPDATE',[s.hierarchyRunId,s.hierarchyObjectId])).rows;
    const events=(await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 OR hierarchy_object_id=$2 ORDER BY event_id',[s.hierarchyRunId,s.hierarchyObjectId])).rows;
    if(events.some(e=>e.customer_id!==s.customerId||e.hierarchy_run_id!==s.hierarchyRunId||(e.hierarchy_object_id!==null&&e.hierarchy_object_id!==s.hierarchyObjectId)||e.phase.startsWith('tree_cleanup_')))problem('GRAPH','Foreign or competing cleanup history is not ignored.');
    // Do not hide malformed cross-run/Customer children behind a scope filter.
    const children=await c.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE parent_object_id=$1 LIMIT 1',[s.hierarchyObjectId]);
    const o=objects[0],h=holds[0];
    if(objects.length!==1||holds.length!==1||children.rowCount||!o||o.hierarchy_object_id!==s.hierarchyObjectId||o.customer_id!==s.customerId||o.object_type!=='campaign'||o.parent_object_id!==null||
      typeof o.remote_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(o.remote_id)||o.create_operation_key!==OPS.campaign.create||o.read_operation_key!==OPS.campaign.read||o.delete_operation_key!==OPS.campaign.delete||
      h.customer_id!==s.customerId||h.object_type!=='campaign'||h.remote_id!==o.remote_id||h.owner_kind!=='hierarchy_canary'||h.owner_run_id!==s.hierarchyRunId||h.hierarchy_object_id!==s.hierarchyObjectId||h.parent_hierarchy_object_id!==null||h.created_operation_key!==OPS.campaign.create||
      run.recipe_id!==this.#recipe.id||run.completed_at!==null)problem('GRAPH','Exactly one matching returned-ID campaign and ownership hold, without children, is required.');
    const resultEvents=events.filter(e=>e.phase==='create_result'); const verifiedEvents=events.filter(e=>e.phase==='create_verification');
    const result=resultEvents[0],verified=verifiedEvents[0];
    if(resultEvents.length!==1||verifiedEvents.length!==1||result.status!=='returned_id_recorded'||verified.status!=='verified'||
      [result,verified].some(e=>e.customer_id!==s.customerId||e.hierarchy_object_id!==s.hierarchyObjectId||e.operation_key!==OPS.campaign.create||e.lifecycle_kind!=='create'||e.details_json?.returnedIdRecorded!==true)||
      typeof result.details_json.planId!=='string'||verified.details_json.planId!==result.details_json.planId)problem('PROVENANCE','The existing creation result and verification records are required.');
    const cp=(await c.query('SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE',[result.details_json.planId,s.customerId])).rows[0];
    const descriptor=this.#recipe.createCampaign({customerId:s.customerId,hierarchyRunId:s.hierarchyRunId});
    const before={customerId:s.customerId,nccCampaignId:o.remote_id,...descriptor.body};
    if(!cp||cp.status!=='applied'||cp.mutation_operation_key!==OPS.campaign.create||!equal(cp.mutation_json,descriptor)||!equal(cp.expected_after_json,descriptor.body)||
      !equal(cp.applied_after_json,before)||cp.applied_after_hash!==contentHash(before))problem('PROVENANCE','Stored ID must match the verified creation snapshot, not a substituted target.');
    const ids=[...new Set([...events.filter(e=>e.phase.startsWith('cleanup_')).map(e=>e.details_json?.planId),s.planId,s.predecessorPlanId].filter(id=>typeof id==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))];
    const plans=(await c.query(`SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=ANY($1::uuid[]) OR before_json->>'hierarchyObjectId'=$2 OR (before_json->>'hierarchyRunId'=$3 AND mutation_operation_key=$4) ORDER BY plan_id FOR UPDATE`,[ids,s.hierarchyObjectId,s.hierarchyRunId,OPS.campaign.delete])).rows.filter(p=>p.plan_id!==cp.plan_id);
    if(plans.some(p=>p.customer_id!==s.customerId||p.mutation_operation_key!==OPS.campaign.delete))problem('GRAPH','Foreign or competing target-linked plans are not ignored.');
    const planIds=plans.map(p=>p.plan_id);
    const approvals=(await c.query('SELECT *,xmin::text AS version FROM searchad_write_approvals WHERE plan_id=ANY($1::uuid[]) ORDER BY approval_id FOR UPDATE',[planIds])).rows;
    const locks=(await c.query('SELECT *,xmin::text AS version FROM searchad_write_locks WHERE plan_id=ANY($1::uuid[]) ORDER BY plan_id FOR UPDATE',[planIds])).rows;
    const attempts=(await c.query('SELECT *,xmin::text AS version FROM searchad_write_attempts WHERE plan_id=ANY($1::uuid[]) ORDER BY attempt_id FOR UPDATE',[planIds])).rows;
    const risks=(await c.query('SELECT *,xmin::text AS version FROM searchad_risk_reservations WHERE owner_run_id=$1 OR intent_id LIKE ANY($2::text[]) ORDER BY reservation_id FOR UPDATE',[s.hierarchyRunId,planIds.map(id=>`%:${id}`)])).rows;
    const plan=plans.find(p=>p.plan_id===s.planId)??null;
    return {account,run,objects,holds,events,object:o,hold:h,createPlan:cp,descriptor,before,plan,plans,approvals,locks,attempts,risks};
  }
  #owned(g) {
    if(!g.account||g.account.suspended!==false)problem('SUSPENDED','Customer is unavailable or suspended.',403);
    if(hasUnprovenInventory({target:g.object,objects:g.objects,events:g.events}))problem('INVENTORY_UNPROVEN','Recorded descendant inventory is not complete remote-absence proof; campaign deletion remains blocked.');
    if(g.run.status!=='cleanup_pending'||g.object.state!=='owned'||g.object.deleted_at!==null||g.hold.state!=='owned')problem('STATE','Only an owned campaign with no previous cleanup attempt may be dispatched.');
  }
  async #authority(c,g,activationId,now) {
    this.#identity(g.run);
    const grant=(await c.query('SELECT * FROM searchad_activation_grants WHERE activation_id=$1',[activationId])).rows[0];
    const evidence=grant?(await c.query('SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1',[grant.evidence_id])).rows[0]:null;
    // Dedicated delete evidence; mutable-field evidence is never upgraded to deletion authority.
    if(!grant||!evidence||[grant,evidence].some(v=>v.customer_id!==g.run.customer_id||v.evidence_type!=='active_canary'||Object.values(IDENTITY).some(k=>v[k]!==g.run[k])||
      !equal(v.operation_keys_json,[OPS.campaign.delete])||!equal(v.lifecycle_kinds_json,['delete'])||!equal(v.field_scope_json,[]))||evidence.result!=='verified'||
      !active(grant.activated_at,grant.expires_at,now)||!active(evidence.created_at,evidence.expires_at,now))problem('AUTHORITY','A current matching delete-only active evidence/grant pair is required.',403);
    return Math.min(epoch(grant.expires_at),epoch(evidence.expires_at));
  }
  #meta(g,s,activationId) {return rootCleanupMetadata(g,activationId);}
  #descriptors(g,s) {
    const input={customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,object:{customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,objectType:'campaign',state:'owned',remoteId:g.object.remote_id}};
    return {mutation:this.#recipe.deleteCampaign(input),read:this.#recipe.readCampaign(input)};
  }
  #history(g,s) {return rootCleanupHistory(g,this.#descriptors(g,s),this.#now());}
  #boundPlan(g,s) {
    const b=this.#history(g,s).current;
    if(!b||b.plan.plan_id!==s.planId)problem('PLAN','Only the current root cleanup plan is eligible; retired plans and tokens are not reused.');
    return b;
  }
  async #audit(c,s,phase,status,details) {
    const at=new Date(this.#now()).toISOString(); const safe={planId:s.planId,...details};
    await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,[randomUUID(),s.hierarchyRunId,s.hierarchyObjectId,s.customerId,phase,status,OPS.campaign.delete,phase==='cleanup_plan_retired'?null:'delete',JSON.stringify(safe),at]);
    await c.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,response_json,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,[randomUUID(),s.planId,phase,status,JSON.stringify(safe),at]);
  }
  #signature(g) {return JSON.stringify([g.run.version,g.objects.map(o=>[o.hierarchy_object_id,o.version]),g.holds.map(h=>[h.ownership_id,h.version]),g.createPlan.version,g.events.map(e=>e.event_id),g.plans.map(p=>[p.plan_id,p.version]),g.approvals.map(a=>[a.approval_id,a.version]),g.locks.map(l=>[l.plan_id,l.version]),g.attempts.map(a=>[a.attempt_id,a.version]),g.risks.map(r=>[r.reservation_id,r.version])]);}
  #ticket(g,s,stage,extra={}) {const t=Object.freeze({});this.#tickets.set(t,{signature:this.#signature(g),scope:structuredClone(s),stage,...extra});return t;}
  #take(t,stage) {const v=this.#tickets.get(t);this.#tickets.delete(t);if(!v||v.stage!==stage)problem('TICKET','An unused internally issued stage ticket is required.');return v;}
  #unchanged(g,v) {if(this.#signature(g)!==v.signature)problem('STALE','Campaign state changed during I/O; no blind replay is allowed.');}
  #projection(g,s) {return {customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,hierarchyObjectId:s.hierarchyObjectId,planId:s.planId,remoteId:g.object.remote_id,state:g.object.state};}

  async #insertPlan(c,g,s,validUntil,meta) {
    const scope={...s,planId:randomUUID()},d=this.#descriptors(g,s),n=this.#now();
    const expiresAt=new Date(Math.min(validUntil,n+this.#ttl*1000)).toISOString();
    await c.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,rollback_json,reason,status,created_by,created_at,expires_at)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb,NULL,'Delete only the verified server-created campaign after separate approval.','planned',$9,$10,$11)`,
    [scope.planId,s.customerId,OPS.campaign.delete,JSON.stringify(d.mutation),JSON.stringify(d.read),JSON.stringify(meta),contentHash(meta),JSON.stringify({absent:true,remoteId:g.object.remote_id}),s.actorPrincipalId,new Date(n).toISOString(),expiresAt]);
    await this.#audit(c,scope,'cleanup_plan','planned',{activationId:s.activationId,beforeHash:contentHash(meta),requestFingerprint:contentHash(d.mutation),actorPrincipalId:s.actorPrincipalId});
    if(s.predecessorPlanId){const final=await this.#graph(c,scope);this.#boundPlan(final,scope);this.#owned(final);this.#identity(final.run);}
    await this.#authority(c,g,s.activationId,this.#now());
    this.#identity(g.run);
    if(this.#now()<n||this.#now()>=Date.parse(expiresAt))problem('EXPIRED','Cleanup plan expired or server time changed before commit.');
    return {...this.#projection(g,scope),state:'planned',expiresAt,requiredConfirmation:this.#confirmation,requiredSecondConfirmation:targetKey(meta)};
  }
  async prepare(s) {
    return this.#tx(async c=>{
      const g=await this.#graph(c,s); this.#owned(g);
      const validUntil=await this.#authority(c,g,s.activationId,this.#now());
      if(g.plans.length||g.events.some(e=>e.phase.startsWith('cleanup_')))problem('PRIOR_PLAN','This target already has cleanup history; use explicit retirement and replanning.');
      return this.#insertPlan(c,g,s,validUntil,this.#meta(g,s,s.activationId));
    });
  }
  async retire(s) {
    return this.#tx(async c=>{
      const g=await this.#graph(c,s);this.#identity(g.run);const n=this.#now();
      if(!g.account||g.run.status!=='cleanup_pending'||g.object.state!=='owned'||g.object.deleted_at!==null||g.hold.state!=='owned')problem('NOT_UNUSED','The campaign and hold must retain their untouched pre-delete state.');
      const h=this.#history(g,s);
      if(g.plans.length!==1||h.first.plan.plan_id!==s.planId)problem('GENERATION_LIMIT','Only the original plan, without a successor, can be retired.');
      const proof=rootCleanupRetirementProof(g,h.first,n);
      if(!proof){
        const details=rootCleanupRetirementDetails(h.first,s.actorPrincipalId,h.first.plan.status);
        await c.query("UPDATE searchad_write_change_plans SET status='expired',last_error_json=$2::jsonb WHERE plan_id=$1",[s.planId,JSON.stringify(ROOT_CLEANUP_RETIREMENT_REASON)]);
        await this.#audit(c,s,'cleanup_plan_retired','expired_unused',details);
      }
      const final=await this.#graph(c,s);this.#identity(final.run);
      if(this.#now()<n||!this.#history(final,s).retirement)problem('RETIREMENT_PROVENANCE','Retirement changed before commit.');
      return {...this.#projection(final,s),state:'expired_unused',alreadyRetired:Boolean(proof),requiresNewApproval:true,cleanupAuthority:false};
    });
  }
  async replan(s) {
    return this.#tx(async c=>{
      const g=await this.#graph(c,s);this.#owned(g);this.#identity(g.run);
      const h=this.#history(g,s);
      if(h.current!==null||!h.retirement||h.first.plan.plan_id!==s.predecessorPlanId)problem('PRIOR_PLAN','One exact retired predecessor and no existing successor are required.');
      const validUntil=await this.#authority(c,g,s.activationId,this.#now());
      return this.#insertPlan(c,g,s,validUntil,rootCleanupReplacementMetadata(g,s.activationId,h.retirement));
    });
  }
  async #approved(c,g,s,binding) {
    this.#owned(g);
    if(s.confirmation!==this.#confirmation||s.secondConfirmation!==targetKey(binding.meta))problem('CONFIRMATION','Exact destructive operation and full target confirmations are required.',400);
    const p=g.plan;
    const approval=(await c.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1 AND token_hash=$2 FOR UPDATE',[s.planId,s.tokenHash])).rows[0];
    if(p.status!=='approved'||!approval||approval.used_at!==null||approval.confirmation!==SEARCHAD_APPROVAL_CONFIRMATION||!approval.actor?.trim())problem('APPROVAL','An unused token for the separately approved cleanup plan is required.',403);
    const n=this.#now(); const until=await this.#authority(c,g,binding.meta.activationId,n);
    if(!active(p.created_at,p.expires_at,n)||!active(approval.created_at,approval.expires_at,n)||!Number.isFinite(epoch(p.approved_at))||epoch(p.approved_at)>n)problem('EXPIRED','Plan or approval expired.');
    if(g.events.some(e=>e.phase==='cleanup_dispatch_intent'))problem('REPLAY','Cleanup has already been claimed.');
    return {approval,validUntil:Math.min(until,epoch(p.expires_at),epoch(approval.expires_at))};
  }
  async executionSnapshot(s) {
    return this.#tx(async c=>{
      const g=await this.#graph(c,s),binding=this.#boundPlan(g,s);await this.#approved(c,g,s,binding);this.#gate(binding.mutation);
      return {ticket:this.#ticket(g,s,'preflight',{readStartedAt:this.#now()}),descriptor:binding.read,expected:g.descriptor,remoteId:g.object.remote_id,identity:this.#identity(g.run)};
    });
  }
  async claim(ticket) {
    const v=this.#take(ticket,'preflight'),s=v.scope;
    return this.#tx(async c=>{
      const g=await this.#graph(c,s);this.#unchanged(g,v); const binding=this.#boundPlan(g,s);let a=await this.#approved(c,g,s,binding);
      const intentId=`hierarchy:campaign:delete:${s.planId}`;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[intentId]);
      if((await c.query('SELECT reservation_id FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE',[intentId])).rowCount)problem('REPLAY','A prior cleanup risk intent cannot be reused.');
      const day=new Date(this.#now()).toISOString().slice(0,10);
      await c.query(`INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at) VALUES($1,$2::date,$3,0,0,$4) ON CONFLICT(customer_id,risk_date) DO NOTHING`,[s.customerId,day,this.#capacity,new Date(this.#now()).toISOString()]);
      const balance=(await c.query('SELECT * FROM searchad_daily_risk_capacity WHERE customer_id=$1 AND risk_date=$2::date FOR UPDATE',[s.customerId,day])).rows[0];
      a=await this.#approved(c,g,s,binding);const n=this.#now(),at=new Date(n).toISOString();
      if(at.slice(0,10)!==day||n<v.readStartedAt||n-v.readStartedAt>this.#maxAge)problem('STALE_PREFLIGHT','Stopped observation expired during the lock wait.');
      if(!balance||balance.capacity_units!==this.#capacity||balance.reserved_units+balance.consumed_units+this.#units>balance.capacity_units)problem('CAPACITY','Shared risk capacity is exhausted or differs from established policy.');
      await c.query('UPDATE searchad_write_approvals SET used_at=$2 WHERE approval_id=$1 AND used_at IS NULL',[a.approval.approval_id,at]);
      await c.query('UPDATE searchad_daily_risk_capacity SET consumed_units=consumed_units+$3,updated_at=$4 WHERE customer_id=$1 AND risk_date=$2::date',[s.customerId,day,this.#units,at]);
      await c.query(`INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,consumed_at)
        VALUES($1,$2,$3,$4::date,$5,'delete',$6,'consumed','hierarchy_canary',$7,$8,$8,$8)`,[randomUUID(),intentId,s.customerId,day,OPS.campaign.delete,this.#units,s.hierarchyRunId,at]);
      await c.query("UPDATE searchad_hierarchy_objects SET state='delete_pending',updated_at=$2 WHERE hierarchy_object_id=$1",[s.hierarchyObjectId,at]);
      await c.query("UPDATE searchad_remote_object_ownership SET state='delete_unknown',updated_at=$2 WHERE ownership_id=$1",[g.hold.ownership_id,at]);
      await c.query("UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1",[s.planId]);
      await c.query("UPDATE searchad_hierarchy_canary_runs SET status='unknown_outcome' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);
      await this.#audit(c,s,'cleanup_dispatch_intent','attempt_once',{intentId,approvalId:a.approval.approval_id,actorPrincipalId:s.actorPrincipalId,requestFingerprint:contentHash(binding.mutation),riskDate:day,riskUnits:this.#units});
      const after=await this.#graph(c,s);await this.#authority(c,g,binding.meta.activationId,this.#now());this.#gate(binding.mutation);
      if(this.#now()>=a.validUntil||new Date(this.#now()).toISOString().slice(0,10)!==day||this.#now()-v.readStartedAt>this.#maxAge)problem('EXPIRED','Cleanup authority or stopped observation expired before commit.');
      return {ticket:this.#ticket(after,s,'send'),descriptor:binding.mutation,identity:this.#identity(g.run),validUntil:Math.min(a.validUntil,v.readStartedAt+this.#maxAge),riskDate:day};
    });
  }
  async recordSend(ticket,acknowledged) {
    const v=this.#take(ticket,'send');
    return this.#tx(async c=>{const g=await this.#graph(c,v.scope);this.#unchanged(g,v);await this.#audit(c,v.scope,'cleanup_result',acknowledged?'acknowledged_unverified':'outcome_unknown',{absenceVerified:false});});
  }
  #pending(g,s) {
    const intents=g.events.filter(e=>e.phase==='cleanup_dispatch_intent');const e=intents[0];
    if(intents.length!==1||e.customer_id!==s.customerId||e.hierarchy_object_id!==s.hierarchyObjectId||e.operation_key!==OPS.campaign.delete||e.lifecycle_kind!=='delete'||e.status!=='attempt_once'||e.details_json.planId!==s.planId||e.details_json.requestFingerprint!==contentHash(g.plan.mutation_json))problem('INTENT','Read-only cleanup recovery requires its recorded dispatch intent.');
    if(!['delete_pending','delete_unknown'].includes(g.object.state)||g.object.deleted_at!==null||g.hold.state!=='delete_unknown'||g.plan.status!=='unknown_outcome')problem('STATE','Cleanup state is not pending observation.');
  }
  async observationSnapshot(s) {
    return this.#tx(async c=>{
      const g=await this.#graph(c,s);const b=this.#boundPlan(g,s);this.#identity(g.run);
      if(g.object.state==='deleted'&&g.hold.state==='deleted'&&g.plan.status==='applied')return {projection:this.#projection(g,s)};
      this.#pending(g,s);
      return {ticket:this.#ticket(g,s,'observation'),descriptor:b.read,expected:g.descriptor,remoteId:g.object.remote_id,identity:this.#identity(g.run)};
    });
  }
  async settle(ticket,kind) {
    if(!['absent','present','unavailable','mismatch'].includes(kind))problem('OBSERVATION','Unknown observation kind.');
    const v=this.#take(ticket,'observation'),s=v.scope;
    return this.#tx(async c=>{
      const g=await this.#graph(c,s);this.#unchanged(g,v);this.#boundPlan(g,s);this.#pending(g,s);this.#identity(g.run);
      const state=kind==='absent'?'deleted':kind==='mismatch'?'manual_review':'delete_unknown';const at=new Date(this.#now()).toISOString();
      await c.query('UPDATE searchad_hierarchy_objects SET state=$2,updated_at=$3,deleted_at=$4 WHERE hierarchy_object_id=$1',[s.hierarchyObjectId,state,at,state==='deleted'?at:null]);
      await c.query('UPDATE searchad_remote_object_ownership SET state=$2,updated_at=$3 WHERE ownership_id=$1',[g.hold.ownership_id,state,at]);
      await c.query('UPDATE searchad_hierarchy_canary_runs SET status=$2 WHERE hierarchy_run_id=$1',[s.hierarchyRunId,state==='deleted'?'cleanup_pending':state==='manual_review'?'manual_review':'unknown_outcome']);
      if(state==='deleted')await c.query("UPDATE searchad_write_change_plans SET status='applied',applied_at=$2,applied_after_json=$3::jsonb,applied_after_hash=$4 WHERE plan_id=$1",[s.planId,at,JSON.stringify(g.plan.expected_after_json),contentHash(g.plan.expected_after_json)]);
      else if(state==='manual_review')await c.query("UPDATE searchad_write_change_plans SET status='manual_review' WHERE plan_id=$1",[s.planId]);
      await this.#audit(c,s,'cleanup_observation',state,{kind,readOnly:true,absenceVerified:kind==='absent'});
      return {...this.#projection(g,s),state};
    });
  }
}

export function cleanupScope(input,context,mode) {
  const base=['customerId','hierarchyRunId','hierarchyObjectId'];
  const keys=[...base,...(mode==='prepare'?['activationId']:mode==='execute'?['planId','executionToken','confirmation','secondConfirmation']:['planId'])];
  if(!record(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k)))problem('INPUT','Only exact local scope and the required confirmations are accepted.',400);
  const s=Object.fromEntries(keys.map(k=>[k,input[k]]));
  if(typeof s.customerId!=='string'||!/^\d{1,30}$/.test(s.customerId)||keys.filter(k=>k.endsWith('Id')&&k!=='customerId').some(k=>typeof s[k]!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s[k])))problem('INPUT','Invalid local scope identifiers.',400);
  const p=context?.principal;
  if(!record(p)||p.role!=='admin'||typeof p.principalId!=='string'||!p.principalId.trim()||p.principalId!==p.principalId.trim()||!Array.isArray(p.customerIds)||!p.customerIds.includes(s.customerId))problem('FORBIDDEN','Authenticated Admin and explicit Customer access are required.',403);
  if(mode==='execute') {
    if(typeof s.executionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(s.executionToken)||typeof s.confirmation!=='string'||typeof s.secondConfirmation!=='string')problem('INPUT','Invalid token or confirmations.',400);
    s.tokenHash=createHash('sha256').update(s.executionToken).digest('hex');delete s.executionToken;
  }
  for(const k of keys)if(k.endsWith('Id')&&k!=='customerId')s[k]=s[k].toLowerCase();
  return Object.freeze({...s,actorPrincipalId:p.principalId});
}
