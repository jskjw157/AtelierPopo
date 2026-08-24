#!/usr/bin/env node
const baseUrl = String(process.env.ATELIER_BASE_URL || '').replace(/\/$/, '');
const apiKey = String(process.env.ATELIER_API_KEY || '');
const runWriteCanary = ['1', 'true', 'yes', 'on'].includes(String(process.env.ATELIER_DRIVE_RUN_WRITE_CANARY || '').toLowerCase());

if (!baseUrl) throw new Error('ATELIER_BASE_URL이 필요합니다.');
if (!apiKey) throw new Error('ATELIER_API_KEY가 필요합니다.');

async function request(method, pathname, { json, auth = true } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(auth ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    signal: AbortSignal.timeout(120_000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`${method} ${pathname}: HTTP ${response.status} ${data?.error?.message || data.raw || ''}`);
    error.response = data;
    throw error;
  }
  return data;
}

const tests = [
  ['health', () => request('GET', '/health', { auth: false })],
  ['drive status', () => request('GET', '/api/v1/drive/status?verifyRemote=true')],
  ['drive catalog status', () => request('GET', '/api/v1/drive/catalog/status')],
  ['drive root list', async () => {
    const status = await request('GET', '/api/v1/drive/status?verifyRemote=false');
    const rootId = status?.drive?.configured?.rootFolderId;
    if (!rootId) throw new Error('Drive rootFolderId를 상태 응답에서 찾을 수 없습니다.');
    return request('GET', `/api/v1/drive/files?parentId=${encodeURIComponent(rootId)}&pageSize=20`);
  }]
];

if (runWriteCanary) {
  tests.push([
    'drive write canary',
    () => request('POST', '/api/v1/drive/capabilities/probe', {
      json: { confirmation: 'RUN_DRIVE_WRITE_CANARY' }
    })
  ]);
}

let passed = 0;
for (const [name, run] of tests) {
  try {
    const result = await run();
    console.log(`PASS ${name}`);
    if (name === 'drive status') {
      console.log(JSON.stringify({
        authMode: result?.drive?.configured?.authMode,
        remoteOk: result?.drive?.remote?.ok,
        createCredentialCompatible: result?.drive?.remote?.createCredentialCompatible
      }));
    }
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    if (error.response) console.error(JSON.stringify(error.response));
  }
}

console.log(`\nDrive remote smoke: ${passed}/${tests.length} passed`);
if (passed !== tests.length) process.exitCode = 1;
