import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { SearchAdWriteError } from '../write/errors.js';
import { contentHash } from '../write/canonical.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { resolveAdgroupGenerationHistory } from './adgroup-generation-contract.js';
import { creationProof } from './child-first-cleanup-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS, KEYWORD_CREATE_MAX_BATCH } from './operations.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const REASON = Object.freeze({ code: 'UNUSED_SIBLING_PLAN_EXPIRED' });
const IDENTITY = Object.freeze({ specSha:'spec_sha',credentialFingerprint:'credential_fingerprint',upstreamBaseUrl:'upstream_base_url' });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const epoch = value => value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
const actor = value => typeof value === 'string' && value.length > 0 && value === value.trim();
const uuid = value => typeof value === 'string' && UUID.test(value);
function fail(code, message, status = 409) {
  throw new SearchAdWriteError(`SEARCHAD_SIBLING_PLAN_RETIREMENT_${code}`, message, {}, status);
}
function result(scope, objectIds, changed) {
  return Object.freeze({customerId:scope.customerId,hierarchyRunId:scope.hierarchyRunId,parentObjectId:scope.parentObjectId,
    planId:scope.planId,kind:scope.kind,objectIds:Object.freeze([...objectIds]),planStatus:'expired',runStatus:'cleanup_pending',changed,
    targetRemoteDispatched:false,runTerminated:false,replacementCreated:false,requiresNewApproval:true,replanningSupported:false,cleanupAuthority:false});
}

/**
 * Whole-plan local retirement. The historical batch and all ancestor rows remain
 * untouched. This does not issue replacement, deletion or remote-absence authority.
 */
export class PostgresSiblingPlanRetirementRepository {
  #pool; #rootRecipe; #current; #clock;
  constructor({pool,dailyBudget,current,clock=Date.now}={}) {
    if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function' || typeof current !== 'function' || typeof clock !== 'function') {
      throw new TypeError('PostgreSQL and synchronous server identity/clock resolvers are required');
    }
    this.#pool=pool; this.#rootRecipe=createHierarchyCampaignRecipe({dailyBudget}); this.#current=current; this.#clock=clock;
  }
  #now() {
    const n=this.#clock();
    if (!Number.isSafeInteger(n) || !Number.isFinite(new Date(n).getTime())) fail('CLOCK_CHANGED','Invalid server clock.',503);
    return n;
  }
  #identity(run) {
    let current;
    try { current=this.#current(run.customer_id); } catch { fail('CONTEXT_UNAVAILABLE','Current SearchAd identity is unavailable.',503); }
    if (!record(current) || typeof current.then==='function' || Object.entries(IDENTITY).some(([key,column])=>
      typeof current[key]!=='string' || !current[key] || current[key]!==run[column])) fail('CONTEXT_MISMATCH','Current identity differs from the persisted hierarchy.');
  }
  async #tx(work) {
    let c, committing=false, discard=false;
    try {
      c=await this.#pool.connect(); await c.query('BEGIN'); const value=await work(c);
      committing=true; await c.query('COMMIT'); return value;
    } catch (e) {
      if (committing) { discard=true; fail('COMMIT_UNKNOWN','Local retirement commit acknowledgement is unknown; inspect this same local scope.',503); }
      if(c)try{await c.query('ROLLBACK');}catch{discard=true;}
      if(e instanceof SearchAdWriteError && e.code?.startsWith('SEARCHAD_SIBLING_PLAN_RETIREMENT_'))throw e;
      fail('STORE_FAILED','Sibling retirement persistence failed; no replacement or send authority was issued.',503);
    } finally { if(c)c.release(discard); }
  }
  async #load(c,s) {
    // Serialize with the existing producer prefix. Broad links expose foreign descendants.
    const account=(await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',[s.customerId])).rows[0];
    const run=(await c.query('SELECT * FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE',[s.hierarchyRunId,s.customerId])).rows[0];
    if(!account||!run)fail('NOT_FOUND','Exact local hierarchy was not found.',404);
    const local=(await c.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1',[s.hierarchyRunId])).rows.map(o=>o.hierarchy_object_id);
    const objects=(await c.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 OR parent_object_id=ANY($2::uuid[]) ORDER BY hierarchy_object_id FOR UPDATE',[s.hierarchyRunId,local])).rows;
    const parent=objects.find(o=>o.hierarchy_object_id===s.parentObjectId&&o.hierarchy_run_id===s.hierarchyRunId&&o.customer_id===s.customerId);
    if(!parent)fail('NOT_FOUND','Exact local adgroup parent was not found.',404);
    const holds=(await c.query('SELECT * FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) OR parent_hierarchy_object_id=ANY($2::uuid[]) ORDER BY ownership_id FOR UPDATE',[s.hierarchyRunId,local])).rows;
    const events=(await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) ORDER BY event_id',[s.hierarchyRunId,local])).rows;
    if(objects.some(o=>o.customer_id!==s.customerId||o.hierarchy_run_id!==s.hierarchyRunId)||
       events.some(e=>e.customer_id!==s.customerId||e.hierarchy_run_id!==s.hierarchyRunId||(e.hierarchy_object_id!==null&&!local.includes(e.hierarchy_object_id))))fail('PRIOR_WORK','Foreign object or audit links cannot be ignored.');
    const ids=[...new Set([s.planId,...events.map(e=>e.details_json?.planId).filter(uuid)])];
    const plans=(await c.query("SELECT * FROM searchad_write_change_plans WHERE plan_id=ANY($1::uuid[]) OR before_json->>'hierarchyRunId'=$2 ORDER BY plan_id FOR UPDATE",[ids,s.hierarchyRunId])).rows;
    const plan=plans.find(p=>p.plan_id===s.planId&&p.customer_id===s.customerId);
    if(!plan)fail('NOT_FOUND','Exact local sibling plan was not found.',404);
    const planIds=plans.map(p=>p.plan_id);
    const approvals=(await c.query('SELECT * FROM searchad_write_approvals WHERE plan_id=ANY($1::uuid[]) ORDER BY approval_id FOR UPDATE',[planIds])).rows;
    const locks=(await c.query('SELECT * FROM searchad_write_locks WHERE plan_id=ANY($1::uuid[]) ORDER BY plan_id FOR UPDATE',[planIds])).rows;
    const attempts=(await c.query('SELECT * FROM searchad_write_attempts WHERE plan_id=ANY($1::uuid[]) ORDER BY attempt_id FOR UPDATE',[planIds])).rows;
    const intentIds=planIds.flatMap(id=>[`hierarchy:campaign:create:${id}`,`hierarchy:adgroup:create:${id}`,`hierarchy:sibling:keywords:${id}`,`hierarchy:sibling:creative:${id}`,`hierarchy:tree:delete:${id}`]);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`hierarchy:sibling:${s.kind}:${s.planId}`]);
    const risks=(await c.query('SELECT * FROM searchad_risk_reservations WHERE owner_run_id=$1 OR intent_id=ANY($2::text[]) ORDER BY reservation_id FOR UPDATE',[s.hierarchyRunId,intentIds])).rows;
    if(run.status!=='cleanup_pending'||run.completed_at!==null||run.last_error_json!==null||
       !['planned','approved','expired'].includes(plan.status)||plan.applied_at!==null||plan.applied_after_json!==null||plan.applied_after_hash!==null||plan.rolled_back_at!==null)fail('NOT_UNUSED','Only a wholly unused sibling plan in a live unresolved-free hierarchy may be retired.');
    if(events.some(e=>e.phase.startsWith('tree_cleanup_')||e.phase.startsWith('cleanup_')))fail('PRIOR_WORK','Competing cleanup history prevents sibling retirement.');
    const roots=objects.filter(o=>o.object_type==='campaign'),root=roots[0];
    if(roots.length!==1||run.recipe_id!==this.#rootRecipe.id||!root||parent.object_type!=='adgroup'||parent.parent_object_id!==root.hierarchy_object_id||root.parent_object_id!==null)fail('PARENT_PROVENANCE','One exact campaign/adgroup ancestor chain is required.');
    if(holds.length!==2)fail('PRIOR_WORK','Unexpected ownership holds prevent unused sibling retirement.');
    for(const node of [root,parent]) {
      const own=holds.filter(h=>h.hierarchy_object_id===node.hierarchy_object_id),h=own[0],op=OPS[node.object_type];
      if(node.state!=='owned'||node.deleted_at!==null||typeof node.remote_id!=='string'||!REMOTE.test(node.remote_id)||
         node.create_operation_key!==op.create||node.read_operation_key!==op.read||node.delete_operation_key!==op.delete||own.length!==1||
         h.customer_id!==s.customerId||h.owner_kind!=='hierarchy_canary'||h.owner_run_id!==s.hierarchyRunId||h.object_type!==node.object_type||
         h.remote_id!==node.remote_id||h.parent_hierarchy_object_id!==node.parent_object_id||h.created_operation_key!==op.create||h.state!=='owned')fail('PARENT_PROVENANCE','Owned ancestor objects and holds must match exactly.');
    }
    const rootResults=events.filter(e=>e.hierarchy_object_id===root.hierarchy_object_id&&e.phase==='create_result');
    const rootPlan=rootResults.length===1?plans.find(p=>p.plan_id===rootResults[0].details_json?.planId):null;
    const g={account,run,objects,holds,events,plans,approvals,locks,attempts,risks,root,rootPlan,parent,plan};
    try {
      g.generation=resolveAdgroupGenerationHistory(g,s.parentObjectId,(code,message)=>fail('PARENT_PROVENANCE',message));
      g.adgroupGeneration=g.generation; g.child=parent;
      g.rootDescriptor=this.#rootRecipe.createCampaign({customerId:s.customerId,hierarchyRunId:s.hierarchyRunId});
      g.rootCreate=creationProof(g,root,g.rootDescriptor);
      g.parentPlan=creationProof(g,parent,g.generation.descriptor);
    } catch(e) {
      if(e instanceof SearchAdWriteError&&e.code?.startsWith('SEARCHAD_SIBLING_PLAN_RETIREMENT_'))throw e;
      fail('PARENT_PROVENANCE','Exact ancestor creation and adgroup generation provenance are required.');
    }
    const knownPlanIds=new Set([g.rootCreate.plan_id,g.parentPlan.plan_id,plan.plan_id,g.generation.predecessor?.plan.plan_id].filter(Boolean));
    if(plans.some(p=>p.customer_id!==s.customerId||!knownPlanIds.has(p.plan_id)))fail('PRIOR_WORK','Additional or orphan linked plans prevent retirement.');
    const expectedRisk=new Map([[`hierarchy:campaign:create:${g.rootCreate.plan_id}`,OPS.campaign.create],[`hierarchy:adgroup:create:${g.parentPlan.plan_id}`,OPS.adgroup.create]]);
    if(risks.length!==2||risks.some(r=>!expectedRisk.has(r.intent_id)||r.operation_key!==expectedRisk.get(r.intent_id)||r.customer_id!==s.customerId||
      r.owner_kind!=='hierarchy_canary'||r.owner_run_id!==s.hierarchyRunId||r.lifecycle_kind!=='create'||r.state!=='consumed'||!Number.isSafeInteger(r.units)||r.units<=0||!Number.isFinite(epoch(r.consumed_at))))fail('PRIOR_WORK','Only ancestors\' original consumed risk may exist; any sibling intent, even released or foreign-owned, blocks retirement.');
    this.#identity(run);return g;
  }
  #binding(g,s,now) {
    const {plan}=g,type=s.kind==='keywords'?'keyword':'creative',op=OPS[type],lifecycle=s.kind==='keywords'?'batch_create':'create';
    const planned=g.events.filter(e=>e.phase==='sibling_plan');
    const event=planned[0];
    if(planned.length!==1||event.details_json?.planId!==s.planId||event.details_json?.kind!==s.kind||!uuid(event.details_json?.activationId))fail('PROVENANCE','One exact original sibling planning event is required.');
    const objectIds=event.details_json.objectIds;
    if(!Array.isArray(objectIds)||objectIds.length<1||objectIds.length>(s.kind==='keywords'?KEYWORD_CREATE_MAX_BATCH:1)||objectIds.some(id=>!uuid(id))||new Set(objectIds).size!==objectIds.length)fail('PROVENANCE','The ordered sibling batch must contain unique bounded local IDs.');
    const targetIds=new Set(objectIds),leaves=g.objects.filter(o=>['keyword','creative'].includes(o.object_type));
    if(leaves.length!==objectIds.length||g.objects.length!==2+leaves.length+(g.generation.predecessor?1:0)||leaves.some(o=>!targetIds.has(o.hierarchy_object_id)))fail('PRIOR_WORK','Every local sibling must belong to this exact original batch.');
    if(leaves.some(o=>o.object_type!==type||o.parent_object_id!==s.parentObjectId||o.state!=='planned'||o.remote_id!==null||o.deleted_at!==null||
       o.create_operation_key!==op.create||o.read_operation_key!==op.read||o.delete_operation_key!==op.delete))fail('NOT_UNUSED','Every batch member must still be planned and never returned or dispatched.');
    if(g.approvals.some(a=>a.plan_id===s.planId&&a.used_at!==null)||g.locks.some(l=>l.plan_id===s.planId))fail('PRIOR_WORK','Used approvals or execution locks make this plan ineligible.');
    const related=g.events.filter(e=>e.phase.startsWith('sibling_')||e.details_json?.planId===s.planId||targetIds.has(e.hierarchy_object_id));
    const attempts=g.attempts.filter(a=>a.plan_id===s.planId);
    if(related.some(e=>!['sibling_plan','sibling_plan_retired'].includes(e.phase))||attempts.some(a=>!['sibling_plan','sibling_plan_retired'].includes(a.phase)))fail('PRIOR_WORK','Any non-planning sibling history prevents retirement.');
    const started=epoch(plan.created_at),expires=epoch(plan.expires_at);
    if(!Number.isFinite(started)||!Number.isFinite(expires)||expires<=started||now<started||!Number.isFinite(epoch(g.run.started_at))||
       epoch(g.run.started_at)>started||!Number.isFinite(epoch(g.parentPlan.applied_at))||epoch(g.parentPlan.applied_at)>started||
       leaves.some(o=>epoch(o.created_at)!==started||epoch(o.updated_at)!==started))fail('PROVENANCE','Original ancestor/plan/object timestamps must remain consistent.');
    if(now<expires)fail('NOT_EXPIRED','The sibling plan itself must expire; approval expiration alone is insufficient.');
    let descriptor;
    try {
      const body=plan.mutation_json?.body;
      let recipe;
      if(s.kind==='keywords') {
        if(!Array.isArray(body)||body.length!==objectIds.length||body.some(item=>!record(item)||Object.keys(item).length!==1||typeof item.keyword!=='string'||!item.keyword.trim()))throw new Error();
        recipe=createHierarchyChildRecipe({keywordTexts:body.map(item=>item.keyword)});
      } else {
        if(!record(body)||body.type!=='TEXT_45'||!record(body.ad)||!record(body.ad.pc)||!record(body.ad.mobile))throw new Error();
        recipe=createHierarchyChildRecipe({creative:{type:body.type,headline:body.ad.headline,description:body.ad.description,pcFinal:body.ad.pc.final,mobileFinal:body.ad.mobile.final}});
      }
      const args={customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,parent:{customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,objectType:'adgroup',state:'owned',remoteId:g.parent.remote_id}};
      descriptor=s.kind==='keywords'?recipe.createKeywords(args):recipe.createCreative(args);
    } catch {fail('PROVENANCE','The stored sibling request must reproduce the supported original recipe exactly.');}
    const meta={kind:`haar_${s.kind}_create_v1`,customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,parentObjectId:s.parentObjectId,parentRemoteId:g.parent.remote_id,
      rootObjectId:g.root.hierarchy_object_id,rootRemoteId:g.root.remote_id,activationId:event.details_json.activationId,objectIds};
    const fingerprint=contentHash(descriptor),beforeHash=contentHash(meta);
    const planningDetails={kind:s.kind,activationId:meta.activationId,beforeHash,requestFingerprint:fingerprint,objectIds};
    const pa=attempts.filter(a=>a.phase==='sibling_plan'),attempt=pa[0];
    if(!actor(plan.created_by)||plan.mutation_operation_key!==op.create||!equal(plan.mutation_json,descriptor)||!equal(plan.expected_after_json,descriptor.body)||
      !equal(plan.before_json,meta)||plan.before_hash!==beforeHash||!equal(plan.read_json,{})||plan.rollback_json!==null||
      event.hierarchy_object_id!==objectIds[0]||event.status!=='planned'||event.operation_key!==op.create||event.lifecycle_kind!==lifecycle||
      event.request_id!==null||event.error_json!==null||epoch(event.created_at)!==started||!equal(event.details_json,{planId:s.planId,...planningDetails})||
      pa.length!==1||attempt.status!=='planned'||attempt.request_fingerprint!==null||attempt.request_json!==null||attempt.error_json!==null||attempt.remote_request_id!==null||
      epoch(attempt.created_at)!==started||!equal(attempt.response_json,planningDetails))fail('PROVENANCE','Original descriptor, ordered batch, immutable planning event and planning attempt must match.');
    const approvals=g.approvals.filter(a=>a.plan_id===s.planId);
    if(approvals.some(a=>!actor(a.actor)||a.confirmation!=='APPROVE_SEARCHAD_CHANGE'||typeof a.token_hash!=='string'||!/^[a-f0-9]{64}$/.test(a.token_hash)||
       !Number.isFinite(epoch(a.created_at))||epoch(a.created_at)<started||epoch(a.created_at)>=expires||epoch(a.created_at)>now||!Number.isFinite(epoch(a.expires_at))||epoch(a.expires_at)<=epoch(a.created_at))||
       (plan.approved_at===null ? approvals.length!==0||plan.status==='approved' : plan.status==='planned'||!approvals.some(a=>epoch(a.created_at)===epoch(plan.approved_at))))fail('PROVENANCE','Unused approval history must still match its original sibling plan.');
    return {objectIds,op,expires,fingerprint,beforeHash,events:related.filter(e=>e.phase==='sibling_plan_retired'),attempts:attempts.filter(a=>a.phase==='sibling_plan_retired')};
  }
  #details(g,s,b,principalId,priorStatus) {
    return {kind:'haar_unused_sibling_plan_retirement_v1',siblingKind:s.kind,planId:s.planId,objectIds:[...b.objectIds],parentObjectId:s.parentObjectId,
      rootObjectId:g.root.hierarchy_object_id,rootCreatePlanId:g.rootCreate.plan_id,parentCreatePlanId:g.parentPlan.plan_id,parentAfterHash:g.parentPlan.applied_after_hash,
      beforeHash:b.beforeHash,requestFingerprint:b.fingerprint,actorPrincipalId:principalId,expiredAt:new Date(b.expires).toISOString(),priorStatus,
      targetRemoteDispatched:false,runTerminated:false,replacementCreated:false,requiresNewApproval:true,replanningSupported:false,cleanupAuthority:false};
  }
  #priorProof(g,s,b,now) {
    const e=b.events[0],a=b.attempts[0],d=e?.details_json,at=epoch(e?.created_at);
    if(b.events.length!==1||b.attempts.length!==1||g.plan.status!=='expired'||!equal(g.plan.last_error_json,REASON)||
       !actor(d?.actorPrincipalId)||!['planned','approved','expired'].includes(d?.priorStatus)||!Number.isFinite(at)||at<b.expires||at>now)fail('PROVENANCE','Idempotent retirement requires exact original non-dispatch proof.');
    const expected=this.#details(g,s,b,d.actorPrincipalId,d.priorStatus);
    if(e.hierarchy_object_id!==b.objectIds[0]||e.customer_id!==s.customerId||e.hierarchy_run_id!==s.hierarchyRunId||e.operation_key!==b.op.create||e.lifecycle_kind!==null||
       e.status!=='expired_unused'||e.request_id!==null||e.error_json!==null||!equal(d,expected)||a.status!=='expired_unused'||a.request_fingerprint!==b.fingerprint||
       a.request_json!==null||a.error_json!==null||a.remote_request_id!==null||epoch(a.created_at)!==at||!equal(a.response_json,expected))fail('PROVENANCE','Retirement audit pair does not prove the unchanged local target.');
  }
  async retire(input) {
    const keys=['customerId','hierarchyRunId','parentObjectId','planId','kind','actorPrincipalId'];
    if(!record(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k)))fail('INPUT_INVALID','Exact copied internal retirement scope is required.',400);
    const s=Object.freeze(Object.fromEntries(keys.map(k=>[k,input[k]])));
    if(typeof s.customerId!=='string'||!/^\d{1,30}$/.test(s.customerId)||['hierarchyRunId','parentObjectId','planId'].some(k=>!uuid(s[k]))||!['keywords','creative'].includes(s.kind)||!actor(s.actorPrincipalId))fail('INPUT_INVALID','Invalid internal retirement scope.',400);
    return this.#tx(async c=>{
      const g=await this.#load(c,s),now=this.#now(),b=this.#binding(g,s,now);
      if(b.events.length||b.attempts.length) {
        this.#priorProof(g,s,b,now);this.#identity(g.run);
        if(this.#now()<now)fail('CLOCK_CHANGED','Server clock moved backwards during retirement.');
        return result(s,b.objectIds,false);
      }
      if(g.plan.last_error_json!==null)fail('PROVENANCE','An unexplained plan error cannot be cleared by retirement.');
      const at=new Date(now).toISOString(),details=this.#details(g,s,b,s.actorPrincipalId,g.plan.status);
      await c.query("UPDATE searchad_write_change_plans SET status='expired',last_error_json=$2::jsonb WHERE plan_id=$1",[s.planId,JSON.stringify(REASON)]);
      await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at)
        VALUES($1,$2,$3,$4,'sibling_plan_retired','expired_unused',$5,NULL,$6::jsonb,$7)`,[randomUUID(),s.hierarchyRunId,b.objectIds[0],s.customerId,b.op.create,JSON.stringify(details),at]);
      await c.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,request_fingerprint,response_json,created_at)
        VALUES($1,$2,'sibling_plan_retired','expired_unused',$3,$4::jsonb,$5)`,[randomUUID(),s.planId,b.fingerprint,JSON.stringify(details),at]);
      this.#identity(g.run);if(this.#now()<now)fail('CLOCK_CHANGED','Server clock moved backwards during retirement.');
      return result(s,b.objectIds,true);
    });
  }
}
