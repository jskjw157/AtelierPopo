import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { createProductionSearchAdWriteRuntime } from '../src/naver/searchad/write/runtime-production.js';

async function resetSearchAdWriteTables(pool) {
  await pool.query(`
    TRUNCATE TABLE
      searchad_write_attempts,
      searchad_write_approvals,
      searchad_write_locks,
      searchad_write_change_plans
    RESTART IDENTITY CASCADE
  `);
}

function fixturePlan(planId, now = Date.now()) {
  return {
    plan_id: planId,
    customer_id: 'customer-postgres-runtime',
    mutation_operation_key: 'PUT:/ncc/campaigns/{nccCampaignId}#fields',
    mutation_json: { operationKey: 'PUT:/ncc/campaigns/{nccCampaignId}#fields', pathParams: { nccCampaignId: 'cmp-1' }, body: { userLock: true } },
    read_json: { operationKey: 'GET:/ncc/campaigns/{nccCampaignId}', pathParams: { nccCampaignId: 'cmp-1' }, extractPath: '' },
    before_json: { nccCampaignId: 'cmp-1', userLock: false },
    before_hash: 'a'.repeat(64),
    expected_after_json: { userLock: true },
    rollback_json: null,
    reason: 'PostgreSQL runtime repository integration test',
    status: 'planned',
    created_by: 'integration-test',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 10 * 60_000).toISOString()
  };
}

function gatewayFixture() {
  const operations = new Map([
    ['fixture.read', { operationKey: 'fixture.read', sideEffect: false }],
    ['fixture.write', { operationKey: 'fixture.write', sideEffect: true }]
  ]);
  return {
    get(operationKey) { return operations.get(operationKey); },
    async execute(operationKey) {
      if (operationKey === 'fixture.read') return { body: { id: 'fixture-1', userLock: false } };
      return { body: { id: 'fixture-1', userLock: true } };
    }
  };
}

function statefulGatewayFixture() {
  const operations = new Map([
    ['fixture.read', { operationKey: 'fixture.read', sideEffect: false }],
    ['fixture.write', { operationKey: 'fixture.write', sideEffect: true }]
  ]);
  const state = { id: 'fixture-1', userLock: false };
  return {
    state,
    get(operationKey) { return operations.get(operationKey); },
    async execute(operationKey, input = {}) {
      if (operationKey === 'fixture.read') return { body: structuredClone(state) };
      if (operationKey === 'fixture.write') {
        Object.assign(state, input.body || {});
        return { body: structuredClone(state), requestId: 'fixture-write-request' };
      }
      throw new Error(`Unexpected fixture operation: ${operationKey}`);
    }
  };
}

test('PostgreSQL SearchAd write repository durably persists plans approvals and attempts', async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return t.skip('TEST_DATABASE_URL is required');

  const pool = createPostgresPool({ connectionString: url, sslMode: 'disable' });
  try {
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres') });
    await resetSearchAdWriteTables(pool);

    const repository = new PostgresSearchAdWriteRepository({ pool });
    const planId = randomUUID();
    const now = Date.now();
    const created = await repository.createPlan(fixturePlan(planId, now));
    assert.equal(created.plan_id, planId);
    assert.equal(created.status, 'planned');
    assert.deepEqual(created.before_json, { nccCampaignId: 'cmp-1', userLock: false });

    const approvalId = randomUUID();
    const tokenHash = 'b'.repeat(64);
    await repository.createApproval({
      approval_id: approvalId,
      plan_id: planId,
      actor: 'approver',
      confirmation: 'APPROVE_SEARCHAD_CHANGE',
      token_hash: tokenHash,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 5 * 60_000).toISOString()
    });

    const claimed = await repository.claimApproval({
      planId,
      tokenHash,
      now: new Date(now + 1_000).toISOString()
    });
    assert.equal(claimed.approval_id, approvalId);
    assert.equal(typeof claimed.used_at, 'string');
    await assert.rejects(
      repository.claimApproval({ planId, tokenHash, now: new Date(now + 2_000).toISOString() }),
      error => error?.code === 'SEARCHAD_EXECUTION_TOKEN_USED'
    );

    const attemptId = randomUUID();
    await repository.addAttempt({
      attempt_id: attemptId,
      plan_id: planId,
      phase: 'execute',
      status: 'remote_accepted',
      request_fingerprint: 'c'.repeat(64),
      request_json: { operationKey: created.mutation_operation_key },
      response_json: { ok: true },
      remote_request_id: 'request-1',
      created_at: new Date(now + 3_000).toISOString()
    });

    const reopened = new PostgresSearchAdWriteRepository({ pool });
    const durablePlan = await reopened.getPlan(planId);
    const attempts = await reopened.listAttempts(planId);
    assert.equal(durablePlan.plan_id, planId);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].attempt_id, attemptId);
    assert.deepEqual(attempts[0].response_json, { ok: true });
  } finally {
    await resetSearchAdWriteTables(pool).catch(() => {});
    await closePostgresPool(pool);
  }
});

test('production SearchAd runtime uses PostgreSQL repository and async services when configured', async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return t.skip('TEST_DATABASE_URL is required');

  const pool = createPostgresPool({ connectionString: url, sslMode: 'disable' });
  try {
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres') });
    await resetSearchAdWriteTables(pool);

    const runtime = createProductionSearchAdWriteRuntime({
      gateway: gatewayFixture(),
      postgresPool: pool,
      env: {
        ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true',
        ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
        ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres'
      }
    });
    const status = runtime.status();
    assert.equal(status.storage.runtime, 'postgres');
    assert.equal(status.storage.postgresRuntimeAdapter, true);

    const plan = await runtime.planService.create({
      customerId: 'customer-postgres-runtime',
      reason: 'runtime integration',
      createdBy: 'integration-test',
      mutation: { operationKey: 'fixture.write', body: { userLock: true } },
      verification: {
        read: { operationKey: 'fixture.read' },
        expectedAfter: { userLock: true }
      }
    });
    assert.equal(plan.customer_id, 'customer-postgres-runtime');

    const fetched = await runtime.planService.get(plan.plan_id);
    assert.equal(fetched.plan_id, plan.plan_id);
    assert.equal(fetched.attempts.length, 1);
    assert.equal(fetched.attempts[0].phase, 'plan');
  } finally {
    await resetSearchAdWriteTables(pool).catch(() => {});
    await closePostgresPool(pool);
  }
});

test('PostgreSQL production runtime approves and executes a verified one-time-token mutation', async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return t.skip('TEST_DATABASE_URL is required');

  const pool = createPostgresPool({ connectionString: url, sslMode: 'disable' });
  try {
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres') });
    await resetSearchAdWriteTables(pool);
    const gateway = statefulGatewayFixture();
    const runtime = createProductionSearchAdWriteRuntime({
      // Authorization is a fixture here; real activation is covered by PostgreSQL composition.
      activationGuard: { async assertMutationAllowed() { return { allowed: true }; } },
      gateway,
      postgresPool: pool,
      env: {
        ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true',
        ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
        ATELIER_SEARCHAD_ALLOW_WRITES: 'true',
        ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres'
      }
    });

    const plan = await runtime.planService.create({
      customerId: 'customer-postgres-runtime',
      reason: 'verified PostgreSQL execute path',
      createdBy: 'integration-test',
      mutation: { operationKey: 'fixture.write', body: { userLock: true } },
      verification: {
        read: { operationKey: 'fixture.read' },
        expectedAfter: { userLock: true }
      }
    });
    const approval = await runtime.approvalService.approve(plan.plan_id, {
      actor: 'approver',
      confirmation: 'APPROVE_SEARCHAD_CHANGE'
    });
    const applied = await runtime.executionService.execute(plan.plan_id, {
      customerId: 'customer-postgres-runtime',
      executionToken: approval.executionToken,
      idempotencyKey: 'postgres-execute-1'
    });

    assert.equal(applied.status, 'applied');
    assert.equal(gateway.state.userLock, true);
    const durable = await runtime.planService.get(plan.plan_id);
    assert.equal(durable.status, 'applied');
    assert.ok(durable.attempts.some(attempt => attempt.phase === 'execute' && attempt.status === 'remote_accepted'));
    assert.ok(durable.attempts.some(attempt => attempt.phase === 'verify' && attempt.status === 'succeeded'));
  } finally {
    await resetSearchAdWriteTables(pool).catch(() => {});
    await closePostgresPool(pool);
  }
});
