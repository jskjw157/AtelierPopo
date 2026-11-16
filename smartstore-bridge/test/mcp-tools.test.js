import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { registerTools } from '../src/mcp/tools.js';
import { ProductService } from '../src/application/product-service.js';

const expectedTools = [
  'atelier_auth_test',
  'atelier_batch_status',
  'atelier_catalog_stats',
  'atelier_create_product',
  'atelier_find_product',
  'atelier_preview_product'
];

function createHarness({ productService, productsApi, ledger } = {}) {
  const tools = new Map();
  const server = {
    registerTool(name, definition, handler) {
      tools.set(name, { definition, handler });
    }
  };
  const calls = { preview: [], find: [], create: [], list: [] };
  const app = {
    config: {
      naver: {
        clientId: 'client-id',
        clientSecret: bcrypt.hashSync('seed', 4).slice(0, 29),
        tokenType: 'SELF',
        accountId: '',
        baseUrl: 'https://api.commerce.naver.com/external'
      },
      catalogRoot: '/tmp/local-demo-catalog',
      sellerCodePrefix: 'QUEEN',
      writeConfirmation: 'REGISTER'
    },
    productService: productService || {
      async preview(productPath) {
        calls.preview.push(productPath);
        return { preview: productPath };
      },
      async create(productPath, options) {
        calls.create.push({ productPath, options });
        return { status: 'created' };
      }
    },
    productsApi: productsApi || {
      async findBySellerManagementCode(sellerManagementCode) {
        calls.find.push(sellerManagementCode);
        return { channelProductNo: '123' };
      }
    },
    ledger: ledger || {
      counts() { return { queued: 2, created: 1 }; },
      list(args) {
        calls.list.push(args);
        return [{ source_product_id: '1905' }];
      }
    }
  };
  const logger = {
    errors: [],
    error(message, context) { this.errors.push({ message, context }); }
  };
  registerTools(server, { app, logger });
  return {
    tools,
    app,
    logger,
    calls,
    call(name, args) {
      return tools.get(name).handler(args);
    }
  };
}

function parseResult(result) {
  return JSON.parse(result.content[0].text);
}

test('MCP registers exactly the six tools', () => {
  const { tools } = createHarness();
  assert.equal(tools.size, 6);
  assert.deepEqual([...tools.keys()].sort(), [...expectedTools].sort());
});

test('atelier_preview_product forwards productPath to ProductService.preview', async () => {
  const harness = createHarness();
  const result = await harness.call('atelier_preview_product', { productPath: '/tmp/product_info.json' });
  assert.deepEqual(harness.calls.preview, ['/tmp/product_info.json']);
  assert.deepEqual(parseResult(result), { preview: '/tmp/product_info.json' });
});

test('atelier_find_product builds the seller management code and calls the products API', async () => {
  const harness = createHarness();
  const result = await harness.call('atelier_find_product', { sourceProductId: '1905' });
  assert.deepEqual(harness.calls.find, ['QUEEN-1905']);
  assert.deepEqual(parseResult(result), {
    sellerManagementCode: 'QUEEN-1905',
    product: { channelProductNo: '123' }
  });
});

test('atelier_create_product forwards productPath and confirm to ProductService.create', async () => {
  const harness = createHarness();
  const result = await harness.call('atelier_create_product', {
    productPath: '/tmp/product_info.json',
    confirm: 'REGISTER'
  });
  assert.deepEqual(harness.calls.create, [{
    productPath: '/tmp/product_info.json',
    options: { confirm: 'REGISTER' }
  }]);
  assert.deepEqual(parseResult(result), { status: 'created' });
});

test('atelier_batch_status forwards filters and returns ledger counts', async () => {
  const harness = createHarness();
  const result = await harness.call('atelier_batch_status', { status: 'queued', limit: 7 });
  assert.deepEqual(harness.calls.list, [{ status: 'queued', limit: 7 }]);
  assert.deepEqual(parseResult(result), {
    counts: { queued: 2, created: 1 },
    jobs: [{ source_product_id: '1905' }]
  });
});

test('a thrown handler error returns isError and logs without throwing', async () => {
  const harness = createHarness({
    productService: {
      async preview() { throw new Error('boom'); }
    }
  });
  const result = await harness.call('atelier_preview_product', { productPath: '/tmp/nope.json' });
  assert.equal(result.isError, true);
  assert.deepEqual(parseResult(result), { error: 'boom', name: 'Error' });
  assert.equal(harness.logger.errors.length, 1);
  assert.equal(harness.logger.errors[0].message, 'boom');
});

test('atelier_auth_test never returns the access token', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async url => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          access_token: 'secret-access-token-value',
          token_type: 'Bearer',
          expires_in: 3600
        });
      },
      headers: { get() { return null; } }
    };
  };
  try {
    const harness = createHarness();
    const result = await harness.call('atelier_auth_test', {});
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text.includes('secret-access-token-value'), false);
    assert.deepEqual(parseResult(result), { ok: true, tokenType: 'Bearer', expiresIn: 3600 });
    assert.match(requestedUrl, /\/v1\/oauth2\/token$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createRealProductService({ allowWrites }) {
  const remote = { find: 0, create: 0 };
  const productsApi = {
    async findBySellerManagementCode() {
      remote.find += 1;
      return null;
    },
    async create() {
      remote.create += 1;
      return {};
    }
  };
  const productService = new ProductService({
    config: {
      naver: { allowWrites },
      writeConfirmation: 'REGISTER',
      categories: {},
      images: {},
      pricing: {},
      defaultStockQuantity: 1,
      includeSoldOut: false,
      workDir: '/tmp'
    },
    client: {},
    productsApi,
    ledger: null
  });
  return { productService, remote };
}

test('real ProductService rejects creation when NAVER_ALLOW_WRITES is false', async () => {
  const { productService, remote } = createRealProductService({ allowWrites: false });
  await assert.rejects(
    () => productService.create('/tmp/nope.json', { confirm: 'REGISTER' }),
    /NAVER_ALLOW_WRITES/
  );
  assert.equal(remote.find, 0);
  assert.equal(remote.create, 0);
});

test('real ProductService rejects creation when the confirmation is wrong', async () => {
  const { productService, remote } = createRealProductService({ allowWrites: true });
  await assert.rejects(
    () => productService.create('/tmp/nope.json', { confirm: 'WRONG' }),
    /확인 문구/
  );
  assert.equal(remote.find, 0);
  assert.equal(remote.create, 0);
});

test('atelier_create_product surfaces the real ProductService gate error', async () => {
  const { productService, remote } = createRealProductService({ allowWrites: false });
  const harness = createHarness({ productService });
  const result = await harness.call('atelier_create_product', {
    productPath: '/tmp/nope.json',
    confirm: 'REGISTER'
  });
  assert.equal(result.isError, true);
  assert.match(parseResult(result).error, /NAVER_ALLOW_WRITES/);
  assert.equal(remote.find, 0);
  assert.equal(remote.create, 0);
  assert.equal(harness.logger.errors.length, 1);
});
