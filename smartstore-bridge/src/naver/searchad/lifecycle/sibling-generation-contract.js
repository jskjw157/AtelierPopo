import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { SearchAdWriteError } from '../write/errors.js';
import { KEYWORD_CREATE_MAX_BATCH, SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const REMOTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const HASH = /^[a-f0-9]{64}$/;
const REASON = Object.freeze({ code: 'UNUSED_SIBLING_PLAN_EXPIRED' });
const RECEIPTS = new WeakMap();
const PLAN_PHASE = 'sibling_plan';
const RETIRE_PHASE = 'sibling_plan_retired';
const KINDS = Object.freeze({
  keywords: Object.freeze({ type: 'keyword', lifecycle: 'batch_create' }),
  creative: Object.freeze({ type: 'creative', lifecycle: 'create' })
});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const epoch = value => value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
const uuid = value => typeof value === 'string' && UUID.test(value);
const actor = value => typeof value === 'string' && value.length > 0 && value === value.trim();
const opaque = value => typeof value === 'string' && REMOTE.test(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function fail(code, message) {
  throw new SearchAdWriteError(`SEARCHAD_SIBLING_GENERATION_${code}`, message, {}, 409);
}
function requireValue(condition, code, message) { if (!condition) fail(code, message); }
function immutableCopy(value) {
  const copied = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  };
  return freeze(copied);
}
function uniqueRows(rows, key) {
  requireValue(rows.every(record) && rows.every(row => uuid(row[key])) && new Set(rows.map(row => row[key])).size === rows.length,
    'SNAPSHOT', 'Snapshot rows must have unique local identifiers.');
}
function descriptorCheck(descriptor, scope, kind) {
  requireValue(record(descriptor) && descriptor.customerId === scope.customerId && descriptor.operationKey === OPS[KINDS[kind].type].create,
    'DESCRIPTOR', 'The recipe descriptor must match the selected Customer and sibling kind.');
  if (kind === 'keywords') {
    requireValue(exactKeys(descriptor, ['operationKey', 'customerId', 'query', 'body']) &&
      equal(descriptor.query, { nccAdgroupId: scope.parentRemoteId }) && Array.isArray(descriptor.body) &&
      descriptor.body.length >= 1 && descriptor.body.length <= KEYWORD_CREATE_MAX_BATCH &&
      descriptor.body.every(item => exactKeys(item, ['keyword']) && actor(item.keyword)),
    'DESCRIPTOR', 'An exact bounded keyword recipe descriptor is required.');
    return descriptor.body.length;
  }
  const body = descriptor.body;
  requireValue(exactKeys(descriptor, ['operationKey', 'customerId', 'body']) &&
    exactKeys(body, ['nccAdgroupId', 'type', 'ad']) && body.nccAdgroupId === scope.parentRemoteId && body.type === 'TEXT_45' &&
    exactKeys(body.ad, ['headline', 'description', 'pc', 'mobile']) && actor(body.ad.headline) && actor(body.ad.description) &&
    exactKeys(body.ad.pc, ['final']) && actor(body.ad.pc.final) && exactKeys(body.ad.mobile, ['final']) && actor(body.ad.mobile.final),
  'DESCRIPTOR', 'An exact TEXT_45 recipe descriptor is required.');
  return 1;
}
function inspectSnapshot(graph, options) {
  requireValue(record(graph) && exactKeys(options, ['kind', 'descriptor', 'now']) && Object.hasOwn(KINDS, options.kind) &&
    Number.isSafeInteger(options.now) && options.now >= 0 && Number.isFinite(new Date(options.now).getTime()),
  'INPUT', 'A complete server snapshot, exact kind/descriptor and valid server time are required.');
  for (const name of ['objects', 'holds', 'plans', 'approvals', 'locks', 'attempts', 'events', 'risks']) {
    requireValue(Array.isArray(graph[name]) && graph[name].every(record), 'SNAPSHOT', 'All snapshot collections are required.');
  }
  requireValue([...graph.events, ...graph.attempts].every(row => typeof row.phase === 'string' && row.phase.length > 0),
    'SNAPSHOT', 'Audit phases must be explicit nonempty strings.');
  const { run, root, parent, rootPlan, parentPlan } = graph;
  requireValue(record(run) && typeof run.customer_id === 'string' && /^\d{1,30}$/.test(run.customer_id) && uuid(run.hierarchy_run_id) &&
    [root, parent, rootPlan, parentPlan].every(record) && uuid(root.hierarchy_object_id) && uuid(parent.hierarchy_object_id) &&
    uuid(rootPlan.plan_id) && uuid(parentPlan.plan_id) && root.object_type === 'campaign' && parent.object_type === 'adgroup' &&
    root.parent_object_id === null && parent.parent_object_id === root.hierarchy_object_id &&
    [root, parent].every(row => row.customer_id === run.customer_id && row.hierarchy_run_id === run.hierarchy_run_id) &&
    [rootPlan, parentPlan].every(row => row.customer_id === run.customer_id && row.status === 'applied') &&
    opaque(root.remote_id) && opaque(parent.remote_id) && typeof parentPlan.applied_after_hash === 'string' && HASH.test(parentPlan.applied_after_hash),
  'ANCESTORS', 'Verified ancestor references and parent creation hash must be supplied by the existing ancestry verifier.');
  uniqueRows(graph.objects, 'hierarchy_object_id'); uniqueRows(graph.plans, 'plan_id');
  uniqueRows(graph.events, 'event_id'); uniqueRows(graph.attempts, 'attempt_id'); uniqueRows(graph.approvals, 'approval_id');
  requireValue(graph.objects.some(row => equal(row, root)) && graph.objects.some(row => equal(row, parent)) &&
    graph.plans.some(row => equal(row, rootPlan)) && graph.plans.some(row => equal(row, parentPlan)),
  'ANCESTORS', 'Ancestor references must name rows in this same complete snapshot.');
  const scope = { customerId: run.customer_id, hierarchyRunId: run.hierarchy_run_id,
    rootObjectId: root.hierarchy_object_id, rootRemoteId: root.remote_id, rootCreatePlanId: rootPlan.plan_id,
    parentObjectId: parent.hierarchy_object_id, parentRemoteId: parent.remote_id, parentCreatePlanId: parentPlan.plan_id,
    parentAfterHash: parentPlan.applied_after_hash };
  const count = descriptorCheck(options.descriptor, scope, options.kind);
  return { scope, count, ...options };
}
function generationFields(predecessor) {
  return predecessor ? { generation: 2, predecessorPlanId: predecessor.plan.plan_id,
    predecessorRetirementEventId: predecessor.event.event_id,
    predecessorRetirementHash: contentHash(predecessor.event.details_json) } : {};
}
function metadataFor(ctx, activationId, ids, predecessor) {
  return { kind: `haar_${ctx.kind}_create_v1`, customerId: ctx.scope.customerId, hierarchyRunId: ctx.scope.hierarchyRunId,
    parentObjectId: ctx.scope.parentObjectId, parentRemoteId: ctx.scope.parentRemoteId,
    rootObjectId: ctx.scope.rootObjectId, rootRemoteId: ctx.scope.rootRemoteId, activationId, objectIds: [...ids],
    ...generationFields(predecessor) };
}
function planningDetailsFor(ctx, metadata, predecessor) {
  return { kind: ctx.kind, activationId: metadata.activationId, beforeHash: contentHash(metadata),
    requestFingerprint: contentHash(ctx.descriptor), objectIds: [...metadata.objectIds], ...generationFields(predecessor) };
}
function validatePlan(graph, ctx, event, predecessor) {
  const op = OPS[KINDS[ctx.kind].type], lifecycle = KINDS[ctx.kind].lifecycle;
  requireValue(record(event.details_json) && uuid(event.details_json.planId) && uuid(event.details_json.activationId),
    'PLANNING', 'A scoped immutable sibling planning event is required.');
  const plan = graph.plans.find(row => row.plan_id === event.details_json.planId);
  const ids = plan?.before_json?.objectIds;
  requireValue(plan && Array.isArray(ids) && ids.length === ctx.count && ids.every(uuid) && new Set(ids).size === ids.length,
    'PLANNING', 'Original batch members must be bounded, unique local identifiers.');
  const metadata = metadataFor(ctx, event.details_json.activationId, ids, predecessor);
  const details = planningDetailsFor(ctx, metadata, predecessor);
  const time = epoch(plan.created_at), expires = epoch(plan.expires_at);
  requireValue(plan.customer_id === ctx.scope.customerId && actor(plan.created_by) &&
    plan.mutation_operation_key === op.create && equal(plan.mutation_json, ctx.descriptor) &&
    equal(plan.before_json, metadata) && plan.before_hash === contentHash(metadata) &&
    equal(plan.expected_after_json, ctx.descriptor.body) && equal(plan.read_json, {}) && plan.rollback_json === null &&
    Number.isFinite(time) && Number.isFinite(expires) && time >= 0 && time <= ctx.now && expires > time,
  'PLANNING', 'The plan must reproduce the trusted recipe and exact generation metadata.');
  requireValue(event.customer_id === ctx.scope.customerId && event.hierarchy_run_id === ctx.scope.hierarchyRunId &&
    event.hierarchy_object_id === ids[0] && event.status === 'planned' && event.operation_key === op.create &&
    event.lifecycle_kind === lifecycle && event.request_id === null && event.error_json === null &&
    equal(event.details_json, { planId: plan.plan_id, ...details }) && epoch(event.created_at) === time,
  'PLANNING', 'The immutable planning event must exactly bind the original request and batch order.');
  const attempts = graph.attempts.filter(row => row.plan_id === plan.plan_id && row.phase === PLAN_PHASE);
  const attempt = attempts[0];
  requireValue(attempts.length === 1 && attempt.status === 'planned' && attempt.request_fingerprint === null &&
    attempt.request_json === null && attempt.error_json === null && attempt.remote_request_id === null &&
    equal(attempt.response_json, details) && epoch(attempt.created_at) === time,
  'PLANNING', 'The original planning attempt must match its immutable planning event.');
  const objects = ids.map(id => graph.objects.find(row => row.hierarchy_object_id === id));
  requireValue(objects.every(row => row && row.customer_id === ctx.scope.customerId && row.hierarchy_run_id === ctx.scope.hierarchyRunId &&
    row.object_type === KINDS[ctx.kind].type && row.parent_object_id === ctx.scope.parentObjectId &&
    row.create_operation_key === op.create && row.read_operation_key === op.read && row.delete_operation_key === op.delete &&
    epoch(row.created_at) === time), 'OBJECTS', 'Every batch member must be linked to the exact generation and parent.');
  if (predecessor) {
    requireValue(time >= epoch(predecessor.event.created_at) && ids.every(id => !predecessor.ids.includes(id)),
      'GENERATION', 'Replacement objects must be new and created after predecessor retirement.');
  }
  return { plan, ids, objects, event, metadata, generation: predecessor ? 2 : 1 };
}
function validateRetirement(graph, ctx, binding, retirement) {
  const { plan, ids, objects } = binding;
  const fingerprint = contentHash(ctx.descriptor), now = ctx.now, started = epoch(plan.created_at), expires = epoch(plan.expires_at);
  requireValue(plan.status === 'expired' && equal(plan.last_error_json, REASON) &&
    [plan.applied_at, plan.applied_after_json, plan.applied_after_hash, plan.rolled_back_at].every(value => value === null) &&
    objects.every(row => row.state === 'planned' && row.remote_id === null && row.deleted_at === null && epoch(row.updated_at) === started),
  'NOT_UNUSED', 'A predecessor must remain expired, planned and never dispatched or returned.');
  requireValue(!graph.holds.some(row => ids.includes(row.hierarchy_object_id) || ids.includes(row.parent_hierarchy_object_id)) &&
    !graph.locks.some(row => row.plan_id === plan.plan_id) &&
    !graph.risks.some(row => typeof row.intent_id === 'string' && row.intent_id.endsWith(`:${plan.plan_id}`)),
  'PRIOR_WORK', 'Any predecessor hold, execution lock or risk intent prevents replacement.');
  const approvals = graph.approvals.filter(row => row.plan_id === plan.plan_id);
  requireValue(approvals.every(row => row.used_at === null && actor(row.actor) && row.confirmation === 'APPROVE_SEARCHAD_CHANGE' &&
    typeof row.token_hash === 'string' && HASH.test(row.token_hash) && Number.isFinite(epoch(row.created_at)) &&
    epoch(row.created_at) >= started && epoch(row.created_at) < expires && epoch(row.created_at) <= now &&
    Number.isFinite(epoch(row.expires_at)) && epoch(row.expires_at) > epoch(row.created_at)) &&
    (plan.approved_at === null ? approvals.length === 0 : Number.isFinite(epoch(plan.approved_at)) && approvals.some(row => epoch(row.created_at) === epoch(plan.approved_at))),
  'APPROVAL', 'Predecessor approvals must remain unused and consistent with their original plan.');
  const related = graph.events.filter(row => row.details_json?.planId === plan.plan_id || ids.includes(row.hierarchy_object_id));
  const attempts = graph.attempts.filter(row => row.plan_id === plan.plan_id);
  requireValue(related.length === 2 && related.every(row => [PLAN_PHASE, RETIRE_PHASE].includes(row.phase)) &&
    attempts.length === 2 && attempts.every(row => [PLAN_PHASE, RETIRE_PHASE].includes(row.phase)),
  'PRIOR_WORK', 'Non-planning or duplicate predecessor history cannot be hidden by retirement flags.');
  const detail = retirement.details_json, time = epoch(retirement.created_at);
  requireValue(record(detail) && actor(detail.actorPrincipalId) && ['planned', 'approved', 'expired'].includes(detail.priorStatus) &&
    Number.isFinite(time) && time >= expires && time <= now &&
    (detail.priorStatus !== 'planned' || (plan.approved_at === null && approvals.length === 0)) &&
    (detail.priorStatus !== 'approved' || plan.approved_at !== null),
  'RETIREMENT', 'Retirement actor, prior status and expiry boundary must be valid.');
  const expected = { kind: 'haar_unused_sibling_plan_retirement_v1', siblingKind: ctx.kind, planId: plan.plan_id,
    objectIds: [...ids], parentObjectId: ctx.scope.parentObjectId, rootObjectId: ctx.scope.rootObjectId,
    rootCreatePlanId: ctx.scope.rootCreatePlanId, parentCreatePlanId: ctx.scope.parentCreatePlanId,
    parentAfterHash: ctx.scope.parentAfterHash, beforeHash: plan.before_hash, requestFingerprint: fingerprint,
    actorPrincipalId: detail.actorPrincipalId, expiredAt: new Date(expires).toISOString(), priorStatus: detail.priorStatus,
    targetRemoteDispatched: false, runTerminated: false, replacementCreated: false, requiresNewApproval: true,
    replanningSupported: false, cleanupAuthority: false };
  const retiredAttempts = attempts.filter(row => row.phase === RETIRE_PHASE), attempt = retiredAttempts[0];
  requireValue(retirement.customer_id === ctx.scope.customerId && retirement.hierarchy_run_id === ctx.scope.hierarchyRunId &&
    retirement.hierarchy_object_id === ids[0] && retirement.status === 'expired_unused' &&
    retirement.operation_key === OPS[KINDS[ctx.kind].type].create && retirement.lifecycle_kind === null &&
    retirement.request_id === null && retirement.error_json === null && equal(detail, expected) &&
    retiredAttempts.length === 1 && attempt.status === 'expired_unused' && attempt.request_fingerprint === fingerprint &&
    attempt.request_json === null && attempt.error_json === null && attempt.remote_request_id === null &&
    equal(attempt.response_json, expected) && epoch(attempt.created_at) === time,
  'RETIREMENT', 'The original non-authorizing retirement event and attempt must agree exactly.');
  return { ...binding, event: retirement };
}

/** Complete locked history validation. This is neither absence proof nor send authority. */
export function resolveSiblingGenerationHistory(graph, options) {
  const ctx = inspectSnapshot(graph, options);
  const leaves = graph.objects.filter(row => ['keyword', 'creative'].includes(row.object_type));
  requireValue(leaves.length <= ctx.count * 2 && leaves.every(row => row.customer_id === ctx.scope.customerId &&
    row.hierarchy_run_id === ctx.scope.hierarchyRunId && row.parent_object_id === ctx.scope.parentObjectId &&
    row.object_type === KINDS[ctx.kind].type), 'OBJECTS', 'Mixed-kind, cross-scope and foreign linked leaves are not supported.');
  const leafIds = new Set(leaves.map(row => row.hierarchy_object_id));
  const related = graph.events.filter(row => row.phase.startsWith('sibling_') || leafIds.has(row.hierarchy_object_id));
  const plans = graph.plans.filter(row => [OPS.keyword.create, OPS.creative.create].includes(row.mutation_operation_key) ||
    ['haar_keywords_create_v1', 'haar_creative_create_v1'].includes(row.before_json?.kind));
  requireValue(related.every(row => row.customer_id === ctx.scope.customerId && row.hierarchy_run_id === ctx.scope.hierarchyRunId &&
    (row.hierarchy_object_id === null || leafIds.has(row.hierarchy_object_id))) && plans.every(row => row.customer_id === ctx.scope.customerId),
  'SCOPE', 'Every related sibling row must belong to this exact Customer and hierarchy.');
  const planning = related.filter(row => row.phase === PLAN_PHASE), retirements = related.filter(row => row.phase === RETIRE_PHASE);
  requireValue(planning.length <= 2 && retirements.length <= 1 && plans.length === planning.length &&
    new Set(planning.map(row => row.details_json?.planId)).size === planning.length,
  'GENERATION_LIMIT', 'Only one initial plan and one proof-bound replacement are supported.');
  const knownPlans = new Set(plans.map(row => row.plan_id));
  requireValue(planning.every(row => knownPlans.has(row.details_json?.planId)) &&
    related.every(row => !row.phase.startsWith('sibling_') || knownPlans.has(row.details_json?.planId)) &&
    graph.attempts.every(row => !row.phase.startsWith('sibling_') || knownPlans.has(row.plan_id)),
  'ORPHAN', 'Orphan sibling plans, events and attempts cannot be ignored.');
  let predecessor = null, active = null;
  if (retirements.length === 1) {
    const retirement = retirements[0], event = planning.find(row => row.details_json?.planId === retirement.details_json?.planId);
    requireValue(event, 'RETIREMENT', 'The retired predecessor must retain its original planning event.');
    predecessor = validateRetirement(graph, ctx, validatePlan(graph, ctx, event, null), retirement);
  }
  const remaining = planning.filter(row => row.details_json?.planId !== predecessor?.plan.plan_id);
  requireValue(remaining.length <= 1 && (planning.length < 2 || predecessor !== null),
    'GENERATION_LIMIT', 'Two active plans or generation 2 without a proved predecessor are not supported.');
  if (remaining.length === 1) active = validatePlan(graph, ctx, remaining[0], predecessor);
  const siblingRisks = graph.risks.filter(row => [OPS.keyword.create, OPS.creative.create].includes(row.operation_key) ||
    (typeof row.intent_id === 'string' && row.intent_id.startsWith('hierarchy:sibling:')));
  requireValue(siblingRisks.every(row => active && row.intent_id === `hierarchy:sibling:${ctx.kind}:${active.plan.plan_id}` &&
    row.operation_key === OPS[KINDS[ctx.kind].type].create && row.customer_id === ctx.scope.customerId &&
    row.owner_kind === 'hierarchy_canary' && row.owner_run_id === ctx.scope.hierarchyRunId),
  'PRIOR_WORK', 'Only the exact active sibling intent may coexist with this history; unexplained sibling risk is not unused.');
  const expectedIds = [...(predecessor?.ids ?? []), ...(active?.ids ?? [])];
  requireValue(expectedIds.length === leafIds.size && new Set(expectedIds).size === expectedIds.length && expectedIds.every(id => leafIds.has(id)),
    'OBJECTS', 'Every leaf must be accounted for by exactly one proven generation.');
  const history = immutableCopy({ kind: ctx.kind, predecessor: predecessor ? { planId: predecessor.plan.plan_id,
    objectIds: predecessor.ids, retirementEventId: predecessor.event.event_id,
    retirementHash: contentHash(predecessor.event.details_json), retiredAt: new Date(epoch(predecessor.event.created_at)).toISOString() } : null,
    active: active ? { planId: active.plan.plan_id, objectIds: active.ids, generation: active.generation, metadata: active.metadata } : null,
    nextGeneration: active ? null : predecessor ? 2 : 1, cleanupAuthority: false });
  RECEIPTS.set(history, immutableCopy({ ctx, predecessor: predecessor ? { plan: predecessor.plan, event: predecessor.event } : null,
    planIds: graph.plans.map(row => row.plan_id), objectIds: graph.objects.map(row => row.hierarchy_object_id) }));
  return history;
}

/** Build metadata only, without creating any object, plan, approval or risk row. */
export function buildSiblingReplacementBinding(history, input) {
  const receipt = RECEIPTS.get(history);
  requireValue(receipt && history.nextGeneration === 2 && history.active === null && receipt.predecessor,
    'REPLACEMENT', 'A freshly validated retired predecessor without an active successor is required.');
  requireValue(exactKeys(input, ['planId', 'objectIds', 'activationId', 'createdAt']),
    'INPUT', 'Only new local identifiers and a server-created timestamp are accepted.');
  const { ctx } = receipt;
  const ids = Array.isArray(input.objectIds) ? [...input.objectIds] : [];
  requireValue(uuid(input.planId) && !receipt.planIds.includes(input.planId) && uuid(input.activationId) &&
    ids.length === ctx.count && ids.every(uuid) && new Set(ids).size === ids.length &&
    ids.every(id => !receipt.objectIds.includes(id)) && Number.isFinite(epoch(input.createdAt)) && epoch(input.createdAt) >= ctx.now,
  'REPLACEMENT', 'Replacement identifiers must be new, unique and consistent with the original batch and server time.');
  const metadata = metadataFor(ctx, input.activationId, ids, receipt.predecessor);
  const details = planningDetailsFor(ctx, metadata, receipt.predecessor);
  return immutableCopy({ metadata, planningEventDetails: { planId: input.planId, ...details }, planningAttemptDetails: details });
}
