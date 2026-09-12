import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Ledger } from '../../src/infrastructure/ledger.js';
import { CatalogRepository } from '../../src/application/catalog-repository.js';
import { SearchAdCredentialsRegistry } from '../../src/naver/searchad/auth.js';
import { loadSearchAdSpecRegistry } from '../../src/naver/searchad/spec-registry.js';
import { NaverSearchAdClient } from '../../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../../src/naver/searchad/gateway.js';
import { SearchAdCapabilityService } from '../../src/naver/searchad/capability.js';
import { createHttpApiV05 } from '../../src/http/server-v05.js';

export const API_KEY = 'fixture-http-key-'.repeat(4);
export const CUSTOMER_ID = '1001';
const logger = { info() {}, warn() {}, error() {} };

// Network responses and activation authorization are explicit test doubles.
// The pinned manifest, signer, client, gateway, SQLite services and HTTP server are real.
export async function startWriteFixture(t, { masterWrites = true, searchAdWrites = true,
  activationGuard = { async assertMutationAllowed() { return { allowed: true }; } }
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-write-integration-'));
  const catalogRoot = path.join(dir, 'catalog');
  fs.mkdirSync(catalogRoot);
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
    source: 'fixture', total_products: 0, total_completed: 0, products: {}
  }));
  const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
  const read = registry.findByPath('GET', '/ncc/keywords/{nccKeywordId}');
  const update = registry.findByPath('PUT', '/ncc/keywords/{nccKeywordId}');
  assert.ok(read && update, 'Pinned official keyword operations must be present');
  let state = { nccKeywordId: 'kw-1', bidAmt: 300, userLock: true, editTm: 'initial' };
  let failNextMutation = false;
  let failNextRead = false;
  const calls = [];
  const credentials = new SearchAdCredentialsRegistry({
    principals: [{ principalId: 'fixture', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
    customers: [{ customerId: CUSTOMER_ID, status: 'active' }],
    grants: [{ principalId: 'fixture', customerId: CUSTOMER_ID, role: 'operator' }]
  });
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.searchad.naver.com');
    assert.equal(init.headers['X-Customer'], CUSTOMER_ID);
    assert.ok(init.headers['X-Signature']);
    const call = { method: init.method, path: new URL(url).pathname,
      query: new URL(url).searchParams.toString(),
      body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (init.method === 'PUT') {
      state = { ...state, ...call.body, editTm: `mutation-${calls.length}` };
      if (failNextMutation) {
        failNextMutation = false;
        throw Object.assign(new Error('Simulated connection reset after apply'), { code: 'ECONNRESET' });
      }
    } else if (init.method === 'GET') {
      if (failNextRead) { failNextRead = false; throw new Error('Simulated read outage'); }
    } else throw new Error(`Unexpected fixture network method: ${init.method}`);
    return new Response(JSON.stringify(state), {
      status: 200, headers: { 'content-type': 'application/json', 'x-request-id': `fixture-${calls.length}` }
    });
  };
  const config = {
    enabled: true, configured: true, allowReads: true, allowWrites: searchAdWrites,
    allowCreates: true, allowBatchWrites: true, allowDeletes: true, allowRollbacks: true,
    allowActiveCanary: false, allowUnverifiedOperations: false, automationMode: 'observe',
    passiveProbeLimit: 10, maxJsonBodyBytes: 1024 * 1024, requestTimeoutMs: 1000
  };
  const client = new NaverSearchAdClient({ credentialsRegistry: credentials, fetchImpl, maxRetries: 0, logger });
  const gateway = new SearchAdOperationGateway({ client, config, registry, credentialsRegistry: credentials, logger });
  const ledger = new Ledger(path.join(dir, 'ledger.sqlite'));
  const app = {
    config: { catalogRoot, workDir: dir, templateFile: path.join(dir, 'template.json'),
      databasePath: path.join(dir, 'ledger.sqlite'), categories: {},
      naver: { clientId: 'fixture', clientSecret: 'fixture', tokenType: 'SELF', allowWrites: false } },
    ledger, catalogRepository: new CatalogRepository(catalogRoot), productService: {}, productsApi: {}, detailContentService: {},
    driveConfig: {}, driveService: null, catalogProvider: 'local', catalogMaterializer: null,
    commerceConfig: { maxJsonBodyBytes: 1024 * 1024 }, commerceManifest: { operations: [] },
    commerceGateway: { status() { return { ready: true }; } },
    searchAdConfig: config, searchAdRegistry: registry, searchAdCredentials: credentials,
    searchAdClient: client, searchAdGateway: gateway,
    searchAdActivationRuntime: { guard: activationGuard },
    searchAdCapabilityService: new SearchAdCapabilityService({ gateway, config })
  };
  const env = {
    ATELIER_API_KEY: API_KEY, ATELIER_HTTP_ALLOW_WRITES: String(masterWrites),
    ATELIER_SEARCHAD_ALLOW_WRITES: String(searchAdWrites), ATELIER_SEARCHAD_ALLOW_ROLLBACK: 'true',
    ATELIER_SEARCHAD_WRITE_DB_PATH: path.join(dir, 'writes.sqlite'),
    ATELIER_WRITE_RATE_LIMIT_PER_MINUTE: '1000'
  };
  const api = createHttpApiV05({ app, env, logger });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  t.after(async () => { await api.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const call = async (method, route, body, { authenticated = true } = {}) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method, headers: { ...(authenticated ? { Authorization: `Bearer ${API_KEY}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  const descriptor = (op = update, body = { bidAmt: 500 }) => ({
    operationKey: op.operationKey, pathParams: { nccKeywordId: 'kw-1' },
    query: op.sideEffect ? { fields: 'bidAmt' } : {},
    ...(op.sideEffect ? { body, confirmation: op.confirmation } : {})
  });
  const planInput = () => ({
    customerId: CUSTOMER_ID, createdBy: 'fixture-planner', reason: 'Contract regression test',
    mutation: descriptor(), verification: { read: descriptor(read), expectedPatch: { bidAmt: 500 } },
    rollback: { mutation: descriptor(update, {}), bodyFromBefore: { bidAmt: 'bidAmt' } }
  });
  const approve = async () => {
    const planned = await call('POST', '/api/v1/searchad/changes/plan', planInput());
    assert.equal(planned.status, 201, JSON.stringify(planned));
    const planId = planned.body.plan_id;
    const approved = await call('POST', `/api/v1/searchad/changes/${planId}/approve`, {
      actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE'
    });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    return { planId, executionToken: approved.body.executionToken,
      idempotencyKey: `fixture-${planId}`, customerId: CUSTOMER_ID };
  };
  return { app, api, gateway, registry, calls, read, update, call, descriptor, planInput, approve,
    state: () => structuredClone(state), setState: patch => { state = { ...state, ...patch }; },
    failMutation: () => { failNextMutation = true; }, failRead: () => { failNextRead = true; },
    mutations: () => calls.filter(c => c.method !== 'GET') };
}
