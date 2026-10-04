import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

export const ADGROUP_GENERATION_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const RETIRE_REASON = Object.freeze({ code: 'UNUSED_ADGROUP_PLAN_EXPIRED' });
const RETIRE_KIND = 'haar_unused_adgroup_plan_retirement_v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const epoch = value => value instanceof Date ? value.getTime() : Date.parse(value);
const actor = value => typeof value === 'string' && value.length > 0 && value === value.trim();
const uuid = value => typeof value === 'string' && ADGROUP_GENERATION_UUID.test(value);

function rejectWith(reject, code, message) {
  return reject(code, message);
}

export function adgroupPlanMetadata({
  customerId, hierarchyRunId, hierarchyObjectId, parentObjectId, parentRemoteId,
  parentCreatePlanId, parentAfterHash, activationId, generation = 1, predecessor = null
}) {
  const base = {
    kind: 'haar_adgroup_create_v1',
    customerId,
    hierarchyRunId,
    hierarchyObjectId,
    parentObjectId,
    parentRemoteId,
    parentCreatePlanId,
    parentAfterHash,
    activationId
  };
  if (generation === 1) return base;
  if (generation !== 2 || !predecessor) throw new TypeError('Only one proof-bound adgroup replacement generation is supported');
  return {
    ...base,
    generation: 2,
    predecessorObjectId: predecessor.object.hierarchy_object_id,
    predecessorPlanId: predecessor.plan.plan_id,
    predecessorRetirementEventId: predecessor.retirementEvent.event_id
  };
}

function descriptorFor(g, reject) {
  if (!g?.run || !g?.root || !g?.rootPlan || g.root.object_type !== 'campaign' ||
      g.root.customer_id !== g.run.customer_id || g.root.hierarchy_run_id !== g.run.hierarchy_run_id ||
      typeof g.root.remote_id !== 'string' || !REMOTE.test(g.root.remote_id) ||
      typeof g.rootPlan.applied_after_hash !== 'string' || !/^[a-f0-9]{64}$/.test(g.rootPlan.applied_after_hash)) {
    return rejectWith(reject, 'GENERATION_PROVENANCE', 'Verified root campaign provenance is required before evaluating adgroup generations.');
  }
  return createHierarchyChildRecipe().createAdgroup({
    customerId: g.run.customer_id,
    hierarchyRunId: g.run.hierarchy_run_id,
    parent: {
      customerId: g.run.customer_id,
      hierarchyRunId: g.run.hierarchy_run_id,
      objectType: 'campaign',
      state: 'owned',
      remoteId: g.root.remote_id
    }
  });
}

function planningDetails(plan, meta, descriptor, predecessor) {
  const base = {
    planId: plan.plan_id,
    activationId: meta.activationId,
    beforeHash: plan.before_hash,
    requestFingerprint: contentHash(descriptor),
    actorPrincipalId: plan.created_by
  };
  return predecessor ? {
    ...base,
    generation: 2,
    predecessorObjectId: predecessor.object.hierarchy_object_id,
    predecessorPlanId: predecessor.plan.plan_id,
    predecessorRetirementEventId: predecessor.retirementEvent.event_id
  } : base;
}

function planningProof(g, node, generation, predecessor, descriptor, reject) {
  const events = g.events.filter(e => e.hierarchy_object_id === node.hierarchy_object_id && e.phase === 'adgroup_plan');
  const event = events[0];
  if (events.length !== 1 || event.customer_id !== g.run.customer_id || event.hierarchy_run_id !== g.run.hierarchy_run_id ||
      event.status !== 'planned' || event.operation_key !== OPS.adgroup.create || event.lifecycle_kind !== 'create' ||
      !record(event.details_json) || !uuid(event.details_json.planId) || !uuid(event.details_json.activationId)) {
    return rejectWith(reject, 'GENERATION_PROVENANCE', 'One exact immutable adgroup planning event is required for the selected generation.');
  }
  const plan = g.plans.find(p => p.plan_id === event.details_json.planId);
  if (!plan || plan.customer_id !== g.run.customer_id || !actor(plan.created_by) ||
      plan.mutation_operation_key !== OPS.adgroup.create || !equal(plan.mutation_json, descriptor) ||
      !equal(plan.expected_after_json, descriptor.body) || !equal(plan.read_json, {}) || plan.rollback_json !== null) {
    return rejectWith(reject, 'GENERATION_PROVENANCE', 'Adgroup generation plan descriptor is missing or inconsistent.');
  }
  const meta = adgroupPlanMetadata({
    customerId: g.run.customer_id,
    hierarchyRunId: g.run.hierarchy_run_id,
    hierarchyObjectId: node.hierarchy_object_id,
    parentObjectId: g.root.hierarchy_object_id,
    parentRemoteId: g.root.remote_id,
    parentCreatePlanId: g.rootPlan.plan_id,
    parentAfterHash: g.rootPlan.applied_after_hash,
    activationId: event.details_json.activationId,
    generation,
    predecessor
  });
  const details = planningDetails(plan, meta, descriptor, predecessor);
  const attempts = g.attempts.filter(a => a.plan_id === plan.plan_id && a.phase === 'adgroup_plan');
  const attempt = attempts[0];
  if (!equal(plan.before_json, meta) || plan.before_hash !== contentHash(meta) ||
      !equal(event.details_json, details) || epoch(event.created_at) !== epoch(plan.created_at) ||
      attempts.length !== 1 || attempt.status !== 'planned' || attempt.request_fingerprint !== contentHash(descriptor) ||
      attempt.request_json !== null || attempt.error_json !== null || attempt.remote_request_id !== null ||
      !equal(attempt.response_json, details) || epoch(attempt.created_at) !== epoch(plan.created_at)) {
    return rejectWith(reject, 'GENERATION_PROVENANCE', 'Adgroup generation metadata, planning event and planning attempt must agree exactly.');
  }
  if (node.customer_id !== g.run.customer_id || node.hierarchy_run_id !== g.run.hierarchy_run_id ||
      node.object_type !== 'adgroup' || node.parent_object_id !== g.root.hierarchy_object_id ||
      node.create_operation_key !== OPS.adgroup.create || node.read_operation_key !== OPS.adgroup.read ||
      node.delete_operation_key !== OPS.adgroup.delete || epoch(node.created_at) !== epoch(plan.created_at)) {
    return rejectWith(reject, 'GENERATION_GRAPH', 'Adgroup generation object is outside the verified root scope.');
  }
  return Object.freeze({ plan, event, descriptor, meta, generation });
}

function retiredPredecessorProof(g, node, descriptor, reject) {
  const binding = planningProof(g, node, 1, null, descriptor, reject);
  const plan = binding.plan;
  const retiredEvents = g.events.filter(e => e.hierarchy_object_id === node.hierarchy_object_id && e.phase === 'adgroup_plan_retired');
  const retirementEvent = retiredEvents[0];
  const objectEvents = g.events.filter(e => e.hierarchy_object_id === node.hierarchy_object_id);
  if (retiredEvents.length !== 1 || objectEvents.length !== 2 || node.state !== 'planned' || node.remote_id !== null ||
      node.deleted_at !== null || g.holds.some(h => h.hierarchy_object_id === node.hierarchy_object_id) ||
      plan.status !== 'expired' || !equal(plan.last_error_json, RETIRE_REASON) ||
      plan.applied_at !== null || plan.applied_after_json !== null || plan.applied_after_hash !== null || plan.rolled_back_at !== null) {
    return rejectWith(reject, 'GENERATION_RETIREMENT', 'Historical predecessor is not an exact expired never-dispatched adgroup plan.');
  }
  const planApprovals = g.approvals.filter(a => a.plan_id === plan.plan_id);
  if (planApprovals.some(a => a.used_at !== null || a.confirmation !== 'APPROVE_SEARCHAD_CHANGE' ||
      !actor(a.actor) || typeof a.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(a.token_hash))) {
    return rejectWith(reject, 'GENERATION_RETIREMENT', 'Retired predecessor contains a used or malformed approval.');
  }
  if (g.locks.some(l => l.plan_id === plan.plan_id) ||
      g.risks.some(r => r.intent_id === `hierarchy:adgroup:create:${plan.plan_id}`)) {
    return rejectWith(reject, 'GENERATION_RETIREMENT', 'Retired predecessor has execution or risk work and cannot be replaced.');
  }
  const allAttempts = g.attempts.filter(a => a.plan_id === plan.plan_id);
  const retirementAttempts = allAttempts.filter(a => a.phase === 'adgroup_plan_retired');
  const retirementAttempt = retirementAttempts[0];
  const expires = epoch(plan.expires_at), retiredAt = epoch(retirementEvent?.created_at);
  const d = retirementEvent?.details_json;
  if (!Number.isFinite(expires) || !Number.isFinite(retiredAt) || retiredAt < expires || !record(d) ||
      !actor(d.actorPrincipalId) || !['planned','approved','expired'].includes(d.priorStatus)) {
    return rejectWith(reject, 'GENERATION_RETIREMENT', 'Retirement timestamp, actor or prior state is invalid.');
  }
  const expected = {
    kind: RETIRE_KIND,
    planId: plan.plan_id,
    parentObjectId: g.root.hierarchy_object_id,
    parentCreatePlanId: g.rootPlan.plan_id,
    beforeHash: plan.before_hash,
    requestFingerprint: contentHash(descriptor),
    actorPrincipalId: d.actorPrincipalId,
    expiredAt: new Date(expires).toISOString(),
    priorStatus: d.priorStatus,
    targetRemoteDispatched: false,
    runTerminated: false,
    replacementCreated: false,
    requiresNewApproval: true,
    cleanupAuthority: false
  };
  if (retirementEvent.customer_id !== g.run.customer_id || retirementEvent.hierarchy_run_id !== g.run.hierarchy_run_id ||
      retirementEvent.status !== 'expired_unused' || retirementEvent.operation_key !== OPS.adgroup.create ||
      retirementEvent.lifecycle_kind !== null || retirementEvent.request_id !== null || retirementEvent.error_json !== null ||
      !equal(d, expected) || allAttempts.length !== 2 || retirementAttempts.length !== 1 ||
      retirementAttempt.status !== 'expired_unused' || retirementAttempt.request_fingerprint !== contentHash(descriptor) ||
      retirementAttempt.request_json !== null || retirementAttempt.error_json !== null || retirementAttempt.remote_request_id !== null ||
      !equal(retirementAttempt.response_json, expected) || epoch(retirementAttempt.created_at) !== retiredAt) {
    return rejectWith(reject, 'GENERATION_RETIREMENT', 'Immutable predecessor retirement event and attempt must match exactly.');
  }
  if (d.priorStatus === 'planned' && (plan.approved_at !== null || planApprovals.length !== 0)) {
    return rejectWith(reject, 'GENERATION_RETIREMENT', 'A planned predecessor cannot contain approval history.');
  }
  if (d.priorStatus === 'approved' && (!Number.isFinite(epoch(plan.approved_at)) ||
      !planApprovals.some(a => epoch(a.created_at) === epoch(plan.approved_at)))) {
    return rejectWith(reject, 'GENERATION_RETIREMENT', 'Approved predecessor retirement must retain its exact unused approval history.');
  }
  return Object.freeze({ object: node, plan, retirementEvent, binding });
}

/**
 * Supports generation 1 plus exactly one proof-bound generation-2 replacement.
 * It never treats a retired predecessor as deleted/absent and never permits a
 * third adgroup generation.
 */
export function resolveAdgroupGenerationHistory(g, selectedObjectId, reject) {
  if (typeof reject !== 'function') throw new TypeError('Generation resolver requires a fail-closed error mapper');
  const descriptor = descriptorFor(g, reject);
  const adgroups = g.objects.filter(o => o.object_type === 'adgroup');
  if (adgroups.length > 2) return rejectWith(reject, 'GENERATION_LIMIT', 'At most one retired predecessor and one active adgroup generation are supported.');
  const retirementMarked = adgroups.filter(o => g.events.some(e => e.hierarchy_object_id === o.hierarchy_object_id && e.phase === 'adgroup_plan_retired'));
  if (retirementMarked.length > 1) return rejectWith(reject, 'GENERATION_LIMIT', 'A second retired adgroup generation is outside this bounded slice.');
  const predecessor = retirementMarked.length ? retiredPredecessorProof(g, retirementMarked[0], descriptor, reject) : null;
  const activeCandidates = adgroups.filter(o => o !== predecessor?.object);
  if (activeCandidates.length > 1) return rejectWith(reject, 'GENERATION_GRAPH', 'Multiple non-retired adgroups are ambiguous and rejected.');
  const active = activeCandidates[0] ?? null;
  if (selectedObjectId !== null && (!active || active.hierarchy_object_id !== selectedObjectId)) {
    return rejectWith(reject, 'GENERATION_TARGET', 'Only the current non-retired adgroup generation may be selected.');
  }
  const activeGeneration = active ? (predecessor ? 2 : 1) : null;
  const activeBinding = active ? planningProof(g, active, activeGeneration, predecessor, descriptor, reject) : null;
  return Object.freeze({
    predecessor,
    active,
    activeBinding,
    activeGeneration,
    nextGeneration: active ? null : predecessor ? 2 : 1,
    descriptor
  });
}
