import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenProvider } from '../src/naver/auth.js';

test('TokenProvider coalesces concurrent token refreshes', async () => {
  let requests = 0;
  const provider = new TokenProvider({
    clientId: 'test-client',
    clientSecret: '$2b$10$abcdefghijklmnopqrstuu',
    fetchImpl: async () => {
      requests += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
        access_token: 'secret-token',
        token_type: 'Bearer',
        expires_in: 10_800
      }), { status: 200 });
    }
  });

  assert.deepEqual(await Promise.all([provider.get(), provider.get(), provider.get()]), [
    'secret-token',
    'secret-token',
    'secret-token'
  ]);
  assert.equal(requests, 1);
});
