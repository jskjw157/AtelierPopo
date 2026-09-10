import test from 'node:test';
import assert from 'node:assert/strict';

import { loadActiveCanaryConfig } from '../src/naver/searchad/canary/config.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { ActiveCanaryGatewayRemoteAdapter } from '../src/naver/searchad/canary/remote-adapter.js';
import { createProductionActiveCanaryRuntime } from '../src/naver/searchad/canary/runtime-production.js';

function enabledEnv(overrides = {}) {
  return {
    ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true',
    ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
    ATELIER_SEARCHAD_CANARY_OBSERVATION_SECONDS: '172800',
    ATELIER_SEARCHAD_CANARY_EVIDENCE_TTL_SECONDS: '86400',
    ATELIER_SEARCHAD_CANARY_MAX_SPEND_KRW: '0',
    ATELIER_SEARCHAD_CANARY_MAX_CONCURRENT_PER_CUSTOMER: '1',
    ATELIER_SEARCHAD_CANARY_MAX_OBJECTS: '4',
    ATELIER_SEARCHAD_CANARY_MAX_MUTATIONS: '12',
    ATELIER_SEARCHAD_CANARY_TTL_SECONDS: '3600',
    ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000',
    ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
    ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1200',
    ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '100',
    ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-10',
    ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-10',
    DATABASE_URL: 'postgresql://fixture.invalid/atelier',
    ATELIER_POSTGRES_SSL_MODE: 'disable',
    ...overrides
  };
}

function fakePool({ schemaReady = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params: structuredClone(params) });
      if (/to_regclass/i.test(String(sql))) {
        return {
          rows: [{
            accounts: schemaReady ? 'searchad_canary_accounts' : null,
            evidence: schemaReady ? 'searchad_verification_evidence' : null,
            runs: schemaReady ? 'searchad_canary_runs' : null,
            objects: schemaReady ? 'searchad_canary_objects' : null,
            events: schemaReady ? 'searchad_canary_events' : null
          }]
        };
      }
      if (/insert into searchad_canary_accounts/i.test(String(sql))) {
        return { rows: [{ customer_id: String(params[0]), suspended: false, updated_at: new Date('2026-09-10T00:00:00Z') }] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
}

function fakeCredentials() {
  return {
    resolve(customerId) {
      assert.equal(String(customerId), '123');
      return {
        principalId: 'principal-a',
        accessLicense: 'access-license-fixture',
        secretKey: 'secret-fixture-rotates',
        customerId: '123',
        role: 'admin'
      };
    },
    listCustomers() {
      return [{ customerId: '123', principalId: 'principal-a', role: 'admin', status: 'active' }];
    }
  };
}

function operation(operationKey, overrides = {}) {
  const action = operationKey.includes('.delete.') ? 'delete' : operationKey.includes('.post.') ? 'create' : operationKey.includes('.put.') ? 'update' : 'read';
  return {
    operationKey,
    method: action === 'delete' ? 'DELETE' : action === 'create' ? 'POST' : action === 'update' ? 'PUT' : 'GET',
    path: action === 'create' ? '/ncc/campaigns' : action === 'read' ? '/ncc/campaigns/{campaignId}' : '/ncc/campaigns/{campaignId}',
    domain: 'campaign',
    action,
    sideEffect: action !== 'read',
    destructive: action === 'delete',
    batch: false,
    runtimeAllowlisted: true,
    tier: 'B',
    requiredGate: action === 'delete' ? 'deletes' : action === 'create' ? 'creates' : action === 'update' ? 'writes' : 'reads',
    confirmation: action === 'delete' ? 'DELETE_AD_ENTITY' : action === 'create' ? 'CREATE_AD_ENTITY' : action === 'update' ? 'UPDATE_AD_ENTITY' : null,
    parameters: action === 'create' ? [] : [{ name: 'campaignId', in: 'path', required: true }],
    ...overrides
  };
}

function fakeGateway() {
  const calls = [];
  const operations = new Map();
  const keys = [
    'ncc.post.add_using_post_3__p_ncc_campaigns',
    'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',
    'ncc.put.modify_using_put_5__p_ncc_campaigns_campaign_id__q_fields',
    'ncc.delete.remove_using_delete_5__p_ncc_campaigns_campaign_id',
    'report.get.get_single_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_id_time_increment_time_range'
  ];
  for (const key of keys) {
    operations.set(key, operation(key, key.startsWith('report.') ? {
      path: '/stats', domain: 'stat', action: 'read', sideEffect: false, destructive: false, requiredGate: 'reads', confirmation: null, parameters: []
    } : {}));
  }
  return {
    calls,
    status() {
      return {
        configured: true,
        specRef: '8e250490ab748367a627213f7d7a2917e005cb10',
        baseUrl: 'https://api.searchad.naver.com',
        gates: { activeCanary: true }
      };
    },
    get(key) {
      const value = operations.get(key);
      if (!value) throw new Error(`unknown operation ${key}`);
      return value;
    },
    preview(key, input) {
      const op = this.get(key);
      const id = input?.pathParams?.campaignId || key;
      return {
        requiredConfirmation: op.confirmation,
        requiredSecondConfirmation: op.destructive ? `searchad:${input.customerId}:${op.domain}:${id}` : null
      };
    },
    async execute(key, input) {
      calls.push({ mode: 'read', key, input: structuredClone(input) });
      return { data: { ok: true } };
    },
    async executeCanary(key, input) {
      calls.push({ mode: 'canary', key, input: structuredClone(input) });
      return { data: { ok: true } };
    }
  };
}

test('Active Canary config is OFF by default and does not require production DB or money settings', () => {
  const config = loadActiveCanaryConfig({});
  assert.equal(config.allowActiveCanary, false);
  assert.equal(config.activationMode, 'prevalidation');
  assert.equal(config.maxSpendKrw, 0);
  assert.equal(config.maxConcurrentPerCustomer, 1);
  assert.equal(config.observationPeriodMs, 48 * 60 * 60 * 1000);
  assert.equal(config.databaseUrl, null);
});

test('Active Canary config rejects unsafe/invalid limits instead of silently clamping them', () => {
  for (const overrides of [
    { ATELIER_SEARCHAD_CANARY_MAX_SPEND_KRW: '1' },
    { ATELIER_SEARCHAD_CANARY_MAX_CONCURRENT_PER_CUSTOMER: '2' },
    { ATELIER_SEARCHAD_CANARY_MAX_OBJECTS: 'not-a-number' },
    { ATELIER_SEARCHAD_CANARY_MAX_MUTATIONS: '13' },
    { ATELIER_SEARCHAD_CANARY_OBSERVATION_SECONDS: '3600' },
    { ATELIER_SEARCHAD_ACTIVATION_MODE: 'active' },
    { ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1050' },
    { ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '99' }
  ]) {
    assert.throws(
      () => loadActiveCanaryConfig(enabledEnv(overrides)),
      error => error?.code === 'SEARCHAD_CANARY_CONFIG_INVALID'
    );
  }
});

test('credential fingerprint is stable for one resolved Customer credential, changes on secret rotation, and contains no secret', () => {
  const credentials = fakeCredentials();
  const first = credentialFingerprintForCustomer(credentials, '123');
  const again = credentialFingerprintForCustomer(credentials, '123');
  assert.equal(first, again);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes('secret-fixture'), false);

  const rotated = {
    ...credentials,
    resolve() {
      return { ...credentials.resolve('123'), secretKey: 'different-secret' };
    }
  };
  assert.notEqual(credentialFingerprintForCustomer(rotated, '123'), first);
});

test('Canary gateway adapter uses ordinary execute for reads and internal executeCanary for mutations with server-derived confirmations', async () => {
  const gateway = fakeGateway();
  const adapter = new ActiveCanaryGatewayRemoteAdapter({ gateway });

  await adapter.read({
    operationKey: 'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',
    customerId: '123',
    pathParams: { campaignId: 'cmp-1' }
  });
  await adapter.mutate({
    operationKey: 'ncc.post.add_using_post_3__p_ncc_campaigns',
    customerId: '123',
    body: { campaignTp: 'WEB_SITE', userLock: true }
  });
  await adapter.mutate({
    operationKey: 'ncc.delete.remove_using_delete_5__p_ncc_campaigns_campaign_id',
    customerId: '123',
    pathParams: { campaignId: 'cmp-1' },
    confirmation: 'caller-value-must-be-ignored',
    secondConfirmation: 'caller-value-must-be-ignored'
  });

  assert.equal(gateway.calls[0].mode, 'read');
  assert.equal(gateway.calls[1].mode, 'canary');
  assert.equal(gateway.calls[1].input.confirmation, 'CREATE_AD_ENTITY');
  assert.equal(gateway.calls[2].mode, 'canary');
  assert.equal(gateway.calls[2].input.confirmation, 'DELETE_AD_ENTITY');
  assert.equal(gateway.calls[2].input.secondConfirmation, 'searchad:123:campaign:cmp-1');
});

test('disabled production Canary runtime does not touch PostgreSQL and remains not ready', async () => {
  const pool = fakePool();
  const runtime = await createProductionActiveCanaryRuntime({
    env: {},
    pool,
    gateway: fakeGateway(),
    credentialsRegistry: fakeCredentials()
  });
  assert.equal(runtime.status().enabled, false);
  assert.equal(runtime.status().ready, false);
  assert.equal(runtime.service, null);
  assert.equal(pool.calls.length, 0);
});

test('enabled production Canary runtime fails closed when PostgreSQL dependency/schema is missing', async () => {
  await assert.rejects(
    createProductionActiveCanaryRuntime({
      env: enabledEnv({ DATABASE_URL: '' }),
      gateway: fakeGateway(),
      credentialsRegistry: fakeCredentials()
    }),
    error => error?.code === 'SEARCHAD_CANARY_DATABASE_REQUIRED'
  );

  await assert.rejects(
    createProductionActiveCanaryRuntime({
      env: enabledEnv(),
      pool: fakePool({ schemaReady: false }),
      gateway: fakeGateway(),
      credentialsRegistry: fakeCredentials()
    }),
    error => error?.code === 'SEARCHAD_CANARY_SCHEMA_NOT_READY'
  );
});

test('enabled production Canary runtime wires PostgreSQL repository, pinned recipe, gateway adapter and Customer fingerprint resolver', async () => {
  const pool = fakePool();
  const gateway = fakeGateway();
  const credentialsRegistry = fakeCredentials();
  const runtime = await createProductionActiveCanaryRuntime({
    env: enabledEnv(),
    pool,
    gateway,
    credentialsRegistry
  });

  const status = runtime.status();
  assert.equal(status.enabled, true);
  assert.equal(status.ready, true);
  assert.equal(status.activationMode, 'canary');
  assert.equal(status.storage.runtime, 'postgres');
  assert.equal(status.storage.schemaReady, true);
  assert.equal(status.safety.maxSpendKrw, 0);
  assert.equal(status.safety.maxConcurrentPerCustomer, 1);
  assert.equal(status.specSha, '8e250490ab748367a627213f7d7a2917e005cb10');
  assert.equal(status.upstreamBaseUrl, 'https://api.searchad.naver.com');
  assert.ok(runtime.service);
  assert.ok(runtime.repository);
  assert.ok(runtime.remote instanceof ActiveCanaryGatewayRemoteAdapter);
  assert.equal(runtime.recipe.id, 'stopped_web_site_campaign_v1');
  assert.equal(runtime.config.dailyBudgetKrw, 1000);
  assert.equal(runtime.config.budgetDeltaKrw, 100);

  const fingerprint = await runtime.service.resolveCredentialFingerprint('123');
  assert.equal(fingerprint, credentialFingerprintForCustomer(credentialsRegistry, '123'));
});
