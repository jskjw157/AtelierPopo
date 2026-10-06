import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { createProductionActiveCanaryRuntime } from '../src/naver/searchad/canary/runtime-production.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { PostgresActiveCanaryRepository } from '../src/naver/searchad/canary/postgres-repository.js';

const logger = { info() {}, warn() {}, error() {} };
const origin = 'https://api.searchad.naver.com';

// Only the upstream fetch boundary is simulated. PostgreSQL, repository, pinned
// registry, credentials, signing client, gateway, adapter, recipe and service are real.
// Removing executeCanary or breaking its descriptor/response contract fails this test.
test('PostgreSQL Canary runtime executes the pinned stopped-campaign recipe through the real signed gateway', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const customerId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 20)}`).toString();
  const evidenceId = `wiring-${randomUUID()}`;
  const remoteId = `cmp-fixture-${randomUUID()}`;
  const now = Date.parse('2026-09-12T00:00:00Z');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable', logger });
  let runtime;
  try {
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
    const credentialsRegistry = new SearchAdCredentialsRegistry({
      principals: [{ principalId: 'canary-fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
      customers: [{ customerId, status: 'active' }],
      grants: [{ principalId: 'canary-fixture', customerId, role: 'admin' }]
    });
    const calls = [];
    let campaign = null;
    const fetchImpl = async (url, init) => {
      const address = new URL(url);
      assert.equal(address.origin, origin);
      assert.equal(init.headers['X-Customer'], customerId);
      assert.ok(init.headers['X-Signature'], 'production signing must run');
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ method: init.method, path: address.pathname, query: address.searchParams.toString(), body });
      let data;
      let status = 200;
      if (init.method === 'POST' && address.pathname === '/ncc/campaigns') {
        assert.equal(campaign, null);
        assert.equal(body.userLock, true);
        assert.equal(body.campaignTp, 'WEB_SITE');
        assert.equal(body.dailyBudget, 1000);
        campaign = { ...body, nccCampaignId: remoteId };
        data = campaign;
      } else if (init.method === 'GET' && address.pathname === '/stats') {
        assert.equal(address.searchParams.get('id'), remoteId);
        assert.deepEqual(JSON.parse(address.searchParams.get('fields')), ['salesAmt']);
        data = { summaryStatResponse: { data: [{ salesAmt: 0 }] } };
      } else {
        assert.equal(address.pathname, `/ncc/campaigns/${remoteId}`, 'all object operations must use the returned ID');
        if (init.method === 'PUT') {
          assert.equal(body.nccCampaignId, remoteId);
          assert.equal(body.userLock, true);
          assert.equal(address.searchParams.get('fields'), 'budget');
          assert.ok(campaign);
          campaign = { ...campaign, ...body };
          data = campaign;
        } else if (init.method === 'DELETE') {
          assert.ok(campaign);
          assert.equal(campaign.dailyBudget, 1000, 'restore must precede cleanup');
          campaign = null;
          data = {};
        } else {
          assert.equal(init.method, 'GET');
          status = campaign ? 200 : 404;
          data = campaign || { code: 'FIXTURE_NOT_FOUND', message: 'Fixture campaign was deleted' };
        }
      }
      return new Response(JSON.stringify(data), { status, headers: {
        'content-type': 'application/json', 'x-request-id': `fixture-request-${calls.length}`
      } });
    };
    const config = {
      enabled: true, configured: true, baseUrl: origin,
      allowReads: true, allowWrites: false, allowCreates: false, allowDeletes: false,
      allowBatchWrites: false, allowRollbacks: false, allowUnverifiedOperations: false,
      allowActiveCanary: true, automationMode: 'observe'
    };
    const client = new NaverSearchAdClient({ baseUrl: origin, credentialsRegistry, fetchImpl, maxRetries: 0, logger, clock: () => now });
    const gateway = new SearchAdOperationGateway({ client, config, registry, credentialsRegistry, logger });
    runtime = await createProductionActiveCanaryRuntime({
      gateway, credentialsRegistry, pool, clock: () => now, logger,
      env: {
        ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true',
        ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
        ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000',
        ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
        ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1200',
        ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '100',
        ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-12',
        ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-12'
      }
    });
    assert.equal(runtime.status().ready, true);
    assert.equal(runtime.status().storage.runtime, 'postgres');
    const create = runtime.recipe.createCampaign({ customerId, canaryRunId: 'fixture' });
    await assert.rejects(gateway.execute(create.operationKey, {
      ...create, confirmation: registry.get(create.operationKey).confirmation,
      executionPurpose: 'active_canary', allowActiveCanary: true
    }), { code: 'SEARCHAD_GATE_DISABLED' });
    const context = { principal: { principalId: 'fixture-admin', role: 'admin', customerIds: [customerId] } };
    await assert.rejects(runtime.service.start({ customerId, passiveEvidenceId: evidenceId }, {
      principal: { ...context.principal, role: 'reader' }
    }), { code: 'SEARCHAD_CANARY_ADMIN_REQUIRED' });
    await assert.rejects(runtime.service.start({ customerId, passiveEvidenceId: evidenceId, remoteId: 'victim' }, context),
      { code: 'SEARCHAD_CANARY_INPUT_INVALID' });
    await assert.rejects(runtime.service.start({ customerId, passiveEvidenceId: evidenceId }, context),
      { code: 'SEARCHAD_CANARY_EVIDENCE_MISMATCH' });
    assert.equal(calls.length, 0, 'unverified input must never reach the simulated upstream');

    // Fixture evidence exists only in the CI database, not an account validation claim.
    await runtime.repository.createEvidence({
      evidenceId, evidenceType: 'passive_capability', customerId,
      specSha: runtime.status().specSha,
      credentialFingerprint: credentialFingerprintForCustomer(credentialsRegistry, customerId),
      upstreamBaseUrl: origin, result: 'verified', sourceRunId: 'fixture-probe',
      operationKeys: [...runtime.recipe.requiredOperationKeys],
      fieldScope: [...runtime.recipe.verifiedOperationScope.fieldScope],
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86400000).toISOString()
    });
    const run = await runtime.service.start({ customerId, passiveEvidenceId: evidenceId }, context);
    assert.equal(run.status, 'spend_check_pending');
    assert.equal(run.remoteId, remoteId);
    assert.equal(run.beforeSpend, 0);
    assert.equal(run.evidenceId, null, 'execution alone must not issue active verification evidence');
    assert.ok(run.cleanupVerifiedAt);
    assert.equal(campaign, null);
    assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'GET', 'PUT', 'GET', 'PUT', 'GET', 'DELETE', 'GET']);
    assert.deepEqual(calls.filter(call => call.method === 'PUT').map(call => call.body.dailyBudget), [1100, 1000]);
    const restarted = new PostgresActiveCanaryRepository({ pool });
    assert.equal((await restarted.getRun(run.canaryRunId)).status, 'spend_check_pending');
    assert.equal((await restarted.listObjects(run.canaryRunId))[0].cleanupStatus, 'deleted_verified');
    const events = await pool.query('SELECT phase,status,request_id FROM searchad_canary_events WHERE canary_run_id=$1', [run.canaryRunId]);
    assert.equal(events.rows.filter(row => row.status === 'remote_accepted').length, 4);
    assert.ok(events.rows.filter(row => row.status === 'remote_accepted').every(row => row.request_id));
    assert.equal(config.allowWrites, false);
    assert.equal(config.allowCreates, false);
    assert.equal(config.allowDeletes, false);
  } finally {
    await runtime?.close();
    await closePostgresPool(pool);
  }
});
