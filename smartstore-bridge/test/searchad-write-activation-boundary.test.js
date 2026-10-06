import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { SearchAdWriteRepository } from '../src/naver/searchad/write/repository.js';
import { SearchAdChangePlanService } from '../src/naver/searchad/write/plan-service.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { ProductionSearchAdExecutionService } from '../src/naver/searchad/write/production-execution-service.js';

// Guard and remote behavior are explicit test doubles. The real activation
// services and PostgreSQL composition are tested separately; no live evidence.
async function fixture(t, activationGuard) {
  const repository = new SearchAdWriteRepository({ database: new DatabaseSync(':memory:') });
  t.after(() => repository.close());
  const state = { id: 'fixture', dailyBudget: 1000 };
  const mutations = [];
  let claims = 0;
  const config = { enabled: true, allowPlans: true, allowWrites: true, allowRollback: true,
    allowReconcile: true, planTtlSeconds: 1800, approvalTtlSeconds: 600 };
  const remote = {
    async read() { return { value: structuredClone(state) }; },
    async mutate(descriptor) {
      mutations.push(structuredClone(descriptor));
      Object.assign(state, descriptor.body);
      return { requestId: 'fixture-only' };
    }
  };
  const approvalService = new SearchAdApprovalService({ repository, config });
  const originalClaim = approvalService.claim.bind(approvalService);
  approvalService.claim = async (...args) => { claims += 1; return originalClaim(...args); };
  const planService = new SearchAdChangePlanService({ repository, remote, config });
  const executor = new ProductionSearchAdExecutionService({ repository, remote, approvalService, config, activationGuard });
  const plan = await planService.create({
    customerId: 'fixture-customer', createdBy: 'fixture-planner', reason: 'guard boundary',
    mutation: { operationKey: 'fixture.update', body: { dailyBudget: 1200 } },
    verification: { read: { operationKey: 'fixture.read' }, expectedPatch: { dailyBudget: 1200 } },
    rollback: { mutation: { operationKey: 'fixture.update', body: {} }, bodyFromBefore: { dailyBudget: 'dailyBudget' } }
  });
  const approval = await approvalService.approve(plan.plan_id, { actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE' });
  return { repository, executor, plan, approval, mutations, claims: () => claims,
    execute: () => executor.execute(plan.plan_id, { executionToken: approval.executionToken, idempotencyKey: 'fixture-execute' }),
    rollback: () => executor.rollback(plan.plan_id, { confirmation: 'ROLLBACK_SEARCHAD_CHANGE', idempotencyKey: 'fixture-rollback' }) };
}

test('execute awaits pending authorization before token claim and does not consume on rejection', async t => {
  let release;
  let entered = false;
  const barrier = new Promise(resolve => { release = resolve; });
  const denial = Object.assign(new Error('fixture authorization denied'), { code: 'FIXTURE_ACTIVATION_DENIED', status: 403 });
  const h = await fixture(t, { async assertMutationAllowed() { entered = true; await barrier; throw denial; } });
  const outcome = h.execute().then(value => ({ value }), error => ({ error }));
  try {
    await yieldTurn();
    await yieldTurn();
    assert.equal(entered, true, 'guard must actually be invoked');
    assert.equal(h.claims(), 0, 'pending async guard must not consume the token');
    assert.equal(h.mutations.length, 0);
  } finally {
    release();
    const result = await outcome;
    assert.equal(result.error?.code, denial.code);
    assert.equal(h.claims(), 0);
    assert.equal(h.repository.getPlan(h.plan.plan_id).status, 'approved');
  }
});

for (const value of [undefined, null, false, {}, { allowed: false }]) {
  test(`non-authorizing guard result ${JSON.stringify(value)} fails closed`, async t => {
    const h = await fixture(t, { async assertMutationAllowed() { return value; } });
    await assert.rejects(h.execute(), { code: 'SEARCHAD_ACTIVATION_REJECTED' });
    assert.equal(h.claims(), 0);
    assert.equal(h.mutations.length, 0);
  });
}

test('rollback independently rechecks authorization before changing an applied plan', async t => {
  let deny = false;
  const descriptors = [];
  const h = await fixture(t, { async assertMutationAllowed(input) {
    descriptors.push(structuredClone(input));
    if (deny) throw Object.assign(new Error('fixture suspended'), { code: 'SEARCHAD_ACCOUNT_SUSPENDED', status: 403 });
    return { allowed: true };
  } });
  assert.equal((await h.execute()).status, 'applied');
  deny = true;
  await assert.rejects(h.rollback(), { code: 'SEARCHAD_ACCOUNT_SUSPENDED' });
  assert.equal(h.mutations.length, 1);
  assert.equal(h.repository.getPlan(h.plan.plan_id).status, 'applied');
  assert.equal(descriptors.at(-1).descriptor.body.dailyBudget, 1000, 'guard must validate materialized rollback, not original forward mutation');
  deny = false;
  assert.equal((await h.rollback()).status, 'rolled_back');
  assert.equal(h.mutations.length, 2);
});

test('guard receives persisted Customer and a detached descriptor without execution token', async t => {
  let seen;
  const h = await fixture(t, { async assertMutationAllowed(input) {
    seen = structuredClone(input);
    input.descriptor.body.dailyBudget = 999999;
    return { allowed: true };
  } });
  assert.equal((await h.execute()).status, 'applied');
  assert.equal(seen.customerId, 'fixture-customer');
  assert.equal(seen.planId, h.plan.plan_id);
  assert.equal(seen.descriptor.body.dailyBudget, 1200);
  assert.ok(!JSON.stringify(seen).includes(h.approval.executionToken));
  assert.equal(h.mutations[0].body.dailyBudget, 1200, 'authorization adapter must not rewrite the approved mutation');
});
