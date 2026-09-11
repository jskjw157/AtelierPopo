import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateReportDownloadUrl,
  SearchAdReportDownloadAdapter
} from '../src/naver/searchad/reporting/download-adapter.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';

const UPSTREAM = 'https://api.searchad.naver.com';

function credentialsRegistry() {
  return new SearchAdCredentialsRegistry({
    principals: [{ principalId: 'p', accessLicense: 'license', secretKey: 'secret', status: 'active' }],
    customers: [{ customerId: '100', status: 'active' }],
    grants: [{ principalId: 'p', customerId: '100', role: 'operator' }]
  });
}

test('report download URL accepts only HTTPS current upstream exact origin and /report-download path', () => {
  const valid = validateReportDownloadUrl(
    'https://api.searchad.naver.com/report-download?reportJobId=123',
    UPSTREAM
  );
  assert.deepEqual(valid, {
    path: '/report-download',
    query: { reportJobId: '123' }
  });

  for (const url of [
    'http://api.searchad.naver.com/report-download?reportJobId=123',
    'https://evil.example/report-download?reportJobId=123',
    'https://api.searchad.naver.com:444/report-download?reportJobId=123',
    'https://user:pass@api.searchad.naver.com/report-download?reportJobId=123',
    'https://api.searchad.naver.com/report-download?reportJobId=123#frag',
    'https://api.searchad.naver.com/other?reportJobId=123',
    'https://api.searchad.naver.com/report-download/extra?reportJobId=123'
  ]) {
    assert.throws(
      () => validateReportDownloadUrl(url, UPSTREAM),
      error => error?.code === 'SEARCHAD_REPORT_DOWNLOAD_URL_UNSAFE'
    );
  }
});

test('download adapter accepts only persistedDownloadUrl and rejects caller raw URL aliases before client I/O', async () => {
  let calls = 0;
  const adapter = new SearchAdReportDownloadAdapter({
    client: { async request() { calls += 1; return { data: Buffer.from('x') }; } },
    upstreamBaseUrl: UPSTREAM
  });

  for (const input of [
    { customerId: '100', url: `${UPSTREAM}/report-download?reportJobId=1` },
    { customerId: '100', downloadUrl: `${UPSTREAM}/report-download?reportJobId=1` },
    { customerId: '100', persistedDownloadUrl: `${UPSTREAM}/report-download?reportJobId=1`, maxBytes: 999 }
  ]) {
    await assert.rejects(
      () => adapter.download(input),
      error => error?.code === 'SEARCHAD_REPORT_DOWNLOAD_INPUT_INVALID'
    );
  }
  assert.equal(calls, 0);
});

test('download adapter signs only normalized /report-download via SearchAd client with trusted persisted query and manual redirect', async () => {
  const calls = [];
  const bytes = Buffer.from('colA,colB\n1,2\n', 'utf8');
  const adapter = new SearchAdReportDownloadAdapter({
    client: {
      async request(input) {
        calls.push(structuredClone(input));
        return {
          status: 200,
          data: bytes,
          headers: { 'content-type': 'text/csv', 'content-length': String(bytes.length) },
          requestId: 'download-req-1'
        };
      }
    },
    upstreamBaseUrl: UPSTREAM,
    maxBytes: 1024
  });

  const result = await adapter.download({
    customerId: '100',
    persistedDownloadUrl: `${UPSTREAM}/report-download?reportJobId=123&format=csv`
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    customerId: '100',
    method: 'GET',
    path: '/report-download',
    query: { reportJobId: '123', format: 'csv' },
    responseType: 'arrayBuffer',
    retrySafe: true,
    redirect: 'manual'
  });
  assert.equal(result.bytes.equals(bytes), true);
  assert.equal(result.byteLength, bytes.length);
  assert.equal(result.contentType, 'text/csv');
  assert.equal(result.requestId, 'download-req-1');
});

test('NaverSearchAdClient forwards manual redirect mode and returns 3xx metadata without auto-follow', async () => {
  let captured;
  const client = new NaverSearchAdClient({
    baseUrl: UPSTREAM,
    credentialsRegistry: credentialsRegistry(),
    clock: () => 1700000000000,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response('', {
        status: 302,
        headers: { location: 'https://evil.example/steal' }
      });
    }
  });

  const response = await client.request({
    customerId: '100',
    method: 'GET',
    path: '/report-download',
    query: { reportJobId: '123' },
    responseType: 'arrayBuffer',
    retrySafe: true,
    redirect: 'manual'
  });
  assert.equal(captured.options.redirect, 'manual');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, 'https://evil.example/steal');
});

test('download adapter enforces content-length/body size and rejects redirects instead of following them', async () => {
  const adapterOversizedHeader = new SearchAdReportDownloadAdapter({
    client: {
      async request() {
        return {
          status: 200,
          data: Buffer.from('tiny'),
          headers: { 'content-length': '9999', 'content-type': 'text/csv' }
        };
      }
    },
    upstreamBaseUrl: UPSTREAM,
    maxBytes: 10
  });
  await assert.rejects(
    () => adapterOversizedHeader.download({ customerId: '100', persistedDownloadUrl: `${UPSTREAM}/report-download?reportJobId=1` }),
    error => error?.code === 'SEARCHAD_REPORT_DOWNLOAD_TOO_LARGE'
  );

  const adapterOversizedBody = new SearchAdReportDownloadAdapter({
    client: {
      async request() {
        return {
          status: 200,
          data: Buffer.alloc(11),
          headers: { 'content-length': '11', 'content-type': 'text/csv' }
        };
      }
    },
    upstreamBaseUrl: UPSTREAM,
    maxBytes: 10
  });
  await assert.rejects(
    () => adapterOversizedBody.download({ customerId: '100', persistedDownloadUrl: `${UPSTREAM}/report-download?reportJobId=1` }),
    error => error?.code === 'SEARCHAD_REPORT_DOWNLOAD_TOO_LARGE'
  );

  const adapterRedirect = new SearchAdReportDownloadAdapter({
    client: {
      async request() {
        return {
          status: 302,
          data: Buffer.alloc(0),
          headers: { location: 'https://evil.example/steal' }
        };
      }
    },
    upstreamBaseUrl: UPSTREAM,
    maxBytes: 10
  });
  await assert.rejects(
    () => adapterRedirect.download({ customerId: '100', persistedDownloadUrl: `${UPSTREAM}/report-download?reportJobId=1` }),
    error => error?.code === 'SEARCHAD_REPORT_DOWNLOAD_REDIRECT_BLOCKED'
  );
});
