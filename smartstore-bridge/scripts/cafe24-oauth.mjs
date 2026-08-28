#!/usr/bin/env node
import crypto from 'node:crypto';
import { loadCafe24Config } from '../src/cafe24/config.js';
import { FileCafe24TokenStore } from '../src/cafe24/token-store.js';

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function tokenExpiry(body, now = Date.now()) {
  if (body.expires_at) return body.expires_at;
  return new Date(now + Number(body.expires_in || 0) * 1000).toISOString();
}

const options = args(process.argv.slice(2));
const config = loadCafe24Config(process.env);
if (!config.mallId || !config.clientId || !config.clientSecret || !config.redirectUri) {
  console.error('CAFE24_MALL_ID, CAFE24_CLIENT_ID, CAFE24_CLIENT_SECRET, CAFE24_REDIRECT_URI가 필요합니다.');
  process.exit(1);
}

const store = new FileCafe24TokenStore({
  filePath: config.tokenStorePath,
  initialTokens: config.initialTokens
});

if (!options.code) {
  const state = crypto.randomBytes(24).toString('hex');
  const url = new URL(config.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  console.log(`state=${state}`);
  console.log(url.toString());
  console.log('승인 후 받은 code를 --code 값으로 다시 실행하세요. 토큰은 출력하지 않습니다.');
  process.exit(0);
}

const response = await fetch(config.tokenUrl, {
  method: 'POST',
  headers: new Headers({
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  }),
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(options.code),
    redirect_uri: config.redirectUri
  }),
  redirect: 'error',
  signal: AbortSignal.timeout(config.requestTimeoutMs)
});
const text = await response.text();
let body = {};
try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
if (!response.ok || !body.access_token || !body.refresh_token) {
  console.error(`Cafe24 OAuth code exchange failed: HTTP ${response.status} ${body.error || body.error_description || ''}`.trim());
  process.exit(1);
}
const saved = store.save({
  accessToken: body.access_token,
  accessTokenExpiresAt: tokenExpiry(body),
  refreshToken: body.refresh_token,
  refreshTokenExpiresAt: body.refresh_token_expires_at || null,
  scope: body.scope || config.scopes.join(' ')
});
console.log(JSON.stringify({
  saved: true,
  tokenStorePath: config.tokenStorePath,
  accessTokenExpiresAt: saved.accessTokenExpiresAt,
  refreshTokenExpiresAt: saved.refreshTokenExpiresAt,
  scope: saved.scope
}, null, 2));
