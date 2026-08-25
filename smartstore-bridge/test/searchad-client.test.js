import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';

function registry() {
  return new SearchAdCredentialsRegistry({
    principals: [{ principalId: 'p', accessLicense: 'license', secretKey: 'secret', status: 'active' }],
    customers: [{ customerId: '1001', status: 'active' }],
    grants: [{ principalId: 'p', customerId: '1001', role: 'operator' }]
  });
}

test('SearchAd client signs request and serializes repeated query parameters', async () => {
  let captured;
  const client = new NaverSearchAdClient({
    baseUrl: 'https://api.searchad.naver.com', credentialsRegistry: registry(), clock: () => 1700000000000,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify([{ nccCampaignId: 'cmp-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' }
      });
    }
  });
  const result = await client.request({ customerId: '1001', method: 'GET', path: '/ncc/campaigns', query: { ids: ['a','b'] } });
  assert.match(captured.url, /ids=a&ids=b/);
  assert.equal(captured.options.headers['X-API-KEY'], 'license');
  assert.equal(captured.options.headers['X-Customer'], '1001');
  assert.equal(result.requestId, 'req-1');
  assert.equal(result.data[0].nccCampaignId, 'cmp-1');
});

test('SearchAd client retries GET 429 but does not retry POST by default', async () => {
  let getCalls = 0;
  const sleeps = [];
  const client = new NaverSearchAdClient({
    baseUrl: 'https://api.searchad.naver.com', credentialsRegistry: registry(), clock: () => 1700000000000,
    sleep: async ms => sleeps.push(ms), random: () => 0,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        getCalls += 1;
        if (getCalls === 1) return new Response(JSON.stringify({ message: 'rate' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('network');
    }
  });
  const result = await client.request({ customerId: '1001', method: 'GET', path: '/ncc/campaigns' });
  assert.equal(result.attempts, 2);
  assert.equal(getCalls, 2);
  assert.equal(sleeps.length, 1);
  await assert.rejects(() => client.request({ customerId: '1001', method: 'POST', path: '/ncc/campaigns', json: {} }), error => {
    assert.equal(error.code, 'SEARCHAD_NETWORK_ERROR');
    return true;
  });
});
