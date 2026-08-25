import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/infrastructure/ledger.js';
import { CatalogRepository } from '../src/application/catalog-repository.js';
import { CommerceOperationGateway } from '../src/naver/commerce/gateway.js';
import { loadCommerceManifest } from '../src/naver/commerce/spec.js';
import { createHttpApiV04 } from '../src/http/server-v04.js';

const API_KEY = 'c'.repeat(48);
const silentLogger = { info() {}, warn() {}, error() {} };

function createFixture({ writes = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-http-'));
  const catalogRoot = path.join(dir, 'catalog');
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
    source: 'fixture', total_products: 0, total_completed: 0, products: {}
  }));
  const templateFile = path.join(dir, 'template.json');
  fs.writeFileSync(templateFile, '{}');
  const ledger = new Ledger(path.join(dir, 'work.sqlite'));
  const calls = [];
  const fakeClient = {
    async requestDetailed(method, apiPath, options) {
      calls.push({ method, apiPath, options });
      return {
        status: 200, data: { method, apiPath, query: options.query, body: options.json },
        traceId: 'trace-http', headers: {}, url: `https://api.test${apiPath}`,
        method, attempts: 1, redirects: 0, responseTimeMs: 1
      };
    }
  };
  const commerceConfig = {
    enabled: true,
    manifestPath: path.resolve('specs/naver-commerce/current.json'),
    allowReads: true,
    allowWrites: writes,
    allowDeletes: writes,
    allowOrders: writes,
    allowClaims: writes,
    allowInquiries: writes,
    allowSolutions: writes,
    allowSellerWrites: writes,
    allowMultipartUploads: writes,
    allowUnverifiedOperations: true,
    exposePersonalData: false,
    maxJsonBodyBytes: 1024 * 1024,
    maxUploadFiles: 10,
    maxInlineUploadBytes: 1024 * 1024,
    backupDir: path.join(dir, 'backups')
  };
  const commerceManifest = loadCommerceManifest(commerceConfig.manifestPath);
  const commerceGateway = new CommerceOperationGateway({
    client: fakeClient,
    config: commerceConfig,
    manifest: commerceManifest,
    logger: silentLogger
  });
  const app = {
    config: {
      catalogRoot,
      workDir: dir,
      templateFile,
      databasePath: path.join(dir, 'work.sqlite'),
      categories: {},
      naver: { clientId: 'client', clientSecret: 'secret', tokenType: 'SELF', allowWrites: writes }
    },
    ledger,
    catalogRepository: new CatalogRepository(catalogRoot),
    productService: {
      enqueueCatalog() { return { total: 0, queued: 0, failed: 0 }; },
      runBatch() { return { requested: 0, results: [] }; }
    },
    productsApi: {
      async getChannelProduct(no) {
        return {
          originProduct: { originProductNo: '10', detailContent: '<p>old</p>' },
          smartstoreChannelProduct: { channelProductNo: no }
        };
      },
      async getOriginProduct(no) { return { originProduct: { originProductNo: no } }; },
      async findBySellerManagementCode() { return null; }
    },
    detailContentService: {
      async previewChannelUpdate(channelProductNo, detailContent) {
        return {
          channelProductNo, originProductNo: '10', changed: detailContent !== '<p>old</p>',
          current: { length: 10, sha256: 'old' }, next: { length: detailContent.length, sha256: 'new' }
        };
      },
      async updateChannelDetail(channelProductNo) {
        return { status: 'updated', channelProductNo, backupId: 'backup-1', detailContentSha256: 'new' };
      },
      loadBackup(backupId) { return { backupId, channelProductNo: '20' }; },
      async rollbackChannelDetail(backupId) { return { status: 'rolled_back', backupId, channelProductNo: '20' }; }
    },
    driveConfig: {},
    driveService: null,
    catalogProvider: 'local',
    catalogMaterializer: null,
    driveStartupError: null,
    commerceConfig,
    commerceManifest,
    commerceGateway,
    commerceStartupError: null
  };
  const env = {
    ATELIER_API_KEY: API_KEY,
    ATELIER_HTTP_ALLOW_WRITES: String(writes),
    ATELIER_HTTP_ALLOW_BATCH_WRITES: String(writes),
    ATELIER_TRUST_PROXY: 'false',
    ATELIER_OPERATION_CONCURRENCY: '1'
  };
  return { dir, app, env, calls };
}

async function startFixture(options) {
  const fixture = createFixture(options);
  const api = createHttpApiV04({ app: fixture.app, env: fixture.env, logger: silentLogger });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  return { ...fixture, api, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function call(fixture, method, pathname, body) {
  return fetch(`${fixture.baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function waitForOperation(fixture, operationId) {
  for (let i = 0; i < 50; i += 1) {
    const response = await call(fixture, 'GET', `/api/v1/operations/${operationId}`);
    const data = await response.json();
    if (['succeeded', 'failed', 'interrupted'].includes(data.operation.status)) return data.operation;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('operation timeout');
}

test('commerce HTTP API exposes exactly 116 official operations', async () => {
  const fixture = await startFixture();
  try {
    const response = await call(fixture, 'GET', '/api/v1/commerce/operations?limit=1');
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.total, 116);
    assert.equal(data.items.length, 1);

    const openapi = await fetch(`${fixture.baseUrl}/openapi.json`);
    const spec = await openapi.json();
    assert.ok(spec.paths['/api/v1/commerce/operations/{operationId}/execute']);
    assert.ok(spec.paths['/api/v1/commerce/products/channel/{channelProductNo}/detail/update']);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('generic read operation executes through the allowlisted manifest', async () => {
  const fixture = await startFixture();
  try {
    const response = await call(fixture, 'POST', '/api/v1/commerce/operations/get_v1_categories/execute', {
      query: { last: true }
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.result.operation.operationId, 'get_v1_categories');
    assert.equal(fixture.calls[0].apiPath, '/v1/categories');
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('generic write is blocked until all write gates are enabled', async () => {
  const fixture = await startFixture({ writes: false });
  try {
    const response = await call(fixture, 'POST', '/api/v1/commerce/operations/put_v1_products_origin_products_by_origin_product_no_change_status/execute', {
      pathParams: { originProductNo: '10' },
      body: { statusType: 'SUSPENSION' },
      confirmation: 'EXECUTE_COMMERCE_WRITE',
      idempotencyKey: 'commerce-write-lock-001'
    });
    assert.equal(response.status, 403);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('enabled generic write runs asynchronously with idempotency', async () => {
  const fixture = await startFixture({ writes: true });
  try {
    const body = {
      pathParams: { originProductNo: '10' },
      body: { statusType: 'SUSPENSION' },
      confirmation: 'EXECUTE_COMMERCE_WRITE',
      idempotencyKey: 'commerce-write-enabled-001'
    };
    const response = await call(fixture, 'POST', '/api/v1/commerce/operations/put_v1_products_origin_products_by_origin_product_no_change_status/execute', body);
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const operation = await waitForOperation(fixture, accepted.operation.operationId);
    assert.equal(operation.status, 'succeeded');
    assert.equal(fixture.calls.at(-1).method, 'PUT');
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('existing product detail update has preview and async write actions', async () => {
  const fixture = await startFixture({ writes: true });
  try {
    const preview = await call(fixture, 'POST', '/api/v1/commerce/products/channel/20/detail/preview', {
      detailContent: '<p>new</p>'
    });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).preview.requiredConfirmation, 'UPDATE_PRODUCT_DETAIL');

    const update = await call(fixture, 'POST', '/api/v1/commerce/products/channel/20/detail/update', {
      detailContent: '<p>new</p>',
      confirmation: 'UPDATE_PRODUCT_DETAIL',
      secondConfirmation: '20',
      idempotencyKey: 'detail-update-20-001'
    });
    assert.equal(update.status, 202);
    const accepted = await update.json();
    const operation = await waitForOperation(fixture, accepted.operation.operationId);
    assert.equal(operation.status, 'succeeded');
    assert.equal(operation.result.status, 'updated');
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
