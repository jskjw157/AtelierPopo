import path from 'node:path';
import { Cafe24Error } from './errors.js';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function integer(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseScopes(value) {
  return String(value || 'mall.read_product')
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export function loadCafe24Config(env = process.env, { cwd = process.cwd() } = {}) {
  const mallId = text(env.CAFE24_MALL_ID).toLowerCase();
  if (mallId && !/^[a-z0-9][a-z0-9-]{1,49}$/.test(mallId)) {
    throw new Cafe24Error('CAFE24_INVALID_MALL_ID', 'CAFE24_MALL_ID 형식이 올바르지 않습니다.', { status: 500 });
  }
  const shopNo = integer(env.CAFE24_SHOP_NO, 1, { min: 1, max: 2_147_483_647 });
  const clientId = text(env.CAFE24_CLIENT_ID);
  const clientSecret = text(env.CAFE24_CLIENT_SECRET);
  const scopes = parseScopes(env.CAFE24_SCOPES);
  if (!scopes.includes('mall.read_product')) {
    throw new Cafe24Error(
      'CAFE24_READ_PRODUCT_SCOPE_REQUIRED',
      'Cafe24 상품 가져오기에는 mall.read_product scope가 필요합니다.',
      { status: 500 }
    );
  }
  const baseUrl = mallId ? `https://${mallId}.cafe24api.com/api/v2` : null;
  return {
    enabled: Boolean(mallId && clientId),
    mallId,
    shopNo,
    clientId,
    clientSecret,
    scopes,
    baseUrl,
    tokenUrl: baseUrl ? `${baseUrl}/oauth/token` : null,
    authorizationUrl: baseUrl ? `${baseUrl}/oauth/authorize` : null,
    redirectUri: text(env.CAFE24_REDIRECT_URI),
    apiVersion: text(env.CAFE24_API_VERSION, '2026-06-01'),
    requestTimeoutMs: integer(env.CAFE24_REQUEST_TIMEOUT_MS, 30_000, { min: 5_000, max: 300_000 }),
    maxRetries: integer(env.CAFE24_MAX_RETRIES, 3, { min: 0, max: 8 }),
    refreshSkewMs: integer(env.CAFE24_REFRESH_SKEW_MS, 300_000, { min: 30_000, max: 3_600_000 }),
    tokenStorePath: path.resolve(cwd, text(env.CAFE24_TOKEN_STORE_PATH, './work/cafe24-oauth-token.json')),
    initialTokens: {
      accessToken: text(env.CAFE24_ACCESS_TOKEN) || null,
      accessTokenExpiresAt: text(env.CAFE24_ACCESS_TOKEN_EXPIRES_AT) || null,
      refreshToken: text(env.CAFE24_REFRESH_TOKEN) || null,
      refreshTokenExpiresAt: text(env.CAFE24_REFRESH_TOKEN_EXPIRES_AT) || null,
      scope: scopes.join(' ')
    }
  };
}

export function publicCafe24Config(config) {
  return {
    enabled: Boolean(config.enabled),
    mallId: config.mallId ? `${config.mallId.slice(0, 1)}***${config.mallId.slice(-1)}` : null,
    shopNo: config.shopNo,
    baseOrigin: config.baseUrl ? new URL(config.baseUrl).origin : null,
    apiVersion: config.apiVersion,
    scopes: [...config.scopes],
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries,
    tokenStoreConfigured: Boolean(config.tokenStorePath)
  };
}
