import test from 'node:test';
import assert from 'node:assert/strict';

import { createSearchAdCanaryRoutes, publicCanaryRun } from '../src/http/routes-searchad-canary.js';
import { searchAdCanaryOpenApi } from '../src/http/openapi-searchad-canary.js';

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

function runtimeFixture() {
  const runs = [
    {
      canaryRunId: 'run-100', customerId: '100', status: 'spend_check_pending',
      passiveEvidenceId: 'ev-100', recipeId: 'recipe', startedByPrincipalId: 'admin-a',
      specSha: 'spec-sha', credentialFingerprint: 'credential-hash-must-not-leak',
      upstreamBaseUrl: 'https://api.searchad.naver.com', verifiedOperationScope: { operationKeys: ['campaign.read'] },
      startedAt: '2026-09-11T00:00:00Z', beforeSpend: 0, remoteId: 'cmp-100',
      lastError: { code: 'REMOTE', message: 'secret=do-not-leak' }
    },
    {
      canaryRunId: 'run-200', customerId: '200', status: 'passed',
      passiveEvidenceId: 'ev-200', recipeId: 'recipe', startedByPrincipalId: 'admin-b',
      specSha: 'spec-sha', credentialFingerprint: 'other-hash',
      upstreamBaseUrl: 'https://api.searchad.naver.com', verifiedOperationScope: {},
      startedAt: '2026-09-10T00:00:00Z', beforeSpend: 0, afterSpend: 0, spendDelta: 0
    }
  ];
  const calls = [];
  const repository = {
    async listRuns({ customerId, status, limit }) {
      calls.push({ type: 'listRuns', customerId, status, limit });
      return runs.filter(item => item.customerId === customerId && (!status || item.status === status));
    },
    async getRun(id) {
      calls.push({ type: 'getRun', id });
      return runs.find(item => item.canaryRunId === id) || null;
    }
  };
  const service = {};
  for (const method of ['start', 'reconcile', 'cleanup', 'verifySpend']) {
    service[method] = async (...args) => {
      calls.push({ type: method, args });
      return runs[0];
    };
  }
  return {
    calls,
    runtime: {
      repository,
      service,
      status() { return { enabled: true, ready: true }; }
    }
  };
}

function route(routes, method, path) {
  const selected = routes.find(item => item.method === method && item.pattern.test(path));
  assert.ok(selected, `missing route ${method} ${path}`);
  selected.pattern.lastIndex = 0;
  return { selected, match: selected.pattern.exec(path) };
}

async function invoke(selected, { match, principal, url = 'http://localhost/', body = {}, method = selected.method } = {}) {
  const res = responseCapture();
  const request = req(method);
  await selected.handler({
    req: request,
    res,
    match,
    principal,
    url: new URL(url),
    body,
    requestId: 'req-1'
  });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
}

const reader100 = { principalId: 'reader-a', role: 'reader', customerIds: ['100'] };
const readerBoth = { principalId: 'reader-all', role: 'reader', customerIds: ['100', '200'] };
const admin100 = { principalId: 'admin-a', role: 'admin', customerIds: ['100'] };

test('public Canary run projection excludes credential fingerprint and remote error message', () => {
  const { runtime } = runtimeFixture();
  return runtime.repository.getRun('run-100').then(run => {
    const publicRun = publicCanaryRun(run);
    const json = JSON.stringify(publicRun);
    assert.equal(json.includes('credential-hash'), false);
    assert.equal(json.includes('do-not-leak'), false);
    assert.equal(publicRun.lastError?.code, 'REMOTE');
    assert.equal(publicRun.customerId, '100');
  });
});

test('Canary route metadata requires Reader for reads and Admin for mutations', () => {
  const { runtime } = runtimeFixture();
  const routes = createSearchAdCanaryRoutes({ app: { searchAdActiveCanaryRuntime: runtime } });
  assert.equal(route(routes, 'GET', '/api/v1/searchad/canary/runs').selected.searchAdRole, 'reader');
  assert.equal(route(routes, 'GET', '/api/v1/searchad/canary/runs/run-100').selected.searchAdRole, 'reader');
  for (const [method, path] of [
    ['POST', '/api/v1/searchad/canary/runs'],
    ['POST', '/api/v1/searchad/canary/runs/run-100/reconcile'],
    ['POST', '/api/v1/searchad/canary/runs/run-100/cleanup'],
    ['POST', '/api/v1/searchad/canary/runs/run-100/verify-spend']
  ]) {
    assert.equal(route(routes, method, path).selected.searchAdRole, 'admin');
  }
});

test('Reader list is queried only within granted Customers and explicit cross-Customer filter is forbidden', async () => {
  const { runtime, calls } = runtimeFixture();
  const routes = createSearchAdCanaryRoutes({ app: { searchAdActiveCanaryRuntime: runtime } });
  const { selected } = route(routes, 'GET', '/api/v1/searchad/canary/runs');

  const all = await invoke(selected, {
    principal: readerBoth,
    url: 'http://localhost/api/v1/searchad/canary/runs?limit=20'
  });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.items.map(item => item.customerId), ['100', '200']);
  assert.deepEqual(calls.filter(call => call.type === 'listRuns').map(call => call.customerId), ['100', '200']);

  await assert.rejects(
    invoke(selected, {
      principal: reader100,
      url: 'http://localhost/api/v1/searchad/canary/runs?customerId=200'
    }),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN' && error?.status === 403
  );
});

test('inaccessible or missing run lookup is projected as the same 404', async () => {
  const { runtime } = runtimeFixture();
  const routes = createSearchAdCanaryRoutes({ app: { searchAdActiveCanaryRuntime: runtime } });
  const existing = route(routes, 'GET', '/api/v1/searchad/canary/runs/run-200');
  const missing = route(routes, 'GET', '/api/v1/searchad/canary/runs/missing');

  for (const target of [existing, missing]) {
    await assert.rejects(
      invoke(target.selected, { match: target.match, principal: reader100 }),
      error => error?.code === 'SEARCHAD_CANARY_NOT_FOUND' && error?.status === 404
    );
  }
});

test('Admin mutation handlers pass authenticated principal and do not derive actor from request body', async () => {
  const { runtime, calls } = runtimeFixture();
  const routes = createSearchAdCanaryRoutes({ app: { searchAdActiveCanaryRuntime: runtime } });
  const start = route(routes, 'POST', '/api/v1/searchad/canary/runs');
  const result = await invoke(start.selected, {
    match: start.match,
    principal: admin100,
    body: { customerId: '100', passiveEvidenceId: 'ev-100' }
  });
  assert.equal(result.status, 201);
  const call = calls.find(item => item.type === 'start');
  assert.equal(call.args[1].principal.principalId, 'admin-a');
});

test('malicious start body overrides are rejected by service contract before execution', async () => {
  const { runtime } = runtimeFixture();
  runtime.service.start = async (body, { principal }) => {
    assert.equal(principal.principalId, 'admin-a');
    const allowed = new Set(['customerId', 'passiveEvidenceId']);
    const extras = Object.keys(body).filter(key => !allowed.has(key));
    if (extras.length) {
      const error = new Error('invalid');
      error.code = 'SEARCHAD_CANARY_INPUT_INVALID';
      error.status = 400;
      throw error;
    }
    return {};
  };
  const routes = createSearchAdCanaryRoutes({ app: { searchAdActiveCanaryRuntime: runtime } });
  const start = route(routes, 'POST', '/api/v1/searchad/canary/runs');
  await assert.rejects(
    invoke(start.selected, {
      match: start.match,
      principal: admin100,
      body: {
        customerId: '100', passiveEvidenceId: 'ev-100', operationKey: 'delete',
        remoteId: 'victim', passed: true, spend: 0, cleanup: 'verified', rawUrl: 'https://evil.invalid'
      }
    }),
    error => error?.code === 'SEARCHAD_CANARY_INPUT_INVALID'
  );
});

test('role-specific OpenAPI exposes read paths to every role but Canary mutation paths only to Admin', () => {
  for (const role of ['reader', 'operator', 'executor']) {
    const doc = searchAdCanaryOpenApi({ role });
    assert.ok(doc.paths['/api/v1/searchad/canary/runs']?.get);
    assert.equal(Boolean(doc.paths['/api/v1/searchad/canary/runs']?.post), false);
    assert.equal(Boolean(doc.paths['/api/v1/searchad/canary/runs/{canaryRunId}/cleanup']), false);
  }
  const admin = searchAdCanaryOpenApi({ role: 'admin' });
  assert.ok(admin.paths['/api/v1/searchad/canary/runs']?.get);
  assert.ok(admin.paths['/api/v1/searchad/canary/runs']?.post);
  assert.ok(admin.paths['/api/v1/searchad/canary/runs/{canaryRunId}/reconcile']?.post);
  assert.ok(admin.paths['/api/v1/searchad/canary/runs/{canaryRunId}/cleanup']?.post);
  assert.ok(admin.paths['/api/v1/searchad/canary/runs/{canaryRunId}/verify-spend']?.post);
  assert.equal(JSON.stringify(admin).includes('API_KEY'), false);
});
