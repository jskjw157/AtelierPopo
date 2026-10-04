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
import { createProductionActiveCanaryRuntime } from '../src/naver/searchad/canary/runtime-production.js';
import { createProductionSearchAdActivationRuntime } from '../src/naver/searchad/activation/runtime-production.js';
import { createProductionSearchAdWriteRuntime } from '../src/naver/searchad/write/runtime-production.js';

const origin = 'https://api.searchad.naver.com';
const logger = { info() {}, warn() {}, error() {} };

// Real PostgreSQL, production runtimes, signing and account-control service.
// All authority evidence and upstream responses are disposable test fixtures.
test('remaining PostgreSQL writers cannot initiate after committed account suspension', { timeout: 60000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const schema = `test_remaining_fence_${randomUUID().replaceAll('-', '')}`;
  const adminPool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable', logger });
  const runtimes = [];
  let pool, controlPool;
  try {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = createPostgresPool({ connectionString: url.toString(), sslMode: 'disable', logger });
    controlPool = createPostgresPool({ connectionString: url.toString(), sslMode: 'disable', logger });
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));

    async function fixture(canary = false) {
      const customerId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 20)}`).toString();
      const remoteId = `cmp-fixture-${randomUUID()}`;
      const now = Date.parse('2026-09-12T00:00:00Z');
      const credentials = new SearchAdCredentialsRegistry({
        principals: [{ principalId: 'fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
        customers: [{ customerId, status: 'active' }],
        grants: [{ principalId: 'fixture', customerId, role: 'admin' }]
      });
      const config = {
        enabled: true, configured: true, baseUrl: origin, allowReads: true,
        allowWrites: !canary, allowCreates: false, allowDeletes: false,
        allowBatchWrites: false, allowRollbacks: !canary, allowActiveCanary: canary,
        allowUnverifiedOperations: false, automationMode: 'observe', passiveProbeLimit: 20
      };
      let campaign = canary ? null : { nccCampaignId: remoteId, dailyBudget: 1000, userLock: true };
      const calls = [], transportFailures = [];
      const fetchImpl = async (address, init) => {
        const target = new URL(address);
        try {
          assert.equal(target.origin, origin);
          assert.equal(init.headers['X-Customer'], customerId);
          assert.ok(init.headers['X-Signature']);
          assert.ok(['GET', 'POST', 'PUT', 'DELETE'].includes(init.method));
        } catch (error) { transportFailures.push(error.message); throw error; }
        calls.push(init.method);
        let data, status = 200;
        if (init.method === 'POST') campaign = { ...JSON.parse(init.body), nccCampaignId: remoteId };
        if (init.method === 'PUT') campaign = { ...campaign, ...JSON.parse(init.body) };
        if (init.method === 'DELETE') campaign = null;
        if (target.pathname === '/stats') data = { summaryStatResponse: { data: [{ salesAmt: 0 }] } };
        else {
          data = campaign || { code: 'FIXTURE_NOT_FOUND' };
          if (init.method === 'GET' && !campaign) status = 404;
        }
        return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'x-request-id': `fixture-${calls.length}` } });
      };
      const client = new NaverSearchAdClient({ baseUrl: origin, credentialsRegistry: credentials, fetchImpl, maxRetries: 0, clock: () => now, logger });
      const gateway = new SearchAdOperationGateway({ client, registry, credentialsRegistry: credentials, config, logger });
      const activation = await createProductionSearchAdActivationRuntime({ gateway, credentialsRegistry: credentials,
        capabilityService: new SearchAdCapabilityService({ gateway, config }), pool: controlPool, clock: () => now, env: {}, logger });
      runtimes.push(activation);
      const context = { principal: { principalId: 'fixture-admin', role: 'admin', customerIds: [customerId] }, requestId: 'fixture-account-control' };
      const h = { customerId, remoteId, now, credentials, config, gateway, client, fetchImpl, activation, context, calls, transportFailures,
        mutations: () => calls.filter(method => method !== 'GET').length,
        suspend: () => activation.accountControlService.suspend(customerId, context),
        resume: () => activation.accountControlService.resume(customerId, context) };
      if (canary) {
        h.runtime = await createProductionActiveCanaryRuntime({ gateway, credentialsRegistry: credentials, pool, clock: () => now, logger, env: {
          ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true', ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
          ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000', ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
          ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1200', ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '100',
          ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-12', ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-12'
        } });
        const evidenceId = randomUUID();
        await h.runtime.repository.createEvidence({ evidenceId, evidenceType: 'passive_capability', customerId,
          specSha: h.runtime.status().specSha, credentialFingerprint: credentialFingerprintForCustomer(credentials, customerId),
          upstreamBaseUrl: origin, result: 'verified', sourceRunId: 'synthetic-not-live',
          operationKeys: [...h.runtime.recipe.requiredOperationKeys], fieldScope: [...h.runtime.recipe.verifiedOperationScope.fieldScope],
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString() });
        h.execute = () => h.runtime.service.start({ customerId, passiveEvidenceId: evidenceId }, context);
      } else {
        const evidence = await activation.repository.createEvidence({ evidenceId: randomUUID(), evidenceType: 'active_canary', customerId,
          specSha: activation.status().specSha, credentialFingerprint: credentialFingerprintForCustomer(credentials, customerId),
          upstreamBaseUrl: origin, result: 'verified', sourceRunId: 'synthetic-not-live', details: { fixtureOnly: true },
          operationKeys: [CANARY_OPERATION_KEYS.updateCampaign], fieldScope: ['campaign.dailyBudget', 'campaign.userLock'],
          createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString() });
        await activation.activationService.activate({ evidenceId: evidence.evidenceId }, context);
        h.runtime = createProductionSearchAdWriteRuntime({ gateway, postgresPool: pool, activationGuard: activation.guard, clock: () => now, env: {
          ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true', ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
          ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres', ATELIER_SEARCHAD_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_ALLOW_ROLLBACK: 'true'
        } });
        const update = registry.get(CANARY_OPERATION_KEYS.updateCampaign);
        const read = registry.findByPath('GET', '/ncc/campaigns/{campaignId}') || registry.findByPath('GET', '/ncc/campaigns/{nccCampaignId}');
        const pathParams = { campaignId: remoteId, nccCampaignId: remoteId };
        const descriptor = body => ({ operationKey: update.operationKey, pathParams, query: { fields: 'budget' }, body, confirmation: update.confirmation });
        h.plan = await h.runtime.planService.create({ customerId, createdBy: 'fixture-planner', reason: 'remaining send fence',
          mutation: descriptor({ nccCampaignId: remoteId, dailyBudget: 1200, userLock: true }),
          verification: { read: { operationKey: read.operationKey, pathParams }, expectedPatch: { dailyBudget: 1200 } },
          rollback: { mutation: descriptor({ nccCampaignId: remoteId, userLock: true }), bodyFromBefore: { dailyBudget: 'dailyBudget' } } });
        const approval = await h.runtime.approvalService.approve(h.plan.plan_id, { actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE' });
        h.execute = () => h.runtime.executionService.execute(h.plan.plan_id, { customerId, executionToken: approval.executionToken });
        h.rollback = () => h.runtime.executionService.rollback(h.plan.plan_id, { confirmation: 'ROLLBACK_SEARCHAD_CHANGE' });
        h.tokenUsed = async () => (await pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [h.plan.plan_id])).rows[0].used_at;
      }
      runtimes.push(h.runtime);
      return h;
    }

    await t.test('ordinary update: suspension after consumed approval denies PUT and never recycles the token', async () => {
      const h = await fixture();
      const claim = h.runtime.approvalService.claim.bind(h.runtime.approvalService);
      let suspended = false;
      h.runtime.approvalService.claim = async (...args) => { const result = await claim(...args); await h.suspend(); suspended = true; return result; };
      const outcome = await h.execute().catch(error => error);
      assert.equal(suspended, true);
      assert.equal(h.mutations(), 0, 'SUSPEND_COMMITTED_BEFORE_ORDINARY_PUT');
      assert.ok(outcome instanceof Error);
      assert.ok(await h.tokenUsed());
      h.runtime.config.allowWrites = false;
      assert.equal((await h.runtime.executionService.reconcile(h.plan.plan_id)).status, 'not_applied');
      await h.resume(); h.runtime.config.allowWrites = true;
      await assert.rejects(h.execute());
      assert.equal(h.mutations(), 0);
      assert.equal(h.client.fetchImpl, h.fetchImpl, 'shared client must not be monkey-patched');
      assert.deepEqual(h.transportFailures, []);
    });

    await t.test('rollback: suspension after activation check denies the second PUT and preserves read recovery', async () => {
      const h = await fixture();
      assert.equal((await h.execute()).status, 'applied');
      const authorize = h.runtime.executionService.assertActivation.bind(h.runtime.executionService);
      let suspended = false;
      h.runtime.executionService.assertActivation = async (...args) => { await authorize(...args); await h.suspend(); suspended = true; };
      const outcome = await h.rollback().catch(error => error);
      assert.equal(suspended, true);
      assert.equal(h.mutations(), 1, 'SUSPEND_COMMITTED_BEFORE_ROLLBACK_PUT');
      assert.ok(outcome instanceof Error);
      const stored = await h.runtime.repository.getPlan(h.plan.plan_id);
      assert.equal(stored.status, 'rollback_unknown_outcome');
      assert.equal((await h.runtime.executionService.readCurrent(stored)).value.dailyBudget, 1200);
      await h.resume();
      await assert.rejects(h.rollback());
      assert.equal(h.mutations(), 1);
      assert.equal(h.client.fetchImpl, h.fetchImpl);
      assert.deepEqual(h.transportFailures, []);
    });

    for (const [phase, precedingMutations] of [['campaign_create', 0], ['budget_update', 1], ['budget_restore', 2], ['campaign_cleanup', 3]]) {
      await t.test(`0007 Canary ${phase}: committed suspension after intent blocks the next transport entry`, async () => {
        const h = await fixture(true);
        const append = h.runtime.repository.addEvent.bind(h.runtime.repository);
        let suspended = false, runId;
        h.runtime.repository.addEvent = async event => {
          const result = await append(event);
          if (!suspended && event.phase === phase && event.status === 'send_intent') {
            runId = event.canaryRunId;
            await h.suspend(); suspended = true;
          }
          return result;
        };
        const outcome = await h.execute().catch(error => error);
        assert.equal(suspended, true);
        assert.equal(h.mutations(), precedingMutations, `SUSPEND_COMMITTED_BEFORE_CANARY_${phase}`);
        assert.ok(outcome instanceof Error);
        const run = await h.runtime.repository.getRun(runId);
        assert.equal(run.status, 'unknown_outcome');
        assert.equal(run.evidenceId, null);
        if (precedingMutations) {
          assert.equal(run.remoteId, h.remoteId);
          await h.runtime.remote.read(h.runtime.recipe.readCampaign({ customerId: h.customerId, remoteId: run.remoteId }));
        }
        const intents = await pool.query('SELECT phase,status FROM searchad_canary_events WHERE canary_run_id=$1', [runId]);
        assert.equal(intents.rows.filter(row => row.phase === phase && row.status === 'send_intent').length, 1);
        await h.resume();
        await assert.rejects(h.execute(), { code: 'SEARCHAD_CANARY_ALREADY_ACTIVE' });
        assert.equal(h.mutations(), precedingMutations);
        assert.equal(h.config.allowWrites, false); assert.equal(h.config.allowCreates, false); assert.equal(h.config.allowDeletes, false);
        assert.equal(h.client.fetchImpl, h.fetchImpl);
        assert.deepEqual(h.transportFailures, []);
      });
    }
  } finally {
    for (const runtime of runtimes.reverse()) await runtime.close();
    await closePostgresPool(pool); await closePostgresPool(controlPool);
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await closePostgresPool(adminPool);
  }
});
