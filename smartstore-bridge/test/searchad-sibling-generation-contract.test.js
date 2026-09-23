import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { contentHash } from '../src/naver/searchad/write/canonical.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

let api = {};
try { api = await import('../src/naver/searchad/lifecycle/sibling-generation-contract.js'); }
catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('/sibling-generation-contract.js')) throw error;
}
const NOW = Date.parse('2026-09-23T08:00:00Z');
const createdAt = new Date(NOW - 120_000).toISOString();
const expiresAt = new Date(NOW - 60_000).toISOString();
const retiredAt = new Date(NOW - 30_000).toISOString();
const reason = () => ({ code: 'UNUSED_SIBLING_PLAN_EXPIRED' });
const failure = error => error?.code?.startsWith('SEARCHAD_SIBLING_GENERATION_');
const objectId = () => randomUUID();

// Synthetic persisted rows, using the existing 3fa0e63 sibling producer and
// retirement formats. These are not real advertising or PostgreSQL fixtures.
function fixture(kind = 'keywords', { retired = true, approved = true } = {}) {
  const customerId = '1001', runId = objectId(), rootId = objectId(), parentId = objectId();
  const rootPlanId = objectId(), parentPlanId = objectId(), planId = objectId(), activationId = objectId();
  const type = kind === 'keywords' ? 'keyword' : 'creative';
  const lifecycle = kind === 'keywords' ? 'batch_create' : 'create';
  const ids = Array.from({ length: kind === 'keywords' ? 2 : 1 }, objectId);
  const descriptor = kind === 'keywords'
    ? { operationKey: OPS.keyword.create, customerId, query: { nccAdgroupId: 'grp-parent' }, body: [{ keyword: 'haar-one' }, { keyword: 'haar-two' }] }
    : { operationKey: OPS.creative.create, customerId, body: { nccAdgroupId: 'grp-parent', type: 'TEXT_45', ad: { headline: 'HAAR hierarchy canary', description: 'HAAR hierarchy canary verification', pc: { final: 'https://example.invalid/haar' }, mobile: { final: 'https://example.invalid/haar' } } } };
  const meta = { kind: `haar_${kind}_create_v1`, customerId, hierarchyRunId: runId, parentObjectId: parentId, parentRemoteId: 'grp-parent', rootObjectId: rootId, rootRemoteId: 'cmp-root', activationId, objectIds: ids };
  const plan = { plan_id: planId, customer_id: customerId, mutation_operation_key: OPS[type].create, mutation_json: structuredClone(descriptor), read_json: {}, before_json: meta, before_hash: contentHash(meta), expected_after_json: structuredClone(descriptor.body), rollback_json: null, status: retired ? 'expired' : (approved ? 'approved' : 'planned'), created_by: 'fixture-admin', created_at: createdAt, expires_at: expiresAt, approved_at: approved ? new Date(NOW - 110_000).toISOString() : null, applied_at: null, applied_after_json: null, applied_after_hash: null, rolled_back_at: null, last_error_json: retired ? reason(kind) : null };
  const planningDetails = { kind, activationId, beforeHash: plan.before_hash, requestFingerprint: contentHash(descriptor), objectIds: ids };
  const planned = { event_id: objectId(), hierarchy_run_id: runId, hierarchy_object_id: ids[0], customer_id: customerId, phase: 'sibling_plan', status: 'planned', operation_key: OPS[type].create, lifecycle_kind: lifecycle, request_id: null, error_json: null, details_json: { planId, ...planningDetails }, created_at: createdAt };
  const attempt = { attempt_id: objectId(), plan_id: planId, phase: 'sibling_plan', status: 'planned', request_fingerprint: null, request_json: null, response_json: structuredClone(planningDetails), error_json: null, remote_request_id: null, created_at: createdAt };
  const details = { kind: 'haar_unused_sibling_plan_retirement_v1', planId, siblingKind: kind, objectIds: ids, parentObjectId: parentId, parentCreatePlanId: parentPlanId, parentAfterHash: 'c'.repeat(64), rootObjectId: rootId, rootCreatePlanId: rootPlanId, beforeHash: plan.before_hash, requestFingerprint: contentHash(descriptor), actorPrincipalId: 'fixture-retiring-admin', expiredAt: expiresAt, priorStatus: approved ? 'approved' : 'planned', targetRemoteDispatched: false, runTerminated: false, replacementCreated: false, requiresNewApproval: true, replanningSupported: false, cleanupAuthority: false };
  const retirement = { ...planned, event_id: objectId(), phase: 'sibling_plan_retired', status: 'expired_unused', lifecycle_kind: null, details_json: details, created_at: retiredAt };
  const retirementAttempt = { ...attempt, attempt_id: objectId(), phase: 'sibling_plan_retired', status: 'expired_unused', request_fingerprint: contentHash(descriptor), response_json: structuredClone(details), created_at: retiredAt };
  const root = { hierarchy_object_id: rootId, hierarchy_run_id: runId, customer_id: customerId, object_type: 'campaign', parent_object_id: null, remote_id: 'cmp-root', state: 'owned', deleted_at: null };
  const parent = { ...root, hierarchy_object_id: parentId, object_type: 'adgroup', parent_object_id: rootId, remote_id: 'grp-parent' };
  const rootPlan = { plan_id: rootPlanId, customer_id: customerId, status: 'applied' };
  const parentPlan = { plan_id: parentPlanId, customer_id: customerId, status: 'applied', applied_after_hash: 'c'.repeat(64) };
  const objects = ids.map(id => ({ hierarchy_object_id: id, hierarchy_run_id: runId, customer_id: customerId, object_type: type, parent_object_id: parentId, create_operation_key: OPS[type].create, read_operation_key: OPS[type].read, delete_operation_key: OPS[type].delete, state: 'planned', remote_id: null, deleted_at: null, created_at: createdAt, updated_at: createdAt }));
  const graph = { run: { hierarchy_run_id: runId, customer_id: customerId, status: 'cleanup_pending', completed_at: null }, root, parent, rootPlan, parentPlan, objects: [root, parent, ...objects], holds: [], plans: [rootPlan, parentPlan, plan], approvals: approved ? [{ approval_id: objectId(), plan_id: planId, actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE', token_hash: 'a'.repeat(64), created_at: plan.approved_at, expires_at: new Date(NOW + 60_000).toISOString(), used_at: null }] : [], locks: [], attempts: [attempt, ...(retired ? [retirementAttempt] : [])], events: [planned, ...(retired ? [retirement] : [])], risks: [] };
  return { graph, kind, descriptor, plan, planned, retirement, retirementAttempt, ids, objects, scope: { kind, descriptor, now: NOW } };
}
function resolve(f) { return api.resolveSiblingGenerationHistory(f.graph, f.scope); }
function successorInput(f) {
  return { planId: objectId(), objectIds: f.ids.map(objectId).sort().reverse(), activationId: objectId(), createdAt: new Date(NOW).toISOString() };
}
function expectedBinding(f, input) {
  const extra = { generation: 2, predecessorPlanId: f.plan.plan_id, predecessorRetirementEventId: f.retirement.event_id, predecessorRetirementHash: contentHash(f.retirement.details_json) };
  const metadata = { ...structuredClone(f.plan.before_json), activationId: input.activationId, objectIds: input.objectIds, ...extra };
  const details = { kind: f.kind, activationId: input.activationId, beforeHash: contentHash(metadata), requestFingerprint: contentHash(f.descriptor), objectIds: input.objectIds, ...extra };
  return { metadata, planningEventDetails: { planId: input.planId, ...details }, planningAttemptDetails: details };
}
function addSuccessor(f) {
  const input = successorInput(f), b = expectedBinding(f, input);
  const p = { ...structuredClone(f.plan), plan_id: input.planId, before_json: b.metadata, before_hash: contentHash(b.metadata), status: 'planned', created_at: input.createdAt, expires_at: new Date(NOW + 60_000).toISOString(), approved_at: null, last_error_json: null };
  f.graph.plans.push(p);
  for (const id of input.objectIds) f.graph.objects.push({ ...f.objects[0], hierarchy_object_id: id, created_at: input.createdAt, updated_at: input.createdAt });
  f.graph.events.push({ ...f.planned, event_id: objectId(), hierarchy_object_id: input.objectIds[0], details_json: b.planningEventDetails, created_at: input.createdAt });
  f.graph.attempts.push({ ...f.graph.attempts[0], attempt_id: objectId(), plan_id: input.planId, response_json: b.planningAttemptDetails, created_at: input.createdAt });
  return { input, plan: p };
}

test('generation contract is implemented', () => {
  assert.equal(typeof api.resolveSiblingGenerationHistory, 'function', 'Sibling generation history resolver is required');
  assert.equal(typeof api.buildSiblingReplacementBinding, 'function', 'Sibling replacement binding builder is required');
});

for (const kind of ['keywords', 'creative']) {
  test(`${kind}: exact retirement authorizes metadata preparation only, without rewriting history`, () => {
    const f = fixture(kind), before = structuredClone(f.graph), history = resolve(f);
    assert.equal(history.nextGeneration, 2);
    assert.equal(history.active, null);
    assert.equal(history.predecessor.planId, f.plan.plan_id);
    assert.deepEqual(history.predecessor.objectIds, f.ids);
    assert.equal(history.cleanupAuthority, false);
    const input = successorInput(f), binding = api.buildSiblingReplacementBinding(history, input);
    assert.deepEqual(binding, expectedBinding(f, input));
    assert.deepEqual(f.graph, before);
    assert.equal(Object.hasOwn(binding, 'executionToken'), false);
    assert.equal(Object.hasOwn(binding, 'riskIntent'), false);
    assert.equal(Object.hasOwn(binding, 'cleanupAuthority'), false);
  });
  test(`${kind}: a missing retirement leaves even an expired plan ineligible for replacement`, () => {
    const f = fixture(kind, { retired: false }); f.plan.status = 'expired';
    const history = resolve(f);
    assert.equal(history.nextGeneration, null);
    assert.equal(history.active.planId, f.plan.plan_id);
    assert.throws(() => api.buildSiblingReplacementBinding(history, successorInput(f)), failure);
  });
  test(`${kind}: generation 2 selects only new objects in explicit plan order`, () => {
    const f = fixture(kind), { input } = addSuccessor(f);
    f.graph.objects.reverse();
    const history = resolve(f);
    assert.equal(history.active.generation, 2);
    assert.equal(history.active.planId, input.planId);
    assert.deepEqual(history.active.objectIds, input.objectIds);
    assert.equal(history.nextGeneration, null);
    assert.throws(() => api.buildSiblingReplacementBinding(history, successorInput(f)), failure);
  });
  test(`${kind}: unused expired approval is history, never a replacement approval`, () => {
    const f = fixture(kind); f.graph.approvals[0].expires_at = new Date(NOW - 15_000).toISOString();
    const history = resolve(f), input = successorInput(f), b = api.buildSiblingReplacementBinding(history, input);
    assert.equal(b.planningEventDetails.planId, input.planId);
    assert.equal(Object.hasOwn(b, 'approvals'), false);
    assert.equal(f.graph.approvals[0].plan_id, f.plan.plan_id);
  });
}

test('empty initial slot is distinguished from a retired predecessor', () => {
  const f = fixture(); f.graph.objects = [f.graph.root, f.graph.parent];
  f.graph.plans = [f.graph.rootPlan, f.graph.parentPlan];
  f.graph.events = []; f.graph.attempts = []; f.graph.approvals = [];
  const history = resolve(f);
  assert.equal(history.nextGeneration, 1); assert.equal(history.predecessor, null);
  assert.throws(() => api.buildSiblingReplacementBinding(history, successorInput(f)), failure);
});
test('a partial or unknown active outcome is never an unused predecessor', () => {
  for (const status of ['unknown_outcome', 'manual_review', 'applied']) {
    const f = fixture('keywords', { retired: false }); f.plan.status = status;
    assert.equal(resolve(f).nextGeneration, null);
  }
});

const corruptions = [
  ['used predecessor token', f => { f.graph.approvals[0].used_at = retiredAt; }],
  ['predecessor execution lock', f => f.graph.locks.push({ plan_id: f.plan.plan_id, purpose: 'execute' })],
  ['released predecessor risk', f => f.graph.risks.push({ intent_id: `hierarchy:sibling:keywords:${f.plan.plan_id}`, state: 'released', operation_key: OPS.keyword.create })],
  ['returned predecessor ID', f => { f.objects[0].remote_id = 'kw-remote'; }],
  ['unexpected predecessor hold', f => f.graph.holds.push({ hierarchy_object_id: f.ids[0], state: 'manual_review', remote_id: 'kw-remote' })],
  ['predecessor claimed state', f => { f.objects[0].state = 'dispatching'; }],
  ['retirement preceding expiry', f => { f.retirement.created_at = createdAt; f.retirementAttempt.created_at = createdAt; }],
  ['retirement from the future', f => { f.retirement.created_at = new Date(NOW + 1).toISOString(); f.retirementAttempt.created_at = f.retirement.created_at; }],
  ['retirement reason changed', f => { f.plan.last_error_json.code = 'EXPIRED'; }],
  ['retirement attempt missing', f => { f.graph.attempts = f.graph.attempts.filter(a => a.phase !== 'sibling_plan_retired'); }],
  ['retirement event duplicated', f => { f.graph.events.push({ ...structuredClone(f.retirement), event_id: objectId() }); }],
  ['retirement attempt response contradicts event', f => { f.retirementAttempt.response_json.targetRemoteDispatched = true; }],
  ['retirement falsely grants cleanup authority', f => { f.retirement.details_json.cleanupAuthority = true; f.retirementAttempt.response_json.cleanupAuthority = true; }],
  ['planning request no longer matches trusted descriptor', f => { f.plan.mutation_json.body[0].keyword = 'other-keyword'; }],
  ['planning metadata hash changed', f => { f.plan.before_hash = 'b'.repeat(64); }],
  ['wrong original parent metadata', f => { f.plan.before_json.parentRemoteId = 'grp-other'; }],
  ['original planning event missing', f => { f.graph.events = f.graph.events.filter(e => e.phase !== 'sibling_plan'); }],
  ['plan-bound late dispatch event', f => f.graph.events.push({ ...f.planned, event_id: objectId(), hierarchy_object_id: null, phase: 'sibling_dispatch_intent', status: 'attempt_once' })],
  ['non-planning predecessor attempt', f => f.graph.attempts.push({ ...f.graph.attempts[0], attempt_id: objectId(), phase: 'sibling_dispatch_intent' })],
  ['foreign-Customer linked leaf', f => f.graph.objects.push({ ...f.objects[0], hierarchy_object_id: objectId(), customer_id: '1002' })],
  ['foreign descendant under a retired leaf', f => f.graph.objects.push({ ...f.objects[0], hierarchy_object_id: objectId(), parent_object_id: f.ids[0], customer_id: '1002' })],
  ['same-kind unplanned extra leaf', f => f.graph.objects.push({ ...f.objects[0], hierarchy_object_id: objectId() })],
  ['duplicate original object ID', f => { f.plan.before_json.objectIds[1] = f.plan.before_json.objectIds[0]; }],
  ['Customer-scope planning event substitution', f => { f.planned.customer_id = '1002'; }],
  ['retirement from another run', f => { f.retirement.hierarchy_run_id = objectId(); }],
  ['used-approval timestamp resets plus dispatch still exists', f => { f.graph.approvals[0].used_at = null; f.graph.attempts.push({ ...f.graph.attempts[0], attempt_id: objectId(), phase: 'sibling_create_result' }); }],
  ['unexplained applied predecessor snapshot', f => { f.plan.applied_after_json = []; }],
  ['changed predecessor last update', f => { f.objects[0].updated_at = retiredAt; }],
  ['orphan sibling plan row', f => { f.graph.plans.push({ ...structuredClone(f.plan), plan_id: objectId() }); }],
  ['orphan planning attempt', f => { f.graph.attempts.push({ ...structuredClone(f.graph.attempts[0]), plan_id: objectId(), attempt_id: objectId() }); }],
];
for (const [name, corrupt] of corruptions) test(`rejects ${name}`, () => {
  const f = fixture(); corrupt(f); const before = structuredClone(f.graph);
  assert.throws(() => resolve(f), failure);
  assert.deepEqual(f.graph, before, 'validation must never repair or rewrite a corrupt snapshot');
});

test('same-kind restriction also rejects swapping both plan body and option', () => {
  const f = fixture('creative'); f.scope.kind = 'keywords';
  f.scope.descriptor = fixture('keywords').descriptor;
  assert.throws(() => resolve(f), failure);
});
test('gen2 predecessor hash must bind the exact original retirement details', () => {
  const f = fixture(), next = addSuccessor(f);
  next.plan.before_json.predecessorRetirementHash = 'f'.repeat(64);
  assert.throws(() => resolve(f), failure);
});
test('a second retired generation cannot open generation 3', () => {
  const f = fixture(); const next = addSuccessor(f);
  f.graph.events.push({ ...structuredClone(f.retirement), event_id: objectId(), hierarchy_object_id: next.input.objectIds[0], details_json: { ...f.retirement.details_json, planId: next.input.planId } });
  assert.throws(() => resolve(f), failure);
});
test('builder rejects forged history projections, including an exact JSON copy', () => {
  const f = fixture(), history = resolve(f);
  assert.throws(() => api.buildSiblingReplacementBinding(structuredClone(history), successorInput(f)), failure);
  assert.throws(() => api.buildSiblingReplacementBinding({ ...history, active: null }, successorInput(f)), failure);
});
test('builder prohibits old object IDs and plan IDs and accepts only the original batch size', () => {
  const f = fixture(), history = resolve(f), valid = successorInput(f);
  for (const bad of [
    { ...valid, planId: f.plan.plan_id },
    { ...valid, planId: f.graph.rootPlan.plan_id },
    { ...valid, objectIds: f.ids },
    { ...valid, objectIds: [objectId()] },
    { ...valid, objectIds: [valid.objectIds[0], valid.objectIds[0]] },
    { ...valid, remoteId: 'injected' },
    { ...valid, executionToken: 'injected' },
    { ...valid, createdAt: createdAt },
  ]) assert.throws(() => api.buildSiblingReplacementBinding(history, bad), failure);
});
test('returned bindings do not share mutable references with the snapshot or caller', () => {
  const f = fixture(), history = resolve(f), input = successorInput(f);
  const b = api.buildSiblingReplacementBinding(history, input), expected = structuredClone(b);
  input.objectIds[0] = objectId(); f.retirement.details_json.actorPrincipalId = 'changed';
  assert.deepEqual(b, expected); assert.ok(Object.isFrozen(b.metadata.objectIds));
  assert.throws(() => { history.predecessor.planId = objectId(); }, TypeError);
});
test('invalid server clock, extra options and caller descriptor overrides fail closed', () => {
  const f = fixture();
  for (const opts of [ { ...f.scope, now: NaN }, { ...f.scope, now: -1 }, { ...f.scope, override: true }, { ...f.scope, descriptor: { ...f.descriptor, pathParams: { id: 'other' } } } ]) {
    assert.throws(() => api.resolveSiblingGenerationHistory(f.graph, opts), failure);
  }
});

test('unexplained sibling risk in the same run blocks replacement even with a noncanonical intent', () => {
  const f = fixture();
  f.graph.risks.push({ reservation_id: objectId(), intent_id: `orphan-sibling:${objectId()}`, operation_key: OPS.keyword.create, customer_id: '1001', owner_kind: 'hierarchy_canary', owner_run_id: f.graph.run.hierarchy_run_id, state: 'consumed' });
  assert.throws(() => resolve(f), failure);
});
test('only the active successor exact create-risk intent may coexist with retired history', () => {
  const f = fixture(), next = addSuccessor(f);
  f.graph.risks.push({ reservation_id: objectId(), intent_id: `hierarchy:sibling:keywords:${next.plan.plan_id}`, operation_key: OPS.keyword.create, customer_id: '1001', owner_kind: 'hierarchy_canary', owner_run_id: f.graph.run.hierarchy_run_id, state: 'consumed' });
  assert.equal(resolve(f).active.planId, next.plan.plan_id);
  f.graph.risks[0].owner_run_id = objectId();
  assert.throws(() => resolve(f), failure);
});
test('missing audit phase produces a sanitized contract error rather than a raw TypeError', () => {
  const f = fixture(); delete f.planned.phase;
  assert.throws(() => resolve(f), failure);
});
