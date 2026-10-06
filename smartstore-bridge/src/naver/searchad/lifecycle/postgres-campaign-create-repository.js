import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SearchAdWriteError } from '../write/errors.js';
import { contentHash } from '../write/canonical.js';
import { SEARCHAD_APPROVAL_CONFIRMATION } from '../write/approval-service.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const FIELDS = ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const IDENT = { specSha:'spec_sha', credentialFingerprint:'credential_fingerprint', upstreamBaseUrl:'upstream_base_url' };
const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
export function fail(code, message, status=409) { throw new SearchAdWriteError(code,message,{},status); }
export function record(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
const epoch = v => v instanceof Date ? v.getTime() : Date.parse(v);
const active = (a,b,n) => Number.isFinite(epoch(a)) && Number.isFinite(epoch(b)) && epoch(a)<=n && epoch(b)>n;
function sameSet(a,b) { return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&new Set(b).size===b.length&&a.every(x=>typeof x==='string'&&x.length>0&&b.includes(x)); }

/** Conservative response contract for the checked-in campaign recipe, not a generic API parser. */
export function campaignResponse(result, descriptor, sideEffect, remoteId=null) {
  if(!record(result)||Object.hasOwn(result,'body')||Object.hasOwn(result,'value')||
    result.operation?.operationKey !== (sideEffect?OPS.campaign.create:OPS.campaign.read)||
    result.operation?.sideEffect !== sideEffect||result.upstream?.status!==200||!record(result.data)) return null;
  const d=result.data;
  const customer=typeof d.customerId==='string'?d.customerId:Number.isSafeInteger(d.customerId)&&d.customerId>=0?String(d.customerId):null;
  if(customer!==descriptor.customerId||typeof d.nccCampaignId!=='string'||!REMOTE_ID.test(d.nccCampaignId)||
    (remoteId!==null&&d.nccCampaignId!==remoteId)||['nccAdgroupId','nccKeywordId','nccAdId'].some(k=>Object.hasOwn(d,k))||
    Object.entries(descriptor.body).some(([k,v])=>!Object.hasOwn(d,k)||d[k]!==v)) return null;
  return Object.freeze({customerId:customer,nccCampaignId:d.nccCampaignId,...descriptor.body});
}

/** Internal PG plan/handoff/result store. No transport and no token issuer. */
export class PostgresCampaignCreateRepository {
  #pool; #recipe; #current; #clock; #ttl; #gate; #tickets=new WeakMap();
  constructor({pool,recipe,current,clock,planTtlSeconds,assertSendGate}) {
    this.#pool=pool;this.#recipe=recipe;this.#current=current;this.#clock=clock;this.#ttl=planTtlSeconds;this.#gate=assertSendGate;
  }
  async #transaction(work) {
    let c; let committing=false; let discard=false;
    try {
      c=await this.#pool.connect();await c.query('BEGIN');const result=await work(c);
      committing=true;await c.query('COMMIT');return result;
    } catch(e) {
      if(committing) {discard=true;fail('SEARCHAD_CAMPAIGN_CREATE_COMMIT_UNKNOWN','Local commit acknowledgement is unknown; do not send or retry.',503);}
      if(c)try{await c.query('ROLLBACK');}catch{discard=true;}
      if(e instanceof SearchAdWriteError)throw e;
      fail('SEARCHAD_CAMPAIGN_CREATE_STORE_FAILED','Campaign persistence failed; no new dispatch permission was issued.',503);
    } finally {if(c)c.release(discard);}
  }
  #now(){const n=this.#clock();if(!Number.isSafeInteger(n)||!Number.isFinite(new Date(n).getTime()))throw new TypeError('Epoch millisecond clock required');return n;}
  #identity(customerId,run=null){const v=this.#current(customerId);if(run&&Object.entries(IDENT).some(([k,c])=>v[k]!==run[c]))fail('SEARCHAD_CAMPAIGN_CREATE_CONTEXT_MISMATCH','Current identity differs from the persisted campaign.');return v;}
  async #authority(c,customerId,activationId,identity,n) {
    const grant=(await c.query('SELECT * FROM searchad_activation_grants WHERE activation_id=$1',[activationId])).rows[0];
    const evidence=grant?(await c.query('SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1',[grant.evidence_id])).rows[0]:null;
    if(!grant||!evidence||[grant,evidence].some(r=>r.customer_id!==customerId||r.evidence_type!=='active_canary'||Object.entries(IDENT).some(([k,col])=>r[col]!==identity[k]))||
      evidence.result!=='verified'||!active(grant.activated_at,grant.expires_at,n)||!active(evidence.created_at,evidence.expires_at,n)||
      ['operation_keys_json','field_scope_json','lifecycle_kinds_json'].some(k=>!sameSet(grant[k],evidence[k]))||
      !grant.operation_keys_json.includes(OPS.campaign.create)||!grant.lifecycle_kinds_json.includes('create')||FIELDS.some(k=>!grant.field_scope_json.includes(k)))
      fail('SEARCHAD_CAMPAIGN_CREATE_AUTHORITY_REQUIRED','Current matching active creation evidence and grant are required.',403);
    return {grant,evidence,validUntil:Math.min(epoch(grant.expires_at),epoch(evidence.expires_at))};
  }
  async #audit(c,s,phase,status,details,at) {
    const safe={planId:s.planId,...details};
    await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'create',$8::jsonb,$9)`,[randomUUID(),s.hierarchyRunId,s.hierarchyObjectId,s.customerId,phase,status,OPS.campaign.create,JSON.stringify(safe),at]);
    await c.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,request_fingerprint,response_json,created_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[randomUUID(),s.planId,phase,status,s.requestFingerprint??null,JSON.stringify(safe),at]);
  }
  async prepare(scope) {
    return this.#transaction(async c=>{
      const account=(await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',[scope.customerId])).rows[0];
      if(!account||account.suspended!==false)fail('SEARCHAD_CAMPAIGN_CREATE_SUSPENDED','Customer is unavailable or suspended.',403);
      const identity=this.#identity(scope.customerId);const authority=await this.#authority(c,scope.customerId,scope.activationId,identity,this.#now());
      const n=this.#now(),at=new Date(n).toISOString(),expiresAt=new Date(Math.min(n+this.#ttl*1000,authority.validUntil)).toISOString();
      if(Date.parse(expiresAt)<=n)fail('SEARCHAD_CAMPAIGN_CREATE_EXPIRED','Creation authority expired before planning.');
      const s={customerId:scope.customerId,hierarchyRunId:randomUUID(),hierarchyObjectId:randomUUID(),planId:randomUUID()};
      const descriptor=this.#recipe.createCampaign(s);s.requestFingerprint=contentHash(descriptor);
      await c.query(`INSERT INTO searchad_hierarchy_canary_runs(hierarchy_run_id,customer_id,recipe_id,status,started_by_principal_id,spec_sha,credential_fingerprint,upstream_base_url,activation_id,started_at)
        VALUES($1,$2,$3,'created',$4,$5,$6,$7,$8,$9)`,[s.hierarchyRunId,s.customerId,this.#recipe.id,scope.actorPrincipalId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,scope.activationId,at]);
      await c.query(`INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at)
        VALUES($1,$2,$3,'campaign',NULL,$4,$5,$6,'planned',$7,$7)`,[s.hierarchyObjectId,s.hierarchyRunId,s.customerId,OPS.campaign.create,OPS.campaign.read,OPS.campaign.delete,at]);
      await c.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,rollback_json,reason,status,created_by,created_at,expires_at)
        VALUES($1,$2,$3,$4::jsonb,'{}','{}',$5,$6::jsonb,NULL,'Prepare one server-owned stopped campaign; cleanup requires a separate approved path.','planned',$7,$8,$9)`,[s.planId,s.customerId,OPS.campaign.create,JSON.stringify(descriptor),contentHash({}),JSON.stringify(descriptor.body),scope.actorPrincipalId,at,expiresAt]);
      await this.#audit(c,s,'campaign_plan','planned',{actorPrincipalId:scope.actorPrincipalId,requestFingerprint:s.requestFingerprint},at);
      const final=this.#identity(scope.customerId);if(!isDeepStrictEqual(final,identity)||this.#now()>=Date.parse(expiresAt))fail('SEARCHAD_CAMPAIGN_CREATE_CONTEXT_MISMATCH','Planning identity or expiry changed before commit.');
      return Object.freeze({...s,state:'planned',expiresAt});
    });
  }
  async #graph(c,s) {
    // Compatible order with existing coordinator: account -> run -> objects -> holds -> plan.
    const account=(await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',[s.customerId])).rows[0];
    const run=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE',[s.hierarchyRunId,s.customerId])).rows[0];
    if(!run)fail('SEARCHAD_HIERARCHY_NOT_FOUND','Campaign scope was not found.',404);
    const objects=(await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 ORDER BY hierarchy_object_id FOR UPDATE',[s.hierarchyRunId])).rows;
    const holds=(await c.query('SELECT *,xmin::text AS version FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=$2 OR parent_hierarchy_object_id=$2 ORDER BY ownership_id FOR UPDATE',[s.hierarchyRunId,s.hierarchyObjectId])).rows;
    const plan=(await c.query('SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE',[s.planId,s.customerId])).rows[0];
    const events=(await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 ORDER BY event_id',[s.hierarchyRunId])).rows;
    const children=(await c.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE parent_object_id=$1 LIMIT 1',[s.hierarchyObjectId])).rows;
    const o=objects[0];const descriptor=this.#recipe.createCampaign({customerId:s.customerId,hierarchyRunId:s.hierarchyRunId});
    if(objects.length!==1||!o||o.hierarchy_object_id!==s.hierarchyObjectId||o.customer_id!==s.customerId||o.object_type!=='campaign'||o.parent_object_id!==null||o.deleted_at!==null||children.length||
      o.create_operation_key!==OPS.campaign.create||o.read_operation_key!==OPS.campaign.read||o.delete_operation_key!==OPS.campaign.delete||run.recipe_id!==this.#recipe.id||run.completed_at!==null||
      !plan||plan.mutation_operation_key!==OPS.campaign.create||!isDeepStrictEqual(plan.mutation_json,descriptor)||!isDeepStrictEqual(plan.expected_after_json,descriptor.body)||
      !isDeepStrictEqual(plan.read_json,{})||!isDeepStrictEqual(plan.before_json,{})||plan.before_hash!==contentHash({})||plan.rollback_json!==null)
      fail('SEARCHAD_CAMPAIGN_CREATE_GRAPH_INVALID','Persisted campaign and approved descriptor no longer have the exact scope.');
    return {account,run,objects,holds,plan,events,descriptor,object:o};
  }
  #signature(g){return JSON.stringify([g.run.version,g.objects.map(o=>[o.hierarchy_object_id,o.version]),g.holds.map(h=>[h.ownership_id,h.version]),g.plan.version,g.events.map(e=>e.event_id)]);}
  #ticket(g,s,stage){const ticket=Object.freeze({});this.#tickets.set(ticket,{signature:this.#signature(g),scope:{...s},stage});return ticket;}
  async beginSend(receipt) {
    const s=Object.freeze({customerId:receipt.descriptor.customerId,hierarchyRunId:receipt.hierarchyRunId,hierarchyObjectId:receipt.hierarchyObjectId,planId:receipt.planId,requestFingerprint:receipt.requestFingerprint});
    return this.#transaction(async c=>{
      const g=await this.#graph(c,s);const n=this.#now();const identity=this.#identity(s.customerId,g.run);
      if(!g.account||g.account.suspended!==false)fail('SEARCHAD_CAMPAIGN_CREATE_SUSPENDED','Customer was suspended before transmission.',403);
      if(receipt.dispatchCommitted!==true||receipt.remoteDispatched!==false||!isDeepStrictEqual(receipt.descriptor,g.descriptor)||s.requestFingerprint!==contentHash(g.descriptor)||
        g.object.state!=='dispatching'||g.object.remote_id!==null||g.holds.length||g.run.status!=='unknown_outcome'||g.plan.status!=='unknown_outcome')
        fail('SEARCHAD_CAMPAIGN_CREATE_HANDOFF_INVALID','Only the freshly committed unowned campaign may reach transport.');
      const intents=g.events.filter(e=>e.phase==='dispatch_intent');const intent=intents[0];
      if(intents.length!==1||intent.hierarchy_object_id!==s.hierarchyObjectId||intent.customer_id!==s.customerId||intent.operation_key!==OPS.campaign.create||intent.lifecycle_kind!=='create'||intent.status!=='committed_pending'||
        intent.details_json.planId!==s.planId||intent.details_json.intentId!==receipt.intentId||intent.details_json.requestFingerprint!==s.requestFingerprint||g.events.some(e=>e.phase==='transport_intent'))
        fail('SEARCHAD_CAMPAIGN_CREATE_HANDOFF_INVALID','A unique matching immutable dispatch intent is required.');
      const approval=(await c.query('SELECT * FROM searchad_write_approvals WHERE approval_id=$1 AND plan_id=$2',[intent.details_json.approvalId,s.planId])).rows[0];
      // SQL DATE is a calendar value. Casting avoids pg's local-midnight Date
      // conversion shifting the day when a client runs in Asia/Seoul.
      const risk=(await c.query('SELECT *,risk_date::text AS risk_date FROM searchad_risk_reservations WHERE intent_id=$1',[receipt.intentId])).rows[0];
      if(!approval||!Number.isFinite(epoch(approval.used_at))||epoch(approval.used_at)!==epoch(intent.created_at)||epoch(approval.used_at)>n||approval.confirmation!==SEARCHAD_APPROVAL_CONFIRMATION||!active(approval.created_at,approval.expires_at,n)||!active(g.plan.created_at,g.plan.expires_at,n)||
        !risk||risk.state!=='consumed'||risk.customer_id!==s.customerId||risk.owner_kind!=='hierarchy_canary'||risk.owner_run_id!==s.hierarchyRunId||risk.operation_key!==OPS.campaign.create||risk.lifecycle_kind!=='create'||risk.units!==intent.details_json.riskUnits||risk.risk_date!==intent.details_json.riskDate||epoch(risk.consumed_at)!==epoch(intent.created_at))
        fail('SEARCHAD_CAMPAIGN_CREATE_HANDOFF_INVALID','The consumed approval and risk must still bind this exact campaign.');
      const a=await this.#authority(c,s.customerId,g.run.activation_id,identity,n);
      const validUntil=Math.min(epoch(g.plan.expires_at),epoch(approval.expires_at),a.validUntil);
      const riskDate=intent.details_json.riskDate;
      if(new Date(n).toISOString().slice(0,10)!==riskDate)fail('SEARCHAD_CAMPAIGN_CREATE_EXPIRED','Risk day changed before transport.');
      await this.#audit(c,s,'transport_intent','attempt_once',{intentId:receipt.intentId,requestFingerprint:s.requestFingerprint},new Date(n).toISOString());
      const after=await this.#graph(c,s);this.#identity(s.customerId,g.run);this.#gate(g.descriptor);
      if(this.#now()>=validUntil||new Date(this.#now()).toISOString().slice(0,10)!==riskDate)fail('SEARCHAD_CAMPAIGN_CREATE_EXPIRED','Authority expired before transport commit.');
      return {ticket:this.#ticket(after,s,'transport'),descriptor:structuredClone(g.descriptor),identity,validUntil,riskDate};
    });
  }
  async #settle(ticket,stage,work) {
    const issued=this.#tickets.get(ticket);this.#tickets.delete(ticket);
    if(!issued||issued.stage!==stage)fail('SEARCHAD_CAMPAIGN_CREATE_TICKET_INVALID','An unused internally issued stage ticket is required.');
    return this.#transaction(async c=>{const g=await this.#graph(c,issued.scope);if(this.#signature(g)!==issued.signature)fail('SEARCHAD_CAMPAIGN_CREATE_STALE','Campaign state changed during transport; inspect without resending.');return work(c,g,issued.scope);});
  }
  async capture(ticket,result,{unavailable=false}={}) {
    return this.#settle(ticket,'transport',async(c,g,s)=>{
      const data=unavailable?null:campaignResponse(result,g.descriptor,true);const at=new Date(this.#now()).toISOString();
      const state=data||unavailable?'create_unknown':'manual_review';
      await c.query('UPDATE searchad_hierarchy_objects SET remote_id=$2,state=$3,updated_at=$4 WHERE hierarchy_object_id=$1',[s.hierarchyObjectId,data?.nccCampaignId??null,state,at]);
      if(data)await c.query(`INSERT INTO searchad_remote_object_ownership(ownership_id,customer_id,object_type,remote_id,owner_kind,owner_run_id,hierarchy_object_id,parent_hierarchy_object_id,created_operation_key,state,created_at,updated_at)
        VALUES($1,$2,'campaign',$3,'hierarchy_canary',$4,$5,NULL,$6,'manual_review',$7,$7)`,[randomUUID(),s.customerId,data.nccCampaignId,s.hierarchyRunId,s.hierarchyObjectId,OPS.campaign.create,at]);
      if(state==='manual_review'){
        await c.query("UPDATE searchad_hierarchy_canary_runs SET status='manual_review' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);
        await c.query("UPDATE searchad_write_change_plans SET status='manual_review' WHERE plan_id=$1",[s.planId]);
      }
      await this.#audit(c,s,'create_result',data?'returned_id_recorded':unavailable?'outcome_unknown':'response_mismatch',{returnedIdRecorded:Boolean(data)},at);
      const projection={...s,state,remoteId:data?.nccCampaignId??null};
      return {projection,ticket:data?this.#ticket(await this.#graph(c,s),s,'candidate'):null};
    });
  }
  async verify(ticket,result,{unavailable=false,contextMismatch=false}={}) {
    return this.#settle(ticket,'candidate',async(c,g,s)=>{
      const id=g.object.remote_id,h=g.holds[0];
      if(g.object.state!=='create_unknown'||g.holds.length!==1||h.customer_id!==s.customerId||h.object_type!=='campaign'||h.remote_id!==id||h.owner_kind!=='hierarchy_canary'||h.owner_run_id!==s.hierarchyRunId||h.hierarchy_object_id!==s.hierarchyObjectId||h.parent_hierarchy_object_id!==null||h.created_operation_key!==OPS.campaign.create||h.state!=='manual_review')fail('SEARCHAD_CAMPAIGN_CREATE_GRAPH_INVALID','Returned-ID hold changed before verification.');
      const data=unavailable||contextMismatch?null:campaignResponse(result,g.descriptor,false,id);
      const state=data?'owned':unavailable&&!contextMismatch?'create_unknown':'manual_review';
      const at=new Date(this.#now()).toISOString();
      await c.query('UPDATE searchad_hierarchy_objects SET state=$2,updated_at=$3 WHERE hierarchy_object_id=$1',[s.hierarchyObjectId,state,at]);
      await c.query('UPDATE searchad_remote_object_ownership SET state=$2,updated_at=$3 WHERE ownership_id=$1',[h.ownership_id,data?'owned':'manual_review',at]);
      await c.query('UPDATE searchad_hierarchy_canary_runs SET status=$2 WHERE hierarchy_run_id=$1',[s.hierarchyRunId,data?'cleanup_pending':state==='manual_review'?'manual_review':'unknown_outcome']);
      if(data)await c.query("UPDATE searchad_write_change_plans SET status='applied',applied_at=$2,applied_after_json=$3::jsonb,applied_after_hash=$4 WHERE plan_id=$1",[s.planId,at,JSON.stringify(data),contentHash(data)]);
      else if(state==='manual_review')await c.query("UPDATE searchad_write_change_plans SET status='manual_review' WHERE plan_id=$1",[s.planId]);
      await this.#audit(c,s,'create_verification',data?'verified':state==='manual_review'?'mismatch':'unavailable',{returnedIdRecorded:true,readOnly:true},at);
      return {...s,state,remoteId:id};
    });
  }
}
