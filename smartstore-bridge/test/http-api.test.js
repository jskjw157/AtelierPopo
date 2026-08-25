import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/infrastructure/ledger.js';
import { CatalogRepository } from '../src/application/catalog-repository.js';
import { createHttpApi } from '../src/http/server.js';

const API_KEY = 'a'.repeat(48);
const silentLogger = { info() {}, warn() {}, error() {} };

function createFixture({ writes = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-http-'));
  const catalogRoot = path.join(dir, 'catalog');
  const productDir = path.join(catalogRoot, '귀걸이', '1905_샘플');
  fs.mkdirSync(path.join(productDir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(productDir, 'product_info.json'), JSON.stringify({
    product_id: '1905',
    name: '925 실버 물방울 귀걸이',
    categories: ['귀걸이'],
    sale_price_display: '14,500원',
    downloaded_images: ['001_a.jpg'],
    sold_out: false
  }));
  fs.writeFileSync(path.join(productDir, 'images', '001_a.jpg'), 'fixture');
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
    source: 'fixture',
    total_products: 1,
    total_completed: 1,
    products: {
      '1905': {
        product_id: '1905',
        name: '925 실버 물방울 귀걸이',
        categories: ['귀걸이'],
        local_folder: '귀걸이\\1905_샘플',
        completed: true,
        image_count: 1,
        option_count: 0
      }
    }
  }));
  const templateFile = path.join(dir, 'template.json');
  fs.writeFileSync(templateFile, '{}');
  const ledger = new Ledger(path.join(dir, 'work.sqlite'));
  const catalogRepository = new CatalogRepository(catalogRoot);
  let createCalls = 0;
  const preview = {
    source: {
      productId: '1905',
      name: '925 실버 물방울 귀걸이',
      categories: ['귀걸이'],
      soldOut: false,
      sourcePath: path.join(productDir, 'product_info.json'),
      sourceUrl: 'https://example.test/product/1905'
    },
    sellerManagementCode: 'QUEEN-1905',
    categoryId: '500001',
    price: { salePrice: 35900 },
    options: null,
    imagePlan: {
      representative: path.join(productDir, 'images', '001_a.jpg'),
      detailCount: 1,
      detail: [path.join(productDir, 'images', '001_a.jpg')]
    },
    payload: {
      originProduct: {
        images: { representativeImage: { url: `local://${path.join(productDir, 'images', '001_a.jpg')}` } },
        detailContent: `<img src="local://${path.join(productDir, 'images', '001_a.jpg')}">`
      }
    },
    validationErrors: [],
    executable: true
  };
  const app = {
    config: {
      catalogRoot,
      templateFile,
      databasePath: path.join(dir, 'work.sqlite'),
      categories: { 귀걸이: '500001' },
      sellerCodePrefix: 'QUEEN',
      writeConfirmation: 'REGISTER',
      batch: { maxSize: 20 },
      naver: {
        clientId: 'client',
        clientSecret: 'secret',
        tokenType: 'SELF',
        allowWrites: writes
      }
    },
    ledger,
    catalogRepository,
    productsApi: {
      async findBySellerManagementCode() { return null; }
    },
    productService: {
      preview() { return structuredClone(preview); },
      enqueueCatalog() { return { total: 1, queued: 1, failed: 0, failures: [] }; },
      async create() {
        createCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { status: 'created', originProductNo: '10', channelProductNo: '20' };
      },
      async runBatch() { return { requested: 0, succeeded: 0, failed: 0, results: [] }; }
    }
  };
  const env = {
    ATELIER_API_KEY: API_KEY,
    ATELIER_HTTP_ALLOW_WRITES: String(writes),
    ATELIER_HTTP_ALLOW_BATCH_WRITES: 'false',
    ATELIER_TRUST_PROXY: 'false',
    ATELIER_OPERATION_CONCURRENCY: '1'
  };
  return { dir, app, env, getCreateCalls: () => createCalls };
}

async function startFixture(options) {
  const fixture = createFixture(options);
  const api = createHttpApi({ app: fixture.app, env: fixture.env, logger: silentLogger });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { ...fixture, api, baseUrl };
}

async function authorizedFetch(baseUrl, pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

async function waitForOperation(baseUrl, operationId) {
  for (let index = 0; index < 50; index += 1) {
    const response = await authorizedFetch(baseUrl, `/api/v1/operations/${operationId}`);
    const data = await response.json();
    if (['succeeded', 'failed', 'interrupted'].includes(data.operation.status)) return data.operation;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('operation timeout');
}

test('health는 공개하고 API 경로는 Bearer 키로 보호한다', async () => {
  const fixture = await startFixture();
  try {
    const health = await fetch(`${fixture.baseUrl}/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.ok, true);
    assert.equal('readiness' in healthBody, false);

    const unauthorized = await fetch(`${fixture.baseUrl}/api/v1/status`);
    assert.equal(unauthorized.status, 401);

    const authorized = await authorizedFetch(fixture.baseUrl, '/api/v1/status');
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).ok, true);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('상품번호 기반 preview에서 서버 절대경로를 노출하지 않는다', async () => {
  const fixture = await startFixture();
  try {
    const response = await authorizedFetch(fixture.baseUrl, '/api/v1/products/1905/preview?includePayload=true', {
      method: 'POST',
      body: '{}'
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.preview.imagePlan.representative, '001_a.jpg');
    assert.equal(JSON.stringify(data).includes(fixture.dir), false);
    assert.match(data.preview.payload.originProduct.images.representativeImage.url, /^local:\/\/catalog\//);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('원격 쓰기 잠금이 꺼져 있으면 상품 등록을 차단한다', async () => {
  const fixture = await startFixture({ writes: false });
  try {
    const response = await authorizedFetch(fixture.baseUrl, '/api/v1/products/1905/register', {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'REGISTER', idempotencyKey: 'register-1905-lock-test' })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'HTTP_WRITES_DISABLED');
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('상품 등록은 비동기 작업으로 실행하고 같은 멱등성 키는 한 번만 처리한다', async () => {
  const fixture = await startFixture({ writes: true });
  try {
    const body = JSON.stringify({ confirmation: 'REGISTER', idempotencyKey: 'register-1905-once-001' });
    const first = await authorizedFetch(fixture.baseUrl, '/api/v1/products/1905/register', { method: 'POST', body });
    assert.equal(first.status, 202);
    const firstData = await first.json();
    const operation = await waitForOperation(fixture.baseUrl, firstData.operation.operationId);
    assert.equal(operation.status, 'succeeded');
    assert.equal(operation.result.status, 'created');

    const repeated = await authorizedFetch(fixture.baseUrl, '/api/v1/products/1905/register', { method: 'POST', body });
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).reused, true);
    assert.equal(fixture.getCreateCalls(), 1);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
