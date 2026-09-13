import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionSearchAdActivationRuntime } from '../src/naver/searchad/activation/runtime-production.js';
import { bootstrapSearchAdActivationRuntime } from '../src/naver/searchad/activation/bootstrap.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';

function gateway() {
  return {
    status() {
      return { specRef: 'spec-runtime-100', baseUrl: 'https://api.searchad.naver.com' };
    },
    get(operationKey) {
      return {
        operationKey,
        runtimeAllowlisted: true,
        state: 'public_documented',
        tier: 'B'
      };
    }
  };
}

function credentialsRegistry() {
  return {
    listCustomers() {
      return [{ customerId: '100', status: 'active' }];
    },
    resolve(customerId) {
      assert.equal(String(customerId), '100');
      return { customerId: '100', accessLicense: 'license-100', secretKey: 'secret-100' };
    }
  };
}

function capabilityService() {
  return {
    defaultPassiveOperations() { return ['campaign.list']; },
    async runPassive() { return { results: [{ operationKey: 'campaign.list', supported: true, state: 'supported' }] }; }
  };
}

function schemaPool({ missing = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params: structuredClone(params) });
      if (String(sql).includes('to_regclass')) {
        return {
          rows: [{
            evidence: missing === 'evidence' ? null : 'searchad_verification_evidence',
            activations: missing === 'activations' ? null : 'searchad_activation_grants',
            accounts: missing === 'accounts' ? null : 'searchad_canary_accounts',
            account_events: missing === 'account_events' ? null : 'searchad_account_state_events'
          }]
        };
      }
      return { rows: [], rowCount: 1 };
    }
  };
}

test('production activation runtime requires DATABASE_URL or an injected PostgreSQL pool', async () => {
  await assert.rejects(
    createProductionSearchAdActivationRuntime({
      gateway: gateway(),
      credentialsRegistry: credentialsRegistry(),
      capabilityService: capabilityService(),
      env: {}
    }),
    error => error?.code === 'SEARCHAD_ACTIVATION_DATABASE_REQUIRED' && error?.status === 503
  );
});

test('production activation runtime fails closed when gateway, credentials or capability service is missing', async () => {
  const pool = schemaPool();
  await assert.rejects(
    createProductionSearchAdActivationRuntime({ pool, credentialsRegistry: credentialsRegistry(), capabilityService: capabilityService(), env: {} }),
    error => error?.code === 'SEARCHAD_ACTIVATION_GATEWAY_REQUIRED' && error?.status === 503
  );
  await assert.rejects(
    createProductionSearchAdActivationRuntime({ pool, gateway: gateway(), capabilityService: capabilityService(), env: {} }),
    error => error?.code === 'SEARCHAD_ACTIVATION_CREDENTIALS_REQUIRED' && error?.status === 503
  );
  await assert.rejects(
    createProductionSearchAdActivationRuntime({ pool, gateway: gateway(), credentialsRegistry: credentialsRegistry(), env: {} }),
    error => error?.code === 'SEARCHAD_ACTIVATION_CAPABILITY_REQUIRED' && error?.status === 503
  );
});

test('production activation runtime rejects an incomplete 0008 schema before exposing services', async () => {
  await assert.rejects(
    createProductionSearchAdActivationRuntime({
      pool: schemaPool({ missing: 'activations' }),
      gateway: gateway(),
      credentialsRegistry: credentialsRegistry(),
      capabilityService: capabilityService(),
      env: {}
    }),
    error => error?.code === 'SEARCHAD_ACTIVATION_SCHEMA_NOT_READY' && error?.status === 503
  );
});

test('production activation runtime wires PostgreSQL repository and all activation control services', async () => {
  const pool = schemaPool();
  const runtime = await createProductionSearchAdActivationRuntime({
    pool,
    gateway: gateway(),
    credentialsRegistry: credentialsRegistry(),
    capabilityService: capabilityService(),
    env: { ATELIER_SEARCHAD_CANARY_EVIDENCE_TTL_SECONDS: '3600' },
    clock: () => Date.parse('2026-09-11T03:00:00Z')
  });

  const status = runtime.status();
  assert.equal(status.ready, true);
  assert.equal(status.specSha, 'spec-runtime-100');
  assert.equal(status.upstreamBaseUrl, 'https://api.searchad.naver.com');
  assert.deepEqual(status.storage, { runtime: 'postgres', schemaReady: true });
  assert.ok(runtime.repository);
  assert.ok(runtime.passiveEvidenceService);
  assert.ok(runtime.activationService);
  assert.ok(runtime.accountControlService);
  assert.ok(runtime.guard);
  assert.deepEqual(runtime.passiveEvidenceService.targetScope.operationKeys, Object.values(CANARY_OPERATION_KEYS));
  assert.equal(pool.calls.some(call => call.sql.includes('INSERT INTO searchad_canary_accounts')), true);
  await runtime.close();
});

test('bootstrap catches activation startup failure without exposing database or credential details', async () => {
  const messages = [];
  const result = await bootstrapSearchAdActivationRuntime({
    app: {
      searchAdGateway: gateway(),
      searchAdCredentials: credentialsRegistry(),
      searchAdCapabilityService: capabilityService()
    },
    env: {},
    logger: { error(message, data) { messages.push({ message, data }); } }
  });

  assert.equal(result.runtime, null);
  assert.equal(result.startupError.code, 'SEARCHAD_ACTIVATION_DATABASE_REQUIRED');
  assert.equal(result.startupError.message, 'SearchAd activation startup failed; activation remains unavailable.');
  assert.equal(JSON.stringify(result).includes('secret-100'), false);
  assert.equal(JSON.stringify(messages).includes('secret-100'), false);
});
