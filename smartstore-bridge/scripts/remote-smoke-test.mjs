#!/usr/bin/env node

const baseUrl = normalizeBaseUrl(process.env.ATELIER_BASE_URL || process.argv[2]);
const apiKey = String(process.env.ATELIER_API_KEY || '').trim();
const productId = String(process.env.ATELIER_TEST_PRODUCT_ID || process.argv[3] || '').trim();
const mode = String(process.env.ATELIER_SMOKE_MODE || 'full').trim().toLowerCase();
const requireExecutable = parseBoolean(process.env.ATELIER_SMOKE_REQUIRE_EXECUTABLE, true);
const timeoutMs = parsePositiveInteger(process.env.ATELIER_SMOKE_TIMEOUT_MS, 20_000);

if (!baseUrl) {
  failUsage('ATELIER_BASE_URL 또는 첫 번째 인자로 배포 주소가 필요합니다.');
}
if (!['infra', 'full'].includes(mode)) {
  failUsage('ATELIER_SMOKE_MODE는 infra 또는 full이어야 합니다.');
}
if (!apiKey) {
  failUsage('ATELIER_API_KEY가 필요합니다.');
}
if (mode === 'full' && !productId) {
  failUsage('full 모드에는 ATELIER_TEST_PRODUCT_ID 또는 두 번째 인자가 필요합니다.');
}

const results = [];

async function main() {
  console.log(`[smoke] baseUrl=${baseUrl}`);
  console.log(`[smoke] mode=${mode}`);
  console.log(`[smoke] productId=${productId || '(미사용)'}`);
  console.log('[smoke] API key는 출력하지 않습니다.');

  await check('public health', 'GET', '/health', {
    expectedStatus: 200,
    assert: body => body?.ok === true && body?.service === 'atelier-popo-smartstore-bridge'
  });

  await check('openapi', 'GET', '/openapi.json', {
    expectedStatus: 200,
    assert: body => String(body?.openapi || '').startsWith('3.1')
      && Boolean(body?.paths?.['/api/v1/products/{productId}/preview'])
  });

  await check('authenticated status', 'GET', '/api/v1/status', {
    auth: true,
    expectedStatus: 200,
    assert: body => body?.ok === true && Boolean(body?.readiness)
  });

  if (mode === 'infra') {
    printSummary();
    return;
  }

  await check('readiness', 'GET', '/health/ready', {
    expectedStatus: 200,
    assert: body => body?.ok === true
      && body?.readiness?.readyForRead === true
      && body?.readiness?.readyForPreview === true
  });

  await check('naver auth', 'POST', '/api/v1/auth/test', {
    auth: true,
    json: {},
    expectedStatus: 200,
    assert: body => body?.ok === true && Number(body?.expiresIn) > 0
  });

  await check('catalog stats', 'GET', '/api/v1/catalog/stats', {
    auth: true,
    expectedStatus: 200,
    assert: body => body?.ok === true && catalogCount(body?.catalog) > 0
  });

  await check('product lookup', 'GET', `/api/v1/products/${encodeURIComponent(productId)}`, {
    auth: true,
    expectedStatus: 200,
    assert: body => body?.ok === true && String(body?.product?.productId || '') === productId
  });

  await check('product validate', 'POST', `/api/v1/products/${encodeURIComponent(productId)}/validate`, {
    auth: true,
    json: {},
    expectedStatus: 200,
    assert: body => body?.ok === true
      && Array.isArray(body?.errors)
      && body.errors.length === 0
      && Number(body?.product?.imageCount) > 0
  });

  await check('product preview', 'POST', `/api/v1/products/${encodeURIComponent(productId)}/preview?includePayload=false`, {
    auth: true,
    json: {},
    expectedStatus: 200,
    assert: body => {
      if (body?.ok !== true || !body?.preview) return false;
      if (!requireExecutable) return true;
      return body.preview.executable === true
        && Array.isArray(body.preview.validationErrors)
        && body.preview.validationErrors.length === 0;
    }
  });

  printSummary();
}

async function check(name, method, pathname, options = {}) {
  const startedAt = Date.now();
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'atelier-popo-remote-smoke-test/1.0'
  };
  if (options.auth) headers.Authorization = `Bearer ${apiKey}`;
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  let body;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      signal: AbortSignal.timeout(timeoutMs)
    });
    body = await readBody(response);
  } catch (error) {
    record(name, false, Date.now() - startedAt, `request failed: ${error.message}`);
    throw new Error(`${name} 실패`);
  }

  const expectedStatus = options.expectedStatus ?? 200;
  const statusOk = response.status === expectedStatus;
  const assertionOk = statusOk && (options.assert ? Boolean(options.assert(body, response)) : true);
  const requestId = response.headers.get('x-request-id') || '-';
  const detail = `status=${response.status} requestId=${requestId}`;
  record(name, assertionOk, Date.now() - startedAt, detail);

  if (!assertionOk) {
    console.error('[smoke] response:', redact(body));
    throw new Error(`${name} 검증 실패: expected status ${expectedStatus}`);
  }

  return body;
}

function record(name, passed, durationMs, detail) {
  results.push({ name, passed, durationMs, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} (${durationMs}ms) ${detail}`);
}

function printSummary() {
  const failed = results.filter(item => !item.passed);
  console.log('\n[smoke] summary');
  for (const item of results) {
    console.log(`- ${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
  }
  if (failed.length) {
    console.error(`[smoke] failed=${failed.length}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[smoke] passed=${results.length}, failed=0`);
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    failUsage('ATELIER_BASE_URL이 올바른 URL이 아닙니다.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    failUsage('ATELIER_BASE_URL은 http 또는 https여야 합니다.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonBody: text.slice(0, 1_000) };
  }
}

function catalogCount(catalog) {
  const candidates = [
    catalog?.totalProducts,
    catalog?.total,
    catalog?.productCount,
    catalog?.indexedProducts,
    catalog?.manifestProducts
  ];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  if (Array.isArray(catalog?.categories)) {
    return catalog.categories.reduce((sum, item) => sum + Number(item?.count || 0), 0);
  }
  return 0;
}

function redact(value) {
  const serialized = JSON.stringify(value, (key, child) => {
    if (/secret|token|authorization|api[_-]?key/i.test(key)) return '[REDACTED]';
    return child;
  }, 2);
  return serialized.length > 4_000 ? `${serialized.slice(0, 4_000)}\n...<truncated>` : serialized;
}

function failUsage(message) {
  console.error(`[smoke] ${message}`);
  console.error('usage:');
  console.error('  ATELIER_BASE_URL=https://example.com ATELIER_API_KEY=... ATELIER_TEST_PRODUCT_ID=1905 npm run test:remote');
  console.error('  ATELIER_SMOKE_MODE=infra ATELIER_BASE_URL=https://example.com ATELIER_API_KEY=... npm run test:remote');
  process.exit(2);
}

main().catch(error => {
  console.error(`[smoke] aborted: ${error.message}`);
  printSummary();
  process.exitCode = 1;
});
