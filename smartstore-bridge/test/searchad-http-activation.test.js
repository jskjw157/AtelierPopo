import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Ledger } from '../src/infrastructure/ledger.js';
import { CatalogRepository } from '../src/application/catalog-repository.js';
import { createHttpApiV05 } from '../src/http/server-v05.js';

const GENERIC_KEY = 'g'.repeat(48);
const READER_KEY = 'r'.repeat(48);
const OPERATOR_KEY = 'o'.repeat(48);
const EXECUTOR_KEY = 'e'.repeat(48);
const ADMIN_KEY = 'a'.repeat(48);
const silentLogger = { info() {}, warn() {}, error() {} };

function fixtureData() {
  const evidence = [
    {
      evidenceId: 'ev-100', evidenceType: 'passive_capability', customerId: '100',
      specSha: 'spec-secret-internal', credentialFingerprint: 'credential-fingerprint-should-not-leak',
      upstreamBaseUrl: 'https://api.searchad.naver.com', operationKeys: ['campaign.update'],
      fieldScope: ['campaign.dailyBudget'], result: 'verified',
      details: { probeOperations: [{ operationKey: 'campaign.list', supported: true }], secret: 'nested-secret' },
      createdAt: '2026-09-11T00:00:00Z', expiresAt: '2026-09-11T01:00:00Z',
      accessLicense: 'must-not-leak', signature: 'must-not-leak'
    },
    {
      evidenceId: 'ev-200', evidenceType: 'active_canary', customerId: '200',
      credentialFingerprint: 'other-secret', upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: ['campaign.update'], fieldScope: ['campaign.dailyBudget'], result: 'verified',
      details: {}, createdAt: '2026-09-11T00:00:00Z', expiresAt: '2026-09-11T01:00:00Z'
    }
  ];
  const activations = [
    {
      activationId: 'act-100', evidenceId: 'ev-100', evidenceType: 'passive_capability', customerId: '100',
      specSha: 'spec-internal', credentialFingerprint: 'activation-secret-fingerprint',
      upstreamBaseUrl: 'https://api.searchad.naver.com', operationKeys: ['campaign.update'],
      fieldScope: ['campaign.dailyBudget'], activatedByPrincipalId: 'admin-a',
      activatedAt: '2026-09-11T00:10:00Z', expiresAt: '2026-09-11T01:00:00Z', secret: 'must-not-leak'
    },
    {
      activationId: 'act-200', evidenceId: 'ev-200', evidenceType: 'active_canary', customerId: '200',
      credentialFingerprint: 'other-secret', upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: ['campaign.update'], fieldScope: ['campaign.dailyBudget'],
      activatedByPrincipalId: 'admin-b', activatedAt: '2026-09-11T00:10:00Z', expiresAt: '2026-09-11T01:00:00Z'
    }
  ];
  const accounts = [
    { customerId: '100', suspended: false, updatedAt: '2026-09-11T00:00:00Z' },
    { customerId: '200', suspended: false, updatedAt: '2026-09-11T00:00:00Z' }
  ];
  return { evidence, activations, accounts };
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'searchad-activation-http-'));
  const catalogRoot = path.join(dir, 'catalog');
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
    source: 'fixture', total_products: 0, total_completed: 0, products: {}
  }));
  const ledger = new Ledger(path.join(dir, 'work.sqlite'));
  const calls = [];
  const data = fixtureData();

  const repository = {
    async listEvidence({ customerIds = [] } = {}) {
      calls.push({ type: 'listEvidence', customerIds: [...customerIds] });
      return data.evidence.filter(item => customerIds.includes(item.customerId));
    },
    async getEvidence(id) {
      calls.push({ type: 'getEvidence', id });
      return data.evidence.find(item => item.evidenceId === id) || null;
    },
    async listActivations({ customerIds = [] } = {}) {
      calls.push({ type: 'listActivations', customerIds: [...customerIds] });
      return data.activations.filter(item => customerIds.includes(item.customerId));
    },
    async getActivation(id) {
      calls.push({ type: 'getActivation', id });
      return data.activations.find(item => item.activationId === id) || null;
    }
  };

  const passiveEvidenceService = {
    async issue(body, context) {
      calls.push({ type: 'issueEvidence', body: structuredClone(body), context });
      const row = { ...data.evidence[0], evidenceId: 'ev-issued', customerId: String(body.customerId) };
      data.evidence.push(row);
      return row;
    }
  };
  const activationService = {
    async activate(body, context) {
      calls.push({ type: 'activate', body: structuredClone(body), context });
      const evidence = data.evidence.find(item => item.evidenceId === body.evidenceId);
      const row = {
        ...data.activations[0], activationId: 'act-issued', evidenceId: body.evidenceId,
        customerId: evidence?.customerId || '100', credentialFingerprint: 'new-fingerprint-secret'
      };
      data.activations.push(row);
      return row;
    }
  };
  const accountControlService = {
    async suspend(customerId, context) {
      calls.push({ type: 'suspend', customerId: String(customerId), context });
      const row = data.accounts.find(item => item.customerId === String(customerId));
      if (row) row.suspended = true;
      return row;
    },
    async resume(customerId, context) {
      calls.push({ type: 'resume', customerId: String(customerId), context });
      const row = data.accounts.find(item => item.customerId === String(customerId));
      if (row) row.suspended = false;
      return row;
    },
    async list(context) {
      calls.push({ type: 'listAccounts', context });
      const allowed = context.principal.customerIds.map(String);
      return data.accounts.filter(item => allowed.includes(item.customerId));
    }
  };

  const app = {
    config: {
      catalogRoot, workDir: dir, templateFile: path.join(dir, 'template.json'),
      databasePath: path.join(dir, 'work.sqlite'), categories: {},
      naver: { clientId: 'client', clientSecret: 'secret', tokenType: 'SELF', allowWrites: false }
    },
    ledger,
    catalogRepository: new CatalogRepository(catalogRoot),
    productService: { enqueueCatalog() { return { total: 0, queued: 0, failed: 0 }; }, runBatch() { return { requested: 0, results: [] }; } },
    productsApi: { async findBySellerManagementCode() { return null; } }, detailContentService: {},
    driveConfig: {}, driveService: null, catalogProvider: 'local', catalogMaterializer: null, driveStartupError: null,
    commerceConfig: { maxJsonBodyBytes: 1024 * 1024 }, commerceManifest: { operations: [] },
    commerceGateway: { status() { return { ready: true }; }, list() { return { total: 0, items: [] }; } }, commerceStartupError: null,
    searchAdConfig: { configured: true, requestTimeoutMs: 1000, automationMode: 'observe' },
    searchAdGateway: { status() { return { ready: true }; } }, searchAdStartupError: null,
    searchAdActivationRuntime: {
      repository, passiveEvidenceService, activationService, accountControlService,
      status() { return { ready: true, storage: { runtime: 'postgres', schemaReady: true }, targetOperationCount: 5, targetFieldCount: 2 }; },
      async close() {}
    },
    searchAdActivationStartupError: null
  };
  const env = {
    ATELIER_API_KEY: GENERIC_KEY,
    ATELIER_HTTP_ALLOW_WRITES: 'false', ATELIER_HTTP_ALLOW_BATCH_WRITES: 'false', ATELIER_TRUST_PROXY: 'false',
    ATELIER_OPERATION_CONCURRENCY: '1',
    ATELIER_SEARCHAD_READER_API_KEY: READER_KEY, ATELIER_SEARCHAD_READER_CUSTOMERS: '100', ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'reader-a',
    ATELIER_SEARCHAD_OPERATOR_API_KEY: OPERATOR_KEY, ATELIER_SEARCHAD_OPERATOR_CUSTOMERS: '100', ATELIER_SEARCHAD_OPERATOR_PRINCIPAL_ID: 'operator-a',
    ATELIER_SEARCHAD_EXECUTOR_API_KEY: EXECUTOR_KEY, ATELIER_SEARCHAD_EXECUTOR_CUSTOMERS: '100', ATELIER_SEARCHAD_EXECUTOR_PRINCIPAL_ID: 'executor-a',
    ATELIER_SEARCHAD_ADMIN_API_KEY: ADMIN_KEY, ATELIER_SEARCHAD_ADMIN_CUSTOMERS: '100', ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'admin-a'
  };
  return { dir, app, env, calls, data };
}

async function startFixture() {
  const fixture = createFixture();
  const api = createHttpApiV05({ app: fixture.app, env: fixture.env, logger: silentLogger });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  return { ...fixture, api, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function request(fixture, key, method, pathname, body) {
  const response = await fetch(`${fixture.baseUrl}${pathname}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function withFixture(fn) {
  const fixture = await startFixture();
  try { await fn(fixture); }
  finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

function assertNoSensitiveJson(value) {
  const json = JSON.stringify(value);
  for (const token of [
    'credentialFingerprint', 'credential-fingerprint-should-not-leak', 'activation-secret-fingerprint',
    'new-fingerprint-secret', 'nested-secret', 'accessLicense', 'must-not-leak', 'signature',
    READER_KEY, OPERATOR_KEY, EXECUTOR_KEY, ADMIN_KEY
  ]) {
    assert.equal(json.includes(token), false, `sensitive token leaked: ${token}`);
  }
}

test('Reader can read only Customer-scoped evidence, activations and account status with sanitized projections', async () => {
  await withFixture(async fixture => {
    const evidence = await request(fixture, READER_KEY, 'GET', '/api/v1/searchad/evidence');
    assert.equal(evidence.status, 200, JSON.stringify(evidence.body));
    assert.deepEqual(evidence.body.items.map(item => item.customerId), ['100']);
    assertNoSensitiveJson(evidence.body);

    const activation = await request(fixture, READER_KEY, 'GET', '/api/v1/searchad/activations');
    assert.equal(activation.status, 200, JSON.stringify(activation.body));
    assert.deepEqual(activation.body.items.map(item => item.customerId), ['100']);
    assertNoSensitiveJson(activation.body);

    const accounts = await request(fixture, READER_KEY, 'GET', '/api/v1/searchad/accounts/control-status');
    assert.equal(accounts.status, 200, JSON.stringify(accounts.body));
    assert.deepEqual(accounts.body.items.map(item => item.customerId), ['100']);
    assertNoSensitiveJson(accounts.body);
  });
});

test('Reader cannot issue trusted Passive evidence while Operator can issue only for a granted Customer', async () => {
  await withFixture(async fixture => {
    const reader = await request(fixture, READER_KEY, 'POST', '/api/v1/searchad/capabilities/passive-evidence', { customerId: '100' });
    assert.equal(reader.status, 403, JSON.stringify(reader.body));
    assert.equal(fixture.calls.some(call => call.type === 'issueEvidence'), false);

    const denied = await request(fixture, OPERATOR_KEY, 'POST', '/api/v1/searchad/capabilities/passive-evidence', { customerId: '200' });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(fixture.calls.some(call => call.type === 'issueEvidence'), false);

    const issued = await request(fixture, OPERATOR_KEY, 'POST', '/api/v1/searchad/capabilities/passive-evidence', { customerId: '100' });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    assert.equal(issued.body.customerId, '100');
    assertNoSensitiveJson(issued.body);
    const call = fixture.calls.find(item => item.type === 'issueEvidence');
    assert.equal(call.context.principal.principalId, 'operator-a');
    assert.equal(call.context.principal.role, 'operator');
  });
});

test('Admin activation accepts exactly evidenceId, binds authenticated principal and sanitizes response', async () => {
  await withFixture(async fixture => {
    const invalid = await request(fixture, ADMIN_KEY, 'POST', '/api/v1/searchad/activations', {
      evidenceId: 'ev-100', customerId: '200'
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
    assert.equal(fixture.calls.some(call => call.type === 'activate'), false);

    const activated = await request(fixture, ADMIN_KEY, 'POST', '/api/v1/searchad/activations', { evidenceId: 'ev-100' });
    assert.equal(activated.status, 201, JSON.stringify(activated.body));
    assert.equal(activated.body.evidenceId, 'ev-100');
    assertNoSensitiveJson(activated.body);
    const call = fixture.calls.find(item => item.type === 'activate');
    assert.equal(call.context.principal.principalId, 'admin-a');
    assert.equal(call.context.principal.role, 'admin');
  });
});

test('cross-Customer evidence and activation lookups are indistinguishable from missing rows', async () => {
  await withFixture(async fixture => {
    for (const pathname of [
      '/api/v1/searchad/evidence/ev-200',
      '/api/v1/searchad/evidence/does-not-exist',
      '/api/v1/searchad/activations/act-200',
      '/api/v1/searchad/activations/does-not-exist'
    ]) {
      const response = await request(fixture, READER_KEY, 'GET', pathname);
      assert.equal(response.status, 404, `${pathname}: ${JSON.stringify(response.body)}`);
    }
  });
});

test('Admin suspend and resume act only on granted Customers with principal-only actor identity', async () => {
  await withFixture(async fixture => {
    const denied = await request(fixture, ADMIN_KEY, 'POST', '/api/v1/searchad/accounts/200/suspend', { actor: 'attacker' });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(fixture.calls.some(call => call.type === 'suspend'), false);

    const suspended = await request(fixture, ADMIN_KEY, 'POST', '/api/v1/searchad/accounts/100/suspend', { actor: 'attacker' });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
    assert.equal(suspended.body.suspended, true);
    let call = fixture.calls.find(item => item.type === 'suspend');
    assert.equal(call.context.principal.principalId, 'admin-a');

    const resumed = await request(fixture, ADMIN_KEY, 'POST', '/api/v1/searchad/accounts/100/resume', { actor: 'attacker' });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.suspended, false);
    call = fixture.calls.find(item => item.type === 'resume');
    assert.equal(call.context.principal.principalId, 'admin-a');
  });
});

test('role-specific activation OpenAPI adds only the paths each role may call', async () => {
  await withFixture(async fixture => {
    const docs = {};
    for (const role of ['reader', 'operator', 'executor', 'admin']) {
      const response = await request(fixture, null, 'GET', `/openapi-searchad-activation-${role}.json`);
      assert.equal(response.status, 200, `${role}: ${JSON.stringify(response.body)}`);
      docs[role] = response.body;
      assertNoSensitiveJson(response.body);
    }
    const readerPaths = docs.reader.paths;
    const operatorPaths = docs.operator.paths;
    const executorPaths = docs.executor.paths;
    const adminPaths = docs.admin.paths;

    assert.ok(readerPaths['/api/v1/searchad/evidence']?.get);
    assert.equal(readerPaths['/api/v1/searchad/capabilities/passive-evidence']?.post, undefined);
    assert.ok(operatorPaths['/api/v1/searchad/capabilities/passive-evidence']?.post);
    assert.ok(executorPaths['/api/v1/searchad/capabilities/passive-evidence']?.post);
    assert.equal(operatorPaths['/api/v1/searchad/activations']?.post, undefined);
    assert.ok(adminPaths['/api/v1/searchad/activations']?.post);
    assert.ok(adminPaths['/api/v1/searchad/accounts/{customerId}/suspend']?.post);
    assert.ok(adminPaths['/api/v1/searchad/accounts/{customerId}/resume']?.post);
  });
});
