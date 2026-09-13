import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { fail, record } from './postgres-campaign-create-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

export const IDENTITY = Object.freeze({ specSha: 'spec_sha', credentialFingerprint: 'credential_fingerprint', upstreamBaseUrl: 'upstream_base_url' });
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const REMOTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
export const problem = (code, message, status = 409) => fail(`SEARCHAD_CHILD_CLEANUP_${code}`, message, status);
export const epoch = value => value instanceof Date ? value.getTime() : Date.parse(value);
export const active = (start, end, now) => Number.isFinite(epoch(start)) && epoch(start) <= now && Number.isFinite(epoch(end)) && epoch(end) > now;
export const dayOf = value => value instanceof Date ? value.toISOString().slice(0,10) : value;

export function cleanupScope(input, context, mode) {
  const keys = ['customerId','hierarchyRunId','hierarchyObjectId', ...(mode === 'prepare' ? ['activationId'] : ['planId']), ...(mode === 'execute' ? ['executionToken','confirmation','secondConfirmation'] : [])];
  if (!record(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) problem('INPUT','Only exact local scope and separately approved credentials are accepted.',400);
  const scope = Object.fromEntries(keys.map(key => [key,input[key]]));
  if (typeof scope.customerId !== 'string' || !/^\d{1,30}$/.test(scope.customerId) || keys.filter(key => key.endsWith('Id') && key !== 'customerId').some(key => typeof scope[key] !== 'string' || !UUID.test(scope[key]))) problem('INPUT','Invalid explicit Customer or local UUID.',400);
  const p = context?.principal;
  if (!record(p) || p.role !== 'admin' || typeof p.principalId !== 'string' || !p.principalId.trim() || p.principalId !== p.principalId.trim() || !Array.isArray(p.customerIds) || !p.customerIds.includes(scope.customerId)) problem('FORBIDDEN','Authenticated Admin with explicit Customer access is required.',403);
  if (mode === 'execute') {
    if (typeof scope.executionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(scope.executionToken) || typeof scope.confirmation !== 'string' || typeof scope.secondConfirmation !== 'string') problem('INPUT','Invalid token or destructive confirmation.',400);
    scope.tokenHash = createHash('sha256').update(scope.executionToken).digest('hex'); delete scope.executionToken;
  }
  for (const key of keys) if (key.endsWith('Id') && key !== 'customerId') scope[key] = scope[key].toLowerCase();
  return Object.freeze({ ...scope, actorPrincipalId: p.principalId });
}

export function oneEvent(g, object, phase, status, operation, kind) {
  const matches = g.events.filter(e => e.hierarchy_object_id === object.hierarchy_object_id && e.phase === phase);
  const e = matches[0];
  if (matches.length !== 1 || e.customer_id !== g.run.customer_id || e.hierarchy_run_id !== g.run.hierarchy_run_id || e.status !== status || e.operation_key !== operation || e.lifecycle_kind !== kind || !record(e.details_json)) problem('PROVENANCE','One exact immutable scoped event is required.');
  return e;
}

/** Creation provenance is verified independently of mutable cleanup states. */
export function creationProof(g, node, descriptor) {
  const prefix = node.object_type === 'campaign' ? '' : 'adgroup_';
  const result = oneEvent(g,node,`${prefix}create_result`,'returned_id_recorded',OPS[node.object_type].create,'create');
  const verified = oneEvent(g,node,`${prefix}create_verification`,'verified',OPS[node.object_type].create,'create');
  const plan = g.plans.find(p => p.plan_id === result.details_json.planId);
  const snapshot = { customerId:g.run.customer_id, [node.object_type === 'campaign' ? 'nccCampaignId' : 'nccAdgroupId']:node.remote_id, ...descriptor.body };
  if (!plan || plan.customer_id !== g.run.customer_id || plan.status !== 'applied' || plan.mutation_operation_key !== OPS[node.object_type].create || !equal(plan.mutation_json,descriptor) || !equal(plan.expected_after_json,descriptor.body) || !equal(plan.applied_after_json,snapshot) || plan.applied_after_hash !== contentHash(snapshot) || !equal(plan.read_json,{}) || plan.rollback_json !== null || verified.details_json.planId !== plan.plan_id || result.details_json.returnedIdRecorded !== true || verified.details_json.returnedIdRecorded !== true) problem('PROVENANCE','Target must match the existing producer plan, response ID, snapshot hash and verification.');
  if (node.object_type === 'adgroup') {
    const planned = oneEvent(g,node,'adgroup_plan','planned',OPS.adgroup.create,'create');
    const meta = { kind:'haar_adgroup_create_v1', customerId:g.run.customer_id, hierarchyRunId:g.run.hierarchy_run_id, hierarchyObjectId:node.hierarchy_object_id, parentObjectId:g.root.hierarchy_object_id, parentRemoteId:g.root.remote_id, parentCreatePlanId:g.rootCreate.plan_id, parentAfterHash:g.rootCreate.applied_after_hash, activationId:planned.details_json.activationId };
    if (!equal(plan.before_json,meta) || plan.before_hash !== contentHash(meta) || planned.details_json.planId !== plan.plan_id || planned.details_json.beforeHash !== plan.before_hash || planned.details_json.requestFingerprint !== contentHash(descriptor) || result.details_json.returnedSnapshotHash !== plan.applied_after_hash) problem('PROVENANCE','Adgroup creation must retain its exact immutable parent binding.');
  } else if (!equal(plan.before_json,{}) || plan.before_hash !== contentHash({})) problem('PROVENANCE','Unexpected root creation metadata.');
  return plan;
}

export function targetDescriptor(customerId, node, kind) {
  return { operationKey:OPS[node.object_type][kind], customerId, pathParams:{ [node.object_type === 'campaign' ? 'campaignId' : 'adgroupId']:node.remote_id } };
}
export function cleanupMetadata(g, node, activationId) {
  const create = node.object_type === 'campaign' ? g.rootCreate : g.childCreate;
  return { kind:'haar_two_node_cleanup_v1', customerId:g.run.customer_id, hierarchyRunId:g.run.hierarchy_run_id, hierarchyObjectId:node.hierarchy_object_id, objectType:node.object_type, remoteId:node.remote_id,
    rootObjectId:g.root.hierarchy_object_id, rootRemoteId:g.root.remote_id, rootCreatePlanId:g.rootCreate.plan_id, rootAfterHash:g.rootCreate.applied_after_hash,
    childObjectId:g.child.hierarchy_object_id, childRemoteId:g.child.remote_id, childCreatePlanId:g.childCreate.plan_id, childAfterHash:g.childCreate.applied_after_hash,
    createPlanId:create.plan_id, activationId };
}
export const fullTarget = (customerId,node) => `searchad:${customerId}:${node.object_type}:${node.remote_id}`;

export function cleanupBinding(g,node,planId) {
  const event = oneEvent(g,node,'tree_cleanup_plan','planned',OPS[node.object_type].delete,'delete');
  const plan = g.plans.find(p => p.plan_id === planId);
  const meta = cleanupMetadata(g,node,event.details_json.activationId);
  const mutation = targetDescriptor(g.run.customer_id,node,'delete'), read = targetDescriptor(g.run.customer_id,node,'read');
  if (!plan || event.details_json.planId !== planId || plan.customer_id !== g.run.customer_id || plan.mutation_operation_key !== mutation.operationKey || !equal(plan.mutation_json,mutation) || !equal(plan.read_json,read) || !equal(plan.before_json,meta) || plan.before_hash !== contentHash(meta) || !equal(plan.expected_after_json,{absent:true,remoteId:node.remote_id}) || plan.rollback_json !== null || event.details_json.beforeHash !== plan.before_hash || event.details_json.requestFingerprint !== contentHash(mutation)) problem('PLAN','Exact server deletion plan and immutable target binding are required.');
  return { plan,meta,mutation,read };
}

export function claimedProof(g,node,binding) {
  const intent = oneEvent(g,node,'tree_cleanup_intent','attempt_once',OPS[node.object_type].delete,'delete');
  const d = intent.details_json, plan = binding.plan;
  const approval = g.approvals.find(a => a.approval_id === d.approvalId && a.plan_id === plan.plan_id);
  const risk = g.risks.find(r => r.intent_id === d.intentId);
  if (d.planId !== plan.plan_id || d.beforeHash !== plan.before_hash || d.requestFingerprint !== contentHash(binding.mutation) || d.intentId !== `hierarchy:tree:delete:${plan.plan_id}` || !approval || approval.confirmation !== 'APPROVE_SEARCHAD_CHANGE' || !Number.isFinite(epoch(approval.used_at)) || epoch(approval.used_at) !== epoch(intent.created_at) || !active(approval.created_at,approval.expires_at,epoch(intent.created_at)) || !active(plan.created_at,plan.expires_at,epoch(intent.created_at)) || !risk || risk.customer_id !== g.run.customer_id || risk.owner_run_id !== g.run.hierarchy_run_id || risk.owner_kind !== 'hierarchy_canary' || risk.state !== 'consumed' || risk.operation_key !== OPS[node.object_type].delete || risk.lifecycle_kind !== 'delete' || risk.units !== d.riskUnits || dayOf(risk.risk_date) !== d.riskDate || epoch(risk.consumed_at) !== epoch(intent.created_at)) problem('CLAIM','A matching committed approval/risk/deletion intent is required.');
  return intent;
}

export function deletedProof(g,node) {
  const hold = g.holds.find(h => h.hierarchy_object_id === node.hierarchy_object_id);
  const event = oneEvent(g,node,'tree_cleanup_plan','planned',OPS[node.object_type].delete,'delete');
  const binding = cleanupBinding(g,node,event.details_json.planId); claimedProof(g,node,binding);
  const absent = g.events.filter(e => e.hierarchy_object_id === node.hierarchy_object_id && e.phase === 'tree_cleanup_observation' && e.status === 'absent');
  const e = absent[0];
  if (node.state !== 'deleted' || hold?.state !== 'deleted' || !Number.isFinite(epoch(node.deleted_at)) || binding.plan.status !== 'applied' || !equal(binding.plan.applied_after_json,binding.plan.expected_after_json) || binding.plan.applied_after_hash !== contentHash(binding.plan.expected_after_json) || absent.length !== 1 || e.customer_id !== g.run.customer_id || e.operation_key !== OPS[node.object_type].delete || e.lifecycle_kind !== 'delete' || e.details_json?.planId !== binding.plan.plan_id || e.details_json.beforeHash !== binding.plan.before_hash || e.details_json.remoteId !== node.remote_id || e.details_json.readOnly !== true || e.details_json.upstreamStatus !== 404 || epoch(e.created_at) !== epoch(node.deleted_at) || epoch(binding.plan.applied_at) !== epoch(node.deleted_at)) problem('CHILD_PROOF','Deleted flags alone cannot authorize parent deletion.');
  return binding;
}
