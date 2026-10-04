import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';
import { createProductionSearchAdWriteRuntime } from '../src/naver/searchad/write/runtime-production.js';

// Runtime composition unit: two deliberately different account-store doubles.
// Durable approval and suspension behavior is covered by the PG integration suite.
test('ordinary send fence uses the activation account store, never an unsuspended write-store mirror', async () => {
  const queries = [], sends = [];
  const makePool = (name, suspended) => {
    const client = { async query(sql) {
      queries.push({ name, sql });
      return { rows: [{ customer_id: '1001', suspended }] };
    }, release() {} };
    return { query: client.query, async connect() { return client; } };
  };
  const accountPool = makePool('control', true), writePool = makePool('write', false);
  const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
  const credentialsRegistry = new SearchAdCredentialsRegistry({
    principals: [{ principalId: 'fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
    customers: [{ customerId: '1001', status: 'active' }],
    grants: [{ principalId: 'fixture', customerId: '1001', role: 'admin' }]
  });
  const config = { enabled: true, configured: true, baseUrl: 'https://api.searchad.naver.com', allowReads: true, allowWrites: true };
  const client = new NaverSearchAdClient({ baseUrl: config.baseUrl, credentialsRegistry, maxRetries: 0,
    fetchImpl: async (_url, init) => { sends.push(init.method); return new Response('{}', { headers: { 'content-type': 'application/json' } }); }
  });
  const gateway = new SearchAdOperationGateway({ client, registry, credentialsRegistry, config });
  const activationGuard = { repository: { pool: accountPool }, async assertMutationAllowed() { return { allowed: true }; } };
  const runtime = createProductionSearchAdWriteRuntime({ gateway, activationGuard, postgresPool: writePool, env: {
    ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres', ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true',
    ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true', ATELIER_SEARCHAD_ALLOW_WRITES: 'true'
  } });
  try {
    const op = registry.get(CANARY_OPERATION_KEYS.updateCampaign);
    const outcome = await runtime.remote.mutate({ operationKey: op.operationKey, customerId: '1001',
      pathParams: { campaignId: 'fixture', nccCampaignId: 'fixture' }, query: { fields: 'budget' },
      body: { nccCampaignId: 'fixture', dailyBudget: 1000, userLock: true }, confirmation: op.confirmation
    }).catch(error => error);
    assert.equal(sends.length, 0, 'WRONG_ACCOUNT_STORE_MUST_NOT_AUTHORIZE_SEND');
    assert.ok(outcome instanceof Error);
    assert.ok(queries.some(q => q.name === 'control' && q.sql.includes('FOR UPDATE')));
    assert.equal(queries.some(q => q.name === 'write' && q.sql.includes('FOR UPDATE')), false);
  } finally { await runtime.close(); }
});
