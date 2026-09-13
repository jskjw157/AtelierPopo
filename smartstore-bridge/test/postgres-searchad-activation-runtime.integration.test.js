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

const logger = { info() {}, warn() {}, error() {} };
const origin = 'https://api.searchad.naver.com';

// Real PostgreSQL, pinned registry, credential resolution, signed client, gateway,
// Passive issuer, activation service and guard. Only upstream GET responses are fake.
// This does NOT claim integration with the async write executor or HTTP entrypoint.
test('0008 PostgreSQL runtime persists server-issued Passive evidence, scopes activation and preserves suspension across runtime reconstruction', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const customerId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 20)}`).toString();
  let now = Date.parse('2026-09-12T00:00:00Z');
  const calls = [];
  const pools = [];
  const runtimes = [];
  const makePool = () => {
    const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable', logger });
    pools.push(pool);
    return pool;
  };
  try {
    const pool = makePool();
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
    const makeCredentials = (secretKey = 'fixture-secret') => new SearchAdCredentialsRegistry({
      principals: [{ principalId: 'activation-fixture', accessLicense: 'fixture-license', secretKey, status: 'active' }],
      customers: [{ customerId, status: 'active' }],
      grants: [{ principalId: 'activation-fixture', customerId, role: 'admin' }]
    });
    const config = {
      enabled: true, configured: true, baseUrl: origin, allowReads: true,
      allowWrites: false, allowCreates: false, allowDeletes: false, allowBatchWrites: false,
      allowRollbacks: false, allowActiveCanary: false, allowUnverifiedOperations: false,
      automationMode: 'observe', passiveProbeLimit: 20
    };
    const fetchImpl = async (url, init) => {
      assert.equal(new URL(url).origin, origin);
      assert.equal(init.method, 'GET', 'this integration test must never send a mutation');
      assert.equal(init.headers['X-Customer'], customerId);
      assert.ok(init.headers['X-Signature'], 'the production signer must be used');
      calls.push({ method: init.method, path: new URL(url).pathname });
      return new Response(JSON.stringify([]), { status: 200, headers: {
        'content-type': 'application/json', 'x-request-id': `fixture-passive-${calls.length}`
      } });
    };
    const buildRuntime = async (credentialsRegistry, targetPool) => {
      const client = new NaverSearchAdClient({ baseUrl: origin, credentialsRegistry, fetchImpl, maxRetries: 0, logger });
      const gateway = new SearchAdOperationGateway({ client, config, registry, credentialsRegistry, logger });
      const capabilityService = new SearchAdCapabilityService({ gateway, config, clock: () => new Date(now) });
      const runtime = await createProductionSearchAdActivationRuntime({
        gateway, credentialsRegistry, capabilityService, pool: targetPool,
        clock: () => now, env: {}, logger
      });
      runtimes.push(runtime);
      return runtime;
    };
    const credentials = makeCredentials();
    const runtime = await buildRuntime(credentials, pool);
    const admin = { principal: { principalId: 'fixture-admin', role: 'admin', customerIds: [customerId] }, requestId: 'fixture-admin-request' };
    const operator = { principal: { principalId: 'fixture-operator', role: 'operator', customerIds: [customerId] }, requestId: 'fixture-probe-request' };
    const reader = { principal: { principalId: 'fixture-reader', role: 'reader', customerIds: [customerId] } };
    const descriptor = {
      operationKey: CANARY_OPERATION_KEYS.updateCampaign, pathParams: { campaignId: 'fixture-campaign' },
      query: { fields: 'budget' }, body: { nccCampaignId: 'fixture-campaign', dailyBudget: 1000, userLock: true }
    };
    const check = current => current.guard.assertMutationAllowed({ customerId, descriptor });
    assert.equal(runtime.status().ready, true);
    await assert.rejects(check(runtime), { code: 'SEARCHAD_ACTIVATION_REQUIRED' });
    await assert.rejects(runtime.passiveEvidenceService.issue({ customerId }, reader), { code: 'SEARCHAD_OPERATOR_REQUIRED' });
    await assert.rejects(runtime.passiveEvidenceService.issue({ customerId, passed: true }, operator), { code: 'SEARCHAD_PASSIVE_EVIDENCE_INPUT_INVALID' });
    assert.equal(calls.length, 0);

    const passive = await runtime.passiveEvidenceService.issue({ customerId }, operator);
    assert.equal(passive.result, 'verified');
    assert.equal(passive.evidenceType, 'passive_capability');
    assert.equal(passive.createdByPrincipalId, operator.principal.principalId);
    assert.equal(passive.sourceRequestId, operator.requestId);
    assert.ok(calls.length > 0);
    assert.ok(passive.details.probeOperations.every(item => item.supported && item.requestId));
    const probeCallCount = calls.length;
    await assert.rejects(runtime.activationService.activate({ evidenceId: passive.evidenceId }, operator), { code: 'SEARCHAD_ADMIN_REQUIRED' });
    const passiveGrant = await runtime.activationService.activate({ evidenceId: passive.evidenceId }, admin);
    assert.equal(passiveGrant.credentialFingerprint, undefined);
    assert.deepEqual(passiveGrant.operationKeys, passive.operationKeys);
    assert.equal((await runtime.activationService.activate({ evidenceId: passive.evidenceId }, admin)).activationId, passiveGrant.activationId);
    await assert.rejects(check(runtime), { code: 'SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED' });

    // Synthetic Active evidence is inserted ONLY in the isolated test database to
    // exercise guard logic. It is not live Canary evidence and never leaves this test.
    now += 1000;
    const active = await runtime.repository.createEvidence({
      evidenceId: randomUUID(), evidenceType: 'active_canary', customerId,
      specSha: runtime.status().specSha, upstreamBaseUrl: origin,
      credentialFingerprint: credentialFingerprintForCustomer(credentials, customerId),
      operationKeys: [CANARY_OPERATION_KEYS.updateCampaign],
      fieldScope: ['campaign.dailyBudget', 'campaign.userLock'], result: 'verified',
      sourceRunId: 'fixture-not-live', details: { fixtureOnly: true },
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString()
    });
    const activeGrant = await runtime.activationService.activate({ evidenceId: active.evidenceId }, admin);
    assert.equal((await check(runtime)).activationId, activeGrant.activationId);
    await assert.rejects(runtime.guard.assertMutationAllowed({ customerId, descriptor: { ...descriptor, operationKey: CANARY_OPERATION_KEYS.createCampaign } }),
      { code: 'SEARCHAD_LIFECYCLE_ACTIVATION_REQUIRED' });
    await assert.rejects(runtime.guard.assertMutationAllowed({ customerId, descriptor: { ...descriptor, body: { ...descriptor.body, name: 'unmapped' } } }),
      { code: 'SEARCHAD_ACTIVATION_FIELD_MAPPING_UNKNOWN' });
    await assert.rejects(runtime.accountControlService.suspend(customerId, operator), { code: 'SEARCHAD_ADMIN_REQUIRED' });
    await runtime.accountControlService.suspend(customerId, admin);
    await runtime.accountControlService.suspend(customerId, admin);
    await assert.rejects(check(runtime), { code: 'SEARCHAD_ACCOUNT_SUSPENDED' });

    const restartedPool = makePool();
    const restarted = await buildRuntime(credentials, restartedPool);
    assert.equal((await restarted.repository.getAccount(customerId)).suspended, true, 'runtime reconstruction must not reset suspension');
    assert.equal((await restarted.repository.getEvidence(passive.evidenceId)).sourceRequestId, operator.requestId);
    await assert.rejects(check(restarted), { code: 'SEARCHAD_ACCOUNT_SUSPENDED' });
    await restarted.accountControlService.resume(customerId, admin);
    assert.equal((await check(restarted)).activationId, activeGrant.activationId);
    const events = await restartedPool.query('SELECT action, actor_principal_id, request_id FROM searchad_account_state_events WHERE customer_id=$1 ORDER BY action DESC', [customerId]);
    assert.equal(events.rows.length, 2, 'repeated same-state request must not create another event');
    assert.deepEqual(events.rows.map(row => row.action), ['suspend', 'resume']);
    assert.ok(events.rows.every(row => row.actor_principal_id === admin.principal.principalId && row.request_id === admin.requestId));

    const rotated = await buildRuntime(makeCredentials('fixture-rotated-secret'), restartedPool);
    await assert.rejects(check(rotated), { code: 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' });
    assert.equal(calls.length, probeCallCount, 'activation and guard checks must not issue upstream calls');
    assert.ok(calls.every(call => call.method === 'GET'));
    for (const key of ['allowWrites', 'allowCreates', 'allowDeletes', 'allowBatchWrites', 'allowRollbacks', 'allowActiveCanary']) {
      assert.equal(config[key], false, `${key} must remain off`);
    }
    now = Date.parse(active.expiresAt) + 1;
    await assert.rejects(check(restarted), { code: 'SEARCHAD_ACTIVATION_REQUIRED' });
  } finally {
    for (const runtime of runtimes) await runtime.close();
    for (const pool of pools) await closePostgresPool(pool);
  }
});
