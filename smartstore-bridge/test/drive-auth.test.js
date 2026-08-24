import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GoogleServiceAccountTokenProvider } from '../src/drive/auth.js';

function decodePart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

test('service-account provider signs RS256 assertion and caches token', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let calls = 0;
  let assertion;
  const provider = new GoogleServiceAccountTokenProvider({
    serviceAccount: {
      clientEmail: 'drive@test.iam.gserviceaccount.com',
      privateKeyId: 'kid-1',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      tokenUri: 'https://oauth2.googleapis.com/token'
    },
    scope: 'https://www.googleapis.com/auth/drive',
    now: () => 1_800_000_000_000,
    fetchImpl: async (_url, init) => {
      calls += 1;
      assertion = init.body.get('assertion');
      return new Response(JSON.stringify({ access_token: 'token-value', expires_in: 3600, token_type: 'Bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.equal(await provider.get(), 'token-value');
  assert.equal(await provider.get(), 'token-value');
  assert.equal(calls, 1);

  const [headerPart, payloadPart, signaturePart] = assertion.split('.');
  const header = decodePart(headerPart);
  const payload = decodePart(payloadPart);
  assert.equal(header.alg, 'RS256');
  assert.equal(header.kid, 'kid-1');
  assert.equal(payload.iss, 'drive@test.iam.gserviceaccount.com');
  assert.equal(payload.scope, 'https://www.googleapis.com/auth/drive');
  assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    Buffer.from(signaturePart, 'base64url')
  );
  assert.equal(valid, true);
});

import { GoogleOAuthRefreshTokenProvider } from '../src/drive/auth.js';

test('user OAuth refresh-token provider exchanges and caches access token', async () => {
  let calls = 0;
  const provider = new GoogleOAuthRefreshTokenProvider({
    userOAuth: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
      tokenUri: 'https://oauth2.googleapis.com/token',
      userEmail: 'owner@example.com'
    },
    now: () => 1_800_000_000_000,
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(init.body.get('grant_type'), 'refresh_token');
      assert.equal(init.body.get('refresh_token'), 'refresh-token');
      return new Response(JSON.stringify({ access_token: 'oauth-access', expires_in: 3600 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  assert.equal(await provider.get(), 'oauth-access');
  assert.equal(await provider.get(), 'oauth-access');
  assert.equal(calls, 1);
});
