import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { createProductionSearchAdWriteRuntime } from '../src/naver/searchad/write/runtime-production.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { SearchAdCapabilityService } from '../src/naver/searchad/capability.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { createProductionSearchAdActivationRuntime } from '../src/naver/searchad/activation/runtime-production.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';

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
  // Exercise the real final signed transport, not an unfenceable execute stub.
  const customerId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 20)}`).toString();
  const state = { nccCampaignId: 'fixture-1', dailyBudget: 1000, userLock: false };
  const calls = [], transportFailures = [];
  const credentialsRegistry = new SearchAdCredentialsRegistry({
    principals: [{ principalId: 'fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
    customers: [{ customerId, status: 'active' }],
    grants: [{ principalId: 'fixture', customerId, role: 'admin' }]
  });
  const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
  const config = { enabled: true, configured: true, baseUrl: 'https://api.searchad.naver.com', allowReads: true, allowWrites: true };
  const client = new NaverSearchAdClient({ baseUrl: config.baseUrl, credentialsRegistry, maxRetries: 0,
    fetchImpl: async (url, init) => {
      try {
        const address = new URL(url);
        assert.equal(address.origin, config.baseUrl);
        assert.equal(address.pathname, '/ncc/campaigns/fixture-1');
        assert.equal(init.headers['X-Customer'], customerId);
        assert.ok(init.headers['X-Signature']);
        assert.ok(['GET', 'PUT'].includes(init.method));
      } catch (error) { transportFailures.push(error.message); throw error; }
      calls.push(init.method);
      if (init.method === 'PUT') Object.assign(state, JSON.parse(init.body));
      return new Response(JSON.stringify(state), { headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-write-request' } });
    }
  });
  return Object.assign(new SearchAdOperationGateway({ client, config, registry, credentialsRegistry }), { state, customerId, calls, transportFailures });
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

    await pool.query('INSERT INTO searchad_canary_accounts(customer_id) VALUES($1) ON CONFLICT(customer_id) DO NOTHING',[created.customer_id]);

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

    const planningCustomer = `unregistered-planning-${randomUUID()}`;
    const plan = await runtime.planService.create({
      customerId: planningCustomer,
      reason: 'runtime integration',
      createdBy: 'integration-test',
      mutation: { operationKey: 'fixture.write', body: { userLock: true } },
      verification: {
        read: { operationKey: 'fixture.read' },
        expectedAfter: { userLock: true }
      }
    });
    assert.equal(plan.customer_id, planningCustomer);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM searchad_canary_accounts WHERE customer_id=$1',[planningCustomer])).rows[0].n,0,'actual plan service neither requires nor creates an account');

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
  let customerId, activation, runtime;
  try {
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres') });
    await resetSearchAdWriteTables(pool);
    const gateway = statefulGatewayFixture();
    customerId = gateway.customerId;
    activation = await createProductionSearchAdActivationRuntime({ gateway, credentialsRegistry: gateway.credentialsRegistry,
      capabilityService: new SearchAdCapabilityService({ gateway, config: gateway.config }), pool, env: {} });
    const now = Date.now();
    const evidence = await activation.repository.createEvidence({ evidenceId: randomUUID(), evidenceType: 'active_canary', customerId,
      specSha: activation.status().specSha, credentialFingerprint: credentialFingerprintForCustomer(gateway.credentialsRegistry, customerId),
      upstreamBaseUrl: gateway.config.baseUrl, result: 'verified', sourceRunId: 'synthetic-runtime-not-live', details: { fixtureOnly: true },
      operationKeys: [CANARY_OPERATION_KEYS.updateCampaign], fieldScope: ['campaign.dailyBudget', 'campaign.userLock'],
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString() });
    await activation.activationService.activate({ evidenceId: evidence.evidenceId }, {
      principal: { principalId: 'fixture-admin', role: 'admin', customerIds: [customerId] }
    });
    assert.equal(activation.repository.pool, pool, 'activation and writer bind the same authoritative store');
    runtime = createProductionSearchAdWriteRuntime({
      activationGuard: activation.guard,
      gateway,
      postgresPool: pool,
      env: {
        ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true',
        ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
        ATELIER_SEARCHAD_ALLOW_WRITES: 'true',
        ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres'
      }
    });

    const update = gateway.registry.get(CANARY_OPERATION_KEYS.updateCampaign);
    const read = gateway.registry.findByPath('GET', '/ncc/campaigns/{campaignId}') || gateway.registry.findByPath('GET', '/ncc/campaigns/{nccCampaignId}');
    const pathParams = { campaignId: 'fixture-1', nccCampaignId: 'fixture-1' };
    const plan = await runtime.planService.create({
      customerId,
      reason: 'verified PostgreSQL locking path',
      createdBy: 'integration-test',
      mutation: { operationKey: update.operationKey, pathParams, query: { fields: 'budget' },
        body: { nccCampaignId: 'fixture-1', userLock: true }, confirmation: update.confirmation },
      verification: { read: { operationKey: read.operationKey, pathParams }, expectedPatch: { userLock: true } }
    });
    const approval = await runtime.approvalService.approve(plan.plan_id, {
      actor: 'approver',
      confirmation: 'APPROVE_SEARCHAD_CHANGE'
    });
    const applied = await runtime.executionService.execute(plan.plan_id, {
      customerId,
      executionToken: approval.executionToken,
      idempotencyKey: 'postgres-execute-1'
    });

    assert.equal(applied.status, 'applied');
    assert.equal(gateway.state.userLock, true);
    const durable = await runtime.planService.get(plan.plan_id);
    assert.equal(durable.status, 'applied');
    assert.ok(durable.attempts.some(attempt => attempt.phase === 'execute' && attempt.status === 'remote_accepted'));
    assert.ok(durable.attempts.some(attempt => attempt.phase === 'verify' && attempt.status === 'succeeded'));
    assert.deepEqual(gateway.calls, ['GET', 'GET', 'PUT', 'GET']);
    const consumedAt = (await pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [plan.plan_id])).rows[0].used_at;
    assert.ok(consumedAt);
    await assert.rejects(runtime.executionService.execute(plan.plan_id, { customerId, executionToken: approval.executionToken }),
      { code: 'SEARCHAD_CHANGE_PLAN_NOT_EXECUTABLE', status: 409 });
    assert.deepEqual(gateway.calls, ['GET', 'GET', 'PUT', 'GET']);
    assert.deepEqual((await pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [plan.plan_id])).rows[0].used_at, consumedAt);
    assert.deepEqual(gateway.transportFailures, []);
  } finally {
    await resetSearchAdWriteTables(pool).catch(() => {});
    await runtime?.close();
    await activation?.close();
    // The unique fixture account owns immutable Circuit audit rows. Retain both;
    // deleting the account would violate their FK and deleting audit is forbidden.
    await closePostgresPool(pool);
  }
});
