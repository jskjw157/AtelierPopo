import { fail } from './policy.js';

// Never expose upstream messages, URLs, bodies, tokens or authorization headers.
export function createProviderHttp(fetcher = fetch) {
  return async function request(url, { method = 'GET', token, body, form, basic } = {}) {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (basic) headers.authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
    if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
    else if (body) headers['content-type'] = 'application/json';
    let response, payload;
    try {
      response = await fetcher(url, { method, headers, body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      payload = await response.json();
    } catch {
      throw fail('CHANNEL_OUTCOME_UNKNOWN', '외부 API 응답을 확인하지 못했습니다. 자동 재전송하지 않습니다.');
    }
    if (!response.ok || payload.error && payload.error.code !== 'ok' || payload.errors?.length) {
      const code = response.status === 401 || Number(payload.error?.code) === 190 ? 'CHANNEL_AUTH_EXPIRED' : response.status === 403 ? 'CHANNEL_PERMISSION_DENIED' : response.status === 402 ? 'CHANNEL_BILLING_REQUIRED' : response.status === 429 ? 'CHANNEL_RATE_LIMITED' : 'CHANNEL_PROVIDER_REJECTED';
      throw fail(code, '외부 플랫폼이 요청을 거절했습니다. 권한·계정 상태·사용량을 확인해 주세요.');
    }
    return payload;
  };
}
