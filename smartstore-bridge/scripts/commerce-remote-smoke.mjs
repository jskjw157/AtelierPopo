#!/usr/bin/env node
const baseUrl = String(process.env.ATELIER_BASE_URL || process.argv[2] || '').replace(/\/+$/, '');
const apiKey = String(process.env.ATELIER_API_KEY || '').trim();
if (!baseUrl || !apiKey) {
  console.error('ATELIER_BASE_URL과 ATELIER_API_KEY가 필요합니다.');
  process.exit(2);
}

async function call(name, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
  console.log(`PASS ${name}`);
  return data;
}

const status = await call('commerce status', 'GET', '/api/v1/commerce/status');
if (Number(status?.commerce?.operationCount) !== 115) throw new Error('operationCount가 115가 아닙니다.');
const list = await call('commerce operations', 'GET', '/api/v1/commerce/operations?limit=1');
if (Number(list?.total) !== 115) throw new Error('operation total이 115가 아닙니다.');
const preview = await call(
  'category read preview',
  'POST',
  '/api/v1/commerce/operations/get_v1_categories/preview',
  {}
);
if (preview?.preview?.operation?.method !== 'GET') throw new Error('GET category preview 검증 실패');
console.log('PASS commerce remote smoke: 3/3');
