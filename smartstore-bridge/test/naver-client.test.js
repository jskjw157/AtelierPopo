import test from 'node:test';
import assert from 'node:assert/strict';
import { NaverCommerceClient } from '../src/naver/client.js';

test('Naver client rejects a cross-origin redirect before forwarding credentials or body', async () => {
  // Given
  const calls = [];
  const client = new NaverCommerceClient({
    baseUrl: 'https://api.commerce.naver.com/external',
    tokenProvider: { async get() { return 'synthetic-token'; } },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(null, {
        status: 307,
        headers: { location: 'https://attacker.invalid/collect' }
      });
    }
  });

  // When / Then
  await assert.rejects(
    () => client.requestDetailed('POST', '/v1/example', { json: { orderId: 'order-1' }, retrySafe: false }),
    error => error.code === 'NAVER_REDIRECT_HOST_NOT_ALLOWED'
  );
  assert.equal(calls.length, 1);
});
