import { TokenProvider } from './auth.js';
import { NaverApiError } from './errors.js';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function appendQuery(url, query = {}) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function responseHeaders(response) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) headers[key.toLowerCase()] = value;
  return headers;
}

async function parseResponse(response, responseType = 'auto') {
  if (responseType === 'buffer') return Buffer.from(await response.arrayBuffer());
  if (responseType === 'text') return response.text();
  const text = await response.text();
  if (!text) return {};
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (responseType === 'json' || contentType.includes('application/json') || contentType.includes('+json')) {
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return Math.min(15_000, 700 * (2 ** attempt)) + Math.floor(Math.random() * 400);
}

export class NaverCommerceClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || 'https://api.commerce.naver.com/external').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.tokenProvider = options.tokenProvider || new TokenProvider(options);
    this.maxRetries = Number(options.maxRetries ?? 4);
    this.timeoutMs = Number(options.timeoutMs ?? 30_000);
    this.maxRedirects = Number(options.maxRedirects ?? 5);
  }

  async requestDetailed(method, apiPath, options = {}) {
    const upperMethod = String(method || 'GET').toUpperCase();
    const initialUrl = new URL(`${this.baseUrl}${apiPath}`);
    appendQuery(initialUrl, options.query);
    const safe = options.retrySafe ?? ['GET', 'HEAD'].includes(upperMethod);
    let refreshed = false;
    let redirectCount = 0;
    let currentUrl = initialUrl;
    let currentMethod = upperMethod;
    let dropBodyAfterRedirect = false;

    for (let attempt = 0; ; attempt += 1) {
      const headers = {
        Accept: options.accept || 'application/json;charset=UTF-8',
        ...(options.headers || {})
      };
      if (options.authenticated !== false) {
        const token = await this.tokenProvider.get();
        headers.Authorization = `Bearer ${token}`;
      }

      let body;
      if (options.json !== undefined) {
        headers['Content-Type'] = 'application/json;charset=UTF-8';
        body = JSON.stringify(options.json);
      } else if (options.formData) {
        body = options.formData;
      } else if (options.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        body = options.form instanceof URLSearchParams ? options.form : new URLSearchParams(options.form);
      } else if (options.rawBody !== undefined) {
        if (options.contentType) headers['Content-Type'] = options.contentType;
        body = options.rawBody;
      }

      const startedAt = Date.now();
      let response;
      try {
        response = await this.fetchImpl(currentUrl, {
          method: currentMethod,
          headers,
          body: dropBodyAfterRedirect ? undefined : body,
          redirect: 'manual',
          signal: AbortSignal.timeout(Number(options.timeoutMs ?? this.timeoutMs))
        });
      } catch (error) {
        if (safe && attempt < this.maxRetries) {
          await sleep(Math.min(8_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
          continue;
        }
        if (!safe) {
          const unknown = new Error(`네이버 쓰기 요청 결과를 확인할 수 없습니다: ${error.message}`);
          unknown.name = 'NaverWriteOutcomeUnknownError';
          unknown.code = 'NAVER_WRITE_OUTCOME_UNKNOWN';
          unknown.cause = error;
          unknown.request = { method: currentMethod, url: currentUrl.toString() };
          throw unknown;
        }
        throw error;
      }

      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
        if (redirectCount >= this.maxRedirects) {
          throw new NaverApiError('네이버 API 리디렉션 횟수를 초과했습니다.', {
            status: response.status,
            code: 'TOO_MANY_REDIRECTS',
            traceId: response.headers.get('gncp-gw-trace-id')
          });
        }
        currentUrl = new URL(response.headers.get('location'), currentUrl);
        redirectCount += 1;
        if (response.status === 303) {
          currentMethod = 'GET';
          dropBodyAfterRedirect = true;
        }
        attempt -= 1;
        continue;
      }

      const data = await parseResponse(response, options.responseType || 'auto');
      const traceId = response.headers.get('gncp-gw-trace-id') || data?.traceId;
      const meta = {
        status: response.status,
        ok: response.ok,
        data,
        traceId: traceId || null,
        headers: responseHeaders(response),
        url: currentUrl.toString(),
        method: currentMethod,
        attempts: attempt + 1,
        redirects: redirectCount,
        responseTimeMs: Date.now() - startedAt
      };

      if (response.ok) return meta;

      if (response.status === 401 && data?.code === 'GW.AUTHN' && !refreshed && options.authenticated !== false) {
        refreshed = true;
        this.tokenProvider.clear();
        attempt -= 1;
        continue;
      }
      if (safe && [429, 502, 503, 504].includes(response.status) && attempt < this.maxRetries) {
        await sleep(retryDelay(response, attempt));
        continue;
      }

      throw new NaverApiError(data?.message || `네이버 API 오류: HTTP ${response.status}`, {
        status: response.status,
        code: data?.code,
        invalidInputs: data?.invalidInputs,
        traceId,
        body: data,
        headers: meta.headers,
        url: meta.url,
        method: meta.method
      });
    }
  }

  async request(method, apiPath, options = {}) {
    const result = await this.requestDetailed(method, apiPath, options);
    return result.data;
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, options) { return this.request('POST', path, options); }
  put(path, options) { return this.request('PUT', path, options); }
  patch(path, options) { return this.request('PATCH', path, options); }
  delete(path, options) { return this.request('DELETE', path, options); }
  head(path, options) { return this.request('HEAD', path, options); }
}
