#!/usr/bin/env node

const baseUrl = normalizeBaseUrl(process.env.ATELIER_BASE_URL || process.argv[2]);
const apiKey = String(process.env.ATELIER_API_KEY || '').trim();
const productId = String(process.env.ATELIER_TEST_PRODUCT_ID || process.argv[3] || '').trim();
const mode = String(process.env.ATELIER_SMOKE_MODE || 'full').trim().toLowerCase();
const timeoutMs = positiveInteger(process.env.ATELIER_SMOKE_TIMEOUT_MS, 20_000);
const requireExecutable = bool(process.env.ATELIER_SMOKE_REQUIRE_EXECUTABLE, true);

if (!baseUrl || !apiKey || !['infra', 'full'].includes(mode) || (mode === 'full' && !productId)) {
  console.error('usage: ATELIER_BASE_URL=https://example.com ATELIER_API_KEY=... [ATELIER_TEST_PRODUCT_ID=1905] npm run test:remote');
  process.exit(2);
}

const results = [];

async function request(name, method, pathname, { auth = false, json, assert } = {}) {
  const startedAt = Date.now();
  const headers = { Accept: 'application/json', 'User-Agent': 'atelier-popo-remote-smoke-test/1.1' };
  if (auth) headers.Authorization = `Bearer ${apiKey}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { nonJsonBody: text.slice(0, 1000) }; }
  const passed = response.ok && (!assert || Boolean(assert(body, response)));
  results.push({ name, passed, status: response.status, durationMs: Date.now() - startedAt });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} status=${response.status}`);
  if (!passed) throw new Error(`${name} smoke check failed`);
  return body;
}

async function main() {
  await request('health', 'GET', '/health', { assert: body => body?.ok === true });
  await request('openapi', 'GET', '/openapi.json', { assert: body => String(body?.openapi || '').startsWith('3.1') });
  await request('status', 'GET', '/api/v1/status', { auth: true, assert: body => body?.ok === true });
  if (mode === 'infra') return;
  await request('readiness', 'GET', '/health/ready', { assert: body => body?.ok === true });
  await request('naver auth', 'POST', '/api/v1/auth/test', { auth: true, json: {}, assert: body => body?.ok === true });
  await request('catalog stats', 'GET', '/api/v1/catalog/stats', { auth: true, assert: body => body?.ok === true });
  await request('product', 'GET', `/api/v1/products/${encodeURIComponent(productId)}`, {
    auth: true,
    assert: body => body?.ok === true && String(body?.product?.productId || '') === productId
  });
  await request('validate', 'POST', `/api/v1/products/${encodeURIComponent(productId)}/validate`, {
    auth: true,
    json: {},
    assert: body => body?.ok === true && Array.isArray(body?.errors) && body.errors.length === 0
  });
  await request('preview', 'POST', `/api/v1/products/${encodeURIComponent(productId)}/preview?includePayload=false`, {
    auth: true,
    json: {},
    assert: body => body?.ok === true && (!requireExecutable || body?.preview?.executable === true)
  });
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new URL(text);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('ATELIER_BASE_URL must be http(s)');
  return parsed.toString().replace(/\/+$/, '');
}
function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

main().then(() => {
  console.log(`[smoke] passed=${results.filter(item => item.passed).length}, failed=0`);
}).catch(error => {
  console.error(`[smoke] ${error.message}`);
  process.exitCode = 1;
});
