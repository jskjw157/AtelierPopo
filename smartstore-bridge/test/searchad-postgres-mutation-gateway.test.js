import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { createPostgresMutationGateway } from '../src/naver/searchad/lifecycle/postgres-mutation-gateway.js';
const origin = 'https://api.searchad.naver.com';
function fixture() {
  const h = { calls: [], sql: [], onLock() {}, suspended: false, spec: 'fixture-spec' };
  const credentials = new SearchAdCredentialsRegistry({
    principals: [{ principalId: 'fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
    customers: [{ customerId: '1001', status: 'active' }],
    grants: [{ principalId: 'fixture', customerId: '1001', role: 'admin' }]
  });
  const config = { enabled: true, configured: true, baseUrl: origin, allowReads: true, allowWrites: true, allowActiveCanary: true };
  const operations = {
    read: { operationKey: 'read', method: 'GET', path: '/ncc/campaigns/fixture', sideEffect: false, requiredGate: 'reads', runtimeAllowlisted: true, tier: 'B' },
    update: { operationKey: 'update', method: 'PUT', path: '/ncc/campaigns/fixture', sideEffect: true, requiredGate: 'writes', runtimeAllowlisted: true, tier: 'B', confirmation: 'UPDATE' }
  };
  const registry = { get: key => operations[key], status: () => ({ specRef: h.spec }), publicOperation: op => structuredClone(op) };
  const fetchImpl = async (url, init) => {
    h.calls.push({ url: String(url), init });
    if (h.reply) return h.reply();
    return new Response(JSON.stringify({ nccCampaignId: 'fixture' }), { headers: { 'content-type': 'application/json' } });
  };
  const client = new NaverSearchAdClient({ baseUrl: origin, credentialsRegistry: credentials, fetchImpl, maxRetries: 3 });
  const source = new SearchAdOperationGateway({ client, config, registry, credentialsRegistry: credentials });
  const db = { async query(sql) {
    h.sql.push(sql);
    if (sql.startsWith('SELECT')) await h.onLock();
    if (sql === 'ROLLBACK') h.unlocked?.();
    return { rows: [{ customer_id: '1001', suspended: h.suspended }] };
  }, release() {} };
  const pool = { query: db.query, async connect() { return db; } };
  const gateway = createPostgresMutationGateway({ gateway: source, pool });
  return Object.assign(h, { source, client, credentials, config, operations, gateway, fetchImpl,
    input: { customerId: '1001', body: { dailyBudget: 1000 }, confirmation: 'UPDATE' } });
}
test('private mutation client signs once, disables redirects, and leaves shared transport untouched', async () => {
  const h = fixture();
  await h.gateway.execute('update', h.input);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].init.method, 'PUT'); assert.equal(h.calls[0].init.redirect, 'error');
  assert.ok(h.calls[0].init.headers['X-Signature']);
  assert.equal(h.calls[0].init.headers['X-Customer'], '1001');
  assert.equal(h.client.fetchImpl, h.fetchImpl);
  assert.ok(h.sql.some(sql => sql.includes('FOR UPDATE')));
  h.sql.length = 0; h.suspended = true; h.config.allowWrites = false;
  await h.gateway.execute('read', { customerId: '1001' });
  assert.equal(h.sql.length, 0, 'read recovery must not acquire the account fence');
});
for (const [name, change] of [
  ['ordinary gate', h => { h.config.allowWrites = false; }],
  ['spec identity', h => { h.spec = 'different'; }],
  ['operation', h => { h.operations.update.path = '/ncc/campaigns/other'; }],
  ['transport replacement', h => { h.client.fetchImpl = async () => { throw new Error('must never run'); }; }],
  ['credential rotation', h => { const resolve = h.credentials.resolve.bind(h.credentials); h.credentials.resolve = id => ({ ...resolve(id), secretKey: 'rotated' }); }]
]) {
  test(`account lock wait revalidates ${name} before mutation entry`, async () => {
    const h = fixture(); h.onLock = () => change(h);
    await assert.rejects(h.gateway.execute('update', h.input));
    assert.equal(h.calls.length, 0);
  });
}
test('a missing signed transport never falls back to a caller-provided mutation implementation', async () => {
  let calls = 0;
  const source = { get: () => ({ sideEffect: true }), async execute() { calls++; } };
  const gateway = createPostgresMutationGateway({ gateway: source, pool: {} });
  await assert.rejects(gateway.execute('update', { customerId: '1001' }), { code: 'SEARCHAD_SEND_GATEWAY_UNAVAILABLE' });
  assert.equal(calls, 0);
});
test('a delayed mutation failure waits for unlock and is never retried', { timeout: 1000 }, async () => {
  const h = fixture();
  const unlocked = new Promise(resolve => { h.unlocked = resolve; });
  h.reply = async () => { await unlocked; throw new Error('fixture network failure'); };
  await assert.rejects(h.gateway.execute('update', h.input));
  assert.equal(h.calls.length, 1);
});
test('input mutation during account acquisition cannot redirect the signed request', async () => {
  const h = fixture(); h.onLock = () => { h.input.customerId = '9999'; h.input.body.dailyBudget = 9000; };
  await h.gateway.execute('update', h.input);
  assert.equal(h.calls[0].init.headers['X-Customer'], '1001');
  assert.equal(JSON.parse(h.calls[0].init.body).dailyBudget, 1000);
});
