import { TokenProvider } from './auth.js';
import { NaverApiError } from './errors.js';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export class NaverCommerceClient {
  constructor(options) {
    this.baseUrl = String(options.baseUrl || 'https://api.commerce.naver.com/external').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.tokenProvider = options.tokenProvider || new TokenProvider(options);
    this.maxRetries = Number(options.maxRetries ?? 4);
    this.timeoutMs = Number(options.timeoutMs ?? 30000);
  }

  async request(method, apiPath, { query, json, formData, retrySafe } = {}) {
    const url = new URL(`${this.baseUrl}${apiPath}`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const safe = retrySafe ?? ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method.toUpperCase());
    let refreshed = false;

    for (let attempt = 0; ; attempt += 1) {
      const token = await this.tokenProvider.get();
      const headers = {
        Accept: 'application/json;charset=UTF-8',
        Authorization: `Bearer ${token}`
      };
      let body;
      if (json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(json);
      } else if (formData) {
        body = formData;
      }

      let response;
      try {
        response = await this.fetchImpl(url, {
          method, headers, body, redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (error) {
        if (safe && attempt < this.maxRetries) {
          await sleep(Math.min(8000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 250));
          continue;
        }
        throw error;
      }
      const data = await parseResponse(response);
      const traceId = response.headers.get('gncp-gw-trace-id') || data.traceId;

      if (response.ok) return data;

      if (response.status === 401 && data.code === 'GW.AUTHN' && !refreshed) {
        refreshed = true;
        this.tokenProvider.clear();
        continue;
      }
      if (safe && [429, 502, 503, 504].includes(response.status) && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(15000, 700 * (2 ** attempt)) + Math.floor(Math.random() * 400);
        await sleep(waitMs);
        continue;
      }

      throw new NaverApiError(data.message || `네이버 API 오류: HTTP ${response.status}`, {
        status: response.status,
        code: data.code,
        invalidInputs: data.invalidInputs,
        traceId,
        body: data
      });
    }
  }

  get(path, options) { return this.request('GET', path, options); }
  post(path, options) { return this.request('POST', path, options); }
  put(path, options) { return this.request('PUT', path, options); }
}
