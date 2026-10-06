import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuitPolicy } from '../src/naver/searchad/circuit/policy.js';
import { CircuitProjectionService } from '../src/naver/searchad/circuit/projection-service.js';

const now = Date.parse('2026-10-05T03:00:00Z');
const ordinary = { customerId: '1001', purpose: 'ordinary', operationKey: 'campaign.update', entityType: 'campaign', entityId: 'c1', actionClass: 'decrease' };
const check = (state = {}, dispatch = ordinary, policy = {}, evidence = null, at = now) => evaluateCircuitPolicy({ state, dispatch, policy, evidence, now: at });

test('three_unknowns_stop_normal_customer_writes', () => {
  assert.equal(check({ unknownCount: 2 }).allowed, true);
  assert.deepEqual(check({ unknownCount: 3 }).reasons, ['UNKNOWN_LIMIT']);
});
test('rollback_and_read_recovery_survive_circuit_pause', () => {
  for (const purpose of ['rollback', 'report_registration', 'read']) assert.equal(check({ manualPaused: true, unknownCount: 3 }, { ...ordinary, purpose }).allowed, true);
  assert.equal(check({ manualPaused: true }).allowed, false);
});
test('manual_hold_and_cooldown_boundary_exact', () => {
  const auto = { ...ordinary, ruleId: 'r1' };
  const evidence = { spendGrossKrw: 100, baselineGrossKrw: 100 };
  const policy = { customerDailySpendCeilingGrossKrw: 1000 };
  const state = { manualChangedAt: now - 86400000 + 1, changedAt: now - 86400000 + 1 };
  assert.deepEqual(check(state, auto, policy, evidence).reasons, ['MANUAL_HOLD', 'ENTITY_COOLDOWN']);
  assert.equal(check(state, auto, policy, evidence, now + 1).allowed, true);
});
test('rule_failure_ceiling_does_not_pause_other_rules', () => {
  const state = { consecutiveFailures: { r1: 3, r2: 2 } };
  const policy = { customerDailySpendCeilingGrossKrw: 1000 };
  const evidence = { spendGrossKrw: 100, baselineGrossKrw: 100 };
  assert.deepEqual(check(state, { ...ordinary, ruleId: 'r1' }, policy, evidence).reasons, ['FAILURE_LIMIT']);
  assert.equal(check(state, { ...ordinary, ruleId: 'r2' }, policy, evidence).allowed, true);
});
test('automatic_spend_checks_require_explicit_ceiling_and_real_baseline', () => {
  const dispatch = { ...ordinary, ruleId: 'r1' };
  assert.deepEqual(check({}, dispatch).reasons, ['DAILY_SPEND_CEILING_REQUIRED', 'SPEND_EVIDENCE_UNAVAILABLE']);
  assert.deepEqual(check({}, dispatch, { customerDailySpendCeilingGrossKrw: 1000 }, { spendGrossKrw: 0 }).reasons, ['SPEND_BASELINE_UNAVAILABLE']);
});
test('increases_keep_gross_incremental_spend_and_net_loss_separate', () => {
  const dispatch = { ...ordinary, actionClass: 'increase', incrementalSpendKrw: 30001 };
  assert.deepEqual(check({ dailyLossNetKrw: 50000 }, dispatch).reasons, ['DAILY_LOSS_LIMIT', 'INCREMENTAL_SPEND_LIMIT']);
  assert.equal(check({ dailyLossNetKrw: 49999 }, { ...dispatch, incrementalSpendKrw: 30000 }).allowed, true);
});
test('post_change_observation_and_spend_spike_deny_automatic_increase', () => {
  const dispatch = { ...ordinary, ruleId: 'r1', actionClass: 'increase', incrementalSpendKrw: 1 };
  assert.deepEqual(check({ changedAt: now - 1, dailyLossNetKrw: 0 }, dispatch, { customerDailySpendCeilingGrossKrw: 1000 }, { spendGrossKrw: 200, baselineGrossKrw: 100 }).reasons, ['ENTITY_COOLDOWN', 'POST_CHANGE_OBSERVATION', 'SPEND_SPIKE']);
});
test('sticky_pause_has_no_midnight_or_collection_expiry', () => {
  for (const at of [now, now + 86400000, now + 365 * 86400000]) assert.deepEqual(check({ manualPaused: true }, ordinary, {}, null, at).reasons, ['MANUAL_PAUSE']);
});
test('projection_failure_returns_not_ready_without_throwing_primary_bookkeeping_error', async () => {
  const projection = new CircuitProjectionService({ repository: { async projectOnce() { throw new Error('private SQL secret'); } }, sources: [{ kind: 'write', async unprojected() { return [{ sourceId: 'a', event: { outcome: 'failed' } }]; } }], clock: () => now });
  assert.deepEqual(await projection.catchUp({ customerId: '1001' }), { ready: false, cursors: {} });
});
test('projection_uses_source_identity_and_revisits_backdated_sources', async () => {
  const projected = new Set(); const outcomes = []; let available = [{ sourceId: 'new', event: { outcome: 'failed', occurredAt: now } }];
  const repository = { async projectOnce({ sourceKind, sourceId, event }) { const id = `${sourceKind}:${sourceId}`; if (!projected.has(id)) { projected.add(id); outcomes.push(event); } } };
  const sources = [{ kind: 'write', async unprojected() { return available.filter(row => !projected.has(`write:${row.sourceId}`)); } }];
  const projection = new CircuitProjectionService({ repository, sources, clock: () => now });
  assert.equal((await projection.catchUp({ customerId: '1001' })).ready, true);
  available.push({ sourceId: 'old-committed-later', event: { outcome: 'unknown', occurredAt: now - 1000 } });
  assert.equal((await projection.catchUp({ customerId: '1001' })).ready, true);
  await projection.catchUp({ customerId: '1001' }); assert.equal(outcomes.length, 2);
});
test('next_dispatch_denied_until_projection_catches_up', async () => {
  const { CircuitService, createCircuitDispatch } = await import('../src/naver/searchad/circuit/service.js');
  let readable = false, pending = true;
  const repository = {
    async transaction(customerId, task) { return task({ query() {} }); },
    async projectOnce() { if (!readable) throw new Error('projection unavailable'); pending = false; },
    async hasBacklog() { return pending; }, async unresolved() { return false; }, async getState() { return {}; }, async getPolicy() { return {}; }
  };
  const projection = new CircuitProjectionService({ repository, sources: [{ kind: 'write', async unprojected() { return pending ? [{ sourceId: 'committed', event: { outcome: 'failed' } }] : []; } }] });
  const circuit = new CircuitService({ repository, projection });
  const dispatch = createCircuitDispatch(ordinary);
  await assert.rejects(circuit.prepareDispatch(dispatch), { code: 'SEARCHAD_CIRCUIT_PROJECTION_NOT_READY' });
  await assert.rejects(circuit.assertDispatchAllowed(dispatch, { client: { query() {} } }), e => e.details.reasons.includes('PROJECTION_BACKLOG'));
  readable = true; await circuit.prepareDispatch(dispatch);
  await circuit.assertDispatchAllowed(dispatch, { client: { query() {} } });
});
test('public_purpose_and_ownership_fields_cannot_forge_dispatch', async () => {
  const { CircuitService } = await import('../src/naver/searchad/circuit/service.js');
  const circuit = new CircuitService({ repository: {}, projection: {} });
  await assert.rejects(circuit.assertDispatchAllowed(Object.freeze({ ...ordinary, purpose: 'rollback', owner: { planId: 'anything' } }), { client: { query() {} } }), { code: 'SEARCHAD_CIRCUIT_CONTEXT' });
});

test('increases_fail_closed_when_customer_net_loss_is_unavailable', () => {
  assert.deepEqual(check({}, { ...ordinary, actionClass: 'increase', incrementalSpendKrw: 1 }).reasons, ['LOSS_EVIDENCE_UNAVAILABLE']);
  assert.equal(check({ dailyLossNetKrw: null }, ordinary).allowed, true);
});
test('trusted_loss_selector_rejects_partial_estimated_wrong_customer_and_expired_totals', async () => {
  const { CircuitService, createCircuitDispatch } = await import('../src/naver/searchad/circuit/service.js');
  const repository = { async hasBacklog() { return false; }, async unresolved() { return false; }, async getState() { return { dailyLossNetKrw: null }; }, async getPolicy() { return {}; } };
  const dispatch = createCircuitDispatch({ ...ordinary, actionClass: 'increase', incrementalSpendKrw: 1 });
  let evidence = { customerId: '1001', quality: 'actual', completeCustomerDay: true, identityVerified: true, observedAt: now, statDateKst: '2026-10-05', amountNetKrw: 49999 };
  const circuit = new CircuitService({ repository, projection: {}, lossEvidence: { async select() { return evidence; } }, clock: () => now });
  await circuit.assertDispatchAllowed(dispatch, { client: { query() {} }, now });
  for (const patch of [{ customerId: '2002' }, { quality: 'estimated' }, { completeCustomerDay: false }, { identityVerified: false }, { observedAt: now - 86400001 }, { statDateKst: '2026-10-04' }]) {
    const good = evidence; evidence = { ...good, ...patch };
    await assert.rejects(circuit.assertDispatchAllowed(dispatch, { client: { query() {} }, now }), error => error.details.reasons.includes('LOSS_EVIDENCE_UNAVAILABLE'));
    evidence = good;
  }
});
test('unreadable_preflight_store_exposes_only_sanitized_Circuit_error', async () => {
  const { CircuitService, createCircuitDispatch } = await import('../src/naver/searchad/circuit/service.js');
  const circuit = new CircuitService({ repository: { async transaction() { throw new Error('postgres://private-password/internal_table'); } }, projection: {} });
  await assert.rejects(circuit.prepareDispatch(createCircuitDispatch(ordinary)), error => error.code === 'SEARCHAD_CIRCUIT_UNAVAILABLE' && !error.message.includes('private-password'));
});
test('late backdated failure cannot be reset by an unrelated timestamp-ordered success', async () => {
  const { PostgresCircuitRepository } = await import('../src/naver/searchad/circuit/postgres-repository.js');
  const events=[
    {logicalKey:'first',ruleId:'r1',outcome:'failed',occurredAt:now},
    {logicalKey:'late',ruleId:'r1',outcome:'failed',occurredAt:now-1000},
    {logicalKey:'unrelated',ruleId:'r1',outcome:'succeeded',occurredAt:now+1000},
    {logicalKey:'third',ruleId:'r1',outcome:'unknown',occurredAt:now-2000}
  ];
  const repository=new PostgresCircuitRepository({pool:{async query(sql){return {rows:sql.includes('SELECT event_json')?events.map(event_json=>({event_json})):[]};}}});
  assert.equal((await repository.getState({customerId:'1001'})).counterBasis,'unresolved_logical_failure_upper_bound');
  assert.equal((await repository.getState({customerId:'1001'})).consecutiveFailures.r1,3);
  events.push({logicalKey:'late',ruleId:'r1',outcome:'succeeded',occurredAt:now-3000});
  assert.equal((await repository.getState({customerId:'1001'})).consecutiveFailures.r1,2,'only exact linked verification resolves a counted failure');
});
test('hierarchy cleanup source variants distinguish terminal unknown, linked absence and neutral receipts', async () => {
  const { PostgresCircuitRepository } = await import('../src/naver/searchad/circuit/postgres-repository.js');
  for(const [phase,status,expected] of [['tree_cleanup_result','unknown','unknown'],['tree_cleanup_observation','present','unknown'],['tree_cleanup_observation','absent','succeeded'],['cleanup_observation','deleted','succeeded'],['cleanup_observation','delete_unknown','unknown'],['cleanup_observation','manual_review','unknown'],['tree_cleanup_result','accepted','neutral']]) {
    const repository=new PostgresCircuitRepository({pool:{async query(){return {rows:[{source_id:'one',phase,status,created_at:new Date(now),logical_id:'owned-plan',owner_id:'run',descriptor:{}}]};}}});
    assert.equal((await repository.unprojected({customerId:'1001',kind:'hierarchy'}))[0].event.outcome,expected,`${phase}:${status}`);
  }
});
test('lifecycle batch excludes exactly the committed owned objects, never public scope IDs or another sibling', async () => {
  const { CircuitService, prepareLifecycleDispatch } = await import('../src/naver/searchad/circuit/service.js');
  const claimed=['owned-first','owned-second'];
  const repository={
    async transaction(_customerId,work){return work({query(){}});},
    async hasBacklog(){return false;},
    async unresolved({owner}){return claimed.some(id=>!owner.objectIds.includes(id));},
    async getState(){return {};},async getPolicy(){return {};}
  };
  const circuit=new CircuitService({repository,projection:{async catchUp(){return {ready:true};}},clock:()=>now});
  const scope={customerId:'1001',planId:'owned-plan',objectIds:['unrelated']};
  const handoffObjectIds=['owned-first','owned-second'];
  const dispatch=await prepareLifecycleDispatch(circuit,scope,{operationKey:'keyword.create'},handoffObjectIds);
  await circuit.assertDispatchAllowed(dispatch,{client:{query(){}},now});
  claimed.push('unrelated'); handoffObjectIds.push('unrelated');
  await assert.rejects(circuit.assertDispatchAllowed(dispatch,{client:{query(){}},now}),error=>error.details.reasons.includes('UNRESOLVED_MUTATION'));
});
test('planning success is neutral rather than exact execute verification',async()=>{
  const {PostgresCircuitRepository}=await import('../src/naver/searchad/circuit/postgres-repository.js');
  const repository=new PostgresCircuitRepository({pool:{async query(){return {rows:[{source_id:'plan-attempt',phase:'plan',status:'succeeded',created_at:new Date(now),logical_id:'same-plan',owner_id:'same-plan',descriptor:{}}]};}}});
  assert.equal((await repository.unprojected({customerId:'1001',kind:'write'}))[0].event.outcome,'neutral');
});
