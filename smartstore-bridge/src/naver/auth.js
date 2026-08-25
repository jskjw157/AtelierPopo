import bcrypt from 'bcryptjs';
import { NaverApiError } from './errors.js';

export function createClientSecretSign(clientId, clientSecret, timestamp = Date.now()) {
  if (!clientId || !clientSecret) throw new Error('NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET이 필요합니다.');
  const password = `${clientId}_${timestamp}`;
  const bcryptHash = bcrypt.hashSync(password, clientSecret);
  return Buffer.from(bcryptHash, 'utf8').toString('base64');
}

export async function issueAccessToken({
  clientId,
  clientSecret,
  tokenType = 'SELF',
  accountId,
  baseUrl = 'https://api.commerce.naver.com/external',
  fetchImpl = fetch
}) {
  const timestamp = Date.now();
  const body = new URLSearchParams({
    client_id: clientId,
    timestamp: String(timestamp),
    grant_type: 'client_credentials',
    client_secret_sign: createClientSecretSign(clientId, clientSecret, timestamp),
    type: tokenType
  });
  if (tokenType === 'SELLER') {
    if (!accountId) throw new Error('NAVER_TOKEN_TYPE=SELLER인 경우 NAVER_ACCOUNT_ID가 필요합니다.');
    body.set('account_id', accountId);
  }

  const response = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok || !data.access_token) {
    throw new NaverApiError(data.message || `토큰 발급 실패: HTTP ${response.status}`, {
      status: response.status,
      code: data.code,
      invalidInputs: data.invalidInputs,
      traceId: response.headers.get('gncp-gw-trace-id'),
      body: data
    });
  }
  return {
    accessToken: data.access_token,
    tokenType: data.token_type || 'Bearer',
    expiresIn: Number(data.expires_in || 10800),
    issuedAt: Date.now()
  };
}

export class TokenProvider {
  constructor(options) {
    this.options = options;
    this.cached = null;
    this.inflight = null;
  }

  clear() { this.cached = null; }

  async get() {
    const safetyMs = 5 * 60 * 1000;
    if (this.cached && Date.now() < this.cached.issuedAt + this.cached.expiresIn * 1000 - safetyMs) {
      return this.cached.accessToken;
    }
    if (this.inflight) return this.inflight;
    const promise = issueAccessToken(this.options).then(token => {
      this.cached = token;
      return token.accessToken;
    });
    this.inflight = promise;
    try {
      return await promise;
    } finally {
      if (this.inflight === promise) this.inflight = null;
    }
  }
}
