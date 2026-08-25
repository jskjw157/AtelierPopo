import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/infrastructure/ledger.js';
import { CatalogRepository } from '../src/application/catalog-repository.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { SearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { SearchAdCapabilityService } from '../src/naver/searchad/capability.js';
import { createHttpApiV05 } from '../src/http/server-v05.js';

const API_KEY = 's'.repeat(48);
const silentLogger = { info() {}, warn() {}, error() {} };

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'searchad-http-'));
  const catalogRoot = path.join(dir, 'catalog');
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({ source: 'fixture', total_products: 0, total_completed: 0, products: {} }));
  const ledger = new Ledger(path.join(dir, 'work.sqlite'));
  const manifest = {
    specRef: 'fixture', generatedAt: '2026-08-25T00:00:00Z', baseUrl: 'https://api.searchad.naver.com', sources: [{}], counts: {},
    operations: [{
      operationKey: 'ncc.get.list_campaigns__p_ncc_campaigns', sourceId: 'ncc', sourceOperationId: 'listCampaigns',
      method: 'GET', path: '/ncc/campaigns', rawPath: '/api/ncc/campaigns', domain: 'campaign', tags: ['Campaign'],
      summary: 'list', action: 'read', sideEffect: false, destructive: false, batch: false, risk: 'low', state: 'public_documented',
      tier: 'B', runtimeAllowlisted: true, requiredGate: 'reads', confirmation: null, capabilityKey: 'campaign.read', parameters: [], specRef: 'fixture'
    }]
  };
  const searchAdRegistry = new SearchAdSpecRegistry(manifest);
  const searchAdCredentials = new SearchAdCredentialsRegistry({
    principals: [{ principalId: 'p', accessLicense: 'license', secretKey: 'secret', status: 'active' }],
    customers: [{ customerId: '1001', status: 'active' }],
    grants: [{ principalId: 'p', customerId: '1001', role: 'operator' }]
  });
  const calls = [];
  const searchAdConfig = {
    enabled: true, configured: true, allowReads: true, allowWrites: false, allowCreates: false, allowBatchWrites: false,
    allowRollbacks: false, allowDeletes: false, allowActiveCanary: false, allowUnverifiedOperations: false,
    automationMode: 'observe', passiveProbeLimit: 10, maxJsonBodyBytes: 1024 * 1024, requestTimeoutMs: 1000
  };
  const searchAdClient = {
    async request(input) {
      calls.push(input);
      return { status: 200, data: [], requestId: 'searchad-http-request', attempts: 1, durationMs: 1, headers: {} };
    }
  };
  const searchAdGateway = new SearchAdOperationGateway({ client: searchAdClient, config: searchAdConfig, registry: searchAdRegistry, credentialsRegistry: searchAdCredentials, logger: silentLogger });
  const searchAdCapabilityService = new SearchAdCapabilityService({ gateway: searchAdGateway, config: searchAdConfig });
  const app = {
    config: {
      catalogRoot, workDir: dir, templateFile: path.join(dir, 'template.json'), databasePath: path.join(dir, 'work.sqlite'), categories: {},
      naver: { clientId: 'client', clientSecret: 'secret', tokenType: 'SELF', allowWrites: false }
    },
    ledger,
    catalogRepository: new CatalogRepository(catalogRoot),
    productService: { enqueueCatalog() { return { total: 0, queued: 0, failed: 0 }; }, runBatch() { return { requested: 0, results: [] }; } },
    productsApi: { async findBySellerManagementCode() { return null; } },
    detailContentService: {},
    driveConfig: {}, driveService: null, catalogProvider: 'local', catalogMaterializer: null, driveStartupError: null,
    commerceConfig: { maxJsonBodyBytes: 1024 * 1024 },
    commerceManifest: { operations: Array.from({ length: 115 }, (_, index) => ({ operationId: `op-${index}` })) },
    commerceGateway: { status() { return { ready: true }; }, list() { return { total: 0, items: [] }; } },
    commerceStartupError: null,
    searchAdConfig, searchAdRegistry, searchAdCredentials, searchAdClient, searchAdGateway, searchAdCapabilityService, searchAdStartupError: null
  };
  const env = {
    ATELIER_API_KEY: API_KEY,
    ATELIER_HTTP_ALLOW_WRITES: 'false',
    ATELIER_HTTP_ALLOW_BATCH_WRITES: 'false',
    ATELIER_TRUST_PROXY: 'false',
    ATELIER_OPERATION_CONCURRENCY: '1'
  };
  return { dir, app, env, calls };
}

async function startFixture() {
  const fixture = createFixture();
  const api = createHttpApiV05({ app: fixture.app, env: fixture.env, logger: silentLogger });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  return { ...fixture, api, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function call(fixture, method, pathname, body) {
  return fetch(`${fixture.baseUrl}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

test('SearchAd HTTP API exposes status, manifest and read execution', async () => {
  const fixture = await startFixture();
  try {
    const status = await call(fixture, 'GET', '/api/v1/searchad/status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).searchAd.automationMode, 'observe');

    const operations = await call(fixture, 'GET', '/api/v1/searchad/operations?runtimeOnly=true');
    assert.equal(operations.status, 200);
    assert.equal((await operations.json()).total, 1);

    const execution = await call(fixture, 'POST', '/api/v1/searchad/operations/ncc.get.list_campaigns__p_ncc_campaigns/execute', { customerId: '1001' });
    assert.equal(execution.status, 200);
    assert.equal((await execution.json()).result.upstream.requestId, 'searchad-http-request');
    assert.equal(fixture.calls.length, 1);

    const openapi = await fetch(`${fixture.baseUrl}/openapi-searchad.json`);
    assert.equal(openapi.status, 200);
    const spec = await openapi.json();
    assert.ok(spec.paths['/api/v1/searchad/capabilities/passive-probe']);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
