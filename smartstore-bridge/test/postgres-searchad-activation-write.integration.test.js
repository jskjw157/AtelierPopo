import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { SearchAdCapabilityService } from '../src/naver/searchad/capability.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { createProductionSearchAdActivationRuntime } from '../src/naver/searchad/activation/runtime-production.js';
import { createProductionSearchAdWriteRuntime } from '../src/naver/searchad/write/runtime-production.js';

const logger = { info() {}, warn() {}, error() {} };
const origin = 'https://api.searchad.naver.com';

// This is NOT live-account validation. Active evidence below is synthetic test
// data in a disposable, uniquely named schema; it must never reach production.
test('0008 activation guards the real PostgreSQL async write runtime before token consumption and rollback mutation', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const schema = `test_activation_write_${randomUUID().replaceAll('-', '')}`;
  const adminPool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable', logger });
  let pool;
  const runtimes = [];
  try {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const isolatedUrl = new URL(process.env.TEST_DATABASE_URL);
    isolatedUrl.searchParams.set('options', `-c search_path=${schema}`);
    pool = createPostgresPool({ connectionString: isolatedUrl.toString(), sslMode: 'disable', logger });
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));

    async function fixture({ evidenceType = 'active_canary', grant = true, guard = true, fieldScope = ['campaign.dailyBudget', 'campaign.userLock'] } = {}) {
      const customerId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 20)}`).toString();
      let now = Date.parse('2026-09-12T00:00:00Z');
      let state = { nccCampaignId: 'cmp-fixture', dailyBudget: 1000, userLock: true };
      let failMutation = false;
      const calls = [];
      const credentials = new SearchAdCredentialsRegistry({
        principals: [{ principalId: 'fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
        customers: [{ customerId, status: 'active' }],
        grants: [{ principalId: 'fixture', customerId, role: 'admin' }]
      });
      const gatewayConfig = {
        enabled: true, configured: true, baseUrl: origin, allowReads: true,
        allowWrites: true, allowCreates: false, allowDeletes: false, allowBatchWrites: false,
        allowRollbacks: true, allowActiveCanary: false, allowUnverifiedOperations: false,
        automationMode: 'observe', passiveProbeLimit: 20
      };
      const client = new NaverSearchAdClient({ baseUrl: origin, credentialsRegistry: credentials, maxRetries: 0, logger, clock: () => now,
        fetchImpl: async (url, init) => {
          assert.equal(new URL(url).origin, origin);
          assert.equal(init.headers['X-Customer'], customerId);
          assert.ok(init.headers['X-Signature']);
          assert.ok(['GET', 'PUT'].includes(init.method));
          calls.push(init.method);
          if (init.method === 'PUT') {
            state = { ...state, ...JSON.parse(init.body) };
            if (failMutation) { failMutation = false; throw Object.assign(new Error('fixture connection reset'), { code: 'ECONNRESET' }); }
          }
          return new Response(JSON.stringify(state), { status: 200, headers: {
            'content-type': 'application/json', 'x-request-id': `fixture-${calls.length}`
          } });
        }
      });
      const gateway = new SearchAdOperationGateway({ client, config: gatewayConfig, registry, credentialsRegistry: credentials, logger });
      const activation = await createProductionSearchAdActivationRuntime({
        gateway, credentialsRegistry: credentials,
        capabilityService: new SearchAdCapabilityService({ gateway, config: gatewayConfig }),
        pool, clock: () => now, env: {}, logger
      });
      runtimes.push(activation);
      const admin = { principal: { principalId: 'fixture-admin', role: 'admin', customerIds: [customerId] }, requestId: 'fixture-admin' };
      if (grant) {
        const evidence = await activation.repository.createEvidence({
          evidenceId: randomUUID(), evidenceType, customerId,
          specSha: activation.status().specSha, upstreamBaseUrl: origin,
          credentialFingerprint: credentialFingerprintForCustomer(credentials, customerId),
          operationKeys: [CANARY_OPERATION_KEYS.updateCampaign], fieldScope, result: 'verified',
          sourceRunId: 'synthetic-not-live', details: { fixtureOnly: true },
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString()
        });
        await activation.activationService.activate({ evidenceId: evidence.evidenceId }, admin);
      }
      const write = createProductionSearchAdWriteRuntime({
        gateway, postgresPool: pool, activationGuard: guard ? activation.guard : null,
        clock: () => now, env: {
          ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true', ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
          ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres', ATELIER_SEARCHAD_ALLOW_WRITES: 'true',
          ATELIER_SEARCHAD_ALLOW_ROLLBACK: 'true'
        }
      });
      runtimes.push(write);
      const update = registry.get(CANARY_OPERATION_KEYS.updateCampaign);
      const read = registry.findByPath('GET', '/ncc/campaigns/{campaignId}') || registry.findByPath('GET', '/ncc/campaigns/{nccCampaignId}');
      assert.ok(read, 'pinned campaign read must exist');
      const descriptor = body => ({ operationKey: update.operationKey,
        pathParams: { campaignId: 'cmp-fixture', nccCampaignId: 'cmp-fixture' },
        query: { fields: 'budget' }, body, confirmation: update.confirmation });
      const plan = await write.planService.create({
        customerId, createdBy: 'fixture-planner', reason: 'activation async boundary',
        mutation: descriptor({ nccCampaignId: 'cmp-fixture', dailyBudget: 800, userLock: true }),
        verification: { read: { operationKey: read.operationKey, pathParams: { campaignId: 'cmp-fixture', nccCampaignId: 'cmp-fixture' } }, expectedPatch: { dailyBudget: 800 } },
        rollback: { mutation: descriptor({ nccCampaignId: 'cmp-fixture', userLock: true }), bodyFromBefore: { dailyBudget: 'dailyBudget' } }
      });
      const approval = await write.approvalService.approve(plan.plan_id, { actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE' });
      const input = { customerId, executionToken: approval.executionToken, idempotencyKey: `fixture-${plan.plan_id}` };
      const tokenUsed = async () => (await pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [plan.plan_id])).rows[0].used_at;
      return { activation, write, admin, plan, input, calls, tokenUsed,
        advance: ms => { now += ms; }, failMutation: () => { failMutation = true; },
        execute: () => write.executionService.execute(plan.plan_id, input),
        rollback: () => write.executionService.rollback(plan.plan_id, { confirmation: 'ROLLBACK_SEARCHAD_CHANGE', idempotencyKey: `rollback-${plan.plan_id}` }) };
    }

    for (const scenario of [
      { name: 'missing guard', options: { guard: false }, code: 'SEARCHAD_ACTIVATION_GUARD_NOT_READY' },
      { name: 'absent grant', options: { grant: false }, code: 'SEARCHAD_ACTIVATION_REQUIRED' },
      { name: 'Passive-only grant', options: { evidenceType: 'passive_capability' }, code: 'SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED' },
      { name: 'expired grant', code: 'SEARCHAD_ACTIVATION_REQUIRED', prepare: h => h.advance(60_001) },
      { name: 'suspended account', code: 'SEARCHAD_ACCOUNT_SUSPENDED', prepare: h => h.activation.accountControlService.suspend(h.input.customerId, h.admin) },
      { name: 'credential rotation', code: 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH', prepare: h => { h.activation.guard.credentialFingerprintResolver = async () => 'rotated-fixture'; } },
      { name: 'out-of-scope fields', options: { fieldScope: ['campaign.userLock'] }, code: 'SEARCHAD_ACTIVATION_FIELD_SCOPE_MISMATCH' }
    ]) {
      await t.test(`${scenario.name} rejects before consuming approval or mutating`, async () => {
        const h = await fixture(scenario.options);
        await scenario.prepare?.(h);
        await assert.rejects(h.execute(), { code: scenario.code });
        assert.equal(await h.tokenUsed(), null);
        assert.equal((await h.write.repository.getPlan(h.plan.plan_id)).status, 'approved');
        assert.equal(h.calls.filter(method => method === 'PUT').length, 0);
        const locks = await pool.query('SELECT count(*) AS n FROM searchad_write_locks WHERE plan_id=$1', [h.plan.plan_id]);
        assert.equal(Number(locks.rows[0].n), 0, 'denial must release the async database lock');
      });
    }

    await t.test('resume permits the same unconsumed token once; rollback rechecks suspension', async () => {
      const h = await fixture();
      await h.activation.accountControlService.suspend(h.input.customerId, h.admin);
      await assert.rejects(h.execute(), { code: 'SEARCHAD_ACCOUNT_SUSPENDED' });
      assert.equal(await h.tokenUsed(), null);
      await h.activation.accountControlService.resume(h.input.customerId, h.admin);
      assert.equal((await h.execute()).status, 'applied');
      assert.ok(await h.tokenUsed());
      await assert.rejects(h.execute(), { code: 'SEARCHAD_CHANGE_PLAN_NOT_EXECUTABLE' });
      await h.activation.accountControlService.suspend(h.input.customerId, h.admin);
      await assert.rejects(h.rollback(), { code: 'SEARCHAD_ACCOUNT_SUSPENDED' });
      assert.equal(h.calls.filter(method => method === 'PUT').length, 1);
      assert.equal((await h.write.repository.getPlan(h.plan.plan_id)).status, 'applied');
      await h.activation.accountControlService.resume(h.input.customerId, h.admin);
      assert.equal((await h.rollback()).status, 'rolled_back');
      assert.equal(h.calls.filter(method => method === 'PUT').length, 2);
    });

    await t.test('read-only reconcile remains usable while activation is suspended and mutation is not retried', async () => {
      const h = await fixture();
      h.failMutation();
      await assert.rejects(h.execute(), { code: 'SEARCHAD_UNKNOWN_OUTCOME' });
      await h.activation.accountControlService.suspend(h.input.customerId, h.admin);
      h.write.config.allowWrites = false;
      const result = await h.write.executionService.reconcile(h.plan.plan_id);
      assert.equal(result.status, 'applied_reconciled');
      assert.equal(h.calls.filter(method => method === 'PUT').length, 1);
    });
  } finally {
    for (const runtime of runtimes.reverse()) await runtime.close();
    await closePostgresPool(pool);
    // Only this test-created, UUID-named schema is disposed; no shared tables.
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await closePostgresPool(adminPool);
  }
});
