import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const epoch=v=>v instanceof Date?v.getTime():Date.parse(v);
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const actor=v=>typeof v==='string'&&v.length>0&&v===v.trim();
const problem=(code,message,status=409)=>{throw new SearchAdWriteError(`SEARCHAD_CAMPAIGN_CLEANUP_${code}`,message,{},status);};
export const ROOT_CLEANUP_RETIREMENT_REASON=Object.freeze({code:'UNUSED_CAMPAIGN_CLEANUP_PLAN_EXPIRED'});
const RETIRED='cleanup_plan_retired';

export function rootCleanupMaintenanceScope(input,context,mode){
  if(!['retire','replan'].includes(mode))problem('INPUT','Unknown maintenance action.',400);
  const keys=['customerId','hierarchyRunId','hierarchyObjectId',...(mode==='retire'?['planId']:['predecessorPlanId','activationId']),'confirmation'];
  if(!record(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k)))problem('INPUT','Only exact local campaign cleanup scope is accepted.',400);
  const s=Object.fromEntries(keys.map(k=>[k,input[k]]));
  if(typeof s.customerId!=='string'||!/^\d{1,30}$/.test(s.customerId)||keys.filter(k=>k.endsWith('Id')&&k!=='customerId').some(k=>typeof s[k]!=='string'||!UUID.test(s[k]))||s.confirmation!==(mode==='retire'?'RETIRE_EXPIRED_UNUSED_CAMPAIGN_CLEANUP_PLAN':'REPLAN_EXPIRED_UNUSED_CAMPAIGN_CLEANUP_PLAN'))problem('INPUT','Invalid local identifiers or exact maintenance confirmation.',400);
  const p=context?.principal;
  if(!record(p)||p.role!=='admin'||!actor(p.principalId)||!Array.isArray(p.customerIds)||!p.customerIds.includes(s.customerId))problem('FORBIDDEN','Authenticated Admin and explicit Customer access are required.',403);
  for(const k of keys)if(k.endsWith('Id')&&k!=='customerId')s[k]=s[k].toLowerCase();
  delete s.confirmation;return Object.freeze({...s,actorPrincipalId:p.principalId});
}
export function rootCleanupMetadata(g,activationId){
  return {kind:'haar_campaign_cleanup_v1',customerId:g.run.customer_id,hierarchyRunId:g.run.hierarchy_run_id,hierarchyObjectId:g.object.hierarchy_object_id,
    remoteId:g.object.remote_id,createPlanId:g.createPlan.plan_id,createAfterHash:g.createPlan.applied_after_hash,activationId};
}
function binding(g,d,event,extra={}){
  const p=g.plans.find(p=>p.plan_id===event?.details_json?.planId);
  if(!event||!p||!record(event.details_json)||!UUID.test(String(event.details_json.activationId??''))||event.customer_id!==g.run.customer_id||event.hierarchy_run_id!==g.run.hierarchy_run_id||event.hierarchy_object_id!==g.object.hierarchy_object_id||event.operation_key!==OPS.campaign.delete||event.lifecycle_kind!=='delete'||event.status!=='planned')problem('PLAN','An exact root-only cleanup planning event is required.');
  const meta={...rootCleanupMetadata(g,event.details_json.activationId),...extra};
  if(p.customer_id!==g.run.customer_id||p.mutation_operation_key!==OPS.campaign.delete||!equal(p.mutation_json,d.mutation)||!equal(p.read_json,d.read)||!equal(p.before_json,meta)||p.before_hash!==contentHash(meta)||!equal(p.expected_after_json,{absent:true,remoteId:g.object.remote_id})||p.rollback_json!==null||event.details_json.beforeHash!==p.before_hash||event.details_json.requestFingerprint!==contentHash(d.mutation))problem('PLAN','Cleanup target, original metadata and generation binding must agree.');
  return {plan:p,event,meta,...d};
}
function planningAudit(g,b){
  const {plan:p,event:e}=b,details={planId:p.plan_id,activationId:b.meta.activationId,beforeHash:p.before_hash,requestFingerprint:contentHash(b.mutation),actorPrincipalId:p.created_by};
  const attempts=g.attempts.filter(a=>a.plan_id===p.plan_id&&a.phase==='cleanup_plan'),a=attempts[0];
  const start=epoch(p.created_at),end=epoch(p.expires_at),at=epoch(e.created_at);
  if(!actor(p.created_by)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isFinite(at)||at<start||at>=end||e.request_id!==null||e.error_json!==null||!equal(e.details_json,details)||attempts.length!==1||a.status!=='planned'||a.request_json!==null||a.request_fingerprint!==null||a.error_json!==null||a.remote_request_id!==null||!equal(a.response_json,details)||epoch(a.created_at)!==at)problem('RETIREMENT_PROVENANCE','Original planning event and attempt must agree exactly.');
}
function unused(g,b,now){
  const p=b.plan;planningAudit(g,b);
  if(p.before_json.cleanupGeneration!==undefined)problem('GENERATION_LIMIT','Only the original cleanup plan can be retired.');
  if(!['planned','approved','expired'].includes(p.status)||p.applied_at!==null||p.applied_after_json!==null||p.applied_after_hash!==null||p.rolled_back_at!==null)problem('NOT_UNUSED','Claimed, applied and ambiguous cleanup plans cannot be retired.');
  if(!Number.isSafeInteger(now)||now<epoch(p.created_at))problem('CLOCK','Invalid retirement time.');
  if(now<epoch(p.expires_at))problem('NOT_EXPIRED','The DELETE plan itself must expire.');
  const approvals=g.approvals.filter(a=>a.plan_id===p.plan_id);
  if(approvals.some(a=>a.used_at!==null)||g.locks.some(l=>l.plan_id===p.plan_id)||g.risks.some(r=>r.intent_id?.endsWith(`:${p.plan_id}`)))problem('PRIOR_WORK','Used approval, execution lock or prior risk prevents retirement.');
  if(approvals.some(a=>a.confirmation!=='APPROVE_SEARCHAD_CHANGE'||!actor(a.actor)||typeof a.token_hash!=='string'||!/^[a-f0-9]{64}$/.test(a.token_hash)||!Number.isFinite(epoch(a.created_at))||epoch(a.created_at)<epoch(p.created_at)||epoch(a.created_at)>now||!Number.isFinite(epoch(a.expires_at))||epoch(a.expires_at)<=epoch(a.created_at))||(p.approved_at===null?approvals.length!==0||p.status==='approved':p.status==='planned'||!approvals.some(a=>epoch(a.created_at)===epoch(p.approved_at))))problem('RETIREMENT_PROVENANCE','Original unused approval history is inconsistent.');
  if(g.events.some(e=>e.details_json?.planId===p.plan_id&&!['cleanup_plan',RETIRED].includes(e.phase))||g.attempts.some(a=>a.plan_id===p.plan_id&&!['cleanup_plan',RETIRED].includes(a.phase)))problem('PRIOR_WORK','Non-planning history is never an unused plan.');
  if(p.last_error_json!==null&&!equal(p.last_error_json,ROOT_CLEANUP_RETIREMENT_REASON))problem('RETIREMENT_PROVENANCE','Unexpected plan error is not a retirement proof.');
}
export function rootCleanupRetirementDetails(b,principalId,priorStatus){
  return {kind:'haar_unused_campaign_cleanup_plan_retirement_v1',planId:b.plan.plan_id,hierarchyObjectId:b.meta.hierarchyObjectId,objectType:'campaign',beforeHash:b.plan.before_hash,requestFingerprint:contentHash(b.mutation),actorPrincipalId:principalId,expiredAt:new Date(epoch(b.plan.expires_at)).toISOString(),priorStatus,targetRemoteDispatched:false,replacementCreated:false,requiresNewApproval:true,cleanupAuthority:false};
}
export function rootCleanupRetirementProof(g,b,now){
  unused(g,b,now);
  const events=g.events.filter(e=>e.phase===RETIRED&&e.details_json?.planId===b.plan.plan_id),attempts=g.attempts.filter(a=>a.phase===RETIRED&&a.plan_id===b.plan.plan_id);
  if(events.length===0&&attempts.length===0){if(b.plan.last_error_json!==null)problem('RETIREMENT_PROVENANCE','Expired flags without immutable retirement audits are not proof.');return null;}
  const e=events[0],a=attempts[0],d=e?.details_json,at=epoch(e?.created_at);
  if(events.length!==1||attempts.length!==1||!record(d)||!actor(d.actorPrincipalId)||!['planned','approved','expired'].includes(d.priorStatus)||!Number.isFinite(at)||at<epoch(b.plan.expires_at)||at>now||b.plan.status!=='expired'||!equal(b.plan.last_error_json,ROOT_CLEANUP_RETIREMENT_REASON))problem('RETIREMENT_PROVENANCE','One exact expired-unused retirement proof is required.');
  const details=rootCleanupRetirementDetails(b,d.actorPrincipalId,d.priorStatus);
  if(e.customer_id!==g.run.customer_id||e.hierarchy_run_id!==g.run.hierarchy_run_id||e.hierarchy_object_id!==g.object.hierarchy_object_id||e.status!=='expired_unused'||e.operation_key!==OPS.campaign.delete||e.lifecycle_kind!==null||e.request_id!==null||e.error_json!==null||!equal(d,details)||a.status!=='expired_unused'||a.request_json!==null||a.request_fingerprint!==null||a.error_json!==null||a.remote_request_id!==null||!equal(a.response_json,details)||epoch(a.created_at)!==at||(d.priorStatus==='planned'&&b.plan.approved_at!==null)||(d.priorStatus==='approved'&&b.plan.approved_at===null))problem('RETIREMENT_PROVENANCE','Retirement audit pair is inconsistent and cannot authorize replacement.');
  return {event:e,hash:contentHash(details),binding:b};
}
export function rootCleanupReplacementMetadata(g,activationId,proof){
  return {...rootCleanupMetadata(g,activationId),cleanupGeneration:2,predecessorPlanId:proof.binding.plan.plan_id,predecessorRetirementEventId:proof.event.event_id,predecessorRetirementHash:proof.hash};
}
/** Root-specific history, never translated into ChildFirst events or metadata. */
export function rootCleanupHistory(g,d,now){
  const events=g.events.filter(e=>e.phase==='cleanup_plan'),ids=events.map(e=>e.details_json?.planId);
  if(events.length<1||events.length>2||new Set(ids).size!==ids.length||g.plans.length!==events.length||g.plans.some(p=>!ids.includes(p.plan_id))||g.events.some(e=>e.phase.startsWith('cleanup_')&&!ids.includes(e.details_json?.planId)))problem('PLAN','Only one original and one explicit successor are supported; competing history is not ignored.');
  // A noncanonical or foreign linked DELETE risk cannot hide behind a reset flag.
  for(const r of g.risks)if(r.lifecycle_kind==='delete'||r.operation_key===OPS.campaign.delete){
    if(r.customer_id!==g.run.customer_id||r.owner_kind!=='hierarchy_canary'||r.owner_run_id!==g.run.hierarchy_run_id||!ids.some(id=>r.intent_id===`hierarchy:campaign:delete:${id}`))problem('PRIOR_WORK','Unexplained linked DELETE risk blocks cleanup maintenance.');
  }
  const originals=events.filter(e=>g.plans.find(p=>p.plan_id===e.details_json?.planId)?.before_json?.cleanupGeneration===undefined);
  if(originals.length!==1)problem('PLAN','An exact first-generation root cleanup plan is required.');
  const first=binding(g,d,originals[0]);
  const marked=g.events.some(e=>e.phase===RETIRED&&e.details_json?.planId===first.plan.plan_id)||g.attempts.some(a=>a.plan_id===first.plan.plan_id&&a.phase===RETIRED)||equal(first.plan.last_error_json,ROOT_CLEANUP_RETIREMENT_REASON);
  if(!marked){if(events.length!==1)problem('RETIREMENT_PROVENANCE','Replacement requires exact predecessor retirement.');return {first,current:first,retirement:null};}
  const retirement=rootCleanupRetirementProof(g,first,now);
  if(!retirement)problem('RETIREMENT_PROVENANCE','Missing predecessor retirement.');
  if(events.length===1)return {first,current:null,retirement};
  const event=events.find(e=>e!==originals[0]);
  const meta=rootCleanupReplacementMetadata(g,event.details_json?.activationId,retirement);
  const extra=Object.fromEntries(['cleanupGeneration','predecessorPlanId','predecessorRetirementEventId','predecessorRetirementHash'].map(k=>[k,meta[k]]));
  const current=binding(g,d,event,extra);planningAudit(g,current);
  if(epoch(current.plan.created_at)<epoch(retirement.event.created_at)||g.events.some(e=>e.phase===RETIRED&&e.details_json?.planId!==first.plan.plan_id)||g.attempts.some(a=>a.phase===RETIRED&&a.plan_id!==first.plan.plan_id))problem('GENERATION_LIMIT','A second retirement or inconsistent successor chronology is unsupported.');
  return {first,current,retirement};
}
