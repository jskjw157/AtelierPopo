import crypto from 'node:crypto';

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return buffer.toString('base64url');
}

function parseJsonResponse(text, label) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 응답이 JSON이 아닙니다.`);
  }
}

export function createServiceAccountAssertion({
  serviceAccount,
  scope,
  nowMs = Date.now(),
  lifetimeSeconds = 3600,
  jwtId = crypto.randomUUID()
}) {
  if (!serviceAccount?.clientEmail || !serviceAccount?.privateKey) {
    throw new Error('Google 서비스 계정 자격증명이 필요합니다.');
  }
  const issuedAt = Math.floor(nowMs / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(serviceAccount.privateKeyId ? { kid: serviceAccount.privateKeyId } : {})
  };
  const payload = {
    iss: serviceAccount.clientEmail,
    scope,
    aud: serviceAccount.tokenUri,
    iat: issuedAt - 5,
    exp: issuedAt + Math.min(3600, Math.max(60, lifetimeSeconds)),
    jti: jwtId
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.privateKey);
  return {
    assertion: `${unsigned}.${base64Url(signature)}`,
    header,
    payload
  };
}

export class GoogleServiceAccountTokenProvider {
  constructor({
    serviceAccount,
    scope,
    fetchImpl = fetch,
    now = () => Date.now(),
    timeoutMs = 30_000,
    refreshSkewMs = 60_000
  }) {
    this.serviceAccount = serviceAccount;
    this.scope = scope;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.refreshSkewMs = refreshSkewMs;
    this.cached = null;
    this.inflight = null;
  }

  clear() {
    this.cached = null;
  }

  status() {
    return {
      configured: Boolean(this.serviceAccount?.clientEmail && this.serviceAccount?.privateKey),
      clientEmail: this.serviceAccount?.clientEmail || null,
      scope: this.scope,
      cached: Boolean(this.cached),
      expiresAt: this.cached?.expiresAt || null
    };
  }

  async get({ forceRefresh = false } = {}) {
    const nowMs = this.now();
    if (!forceRefresh && this.cached && this.cached.expiresAt - this.refreshSkewMs > nowMs) {
      return this.cached.accessToken;
    }
    if (!forceRefresh && this.inflight) return this.inflight;

    const promise = this.issue();
    this.inflight = promise;
    try {
      return await promise;
    } finally {
      if (this.inflight === promise) this.inflight = null;
    }
  }

  async issue() {
    const nowMs = this.now();
    const { assertion } = createServiceAccountAssertion({
      serviceAccount: this.serviceAccount,
      scope: this.scope,
      nowMs
    });
    const form = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    });
    let response;
    try {
      response = await this.fetchImpl(this.serviceAccount.tokenUri, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const wrapped = new Error(`Google OAuth 토큰 요청에 실패했습니다: ${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }

    const text = await response.text();
    const data = parseJsonResponse(text, 'Google OAuth');
    if (!response.ok) {
      const error = new Error(data.error_description || data.error || `Google OAuth HTTP ${response.status}`);
      error.name = 'GoogleOAuthError';
      error.status = response.status;
      error.code = data.error || 'GOOGLE_OAUTH_ERROR';
      throw error;
    }
    if (!data.access_token) {
      throw new Error('Google OAuth 응답에 access_token이 없습니다.');
    }
    const expiresIn = Number(data.expires_in || 3600);
    this.cached = {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      expiresIn,
      expiresAt: nowMs + Math.max(60, expiresIn) * 1000
    };
    return this.cached.accessToken;
  }
}

export class GoogleOAuthRefreshTokenProvider {
  constructor({
    userOAuth,
    fetchImpl = fetch,
    now = () => Date.now(),
    timeoutMs = 30_000,
    refreshSkewMs = 60_000
  }) {
    this.userOAuth = userOAuth;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.refreshSkewMs = refreshSkewMs;
    this.cached = null;
    this.inflight = null;
  }

  clear() {
    this.cached = null;
  }

  status() {
    return {
      configured: Boolean(this.userOAuth?.clientId && this.userOAuth?.clientSecret && this.userOAuth?.refreshToken),
      authMode: 'user-oauth',
      userEmail: this.userOAuth?.userEmail || null,
      cached: Boolean(this.cached),
      expiresAt: this.cached?.expiresAt || null
    };
  }

  async get({ forceRefresh = false } = {}) {
    const nowMs = this.now();
    if (!forceRefresh && this.cached && this.cached.expiresAt - this.refreshSkewMs > nowMs) {
      return this.cached.accessToken;
    }
    if (!forceRefresh && this.inflight) return this.inflight;
    const promise = this.issue();
    this.inflight = promise;
    try {
      return await promise;
    } finally {
      if (this.inflight === promise) this.inflight = null;
    }
  }

  async issue() {
    const form = new URLSearchParams({
      client_id: this.userOAuth.clientId,
      client_secret: this.userOAuth.clientSecret,
      refresh_token: this.userOAuth.refreshToken,
      grant_type: 'refresh_token'
    });
    let response;
    try {
      response = await this.fetchImpl(this.userOAuth.tokenUri, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      const wrapped = new Error(`Google 사용자 OAuth 토큰 요청에 실패했습니다: ${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
    const text = await response.text();
    const data = parseJsonResponse(text, 'Google 사용자 OAuth');
    if (!response.ok) {
      const error = new Error(data.error_description || data.error || `Google OAuth HTTP ${response.status}`);
      error.name = 'GoogleOAuthError';
      error.status = response.status;
      error.code = data.error || 'GOOGLE_OAUTH_ERROR';
      throw error;
    }
    if (!data.access_token) throw new Error('Google OAuth 응답에 access_token이 없습니다.');
    const expiresIn = Number(data.expires_in || 3600);
    const nowMs = this.now();
    this.cached = {
      accessToken: data.access_token,
      tokenType: data.token_type || 'Bearer',
      expiresIn,
      expiresAt: nowMs + Math.max(60, expiresIn) * 1000
    };
    return this.cached.accessToken;
  }
}

export function createGoogleTokenProvider({
  authMode,
  serviceAccount,
  userOAuth,
  scope,
  fetchImpl = fetch,
  timeoutMs = 30_000
}) {
  if (authMode === 'user-oauth') {
    return new GoogleOAuthRefreshTokenProvider({ userOAuth, fetchImpl, timeoutMs });
  }
  if (authMode === 'service-account') {
    return new GoogleServiceAccountTokenProvider({ serviceAccount, scope, fetchImpl, timeoutMs });
  }
  throw new Error(`지원하지 않는 Google Drive 인증 방식입니다: ${authMode}`);
}
