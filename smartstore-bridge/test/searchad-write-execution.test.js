import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SearchAdWriteRepository } from '../src/naver/searchad/write/repository.js';
import { SearchAdChangePlanService } from '../src/naver/searchad/write/plan-service.js';
import { SearchAdApprovalService, SEARCHAD_APPROVAL_CONFIRMATION } from '../src/naver/searchad/write/approval-service.js';
import { ProductionSearchAdExecutionService } from '../src/naver/searchad/write/production-execution-service.js';
import { SearchAdGatewayRemoteAdapter } from '../src/naver/searchad/write/remote-adapter.js';

function harness({ allowWrites = true, allowRollback = true, mutateHook, readHook } = {}) {
  let currentTime = Date.parse('2026-09-02T01:00:00.000Z');
  let state = { keywordId: 'kw-1', bidAmt: 300, editTm: 'initial' };
  let readCalls = 0;
  let mutateCalls = 0;
  const clock = () => currentTime;
  const remote = {
    async read(descriptor) {
      readCalls += 1;
      if (readHook) {
        const custom = await readHook({ descriptor, state, readCalls, setState: value => { state = value; } });
        if (custom !== undefined) return custom;
      }
      return { value: structuredClone(state), raw: { body: state } };
    },
    async mutate(descriptor) {
      mutateCalls += 1;
      if (mutateHook) {
        const custom = await mutateHook({ descriptor, state, mutateCalls, setState: value => { state = value; } });
        if (custom !== undefined) return custom;
      }
      state = { ...state, ...(descriptor.body || {}), editTm: `mutation-${mutateCalls}` };
      return { requestId: `remote-${mutateCalls}`, body: { accepted: true } };
    }
  };
  const repository = new SearchAdWriteRepository({ database: new DatabaseSync(':memory:') });
  const config = {
    enabled: true,
    allowPlans: true,
    allowWrites,
    allowRollback,
    allowReconcile: true,
    initialActivationMode: allowWrites ? 'active' : 'prevalidation',
    planTtlSeconds: 1800,
    approvalTtlSeconds: 600
  };
  const approvalService = new SearchAdApprovalService({ repository, config, clock });
  const planService = new SearchAdChangePlanService({ repository, remote, config, clock });
  const executionService = new ProductionSearchAdExecutionService({
    repository, remote, approvalService, config, clock, lockTtlMs: 60_000
  });
  return {
    repository, remote, config, clock, approvalService, planService, executionService,
    getState: () => structuredClone(state),
    setState: value => { state = structuredClone(value); },
    getReadCalls: () => readCalls,
    getMutateCalls: () => mutateCalls,
    advance: milliseconds => { currentTime += milliseconds; }
  };
}

async function approvedPlan(h, { bidAmt = 500 } = {}) {
  const plan = await h.planService.create({
    customerId: 'customer-1',
    createdBy: 'planner',
    reason: '입찰가 조정 테스트',
    mutation: {
      operationKey: 'ncc.keyword.update',
      pathParams: { keywordId: 'kw-1' },
      body: { bidAmt },
      confirmation: 'UPDATE_AD_ENTITY'
    },
    verification: {
      read: {
        operationKey: 'ncc.keyword.get',
        pathParams: { keywordId: 'kw-1' }
      },
      expectedPatch: { bidAmt }
    },
    rollback: {
      mutation: {
        operationKey: 'ncc.keyword.update',
        pathParams: { keywordId: 'kw-1' },
        body: {},
        confirmation: 'UPDATE_AD_ENTITY'
      },
      bodyFromBefore: { bidAmt: 'bidAmt' },
      expectedBefore: { bidAmt: 300 }
    }
  });
  const approval = h.approvalService.approve(plan.plan_id, {
    actor: 'approver',
    confirmation: SEARCHAD_APPROVAL_CONFIRMATION
  });
  return { plan, approval };
}

test('gateway adapter passes an official operation descriptor as one input object', async () => {
  let received;
  const gateway = {
    async execute(input) {
      received = input;
      return { body: { bidAmt: 300 } };
    }
  };
  const adapter = new SearchAdGatewayRemoteAdapter({ gateway });
  const result = await adapter.read({
    operationKey: 'ncc.keyword.get',
    customerId: 'customer-1',
    pathParams: { keywordId: 'kw-1' }
  });
  assert.equal(received.operationKey, 'ncc.keyword.get');
  assert.equal(received.customerId, 'customer-1');
  assert.deepEqual(result.value, { bidAmt: 300 });
});

test('plan service rejects raw URL or method descriptors before any remote call', async () => {
  const h = harness();
  await assert.rejects(() => h.planService.create({
    customerId: 'customer-1',
    createdBy: 'planner',
    reason: 'invalid',
    mutation: { operationKey: 'ncc.keyword.update', url: 'https://example.invalid', body: { bidAmt: 500 } },
    verification: { read: { operationKey: 'ncc.keyword.get' }, expectedPatch: { bidAmt: 500 } }
  }), error => error.code === 'SEARCHAD_RAW_REQUEST_FORBIDDEN');
  assert.equal(h.getReadCalls(), 0);
  h.repository.close();
});

test('approved change performs drift check, one mutation, and remote re-verification', async () => {
  const h = harness();
  const { plan, approval } = await approvedPlan(h);
  const applied = await h.executionService.execute(plan.plan_id, {
    customerId: 'customer-1',
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-1'
  });
  assert.equal(applied.status, 'applied');
  assert.equal(h.getMutateCalls(), 1);
  assert.equal(h.getState().bidAmt, 500);
  assert.ok(applied.applied_after_hash);
  h.repository.close();
});

test('stale plan blocks the remote write and records the drift state', async () => {
  const h = harness();
  const { plan, approval } = await approvedPlan(h);
  h.setState({ keywordId: 'kw-1', bidAmt: 350, editTm: 'manual-change' });
  await assert.rejects(() => h.executionService.execute(plan.plan_id, {
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-stale'
  }), error => error.code === 'SEARCHAD_STALE_PLAN');
  assert.equal(h.getMutateCalls(), 0);
  assert.equal(h.repository.getPlan(plan.plan_id).status, 'stale');
  h.repository.close();
});

test('ambiguous write outcome is not retried and reconcile detects applied state', async () => {
  const h = harness({
    mutateHook: async ({ descriptor, state, setState }) => {
      setState({ ...state, ...descriptor.body, editTm: 'accepted-before-timeout' });
      const error = new Error('socket timed out');
      error.name = 'AbortError';
      error.code = 'TIMEOUT';
      throw error;
    }
  });
  const { plan, approval } = await approvedPlan(h);
  await assert.rejects(() => h.executionService.execute(plan.plan_id, {
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-timeout'
  }), error => error.code === 'SEARCHAD_UNKNOWN_OUTCOME');
  assert.equal(h.getMutateCalls(), 1);
  assert.equal(h.repository.getPlan(plan.plan_id).status, 'unknown_outcome');
  const reconciled = await h.executionService.reconcile(plan.plan_id);
  assert.equal(reconciled.status, 'applied_reconciled');
  assert.equal(h.getMutateCalls(), 1);
  h.repository.close();
});

test('post-write read failure becomes verification_failed and reconcile never repeats mutation', async () => {
  let failRead = true;
  const h = harness({
    readHook: async ({ readCalls }) => {
      if (readCalls === 3 && failRead) {
        const error = new Error('read unavailable');
        error.status = 503;
        throw error;
      }
      return undefined;
    }
  });
  const { plan, approval } = await approvedPlan(h);
  await assert.rejects(() => h.executionService.execute(plan.plan_id, {
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-verify-fail'
  }), error => error.code === 'SEARCHAD_REMOTE_VERIFICATION_UNAVAILABLE');
  assert.equal(h.repository.getPlan(plan.plan_id).status, 'verification_failed');
  assert.equal(h.getMutateCalls(), 1);
  failRead = false;
  const reconciled = await h.executionService.reconcile(plan.plan_id);
  assert.equal(reconciled.status, 'applied_reconciled');
  assert.equal(h.getMutateCalls(), 1);
  h.repository.close();
});

test('rollback succeeds only without post-apply drift', async () => {
  const h = harness();
  const { plan, approval } = await approvedPlan(h);
  await h.executionService.execute(plan.plan_id, {
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-before-rollback'
  });
  const rolledBack = await h.executionService.rollback(plan.plan_id, {
    confirmation: 'ROLLBACK_SEARCHAD_CHANGE',
    idempotencyKey: 'rollback-1'
  });
  assert.equal(rolledBack.status, 'rolled_back');
  assert.equal(h.getState().bidAmt, 300);
  assert.equal(h.getMutateCalls(), 2);
  h.repository.close();
});

test('rollback drift blocks a second remote mutation', async () => {
  const h = harness();
  const { plan, approval } = await approvedPlan(h);
  await h.executionService.execute(plan.plan_id, {
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-before-drift'
  });
  h.setState({ keywordId: 'kw-1', bidAmt: 550, editTm: 'manual-after-apply' });
  await assert.rejects(() => h.executionService.rollback(plan.plan_id, {
    confirmation: 'ROLLBACK_SEARCHAD_CHANGE',
    idempotencyKey: 'rollback-drift'
  }), error => error.code === 'SEARCHAD_ROLLBACK_DRIFT');
  assert.equal(h.getMutateCalls(), 1);
  h.repository.close();
});

test('rollback verification outage records rollback_unknown_outcome and prevents blind retry', async () => {
  let failRollbackRead = false;
  const h = harness({
    mutateHook: async ({ descriptor, state, mutateCalls, setState }) => {
      setState({ ...state, ...descriptor.body, editTm: `mutation-${mutateCalls}` });
      if (mutateCalls === 2) failRollbackRead = true;
      return { requestId: `remote-${mutateCalls}` };
    },
    readHook: async () => {
      if (failRollbackRead) {
        const error = new Error('rollback verification unavailable');
        error.status = 503;
        throw error;
      }
      return undefined;
    }
  });
  const { plan, approval } = await approvedPlan(h);
  await h.executionService.execute(plan.plan_id, {
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-before-rollback-outage'
  });
  await assert.rejects(() => h.executionService.rollback(plan.plan_id, {
    confirmation: 'ROLLBACK_SEARCHAD_CHANGE',
    idempotencyKey: 'rollback-outage'
  }), error => error.code === 'SEARCHAD_ROLLBACK_UNKNOWN_OUTCOME');
  assert.equal(h.repository.getPlan(plan.plan_id).status, 'rollback_unknown_outcome');
  assert.equal(h.getMutateCalls(), 2);
  await assert.rejects(() => h.executionService.rollback(plan.plan_id, {
    confirmation: 'ROLLBACK_SEARCHAD_CHANGE',
    idempotencyKey: 'rollback-outage-repeat'
  }), error => error.code === 'SEARCHAD_CHANGE_PLAN_NOT_ROLLBACKABLE');
  assert.equal(h.getMutateCalls(), 2);
  h.repository.close();
});

test('temporary write gate blocks mutation but plan and approval remain available', async () => {
  const h = harness({ allowWrites: false });
  const { plan, approval } = await approvedPlan(h);
  await assert.rejects(() => h.executionService.execute(plan.plan_id, {
    executionToken: approval.executionToken,
    idempotencyKey: 'execute-gated'
  }), error => error.code === 'SEARCHAD_WRITES_PREVALIDATION_GATED');
  assert.equal(h.getMutateCalls(), 0);
  assert.equal(h.repository.getPlan(plan.plan_id).status, 'approved');
  h.repository.close();
});

test('same plan and operation are serialized with a database lock', async () => {
  const h = harness();
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const first = h.executionService.withLock('plan-lock', 'execute', async () => blocker);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => h.executionService.withLock('plan-lock', 'execute', async () => undefined), error =>
    error.code === 'SEARCHAD_WRITE_ALREADY_IN_PROGRESS'
  );
  release('done');
  assert.equal(await first, 'done');
  h.repository.close();
});
