import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchAdLifecycleRoutes, publicLifecycleRun } from '../src/http/routes-searchad-lifecycle.js';
import { searchAdLifecycleOpenApi } from '../src/http/openapi-searchad-lifecycle.js';

function responseCapture() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    end(body = '') { this.body = String(body); }
  };
}
function req(method = 'GET') { return { method, headers: {} }; }
function route(routes, method, path) {
  const selected = routes.find(item => item.method === method && item.pattern.test(path));
  assert.ok(selected, `missing route ${method} ${path}`);
  selected.pattern.lastIndex = 0;
  return { selected, match: selected.pattern.exec(path) };
}
async function invoke(selected, { match, principal, url = 'http://localhost/', body = {}, method = selected.method } = {}) {
  const res = responseCapture();
  await selected.handler({ req: req(method), res, match, principal, url: new URL(url), body, requestId: 'req-life-1' });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
}

function fixture() {
  const calls = [];
  const runs = [
    { hierarchyRunId: 'run-100', customerId: '100', recipeId: 'hierarchy', status: 'active', startedByPrincipalId: 'admin-100', specSha: 'spec', credentialFingerprint: 'must-not-leak', upstreamBaseUrl: 'https://api.searchad.naver.com', activationId: 'act-100', startedAt: '2026-09-11T00:00:00Z', lastError: { code: 'REMOTE', message: 'secret raw message' } },
    { hierarchyRunId: 'run-200', customerId: '200', recipeId: 'hierarchy', status: 'passed', startedByPrincipalId: 'admin-200', specSha: 'spec', credentialFingerprint: 'other-secret', upstreamBaseUrl: 'https://api.searchad.naver.com', activationId: 'act-200', startedAt: '2026-09-11T00:00:00Z' }
  ];
  const repository = {
    async listRuns({ customerIds }) { calls.push({ type: 'listRuns', customerIds }); return runs.filter(row => customerIds.includes(row.customerId)); },
    async getRun(id, customerId = null) { calls.push({ type: 'getRun', id, customerId }); return runs.find(row => row.hierarchyRunId === id && (!customerId || row.customerId === customerId)) || null; },
    async listObjects(id) { return id === 'run-100' ? [{ hierarchyObjectId: 'obj-1', hierarchyRunId: id, customerId: '100', objectType: 'campaign', remoteId: 'cmp-1', state: 'owned' }] : []; },
    async listEvents(id) { return id === 'run-100' ? [{ eventId: 'ev-1', hierarchyRunId: id, customerId: '100', phase: 'create', status: 'remote_accepted', error: { code: 'UPSTREAM', message: 'raw secret error' } }] : []; }
  };
  const service = {};
  for (const method of ['start', 'createAdgroup', 'createKeywords', 'createCreative', 'cleanupNext', 'reconcile']) {
    service[method] = async (...args) => { calls.push({ type: method, args }); return { run: runs[0], object: null, objects: [] }; };
  }
  return {
    calls,
    runtime: {
      repository,
      service,
      status() { return { ready: true, mutationEnabled: false, storage: { runtime: 'postgres', schemaReady: true } }; }
    }
  };
}

const reader100 = { principalId: 'reader-100', role: 'reader', customerIds: ['100'] };
const readerBoth = { principalId: 'reader-both', role: 'reader', customerIds: ['100', '200'] };
const admin100 = { principalId: 'admin-100', role: 'admin', customerIds: ['100'] };

test('public lifecycle projection removes credential fingerprint and raw error messages', () => {
  const projected = publicLifecycleRun({ hierarchyRunId: 'run-100', customerId: '100', credentialFingerprint: 'secret-hash', lastError: { code: 'UPSTREAM', message: 'do-not-leak', status: 504 } });
  const text = JSON.stringify(projected);
  assert.equal(text.includes('secret-hash'), false);
  assert.equal(text.includes('do-not-leak'), false);
  assert.equal(projected.lastError.code, 'UPSTREAM');
  assert.equal(projected.lastError.status, 504);
});

test('lifecycle route metadata gives Reader read access and Admin-only mutation access', () => {
  const { runtime } = fixture();
  const routes = createSearchAdLifecycleRoutes({ app: { searchAdLifecycleRuntime: runtime } });
  assert.equal(route(routes, 'GET', '/api/v1/searchad/lifecycle/runs').selected.searchAdRole, 'reader');
  assert.equal(route(routes, 'GET', '/api/v1/searchad/lifecycle/runs/run-100').selected.searchAdRole, 'reader');
  for (const path of [
    '/api/v1/searchad/lifecycle/runs',
    '/api/v1/searchad/lifecycle/runs/run-100/adgroups',
    '/api/v1/searchad/lifecycle/runs/run-100/keywords',
    '/api/v1/searchad/lifecycle/runs/run-100/creative',
    '/api/v1/searchad/lifecycle/runs/run-100/cleanup-next',
    '/api/v1/searchad/lifecycle/runs/run-100/reconcile'
  ]) {
    assert.equal(route(routes, 'POST', path).selected.searchAdRole, 'admin');
  }
});

test('Reader listing is restricted to explicit Customer grants and hidden run lookup is indistinguishable from missing', async () => {
  const { runtime } = fixture();
  const routes = createSearchAdLifecycleRoutes({ app: { searchAdLifecycleRuntime: runtime } });
  const list = route(routes, 'GET', '/api/v1/searchad/lifecycle/runs');
  const result = await invoke(list.selected, { principal: readerBoth, url: 'http://localhost/api/v1/searchad/lifecycle/runs' });
  assert.deepEqual(result.body.items.map(row => row.customerId), ['100', '200']);

  await assert.rejects(
    invoke(list.selected, { principal: reader100, url: 'http://localhost/api/v1/searchad/lifecycle/runs?customerId=200' }),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN' && error?.status === 403
  );
  for (const id of ['run-200', 'missing']) {
    const target = route(routes, 'GET', `/api/v1/searchad/lifecycle/runs/${id}`);
    await assert.rejects(
      invoke(target.selected, { match: target.match, principal: reader100 }),
      error => error?.code === 'SEARCHAD_HIERARCHY_NOT_FOUND' && error?.status === 404
    );
  }
});

test('lifecycle mutation bodies reject remote IDs, risk controls and actor overrides before service call', async () => {
  const { runtime, calls } = fixture();
  const routes = createSearchAdLifecycleRoutes({ app: { searchAdLifecycleRuntime: runtime } });
  const cases = [
    ['POST', '/api/v1/searchad/lifecycle/runs', { customerId: '100', planId: 'p', executionToken: 't', remoteId: 'victim' }],
    ['POST', '/api/v1/searchad/lifecycle/runs/run-100/adgroups', { parentObjectId: 'parent', planId: 'p', executionToken: 't', riskUnits: 999 }],
    ['POST', '/api/v1/searchad/lifecycle/runs/run-100/keywords', { parentObjectId: 'parent', planId: 'p', executionToken: 't', riskDate: '2099-01-01' }],
    ['POST', '/api/v1/searchad/lifecycle/runs/run-100/creative', { parentObjectId: 'parent', planId: 'p', executionToken: 't', nccAdgroupId: 'victim' }],
    ['POST', '/api/v1/searchad/lifecycle/runs/run-100/cleanup-next', { planId: 'p', executionToken: 't', actor: 'fake-admin' }]
  ];
  for (const [method, path, body] of cases) {
    const target = route(routes, method, path);
    await assert.rejects(
      invoke(target.selected, { match: target.match, principal: admin100, body }),
      error => error?.code === 'SEARCHAD_LIFECYCLE_HTTP_INPUT_INVALID' && error?.status === 400
    );
  }
  assert.equal(calls.some(call => ['start', 'createAdgroup', 'createKeywords', 'createCreative', 'cleanupNext'].includes(call.type)), false);
});

test('valid lifecycle handlers derive run/customer from server scope and pass authenticated principal only', async () => {
  const { runtime, calls } = fixture();
  const routes = createSearchAdLifecycleRoutes({ app: { searchAdLifecycleRuntime: runtime } });
  const child = route(routes, 'POST', '/api/v1/searchad/lifecycle/runs/run-100/adgroups');
  const result = await invoke(child.selected, { match: child.match, principal: admin100, body: { parentObjectId: 'parent', planId: 'p', executionToken: 't' } });
  assert.equal(result.status, 201);
  const call = calls.find(row => row.type === 'createAdgroup');
  assert.equal(call.args[0].hierarchyRunId, 'run-100');
  assert.equal(call.args[0].customerId, undefined);
  assert.equal(call.args[1].principal.principalId, 'admin-100');
});

test('role-scoped lifecycle OpenAPI exposes mutation schemas only to Admin and forbids extra request properties', () => {
  for (const role of ['reader', 'operator', 'executor']) {
    const doc = searchAdLifecycleOpenApi({ role });
    assert.ok(doc.paths['/api/v1/searchad/lifecycle/runs']?.get);
    assert.equal(Boolean(doc.paths['/api/v1/searchad/lifecycle/runs']?.post), false);
    assert.equal(Boolean(doc.paths['/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/cleanup-next']), false);
  }
  const admin = searchAdLifecycleOpenApi({ role: 'admin' });
  const schema = admin.paths['/api/v1/searchad/lifecycle/runs'].post.requestBody.content['application/json'].schema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(Boolean(schema.properties.remoteId), false);
  assert.equal(Boolean(schema.properties.riskUnits), false);
  assert.ok(admin.paths['/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/adgroups']?.post);
  assert.ok(admin.paths['/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/keywords']?.post);
  assert.ok(admin.paths['/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/creative']?.post);
  assert.ok(admin.paths['/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/cleanup-next']?.post);
  assert.ok(admin.paths['/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/reconcile']?.post);
});