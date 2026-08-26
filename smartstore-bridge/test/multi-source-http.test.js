import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/infrastructure/ledger.js';
import { CatalogRepository } from '../src/application/catalog-repository.js';
import { CatalogSourceRegistry, SalesChannelRegistry } from '../src/catalog/multi-source/source-registry.js';
import { createHttpApiV05 } from '../src/http/server-v05.js';

const API_KEY = 'm'.repeat(48);
const silentLogger = { info() {}, warn() {}, error() {} };

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-source-http-'));
  const catalogRoot = path.join(dir, 'catalog');
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
    source: 'fixture', total_products: 0, total_completed: 0, products: {}
  }));
  const templateFile = path.join(dir, 'template.json');
  fs.writeFileSync(templateFile, '{}');
  const ledger = new Ledger(path.join(dir, 'work.sqlite'));
  const source = {
    sourceId: 'supplier_a', sourceName: '공급처 A', sourceType: 'supplier', providerType: 'other',
    rootReference: null, credentialRef: null, defaultCurrency: 'KRW', status: 'active', canonical: false, metadata: {}
  };
  const catalogSourceRegistry = new CatalogSourceRegistry({ sources: [source], logger: silentLogger });
  catalogSourceRegistry.registerProvider('supplier_a', {
    async status() { return { ready: true, totalProducts: 1 }; },
    async listChanges() { return { items: [{ sourceId: 'supplier_a', sourceProductId: '1905', name: '공급처 상품' }], nextCursor: null, hasMore: false, totalAvailable: 1 }; },
    async getSourceProduct(id) { return { product_id: id, name: '공급처 상품' }; },
    async hydrateAssets(id) { return { sourceId: 'supplier_a', sourceProductId: id, downloadedImages: 1 }; },
    async normalize(raw) { return { sourceId: 'supplier_a', sourceProductId: String(raw.product_id), sourceProductName: raw.name }; }
  });
  const channels = [
    {
      channelId: 'haar_naver_smartstore', channelName: 'HAAR 스마트스토어', channelRole: 'marketplace',
      platformType: 'naver_smartstore', externalStoreId: null, primaryDomain: null, accountReference: null, status: 'active', metadata: {}
    },
    {
      channelId: 'haar_own_mall', channelName: 'HAAR 자사몰', channelRole: 'owned_store',
      platformType: 'cafe24', externalStoreId: 'haar', primaryDomain: 'haar.co.kr', accountReference: 'haar', status: 'active', metadata: {}
    }
  ];
  const multiSourceCatalogConfig = {
    enabled: true,
    defaultSourceId: 'supplier_a',
    cacheRoot: path.join(dir, 'source-cache'),
    sources: [source],
    channels,
    naverChannelId: 'haar_naver_smartstore',
    ownMallChannelId: 'haar_own_mall'
  };
  const app = {
    config: {
      catalogRoot, workDir: dir, templateFile, databasePath: path.join(dir, 'work.sqlite'), categories: {},
      naver: { clientId: 'client', clientSecret: 'secret', tokenType: 'SELF', allowWrites: false }
    },
    ledger,
    catalogRepository: new CatalogRepository(catalogRoot),
    productService: { enqueueCatalog() { return { total: 0 }; }, runBatch() { return { results: [] }; } },
    productsApi: { async findBySellerManagementCode() { return null; } },
    detailContentService: {},
    driveConfig: {}, driveService: null, catalogProvider: 'local', catalogMaterializer: null, driveStartupError: null,
    commerceConfig: { maxJsonBodyBytes: 1024 * 1024 },
    commerceManifest: { operations: Array.from({ length: 116 }, (_, index) => ({ operationId: `op-${index}` })) },
    commerceGateway: { status() { return { ready: true }; }, list() { return { total: 0, items: [] }; } },
    commerceStartupError: null,
    searchAdConfig: null, searchAdRegistry: null, searchAdCredentials: null, searchAdClient: null,
    searchAdGateway: null, searchAdCapabilityService: null, searchAdStartupError: null,
    multiSourceCatalogConfig,
    catalogSourceRegistry,
    salesChannelRegistry: new SalesChannelRegistry(channels),
    multiSourceCatalogStartupErrors: [],
    multiSourceCatalogStartupError: null
  };
  const env = {
    ATELIER_API_KEY: API_KEY,
    ATELIER_HTTP_ALLOW_WRITES: 'false',
    ATELIER_HTTP_ALLOW_BATCH_WRITES: 'false',
    ATELIER_TRUST_PROXY: 'false',
    ATELIER_OPERATION_CONCURRENCY: '1'
  };
  return { dir, app, env };
}

async function startFixture() {
  const fixture = createFixture();
  const api = createHttpApiV05({ app: fixture.app, env: fixture.env, logger: silentLogger, version: '0.5.1' });
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

test('multi-source API exposes source products and one Cafe24 own-mall channel', async () => {
  const fixture = await startFixture();
  try {
    const statusResponse = await call(fixture, 'GET', '/api/v1/catalog/multi-source/status');
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.channels.ownMall.channelId, 'haar_own_mall');
    assert.equal(status.channels.ownMall.platformType, 'cafe24');

    const sourcesResponse = await call(fixture, 'GET', '/api/v1/catalog/sources');
    assert.equal(sourcesResponse.status, 200);
    assert.equal((await sourcesResponse.json()).sources.length, 1);

    const productsResponse = await call(fixture, 'GET', '/api/v1/catalog/sources/supplier_a/products');
    const products = await productsResponse.json();
    assert.equal(products.items[0].sourceProductId, '1905');

    const productResponse = await call(fixture, 'GET', '/api/v1/catalog/sources/supplier_a/products/1905');
    const product = await productResponse.json();
    assert.equal(product.sourceProduct.sourceId, 'supplier_a');
    assert.equal(product.sourceProduct.sourceProductId, '1905');

    const channelsResponse = await call(fixture, 'GET', '/api/v1/sales-channels');
    const channelData = await channelsResponse.json();
    assert.equal(channelData.channels.filter(item => item.platformType === 'cafe24').length, 1);

    const openapi = await fetch(`${fixture.baseUrl}/openapi-catalog.json`);
    assert.equal(openapi.status, 200);
    const spec = await openapi.json();
    assert.ok(spec.paths['/api/v1/catalog/sources/{sourceId}/products/{sourceProductId}']);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
