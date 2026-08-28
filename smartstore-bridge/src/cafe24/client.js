import { Cafe24Error, redactCafe24Value } from './errors.js';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendQuery(url, query = {}) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function retryAfterMs(response, attempt) {
  const raw = response.headers.get('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const absolute = Date.parse(raw);
    if (Number.isFinite(absolute)) return Math.max(0, absolute - Date.now());
  }
  return Math.min(30_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250);
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export class Cafe24AdminClient {
  constructor({ config, tokenProvider, fetchImpl = globalThis.fetch, logger = console } = {}) {
    if (!config?.baseUrl) throw new Error('Cafe24AdminClient에는 config.baseUrl이 필요합니다.');
    if (!tokenProvider) throw new Error('Cafe24AdminClient에는 tokenProvider가 필요합니다.');
    this.config = config;
    this.baseUrl = new URL(String(config.baseUrl).replace(/\/$/, '') + '/');
    this.origin = this.baseUrl.origin;
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
  }

  buildUrl(apiPath, query = {}) {
    const value = String(apiPath || '');
    const url = /^https?:\/\//i.test(value)
      ? new URL(value)
      : new URL(value.replace(/^\//, ''), this.baseUrl);
    if (url.origin !== this.origin) {
      throw new Cafe24Error('CAFE24_CROSS_ORIGIN_BLOCKED', 'Cafe24 API 요청은 설정된 mall origin만 사용할 수 있습니다.', {
        status: 400,
        details: { origin: url.origin }
      });
    }
    appendQuery(url, query);
    return url;
  }

  async get(apiPath, { query, timeoutMs } = {}) {
    return this.#request('GET', apiPath, { query, timeoutMs });
  }

  async #request(method, apiPath, { query, timeoutMs } = {}) {
    if (method !== 'GET') {
      throw new Cafe24Error('CAFE24_READ_ONLY_CLIENT', 'Cafe24 상품 가져오기 클라이언트는 GET만 허용합니다.', { status: 403 });
    }
    let url = this.buildUrl(apiPath, query);
    let refreshed401 = false;
    const maxRetries = Math.max(0, Number(this.config.maxRetries || 0));

    for (let attempt = 0; ; attempt += 1) {
      const accessToken = await this.tokenProvider.getAccessToken();
      const headers = new Headers({
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Cafe24-Api-Version': String(this.config.apiVersion || '2026-06-01')
      });
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(Number(timeoutMs || this.config.requestTimeoutMs || 30_000))
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(Math.min(15_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
          continue;
        }
        throw new Cafe24Error('CAFE24_NETWORK_ERROR', 'Cafe24 상품 조회 결과를 확인할 수 없습니다.', {
          status: 502,
          retryable: true,
          cause: error
        });
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Cafe24Error('CAFE24_REDIRECT_LOCATION_MISSING', 'Cafe24 redirect Location 헤더가 없습니다.', {
            status: 502,
            upstreamStatus: response.status
          });
        }
        const redirected = new URL(location, url);
        if (redirected.origin !== this.origin) {
          throw new Cafe24Error('CAFE24_CROSS_ORIGIN_REDIRECT_BLOCKED', 'Cafe24 외부 origin redirect를 차단했습니다.', {
            status: 502,
            upstreamStatus: response.status,
            details: { origin: redirected.origin }
          });
        }
        if (attempt >= Math.max(3, maxRetries)) {
          throw new Cafe24Error('CAFE24_TOO_MANY_REDIRECTS', 'Cafe24 redirect 횟수가 제한을 초과했습니다.', { status: 502 });
        }
        url = redirected;
        continue;
      }

      if (response.status === 401 && !refreshed401) {
        refreshed401 = true;
        this.tokenProvider.clear();
        await response.arrayBuffer().catch(() => {});
        continue;
      }

      if ([429, 502, 503, 504].includes(response.status) && attempt < maxRetries) {
        const waitMs = retryAfterMs(response, attempt);
        await response.arrayBuffer().catch(() => {});
        await sleep(waitMs);
        continue;
      }

      const data = await parseResponse(response);
      const requestId = response.headers.get('x-request-id')
        || response.headers.get('x-cafe24-request-id')
        || null;
      if (!response.ok) {
        throw new Cafe24Error(
          'CAFE24_UPSTREAM_ERROR',
          data?.error?.message || data?.message || `Cafe24 API HTTP ${response.status}`,
          {
            status: response.status === 401 || response.status === 403 ? 503 : 502,
            upstreamStatus: response.status,
            requestId,
            retryable: [429, 502, 503, 504].includes(response.status),
            details: redactCafe24Value(data)
          }
        );
      }
      const result = {
        data,
        meta: {
          status: response.status,
          requestId,
          attempts: attempt + 1,
          url: `${url.origin}${url.pathname}`,
          apiVersion: this.config.apiVersion || '2026-06-01'
        }
      };
      this.logger?.info?.('Cafe24 GET success', result.meta);
      return result;
    }
  }
}

export const _internal = { appendQuery, retryAfterMs, parseResponse };
