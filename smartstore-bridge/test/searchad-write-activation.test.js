import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { SearchAdWriteRepository } from '../src/naver/searchad/write/repository.js';
import { SearchAdChangePlanService } from '../src/naver/searchad/write/plan-service.js';
import { SearchAdApprovalService, SEARCHAD_APPROVAL_CONFIRMATION } from '../src/naver/searchad/write/approval-service.js';
import { ProductionSearchAdExecutionService } from '../src/naver/searchad/write/production-execution-service.js';
import { SearchAdWriteError } from '../src/naver/searchad/write/errors.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';

function harness({ activationGuard = null, mutateHook = null } = {}) {
  const now = Date.parse('2026-09-11T03:00:00Z');
  let state = { nccCampaignId: 'cmp-100', dailyBudget: 1000, userLock: true };
  let mutateCalls = 0;
  let readCalls = 0;
  const guardCalls = [];
  const repository = new SearchAdWriteRepository({ database: new DatabaseSync(':memory:') });
  const config = {
    enabled: true,
    allowPlans: true,
    allowWrites: true,
    allowRollback: true,
    allowReconcile: true,
    initialActivationMode: 'active',
    planTtlSeconds: 1800,
    approvalTtlSeconds: 600
  };
  const remote = {
    async read() {
      readCalls += 1;
      return { value: structuredClone(state) };
    },
    async mutate(descriptor) {
      mutateCalls += 1;
      if (mutateHook) return mutateHook({ descriptor, state, setState: value => { state = structuredClone(value); } });
      state = { ...state, ...(descriptor.body || {}) };
      return { requestId: `mutation-${mutateCalls}` };
    }
  };
  const wrappedGuard = activationGuard && {
    async assertMutationAllowed(input) {
      guardCalls.push(structuredClone(input));
      return activationGuard.assertMutationAllowed(input);
    }
  };
  const approvalService = new SearchAdApprovalService({ repository, config, clock: () => now });
  const planService = new SearchAdChangePlanService({ repository, remote, config, clock: () => now });
  const executionService = new ProductionSearchAdExecutionService({
    repository,
    remote,
    approvalService,
    config,
    activationGuard: wrappedGuard,
    clock: () => now,
    lockTtlMs: 60_000
  });
  return {
    repository,
    approvalService,
    planService,
    executionService,
    guardCalls,
    getMutateCalls: () => mutateCalls,
    getReadCalls: () => readCalls,
    getState: () => structuredClone(state)
  };
}

async function approvedPlan(h, { dailyBudget = 1100 } = {}) {
  const plan = await h.planService.create({
    customerId: '100',
    createdBy: 'fixture-planner',
    reason: 'activation guard ordering test',
    mutation: {
      operationKey: CANARY_OPERATION_KEYS.updateCampaign,
      pathParams: { campaignId: 'cmp-100' },
      query: { fields: 'budget' },
      body: { nccCampaignId: 'cmp-100', dailyBudget, userLock: true }
    },
    verification: {
      read: {
        operationKey: CANARY_OPERATION_KEYS.readCampaign,
        pathParams: { campaignId: 'cmp-100' }
      },
      expectedPatch: { dailyBudget, userLock: true }
    }
  });
  const approval = h.approvalService.approve(plan.plan_id, {
    actor: 'fixture-executor',
    confirmation: SEARCHAD_APPROVAL_CONFIRMATION
  });
  return { plan, approval };
}

function approvalRow(h, approvalId) {
  return h.repository.getApproval(approvalId);
}

test('normal write fails closed when activation guard is unavailable, without consuming approval or mutating', async () => {
  const h = harness();
  const { plan, approval } = await approvedPlan(h);

  await assert.rejects(
    h.executionService.execute(plan.plan_id, {
      customerId: '100',
      executionToken: approval.executionToken,
      idempotencyKey: 'guard-missing'
    }),
    error => error?.code === 'SEARCHAD_ACTIVATION_GUARD_NOT_READY' && error?.status === 503
  );

  assert.equal(h.getMutateCalls(), 0);
  assert.equal(approvalRow(h, approval.approvalId).used_at, null);
  assert.equal(h.repository.getPlan(plan.plan_id).status, 'approved');
  h.repository.close();
});

test('guard rejection happens after drift read but before one-time approval claim and mutation', async () => {
  let allow = false;
  const guard = {
    async assertMutationAllowed({ customerId, descriptor, planId }) {
      assert.equal(customerId, '100');
      assert.ok(planId);
      assert.equal(descriptor.operationKey, CANARY_OPERATION_KEYS.updateCampaign);
      if (!allow) throw new SearchAdWriteError('SEARCHAD_ACCOUNT_SUSPENDED', 'suspended', {}, 403);
      return { allowed: true, activationId: 'activation-100' };
    }
  };
  const h = harness({ activationGuard: guard });
  const { plan, approval } = await approvedPlan(h);

  await assert.rejects(
    h.executionService.execute(plan.plan_id, {
      customerId: '100',
      executionToken: approval.executionToken,
      idempotencyKey: 'guard-rejected'
    }),
    error => error?.code === 'SEARCHAD_ACCOUNT_SUSPENDED' && error?.status === 403
  );

  assert.equal(h.getReadCalls(), 2, 'plan snapshot + execute drift read must happen before guard');
  assert.equal(h.guardCalls.length, 1);
  assert.equal(h.getMutateCalls(), 0);
  assert.equal(approvalRow(h, approval.approvalId).used_at, null);
  assert.equal(h.repository.getPlan(plan.plan_id).status, 'approved');

  allow = true;
  const applied = await h.executionService.execute(plan.plan_id, {
    customerId: '100',
    executionToken: approval.executionToken,
    idempotencyKey: 'guard-allowed-same-token'
  });
  assert.equal(applied.status, 'applied');
  assert.equal(h.guardCalls.length, 2);
  assert.equal(h.getMutateCalls(), 1);
  assert.ok(approvalRow(h, approval.approvalId).used_at);
  assert.equal(h.getState().dailyBudget, 1100);
  h.repository.close();
});

test('read-only reconcile never requires or calls activation guard', async () => {
  const guard = {
    async assertMutationAllowed() {
      throw new Error('guard must not be called by reconcile');
    }
  };
  const h = harness({
    activationGuard: guard,
    mutateHook({ descriptor, state, setState }) {
      setState({ ...state, ...(descriptor.body || {}) });
      const error = new Error('ambiguous timeout');
      error.name = 'AbortError';
      error.code = 'TIMEOUT';
      throw error;
    }
  });
  const { plan, approval } = await approvedPlan(h);

  // Let execute pass guard once, then become ambiguous after the single mutation.
  h.executionService.activationGuard = { async assertMutationAllowed() { return { allowed: true }; } };
  await assert.rejects(
    h.executionService.execute(plan.plan_id, {
      customerId: '100',
      executionToken: approval.executionToken,
      idempotencyKey: 'ambiguous-before-reconcile'
    }),
    error => error?.code === 'SEARCHAD_UNKNOWN_OUTCOME'
  );
  assert.equal(h.getMutateCalls(), 1);

  h.executionService.activationGuard = guard;
  const reconciled = await h.executionService.reconcile(plan.plan_id, {}, { requestId: 'reconcile-read-only' });
  assert.equal(reconciled.status, 'applied_reconciled');
  assert.equal(h.getMutateCalls(), 1);
  h.repository.close();
});
