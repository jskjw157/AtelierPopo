import { Cafe24Error, redactCafe24Value } from './errors.js';

function expiryMillis(value, fallback = 0) {
  if (!value) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function responseExpiry(body, now) {
  const absolute = body.expires_at || body.access_token_expires_at;
  if (absolute) return new Date(expiryMillis(absolute)).toISOString();
  const seconds = Number(body.expires_in || 0);
  return new Date(now + Math.max(0, seconds) * 1000).toISOString();
}

export class Cafe24TokenProvider {
  constructor({
    config,
    tokenStore,
    fetchImpl = globalThis.fetch,
    clock = () => Date.now(),
    logger = console
  } = {}) {
    if (!config) throw new Error('Cafe24TokenProvider에는 config가 필요합니다.');
    if (!tokenStore) throw new Error('Cafe24TokenProvider에는 tokenStore가 필요합니다.');
    this.config = config;
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.logger = logger;
    this.forceRefresh = false;
    this.refreshPromise = null;
  }

  clear() {
    this.forceRefresh = true;
  }

  async getAccessToken() {
    const tokens = this.tokenStore.load();
    if (!tokens) {
      throw new Cafe24Error('CAFE24_TOKENS_NOT_CONFIGURED', 'Cafe24 OAuth 토큰이 설정되지 않았습니다.', { status: 503 });
    }
    const now = Number(this.clock());
    const accessExpiresAt = expiryMillis(tokens.accessTokenExpiresAt);
    if (!this.forceRefresh && tokens.accessToken && accessExpiresAt > now + Number(this.config.refreshSkewMs || 300_000)) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      if (tokens.accessToken && accessExpiresAt > now) return tokens.accessToken;
      throw new Cafe24Error('CAFE24_REFRESH_TOKEN_REQUIRED', 'Cafe24 refresh token이 필요합니다.', { status: 503 });
    }
    const refreshExpiresAt = expiryMillis(tokens.refreshTokenExpiresAt, Number.MAX_SAFE_INTEGER);
    if (refreshExpiresAt <= now) {
      throw new Cafe24Error('CAFE24_REFRESH_TOKEN_EXPIRED', 'Cafe24 refresh token이 만료되었습니다.', { status: 503 });
    }
    if (!this.refreshPromise) {
      this.refreshPromise = this.#refresh(tokens).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async #refresh(tokens) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken
    });
    let response;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        method: 'POST',
        headers: new Headers({
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }),
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(Number(this.config.requestTimeoutMs || 30_000))
      });
    } catch (error) {
      throw new Cafe24Error('CAFE24_TOKEN_REFRESH_NETWORK_ERROR', 'Cafe24 access token 갱신 결과를 확인할 수 없습니다.', {
        status: 502,
        retryable: true,
        cause: error
      });
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok || !data.access_token) {
      throw new Cafe24Error('CAFE24_TOKEN_REFRESH_FAILED', data.error_description || data.error || 'Cafe24 access token 갱신에 실패했습니다.', {
        status: response.status === 401 || response.status === 403 ? 503 : 502,
        upstreamStatus: response.status,
        requestId: response.headers.get('x-request-id'),
        details: redactCafe24Value(data)
      });
    }
    const now = Number(this.clock());
    const rotated = this.tokenStore.save({
      accessToken: data.access_token,
      accessTokenExpiresAt: responseExpiry(data, now),
      refreshToken: data.refresh_token || tokens.refreshToken,
      refreshTokenExpiresAt: data.refresh_token_expires_at || tokens.refreshTokenExpiresAt,
      scope: data.scope || tokens.scope || this.config.scopes?.join(' ') || null
    });
    this.forceRefresh = false;
    this.logger?.info?.('Cafe24 OAuth token refreshed', {
      accessTokenExpiresAt: rotated.accessTokenExpiresAt,
      refreshTokenExpiresAt: rotated.refreshTokenExpiresAt,
      rotatedRefreshToken: Boolean(data.refresh_token)
    });
    return rotated.accessToken;
  }
}

export const _internal = { expiryMillis, responseExpiry };
