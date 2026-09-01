import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SearchAdWriteRepository } from '../src/naver/searchad/write/repository.js';
import { SearchAdApprovalService, SEARCHAD_APPROVAL_CONFIRMATION } from '../src/naver/searchad/write/approval-service.js';

function createRepository() {
  return new SearchAdWriteRepository({ database: new DatabaseSync(':memory:') });
}

function seedPlan(repository, overrides = {}) {
  return repository.createPlan({
    plan_id: overrides.plan_id || '11111111-1111-4111-8111-111111111111',
    customer_id: 'customer-1',
    mutation_operation_key: 'ncc.keyword.update',
    mutation_json: { operationKey: 'ncc.keyword.update', body: { bidAmt: 500 } },
    read_json: { operationKey: 'ncc.keyword.get', extractPath: '' },
    before_json: { bidAmt: 300 },
    before_hash: 'before-hash',
    expected_after_json: { bidAmt: 500 },
    rollback_json: null,
    reason: 'test change',
    status: overrides.status || 'planned',
    created_by: 'tester',
    created_at: overrides.created_at || '2026-09-02T00:00:00.000Z',
    expires_at: overrides.expires_at || '2026-09-02T01:00:00.000Z'
  });
}

test('SearchAd write repository persists structured plan fields and attempts', () => {
  const repository = createRepository();
  const plan = seedPlan(repository);
  repository.addAttempt({
    attempt_id: '22222222-2222-4222-8222-222222222222',
    plan_id: plan.plan_id,
    phase: 'plan',
    status: 'succeeded',
    request_json: { operationKey: 'ncc.keyword.update' },
    response_json: { beforeHash: 'before-hash' },
    created_at: '2026-09-02T00:00:01.000Z'
  });
  const loaded = repository.getPlan(plan.plan_id);
  assert.deepEqual(loaded.before_json, { bidAmt: 300 });
  assert.deepEqual(loaded.expected_after_json, { bidAmt: 500 });
  assert.equal(repository.listAttempts(plan.plan_id).length, 1);
  repository.close();
});

test('plan transitions reject an unexpected current state', () => {
  const repository = createRepository();
  const plan = seedPlan(repository);
  assert.throws(() => repository.updatePlan(plan.plan_id, { status: 'applied' }, {
    expectedStatuses: ['approved']
  }), error => error.code === 'SEARCHAD_CHANGE_PLAN_STATE_CONFLICT');
  repository.close();
});

test('approval stores only a hash and the execution token is one-time', () => {
  const repository = createRepository();
  const clock = () => Date.parse('2026-09-02T00:10:00.000Z');
  const plan = seedPlan(repository);
  const service = new SearchAdApprovalService({
    repository,
    config: { approvalTtlSeconds: 600 },
    clock
  });
  const approved = service.approve(plan.plan_id, {
    actor: 'approver',
    confirmation: SEARCHAD_APPROVAL_CONFIRMATION
  });
  assert.ok(approved.executionToken.length > 20);
  const row = repository.getApproval(approved.approvalId);
  assert.notEqual(row.token_hash, approved.executionToken);
  assert.equal(Object.values(row).includes(approved.executionToken), false);
  const claimed = service.claim(plan.plan_id, approved.executionToken);
  assert.ok(claimed.used_at);
  assert.throws(() => service.claim(plan.plan_id, approved.executionToken), error =>
    error.code === 'SEARCHAD_EXECUTION_TOKEN_USED'
  );
  repository.close();
});

test('expired plans cannot be approved', () => {
  const repository = createRepository();
  const plan = seedPlan(repository, { expires_at: '2026-09-01T23:59:59.000Z' });
  const service = new SearchAdApprovalService({
    repository,
    config: { approvalTtlSeconds: 600 },
    clock: () => Date.parse('2026-09-02T00:10:00.000Z')
  });
  assert.throws(() => service.approve(plan.plan_id, {
    actor: 'approver',
    confirmation: SEARCHAD_APPROVAL_CONFIRMATION
  }), error => error.code === 'SEARCHAD_CHANGE_PLAN_EXPIRED');
  assert.equal(repository.getPlan(plan.plan_id).status, 'expired');
  repository.close();
});
