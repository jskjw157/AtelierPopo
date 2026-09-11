import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Ledger } from '../src/infrastructure/ledger.js';
import { CatalogRepository } from '../src/application/catalog-repository.js';
import { createHttpApiV05 } from '../src/http/server-v05.js';

const READER_KEY = 'r'.repeat(48);
const ADMIN_KEY = 'a'.repeat(48);
const GENERIC_KEY = 'g'.repeat(48);
const silentLogger = { info() {}, warn() {}, error() {} };

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'searchad-lifecycle-server-'));
  const catalogRoot = path.join(dir, 'catalog');
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({ source: 'fixture', total_products: 0, total_completed: 0, products: {} }));
  const ledger = new Ledger(path.join(dir, 'work.sqlite'));
  const calls = [];
  let closeCalls = 0;
  const runs = [{ hierarchyRunId: 'run-100', customerId: '100', status: 'active', createdAt: '2026-09-11T00:00:00Z' }];
  const repository = {
    async listRuns({ customerId }) { calls.push({ type: 'listRuns', customerId }); return runs.filter(run => run.customerId === customerId); },
    async getRun(id, customerId) { calls.push({ type: 'getRun', id, customerId }); return runs.find(run => run.hierarchyRunId === id && (!customerId || run.customerId === customerId)) || null; }
  };
  const service = {
    async start(body, context) { calls.push({ type: 'start', body, context }); return runs[0]; },
    async createAdgroup(body, context) { calls.push({ type: 'createAdgroup', body, context }); return runs[0]; },
    async createKeywords(body, context) { calls.push({ type: 'createKeywords', body, context }); return runs[0]; },
    async createCreative(body, context) { calls.push({ type: 'createCreative', body, context }); return runs[0]; },
    async cleanupNext(body, context) { calls.push({ type: 'cleanupNext', body, context }); return runs[0]; },
    async reconcile(id, context) { calls.push({ type: 'reconcile', id, context }); return runs[0]; }
  };
  const app = {
    config: {
      catalogRoot,
      workDir: dir,
      templateFile: path.join(dir, 'template.json'),
      databasePath: path.join(dir, 'work.sqlite'),
      categories: {},
      naver: { clientId: 'client', clientSecret: 'secret', tokenType: 'SELF', allowWrites: false }
    },
    ledger,
    catalogRepository: new CatalogRepository(catalogRoot),
    productService: { enqueueCatalog() { return { total: 0, queued: 0, failed: 0 }; }, runBatch() { return { requested: 0, results: [] }; } },
    productsApi: { async findBySellerManagementCode() { return null; } },
    detailContentService: {},
    driveConfig: {}, driveService: null, catalogProvider: 'local', catalogMaterializer: null, driveStartupError: null,
    commerceConfig: { maxJsonBodyBytes: 1024 * 1024 },
    commerceManifest: { operations: [] },
    commerceGateway: { status() { return { ready: true }; }, list() { return { total: 0, items: [] }; } },
    commerceStartupError: null,
    searchAdConfig: { configured: true, requestTimeoutMs: 1000, automationMode: 'observe' },
    searchAdGateway: { status() { return { ready: true }; } },
    searchAdStartupError: null,
    searchAdLifecycleRuntime: {
      repository,
      service,
      status() { return { ready: true, mutationEnabled: false, storage: { runtime: 'postgres', schemaReady: true } }; },
      async close() { closeCalls += 1; }
    },
    searchAdLifecycleStartupError: null
  };
  const env = {
    ATELIER_API_KEY: GENERIC_KEY,
    ATELIER_HTTP_ALLOW_WRITES: 'false',
    ATELIER_HTTP_ALLOW_BATCH_WRITES: 'false',
    ATELIER_TRUST_PROXY: 'false',
    ATELIER_OPERATION_CONCURRENCY: '1',
    ATELIER_SEARCHAD_READER_API_KEY: READER_KEY,
    ATELIER_SEARCHAD_READER_CUSTOMERS: '100',
    ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'reader-a',
    ATELIER_SEARCHAD_ADMIN_API_KEY: ADMIN_KEY,
    ATELIER_SEARCHAD_ADMIN_CUSTOMERS: '100',
    ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'admin-a'
  };
  return { dir, app, env, calls, getCloseCalls: () => closeCalls };
}

async function startFixture() {
  const fixture = createFixture();
  const api = createHttpApiV05({ app: fixture.app, env: fixture.env, logger: silentLogger });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  return { ...fixture, api, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function request(fixture, key, method, pathname, body) {
  return fetch(`${fixture.baseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('V05 server exposes Customer-scoped lifecycle routes and readiness', async () => {
  const fixture = await startFixture();
  try {
    const response = await request(fixture, READER_KEY, 'GET', '/api/v1/searchad/lifecycle/runs');
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.items.map(item => item.customerId), ['100']);
    assert.deepEqual(fixture.calls.filter(call => call.type === 'listRuns').map(call => call.customerId), ['100']);
    const readiness = fixture.api.readiness();
    assert.equal(readiness.searchAdLifecycle?.initialized, true);
    assert.equal(readiness.searchAdLifecycle?.ready, true);
    assert.equal(readiness.searchAdLifecycle?.status?.mutationEnabled, false);
  } finally {
    await fixture.api.close();
    assert.equal(fixture.getCloseCalls(), 1);
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('V05 lifecycle Admin route rejects caller remote IDs before service invocation', async () => {
  const fixture = await startFixture();
  try {
    const response = await request(fixture, ADMIN_KEY, 'POST', '/api/v1/searchad/lifecycle/runs', {
      customerId: '100', planId: 'plan-1', executionToken: 'token-1', remoteId: 'victim'
    });
    assert.equal(response.status, 400);
    assert.equal(fixture.calls.some(call => call.type === 'start'), false);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
