import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCafe24Config } from '../src/cafe24/config.js';
import { FileCafe24TokenStore } from '../src/cafe24/token-store.js';
import { Cafe24TokenProvider } from '../src/cafe24/auth.js';
import { Cafe24AdminClient } from '../src/cafe24/client.js';

const silentLogger = { info() {}, warn() {}, error() {} };

test('configuration requires mall.read_product and builds one HAAR mall origin', () => {
  const config = loadCafe24Config({
    CAFE24_MALL_ID: 'haar',
    CAFE24_CLIENT_ID: 'id',
    CAFE24_CLIENT_SECRET: 'secret',
    CAFE24_SCOPES: 'mall.read_product',
    CAFE24_TOKEN_STORE_PATH: './work/test-cafe24-tokens.json'
  }, { cwd: '/tmp/haar' });
  assert.equal(config.shopNo, 1);
  assert.equal(config.baseUrl, 'https://haar.cafe24api.com/api/v2');
  assert.equal(config.apiVersion, '2026-06-01');
  assert.throws(
    () => loadCafe24Config({
      CAFE24_MALL_ID: 'haar',
      CAFE24_CLIENT_ID: 'id',
      CAFE24_SCOPES: 'mall.read_order'
    }),
    error => error.code === 'CAFE24_READ_PRODUCT_SCOPE_REQUIRED'
  );
});

test('refreshes early and persists rotated refresh token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe24-token-'));
  const store = new FileCafe24TokenStore({
    filePath: path.join(dir, 'tokens.json'),
    initialTokens: {
      accessToken: 'old',
      accessTokenExpiresAt: '2026-08-28T10:03:00.000Z',
      refreshToken: 'refresh-old',
      refreshTokenExpiresAt: '2026-09-10T10:00:00.000Z'
    }
  });
  const provider = new Cafe24TokenProvider({
    config: {
      mallId: 'haar', clientId: 'id', clientSecret: 'secret',
      tokenUrl: 'https://haar.cafe24api.com/api/v2/oauth/token',
      refreshSkewMs: 300000, requestTimeoutMs: 30000, scopes: ['mall.read_product']
    },
    tokenStore: store,
    clock: () => Date.parse('2026-08-28T10:00:00.000Z'),
    logger: silentLogger,
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: 'new',
      expires_at: '2026-08-28T12:00:00.000Z',
      refresh_token: 'refresh-new',
      refresh_token_expires_at: '2026-09-11T10:00:00.000Z'
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  try {
    assert.equal(await provider.getAccessToken(), 'new');
    assert.equal(store.load().refreshToken, 'refresh-new');
    assert.equal(fs.statSync(path.join(dir, 'tokens.json')).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('coalesces concurrent token refresh requests', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe24-token-coalesce-'));
  let refreshCalls = 0;
  const store = new FileCafe24TokenStore({
    filePath: path.join(dir, 'tokens.json'),
    initialTokens: {
      accessToken: 'old',
      accessTokenExpiresAt: '2026-08-28T10:01:00.000Z',
      refreshToken: 'refresh-old',
      refreshTokenExpiresAt: '2026-09-10T10:00:00.000Z'
    }
  });
  const provider = new Cafe24TokenProvider({
    config: {
      clientId: 'id', clientSecret: 'secret',
      tokenUrl: 'https://haar.cafe24api.com/api/v2/oauth/token',
      refreshSkewMs: 300000, requestTimeoutMs: 30000, scopes: ['mall.read_product']
    },
    tokenStore: store,
    clock: () => Date.parse('2026-08-28T10:00:00.000Z'),
    logger: silentLogger,
    fetchImpl: async () => {
      refreshCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
        access_token: 'new', expires_in: 3600,
        refresh_token: 'refresh-new',
        refresh_token_expires_at: '2026-09-11T10:00:00.000Z'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  try {
    assert.deepEqual(await Promise.all([
      provider.getAccessToken(), provider.getAccessToken(), provider.getAccessToken()
    ]), ['new', 'new', 'new']);
    assert.equal(refreshCalls, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET client is same-origin and redacts token metadata', async () => {
  let request;
  const client = new Cafe24AdminClient({
    config: {
      baseUrl: 'https://haar.cafe24api.com/api/v2',
      requestTimeoutMs: 30000, maxRetries: 0, apiVersion: '2026-06-01'
    },
    tokenProvider: { async getAccessToken() { return 'access-fixture'; }, clear() {} },
    logger: silentLogger,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init };
      return new Response(JSON.stringify({ products: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'r1' }
      });
    }
  });
  const result = await client.get('/admin/products', {
    query: { shop_no: 1, limit: 100, offset: 0 }
  });
  assert.equal(request.init.method, 'GET');
  assert.equal(request.init.headers.get('authorization'), 'Bearer access-fixture');
  assert.equal(request.init.headers.get('x-cafe24-api-version'), '2026-06-01');
  assert.equal(request.url, 'https://haar.cafe24api.com/api/v2/admin/products?shop_no=1&limit=100&offset=0');
  assert.equal(JSON.stringify(result.meta).includes('access-fixture'), false);
  assert.deepEqual(result.data.products, []);
});

test('blocks external origins and external redirects', async () => {
  const client = new Cafe24AdminClient({
    config: {
      baseUrl: 'https://haar.cafe24api.com/api/v2',
      requestTimeoutMs: 30000, maxRetries: 0, apiVersion: '2026-06-01'
    },
    tokenProvider: { async getAccessToken() { return 'token'; }, clear() {} },
    logger: silentLogger,
    fetchImpl: async () => new Response('', {
      status: 302,
      headers: { location: 'https://evil.example/steal' }
    })
  });
  assert.throws(
    () => client.buildUrl('https://evil.example/admin/products'),
    error => error.code === 'CAFE24_CROSS_ORIGIN_BLOCKED'
  );
  await assert.rejects(
    () => client.get('/admin/products'),
    error => error.code === 'CAFE24_CROSS_ORIGIN_REDIRECT_BLOCKED'
  );
});

test('one 401 clears token and retries GET once', async () => {
  let calls = 0;
  let clears = 0;
  const client = new Cafe24AdminClient({
    config: {
      baseUrl: 'https://haar.cafe24api.com/api/v2',
      requestTimeoutMs: 30000, maxRetries: 0, apiVersion: '2026-06-01'
    },
    tokenProvider: {
      async getAccessToken() { return calls === 0 ? 'old' : 'new'; },
      clear() { clears += 1; }
    },
    logger: silentLogger,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
        : new Response('{"products":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const result = await client.get('/admin/products');
  assert.equal(result.meta.attempts, 2);
  assert.equal(clears, 1);
  assert.equal(calls, 2);
});
