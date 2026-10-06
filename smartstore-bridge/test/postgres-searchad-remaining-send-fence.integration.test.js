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
      let loseResponseAtMutation = null;
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
        if (init.method !== 'GET' && calls.filter(method => method !== 'GET').length === loseResponseAtMutation) {
          loseResponseAtMutation = null;
          throw Object.assign(new Error('Fixture response lost after signed mutation entry'), { code: 'ECONNRESET' });
        }
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
        capabilityService: new SearchAdCapabilityService({ gateway, config }), pool, clock: () => now, env: {}, logger });
      // The writer and activation share the authoritative pool binding. Account
      // suspension still commits through a separate real control connection.
      const control = await createProductionSearchAdActivationRuntime({ gateway, credentialsRegistry: credentials,
        capabilityService: new SearchAdCapabilityService({ gateway, config }), pool: controlPool, clock: () => now, env: {}, logger });
      runtimes.push(activation, control);
      assert.equal(activation.repository.pool, pool);
      assert.notEqual(control.repository.pool, pool);
      const context = { principal: { principalId: 'fixture-admin', role: 'admin', customerIds: [customerId] }, requestId: 'fixture-account-control' };
      const h = { customerId, remoteId, now, credentials, config, gateway, client, fetchImpl, activation, context, calls, transportFailures,
        mutations: () => calls.filter(method => method !== 'GET').length,
        suspend: () => control.accountControlService.suspend(customerId, context),
        resume: () => control.accountControlService.resume(customerId, context),
        loseResponseAfterMutation: number => { loseResponseAtMutation = number; },
        authoritySnapshot: () => Promise.all(['searchad_daily_risk_capacity', 'searchad_risk_reservations', 'searchad_verification_evidence']
          .map(table => pool.query(`SELECT * FROM ${table} WHERE customer_id=$1`, [customerId]).then(result => result.rows))) };
      if (canary) {
        const openCanary = () => createProductionActiveCanaryRuntime({ gateway, credentialsRegistry: credentials, pool, clock: () => now, logger, env: {
          ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true', ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
          ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000', ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
          ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1200', ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '100',
          ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-12', ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-12'
        } });
        h.runtime = await openCanary();
        h.restart = async () => { await h.runtime.close(); h.runtime = await openCanary(); runtimes.push(h.runtime); };
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
        const openWriter = () => createProductionSearchAdWriteRuntime({ gateway, postgresPool: pool, activationGuard: activation.guard, clock: () => now, env: {
          ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true', ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
          ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres', ATELIER_SEARCHAD_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_ALLOW_ROLLBACK: 'true'
        } });
        h.runtime = openWriter();
        h.restart = async () => { await h.runtime.close(); h.runtime = openWriter(); runtimes.push(h.runtime); };
        const update = registry.get(CANARY_OPERATION_KEYS.updateCampaign);
        const read = registry.findByPath('GET', '/ncc/campaigns/{campaignId}') || registry.findByPath('GET', '/ncc/campaigns/{nccCampaignId}');
        const pathParams = { campaignId: remoteId, nccCampaignId: remoteId };
        const descriptor = body => ({ operationKey: update.operationKey, pathParams, query: { fields: 'budget' }, body, confirmation: update.confirmation });
        h.plan = await h.runtime.planService.create({ customerId, createdBy: 'fixture-planner', reason: 'remaining send fence',
          mutation: descriptor({ nccCampaignId: remoteId, dailyBudget: 900, userLock: true }),
          verification: { read: { operationKey: read.operationKey, pathParams }, expectedPatch: { dailyBudget: 900 } },
          rollback: { mutation: descriptor({ nccCampaignId: remoteId, userLock: true }), bodyFromBefore: { dailyBudget: 'dailyBudget' } } });
        const approval = await h.runtime.approvalService.approve(h.plan.plan_id, { actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE' });
        h.execute = () => h.runtime.executionService.execute(h.plan.plan_id, { customerId, executionToken: approval.executionToken });
        h.rollback = () => h.runtime.executionService.rollback(h.plan.plan_id, { confirmation: 'ROLLBACK_SEARCHAD_CHANGE' });
        h.tokenUsed = async () => (await pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [h.plan.plan_id])).rows[0].used_at;
      }
      runtimes.push(h.runtime);
      return h;
    }

    await t.test('ordinary update: suspension after consumed approval is a known failure with no token reuse', async () => {
      const h = await fixture();
      const claim = h.runtime.approvalService.claim.bind(h.runtime.approvalService);
      let suspended = false;
      h.runtime.approvalService.claim = async (...args) => { const result = await claim(...args); await h.suspend(); suspended = true; return result; };
      await assert.rejects(h.execute(), { code: 'SEARCHAD_SEND_FENCE_SUSPENDED', status: 403 });
      assert.equal(suspended, true);
      assert.equal(h.mutations(), 0, 'SUSPEND_COMMITTED_BEFORE_ORDINARY_PUT');
      const consumedAt = await h.tokenUsed();
      assert.ok(consumedAt);
      await h.restart();
      h.runtime.config.allowWrites = false;
      const stored = await h.runtime.planService.get(h.plan.plan_id);
      assert.equal(stored.status, 'failed');
      assert.equal(stored.last_error_json.code, 'SEARCHAD_SEND_FENCE_SUSPENDED');
      assert.deepEqual(stored.attempts.filter(row => row.phase === 'execute').map(row => [row.status, row.error_json.code]),
        [['failed', 'SEARCHAD_SEND_FENCE_SUSPENDED']]);
      const beforeReconcile = h.calls.length;
      await assert.rejects(h.runtime.executionService.reconcile(h.plan.plan_id), {
        code: 'SEARCHAD_CHANGE_PLAN_NOT_RECONCILABLE', status: 409, details: { planId: h.plan.plan_id, status: 'failed' }
      });
      assert.equal(h.calls.length, beforeReconcile, 'known local failure requires no recovery transport');
      assert.equal((await h.runtime.executionService.readCurrent(stored)).value.dailyBudget, 1000);
      assert.deepEqual(h.calls.slice(beforeReconcile), ['GET'], 'independent observation survives suspension and writes OFF');
      await h.resume();
      await h.restart();
      const beforeReplay = h.calls.length;
      await assert.rejects(h.execute(), { code: 'SEARCHAD_CHANGE_PLAN_NOT_EXECUTABLE', status: 409 });
      assert.equal(h.calls.length, beforeReplay);
      assert.deepEqual(await h.tokenUsed(), consumedAt);
      assert.equal(h.mutations(), 0);
      assert.equal(h.client.fetchImpl, h.fetchImpl, 'shared client must not be monkey-patched');
      assert.deepEqual(h.transportFailures, []);
    });

    await t.test('rollback: suspension after activation check is a known failure with one durable intent', async () => {
      const h = await fixture();
      const applied = await h.execute();
      assert.equal(applied.status, 'applied');
      assert.equal(applied.applied_after_json.dailyBudget, 900);
      const consumedAt = await h.tokenUsed();
      const authorize = h.runtime.executionService.assertActivation.bind(h.runtime.executionService);
      let suspended = false;
      h.runtime.executionService.assertActivation = async (...args) => { await authorize(...args); await h.suspend(); suspended = true; };
      await assert.rejects(h.rollback(), { code: 'SEARCHAD_SEND_FENCE_SUSPENDED', status: 403 });
      assert.equal(suspended, true);
      assert.equal(h.mutations(), 1, 'SUSPEND_COMMITTED_BEFORE_ROLLBACK_PUT');
      await h.restart();
      h.runtime.config.allowWrites = false;
      const stored = await h.runtime.planService.get(h.plan.plan_id);
      assert.equal(stored.status, 'rollback_failed');
      assert.equal(stored.last_error_json.code, 'SEARCHAD_SEND_FENCE_SUSPENDED');
      assert.equal(stored.applied_after_hash, applied.applied_after_hash);
      const rollbackAttempts = stored.attempts.filter(row => row.phase === 'rollback');
      assert.equal(rollbackAttempts.filter(row => row.status === 'send_intent').length, 1);
      assert.equal(rollbackAttempts.filter(row => row.status === 'rollback_failed' && row.error_json.code === 'SEARCHAD_SEND_FENCE_SUSPENDED').length, 1);
      assert.equal(rollbackAttempts.length, 2);
      const beforeRead = h.calls.length;
      await assert.rejects(h.runtime.executionService.reconcile(h.plan.plan_id), {
        code: 'SEARCHAD_CHANGE_PLAN_NOT_RECONCILABLE', status: 409, details: { planId: h.plan.plan_id, status: 'rollback_failed' }
      });
      assert.equal(h.calls.length, beforeRead);
      assert.equal((await h.runtime.executionService.readCurrent(stored)).value.dailyBudget, 900);
      assert.deepEqual(h.calls.slice(beforeRead), ['GET']);
      await h.resume();
      await h.restart();
      const beforeReplay = h.calls.length;
      await assert.rejects(h.rollback(), { code: 'SEARCHAD_CHANGE_PLAN_NOT_ROLLBACKABLE', status: 409 });
      assert.equal(h.calls.length, beforeReplay);
      assert.deepEqual((await h.runtime.repository.listAttempts(h.plan.plan_id)).filter(row => row.phase === 'rollback'), rollbackAttempts);
      assert.deepEqual(await h.tokenUsed(), consumedAt);
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
        const authorityBefore = await h.authoritySnapshot();
        await assert.rejects(h.execute(), { code: 'SEARCHAD_SEND_FENCE_SUSPENDED', status: 403 });
        assert.equal(suspended, true);
        assert.equal(h.mutations(), precedingMutations, `SUSPEND_COMMITTED_BEFORE_CANARY_${phase}`);
        await h.restart();
        const run = await h.runtime.repository.getRun(runId);
        assert.equal(run.status, 'failed');
        assert.equal(run.lastError.code, 'SEARCHAD_SEND_FENCE_SUSPENDED');
        assert.equal(run.evidenceId, null);
        assert.equal(run.cleanupVerifiedAt, null);
        const events = (await pool.query('SELECT * FROM searchad_canary_events WHERE canary_run_id=$1 ORDER BY event_id', [runId])).rows;
        const intents = events.filter(row => row.phase === phase && row.status === 'send_intent');
        const failed = events.filter(row => row.phase === phase && row.status === 'failed');
        assert.equal(intents.length, 1);
        assert.equal(failed.length, 1);
        assert.equal(failed[0].customer_id, h.customerId);
        assert.equal(failed[0].operation_key, intents[0].operation_key, 'atomic primary failure is linked to the exact consumed phase');
        assert.equal(failed[0].error_json.code, 'SEARCHAD_SEND_FENCE_SUSPENDED');
        assert.equal(events.filter(row => row.phase === phase).length, 2, 'denied phase has no remote acceptance or invented unknown');
        assert.equal(events.filter(row => row.status === 'remote_accepted').length, precedingMutations);
        const beforeRead = h.calls.length;
        await assert.rejects(h.runtime.service.reconcile(runId, h.context), {
          code: 'SEARCHAD_CANARY_RECONCILE_NOT_ALLOWED', status: 409, details: { status: 'failed' }
        });
        await assert.rejects(h.runtime.service.cleanup(runId, h.context), { code: 'SEARCHAD_CANARY_CLEANUP_NOT_ALLOWED', status: 409 });
        assert.equal(h.calls.length, beforeRead);
        if (precedingMutations) {
          assert.equal(run.remoteId, h.remoteId);
          const observed = await h.runtime.remote.read(h.runtime.recipe.readCampaign({ customerId: h.customerId, remoteId: run.remoteId }));
          assert.equal(observed.data.dailyBudget, phase === 'budget_restore' ? 1100 : 1000);
          assert.deepEqual(h.calls.slice(beforeRead), ['GET']);
        } else {
          assert.equal(run.remoteId, null, 'no guessed remote ID is introduced for an unsent create');
        }
        await h.resume();
        await h.restart();
        const beforeReplay = h.calls.length;
        // start() allocates a new run; it is not reuse of this failed run's intent.
        await assert.rejects(h.runtime.service.cleanup(runId, h.context), { code: 'SEARCHAD_CANARY_CLEANUP_NOT_ALLOWED', status: 409 });
        await assert.rejects(h.runtime.service.reconcile(runId, h.context), { code: 'SEARCHAD_CANARY_RECONCILE_NOT_ALLOWED', status: 409 });
        assert.equal(h.calls.length, beforeReplay);
        assert.deepEqual((await pool.query('SELECT * FROM searchad_canary_events WHERE canary_run_id=$1 ORDER BY event_id', [runId])).rows, events);
        assert.deepEqual(await h.runtime.repository.getRun(runId), run);
        assert.deepEqual(await h.authoritySnapshot(), authorityBefore, 'local denial and reads cannot refund risk or mint PASS/evidence');
        assert.equal(h.mutations(), precedingMutations);
        assert.equal(h.config.allowWrites, false); assert.equal(h.config.allowCreates, false); assert.equal(h.config.allowDeletes, false);
        assert.equal(h.client.fetchImpl, h.fetchImpl);
        assert.deepEqual(h.transportFailures, []);
      });
    }
    for (const [phase, mutationCount] of [['budget_update', 2], ['campaign_cleanup', 4]]) {
      await t.test(`0007 Canary ${phase}: actual signed response loss remains ambiguous and restart recovery is GET-only`, async () => {
        const h = await fixture(true);
        const authorityBefore = await h.authoritySnapshot();
        h.loseResponseAfterMutation(mutationCount);
        const outcome = await h.execute().catch(error => error);
        assert.equal(outcome.code, 'SEARCHAD_CANARY_UNKNOWN_OUTCOME');
        assert.equal(outcome.status, 409);
        assert.equal(outcome.details.phase, phase);
        const runId = outcome.details.canaryRunId;
        const run = await h.runtime.repository.getRun(runId);
        assert.equal(run.status, 'unknown_outcome');
        assert.equal(run.lastError.code, 'SEARCHAD_NETWORK_ERROR');
        assert.equal(run.remoteId, h.remoteId);
        assert.equal(run.evidenceId, null);
        assert.equal(h.mutations(), mutationCount, 'ambiguity begins after the real signed fetch entry');
        const phaseEvents = async () => (await pool.query(
          'SELECT * FROM searchad_canary_events WHERE canary_run_id=$1 AND phase=$2 ORDER BY event_id', [runId, phase])).rows;
        const events = await phaseEvents();
        const intent = events.find(row => row.status === 'send_intent');
        const unknown = events.find(row => row.status === 'unknown_outcome');
        assert.equal(events.length, 2);
        assert.ok(intent);
        assert.equal(unknown.operation_key, intent.operation_key);
        assert.equal(unknown.error_json.code, 'SEARCHAD_NETWORK_ERROR');
        await h.runtime.service.circuitGuard.pause({ customerId: h.customerId, reason: 'response loss recovery fixture' }, h.context);
        await h.suspend();
        await h.restart();
        const beforeRead = h.calls.length;
        const recovered = await h.runtime.service.reconcile(runId, h.context);
        assert.equal(recovered.status, phase === 'campaign_cleanup' ? 'spend_check_pending' : 'unknown_outcome');
        assert.equal(recovered.evidenceId, null);
        assert.deepEqual(h.calls.slice(beforeRead), ['GET']);
        assert.equal((await h.runtime.repository.getAccount(h.customerId)).suspended, true);
        assert.equal((await h.runtime.service.circuitGuard.status({ customerId: h.customerId }, h.context)).state.manualPaused, true);
        await h.resume();
        await h.restart();
        const beforeReplay = h.calls.length;
        await assert.rejects(h.execute(), { code: 'SEARCHAD_CANARY_ALREADY_ACTIVE', status: 409 });
        await assert.rejects(h.runtime.service.cleanup(runId, h.context), { code: 'SEARCHAD_CANARY_CLEANUP_NOT_ALLOWED', status: 409 });
        assert.equal(h.calls.length, beforeReplay);
        assert.deepEqual(await phaseEvents(), events, 'recovery never recreates or consumes another mutation intent');
        assert.deepEqual(await h.authoritySnapshot(), authorityBefore, 'observational recovery cannot refund risk or mint PASS/evidence');
        assert.equal(h.mutations(), mutationCount);
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
