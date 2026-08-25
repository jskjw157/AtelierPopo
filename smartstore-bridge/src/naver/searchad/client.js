import { buildSearchAdHeaders, normalizeSearchAdUri } from './auth.js';
import { SearchAdError, redactSearchAdObject, searchAdErrorFromResponse } from './errors.js';

function sleepDefault(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendQuery(url, query) {
  if (!query || typeof query !== 'object') return;
  for (const [key, raw] of Object.entries(query)) {
    if (raw === undefined || raw === null || raw === '') continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value === undefined || value === null) continue;
      url.searchParams.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }
}

async function parseResponseBody(response, responseType = 'auto') {
  if (response.status === 204 || response.status === 205) return null;
  if (responseType === 'arrayBuffer') return Buffer.from(await response.arrayBuffer());
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (responseType === 'json' || contentType.includes('application/json')) {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }
  const text = await response.text();
  if (!text) return null;
  if (responseType === 'text') return text;
  try { return JSON.parse(text); } catch { return text; }
}

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, when - now);
  return null;
}

function headerMetadata(headers) {
  const entries = {};
  for (const name of [
    'x-request-id',
    'x-transaction-id',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'retry-after',
    'content-type',
    'content-length'
  ]) {
    const value = headers.get(name);
    if (value !== null) entries[name] = value;
  }
  return entries;
}

export class NaverSearchAdClient {
  constructor({
    baseUrl,
    credentialsRegistry,
    fetchImpl = globalThis.fetch,
    clock = () => Date.now(),
    sleep = sleepDefault,
    requestTimeoutMs = 30_000,
    maxRetries = 3,
    logger = console,
    random = Math.random
  }) {
    if (!fetchImpl) throw new Error('SearchAd client requires fetch.');
    this.baseUrl = String(baseUrl || 'https://api.searchad.naver.com').replace(/\/$/, '');
    this.credentialsRegistry = credentialsRegistry;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.sleep = sleep;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxRetries = maxRetries;
    this.logger = logger;
    this.random = random;
  }

  async request({
    customerId,
    method = 'GET',
    path,
    query,
    json,
    body,
    headers = {},
    responseType = 'auto',
    retrySafe
  }) {
    const normalizedMethod = String(method).toUpperCase();
    const uri = normalizeSearchAdUri(path);
    const credentials = this.credentialsRegistry.resolve(customerId);
    const canRetry = retrySafe ?? ['GET', 'HEAD'].includes(normalizedMethod);
    const maxAttempts = canRetry ? this.maxRetries + 1 : 1;
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = this.clock();
      const url = new URL(`${this.baseUrl}${uri}`);
      appendQuery(url, query);
      const timestamp = String(this.clock());
      const authHeaders = buildSearchAdHeaders({
        accessLicense: credentials.accessLicense,
        secretKey: credentials.secretKey,
        customerId: credentials.customerId,
        timestamp,
        method: normalizedMethod,
        uri
      });
      const requestHeaders = {
        Accept: 'application/json',
        ...authHeaders,
        ...headers
      };
      let requestBody = body;
      if (json !== undefined) {
        requestHeaders['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(json);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: normalizedMethod,
          headers: requestHeaders,
          body: ['GET', 'HEAD'].includes(normalizedMethod) ? undefined : requestBody,
          signal: controller.signal,
          redirect: 'follow'
        });
        const data = await parseResponseBody(response, responseType);
        const requestId = response.headers.get('x-request-id') || response.headers.get('x-transaction-id') || null;
        if (!response.ok) {
          const error = searchAdErrorFromResponse({ response, data, requestId });
          if (canRetry && error.retryable && attempt < maxAttempts) {
            const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.clock());
            const backoffMs = retryAfterMs ?? Math.min(30_000, 300 * (2 ** (attempt - 1)) + Math.floor(this.random() * 250));
            this.logger?.warn?.('SearchAd request retry scheduled', {
              method: normalizedMethod,
              uri,
              attempt,
              status: response.status,
              backoffMs,
              customerIdMasked: `***${String(customerId).slice(-4)}`
            });
            await this.sleep(backoffMs);
            continue;
          }
          throw error;
        }
        return {
          status: response.status,
          data,
          requestId,
          attempts: attempt,
          durationMs: Math.max(0, this.clock() - startedAt),
          headers: headerMetadata(response.headers),
          customerId: credentials.customerId,
          principalId: credentials.principalId,
          uri,
          method: normalizedMethod
        };
      } catch (error) {
        lastError = error;
        const aborted = error?.name === 'AbortError';
        const networkError = !(error instanceof SearchAdError);
        const retryable = canRetry && attempt < maxAttempts && (aborted || networkError);
        if (retryable) {
          const backoffMs = Math.min(30_000, 300 * (2 ** (attempt - 1)) + Math.floor(this.random() * 250));
          await this.sleep(backoffMs);
          continue;
        }
        if (error instanceof SearchAdError) throw error;
        throw new SearchAdError(aborted ? 'SearchAd request timed out.' : 'SearchAd network request failed.', {
          code: aborted ? 'SEARCHAD_REQUEST_TIMEOUT' : 'SEARCHAD_NETWORK_ERROR',
          status: 502,
          retryable: canRetry,
          cause: error,
          details: redactSearchAdObject({ method: normalizedMethod, uri, attempt })
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }
}

export const _internal = { appendQuery, parseResponseBody, parseRetryAfter, headerMetadata };
