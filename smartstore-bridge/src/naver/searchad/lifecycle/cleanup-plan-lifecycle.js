import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { UUID, problem, epoch, cleanupMetadata, targetDescriptor, claimedProof } from './child-first-cleanup-contract.js';

export const CLEANUP_RETIREMENT_REASON = Object.freeze({ code:'UNUSED_CLEANUP_PLAN_EXPIRED' });
const RETIRE_PHASE='tree_cleanup_plan_retired';
const actor=value=>typeof value==='string'&&value.length>0&&value===value.trim();
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const planEvents=(g,node)=>g.events.filter(e=>e.hierarchy_object_id===node.hierarchy_object_id&&e.phase==='tree_cleanup_plan');
const retireEvents=(g,node,id)=>g.events.filter(e=>e.hierarchy_object_id===node.hierarchy_object_id&&e.phase===RETIRE_PHASE&&e.details_json?.planId===id);

/** A local maintenance action is not a deletion approval or an HTTP endpoint. */
export function cleanupMaintenanceScope(input,context,mode){
  if(!['retire','replan'].includes(mode))problem('INPUT','Unknown local maintenance action.',400);
  const keys=['customerId','hierarchyRunId','hierarchyObjectId',...(mode==='retire'?['planId']:['predecessorPlanId','activationId']),'confirmation'];
  if(!record(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k)))problem('INPUT','Only exact local cleanup maintenance scope is accepted.',400);
  const s=Object.fromEntries(keys.map(k=>[k,input[k]]));
  if(typeof s.customerId!=='string'||!/^\d{1,30}$/.test(s.customerId)||keys.filter(k=>k.endsWith('Id')&&k!=='customerId').some(k=>typeof s[k]!=='string'||!UUID.test(s[k]))||s.confirmation!==(mode==='retire'?'RETIRE_EXPIRED_UNUSED_CLEANUP_PLAN':'REPLAN_EXPIRED_UNUSED_CLEANUP_PLAN'))problem('INPUT','Invalid maintenance identifiers or exact confirmation.',400);
  const p=context?.principal;
  if(!record(p)||p.role!=='admin'||!actor(p.principalId)||!Array.isArray(p.customerIds)||!p.customerIds.includes(s.customerId))problem('FORBIDDEN','Authenticated Admin and explicit Customer access are required.',403);
  for(const key of keys)if(key.endsWith('Id')&&key!=='customerId')s[key]=s[key].toLowerCase();
  delete s.confirmation;
  return Object.freeze({...s,actorPrincipalId:p.principalId});
}

function bindingFor(g,node,event,extra={}){
  const plan=g.plans.find(p=>p.plan_id===event?.details_json?.planId);
  if(!event||!plan||event.customer_id!==g.run.customer_id||event.hierarchy_run_id!==g.run.hierarchy_run_id||event.status!=='planned'||event.operation_key!==OPS[node.object_type].delete||event.lifecycle_kind!=='delete'||!record(event.details_json)||!UUID.test(String(event.details_json.activationId||'')))problem('PLAN','One exact scoped deletion planning event is required.');
  const meta={...cleanupMetadata(g,node,event.details_json.activationId),...extra};
  const mutation=targetDescriptor(g.run.customer_id,node,'delete'),read=targetDescriptor(g.run.customer_id,node,'read');
  if(plan.customer_id!==g.run.customer_id||plan.mutation_operation_key!==mutation.operationKey||!equal(plan.mutation_json,mutation)||!equal(plan.read_json,read)||!equal(plan.before_json,meta)||plan.before_hash!==contentHash(meta)||!equal(plan.expected_after_json,{absent:true,remoteId:node.remote_id})||plan.rollback_json!==null||event.details_json.beforeHash!==plan.before_hash||event.details_json.requestFingerprint!==contentHash(mutation))problem('PLAN','Deletion plan must retain its exact original target and generation binding.');
  return {plan,meta,mutation,read,event};
}

function originalPlanningAudit(g,b){
  const {plan,event,mutation}=b;
  const details={planId:plan.plan_id,activationId:b.meta.activationId,beforeHash:plan.before_hash,requestFingerprint:contentHash(mutation),actorPrincipalId:plan.created_by};
  const attempts=g.attempts.filter(a=>a.plan_id===plan.plan_id&&a.phase==='tree_cleanup_plan');
  const a=attempts[0],start=epoch(plan.created_at),expiry=epoch(plan.expires_at),planned=epoch(event.created_at);
  if(!actor(plan.created_by)||!Number.isFinite(start)||!Number.isFinite(expiry)||expiry<=start||!Number.isFinite(planned)||planned<start||planned>=expiry||event.request_id!==null||event.error_json!==null||!equal(event.details_json,details)||attempts.length!==1||a.status!=='planned'||a.request_json!==null||a.request_fingerprint!==null||a.error_json!==null||a.remote_request_id!==null||!equal(a.response_json,details)||epoch(a.created_at)!==planned)problem('RETIREMENT_PROVENANCE','Original cleanup planning event and attempt must agree exactly.');
}

/** Validate only work attributable to this DELETE plan, not legitimate CREATE risk. */
export function assertUnusedCleanupPlan(g,node,b,now){
  const p=b.plan;
  if(p.before_json?.cleanupGeneration!==undefined)problem('GENERATION_LIMIT','Only a first-generation cleanup plan may be retired.');
  if(!['planned','approved','expired'].includes(p.status)||p.applied_at!==null||p.applied_after_json!==null||p.applied_after_hash!==null||p.rolled_back_at!==null)problem('NOT_UNUSED','A claimed, applied or ambiguous DELETE plan is never unused.');
  originalPlanningAudit(g,b);
  const expiry=epoch(p.expires_at);
  if(!Number.isSafeInteger(now)||now<epoch(p.created_at))problem('CLOCK','Invalid time for cleanup retirement.');
  if(now<expiry)problem('NOT_EXPIRED','The DELETE plan itself must expire; token expiry alone is insufficient.');
  const approvals=g.approvals.filter(a=>a.plan_id===p.plan_id);
  if(approvals.some(a=>a.used_at!==null)||g.locks.some(l=>l.plan_id===p.plan_id)||g.risks.some(r=>typeof r.intent_id==='string'&&r.intent_id.endsWith(`:${p.plan_id}`)))problem('PRIOR_WORK','Used approval, execution lock or any prior DELETE risk prevents retirement.');
  if(approvals.some(a=>a.confirmation!=='APPROVE_SEARCHAD_CHANGE'||!actor(a.actor)||typeof a.token_hash!=='string'||!/^[a-f0-9]{64}$/.test(a.token_hash)||!Number.isFinite(epoch(a.created_at))||epoch(a.created_at)<epoch(p.created_at)||epoch(a.created_at)>now||!Number.isFinite(epoch(a.expires_at))||epoch(a.expires_at)<=epoch(a.created_at))||(p.approved_at===null?approvals.length!==0||p.status==='approved':p.status==='planned'||!approvals.some(a=>epoch(a.created_at)===epoch(p.approved_at))))problem('RETIREMENT_PROVENANCE','Unused approval history is inconsistent with the original plan.');
  const ownEvents=g.events.filter(e=>e.details_json?.planId===p.plan_id);
  if(ownEvents.some(e=>e.hierarchy_object_id!==node.hierarchy_object_id||e.customer_id!==g.run.customer_id||e.hierarchy_run_id!==g.run.hierarchy_run_id||!['tree_cleanup_plan',RETIRE_PHASE].includes(e.phase))||g.attempts.some(a=>a.plan_id===p.plan_id&&!['tree_cleanup_plan',RETIRE_PHASE].includes(a.phase)))problem('PRIOR_WORK','Any non-planning DELETE event or attempt prevents retirement.');
  if(p.last_error_json!==null&&!equal(p.last_error_json,CLEANUP_RETIREMENT_REASON))problem('RETIREMENT_PROVENANCE','An unexplained old plan error is not retirement proof.');
}

export function cleanupRetirementDetails(b,node,principalId,priorStatus){
  return {kind:'haar_unused_cleanup_plan_retirement_v1',planId:b.plan.plan_id,hierarchyObjectId:node.hierarchy_object_id,objectType:node.object_type,beforeHash:b.plan.before_hash,requestFingerprint:contentHash(b.mutation),actorPrincipalId:principalId,expiredAt:new Date(epoch(b.plan.expires_at)).toISOString(),priorStatus,targetRemoteDispatched:false,replacementCreated:false,requiresNewApproval:true,cleanupAuthority:false};
}

export function cleanupRetirementProof(g,node,b,now){
  assertUnusedCleanupPlan(g,node,b,now);
  const matches=retireEvents(g,node,b.plan.plan_id),attempts=g.attempts.filter(a=>a.plan_id===b.plan.plan_id&&a.phase===RETIRE_PHASE);
  if(matches.length===0&&attempts.length===0){if(b.plan.last_error_json!==null)problem('RETIREMENT_PROVENANCE','An expired flag/reason without retirement audit is not proof.');return null;}
  const event=matches[0],d=event?.details_json,a=attempts[0],at=epoch(event?.created_at);
  if(matches.length!==1||attempts.length!==1||!record(d)||!actor(d.actorPrincipalId)||!['planned','approved','expired'].includes(d.priorStatus)||!Number.isFinite(at)||at<epoch(b.plan.expires_at)||at>now||b.plan.status!=='expired'||!equal(b.plan.last_error_json,CLEANUP_RETIREMENT_REASON))problem('RETIREMENT_PROVENANCE','Exactly one valid expired-unused cleanup retirement proof is required.');
  const details=cleanupRetirementDetails(b,node,d.actorPrincipalId,d.priorStatus);
  if(event.customer_id!==g.run.customer_id||event.hierarchy_run_id!==g.run.hierarchy_run_id||event.status!=='expired_unused'||event.operation_key!==b.mutation.operationKey||event.lifecycle_kind!==null||event.request_id!==null||event.error_json!==null||!equal(d,details)||a.status!=='expired_unused'||a.request_json!==null||a.request_fingerprint!==null||a.error_json!==null||a.remote_request_id!==null||!equal(a.response_json,details)||epoch(a.created_at)!==at||(d.priorStatus==='planned'&&b.plan.approved_at!==null)||(d.priorStatus==='approved'&&b.plan.approved_at===null))problem('RETIREMENT_PROVENANCE','Retirement event and attempt are inconsistent; they never authorize a DELETE.');
  return Object.freeze({event,hash:contentHash(details),binding:b});
}

export function replacementCleanupMetadata(g,node,activationId,proof){
  return {...cleanupMetadata(g,node,activationId),cleanupGeneration:2,predecessorPlanId:proof.binding.plan.plan_id,predecessorRetirementEventId:proof.event.event_id,predecessorRetirementHash:proof.hash};
}

function history(g,node,now){
  const events=planEvents(g,node);
  if(events.length<1||events.length>2||new Set(events.map(e=>e.details_json?.planId)).size!==events.length)problem('PLAN','Only one original and one replacement cleanup plan are supported.');
  const ids=events.map(e=>e.details_json?.planId);
  const linked=g.plans.filter(p=>p.before_json?.hierarchyObjectId===node.hierarchy_object_id&&p.mutation_operation_key===OPS[node.object_type].delete);
  if(linked.length!==events.length||linked.some(p=>!ids.includes(p.plan_id))||g.events.some(e=>e.hierarchy_object_id===node.hierarchy_object_id&&e.phase.startsWith('tree_cleanup_')&&!ids.includes(e.details_json?.planId)))problem('PLAN','Unbound or competing target cleanup history is not ignored.');
  const originalEvents=events.filter(e=>g.plans.find(p=>p.plan_id===e.details_json?.planId)?.before_json?.cleanupGeneration===undefined);
  if(originalEvents.length!==1)problem('PLAN','An exact original cleanup plan is required.');
  const first=bindingFor(g,node,originalEvents[0]);
  const marked=retireEvents(g,node,first.plan.plan_id).length>0||equal(first.plan.last_error_json,CLEANUP_RETIREMENT_REASON);
  if(!marked){if(events.length!==1)problem('RETIREMENT_PROVENANCE','Replacement requires an exact predecessor retirement.');return {first,current:first,retirement:null};}
  const retirement=cleanupRetirementProof(g,node,first,now);
  if(!retirement)problem('RETIREMENT_PROVENANCE','Missing predecessor retirement proof.');
  if(events.length===1)return {first,current:null,retirement};
  const event=events.find(e=>e!==originalEvents[0]);
  const extra={cleanupGeneration:2,predecessorPlanId:first.plan.plan_id,predecessorRetirementEventId:retirement.event.event_id,predecessorRetirementHash:retirement.hash};
  const current=bindingFor(g,node,event,extra);
  originalPlanningAudit(g,current);
  if(epoch(current.plan.created_at)<epoch(retirement.event.created_at)||g.events.some(e=>e.hierarchy_object_id===node.hierarchy_object_id&&e.phase===RETIRE_PHASE&&e.details_json?.planId!==first.plan.plan_id))problem('GENERATION_LIMIT','A second retirement or inconsistent replacement chronology is unsupported.');
  return {first,current,retirement};
}

/** Consumers see the complete history; retired plans cannot be executed/reconciled. */
export function cleanupBinding(g,node,planId,{allowRetired=false}={}){
  const h=history(g,node,g.cleanupNow);
  if(h.current?.plan.plan_id===planId)return h.current;
  if(allowRetired&&h.current===null&&h.first.plan.plan_id===planId)return h.first;
  problem('PLAN','Only the current cleanup plan is eligible; an old token or retired plan is not reused.');
}

export function cleanupReplacementProof(g,node,predecessorPlanId,now){
  const h=history(g,node,now);
  if(h.current!==null||h.first.plan.plan_id!==predecessorPlanId||!h.retirement)problem('PRIOR_PLAN','Exactly one retired predecessor and no existing successor are required.');
  return h.retirement;
}

export function assertCleanupTargetUntouched(g,node){
  const hold=g.holds.find(h=>h.hierarchy_object_id===node.hierarchy_object_id);
  const partial=g.siblingCreate?.partial===true&&g.siblingCreate.quarantined.some(q=>q.objectId===node.hierarchy_object_id);
  if(g.run.completed_at!==null||!['cleanup_pending','manual_review'].includes(g.run.status)||node.deleted_at!==null||node.state!==(partial?'manual_review':'owned')||hold?.state!==(partial?'manual_review':'owned'))problem('NOT_UNUSED','The target must retain its original pre-delete state; ambiguous deletion cannot be retired.');
}

/** Retired local plans are history, never deletion evidence for a parent. */
export function deletedProof(g,node){
  const hold=g.holds.find(h=>h.hierarchy_object_id===node.hierarchy_object_id);
  if(node.state!=='deleted'||hold?.state!=='deleted'||!Number.isFinite(epoch(node.deleted_at)))problem('CHILD_PROOF','Every managed descendant must be deletion-proven before parent cleanup.');
  const h=history(g,node,g.cleanupNow),b=h.current;
  if(!b)problem('CHILD_PROOF','A retired plan is not a deletion proof.');
  claimedProof(g,node,b);
  const absent=g.events.filter(e=>e.hierarchy_object_id===node.hierarchy_object_id&&e.phase==='tree_cleanup_observation'&&e.status==='absent'),e=absent[0];
  if(b.plan.status!=='applied'||!equal(b.plan.applied_after_json,b.plan.expected_after_json)||b.plan.applied_after_hash!==contentHash(b.plan.expected_after_json)||absent.length!==1||e.customer_id!==g.run.customer_id||e.hierarchy_run_id!==g.run.hierarchy_run_id||e.operation_key!==OPS[node.object_type].delete||e.lifecycle_kind!=='delete'||e.details_json?.planId!==b.plan.plan_id||e.details_json.beforeHash!==b.plan.before_hash||e.details_json.remoteId!==node.remote_id||e.details_json.readOnly!==true||e.details_json.upstreamStatus!==404||epoch(e.created_at)!==epoch(node.deleted_at)||epoch(b.plan.applied_at)!==epoch(node.deleted_at))problem('CHILD_PROOF','Only the current separately approved DELETE and qualified GET404 may prove descendant deletion.');
  return b;
}
