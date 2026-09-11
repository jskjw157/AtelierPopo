import { SearchAdWriteError } from '../write/errors.js';

const INPUT_KEYS = new Set(['customerId', 'persistedDownloadUrl']);

function fail(code, message, status = 409, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function normalizeOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    fail('SEARCHAD_REPORT_DOWNLOAD_URL_UNSAFE', 'SearchAd report download origin is invalid.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.pathname !== '/') {
    fail('SEARCHAD_REPORT_DOWNLOAD_URL_UNSAFE', 'SearchAd report download origin is not trusted HTTPS origin.');
  }
  return parsed.origin;
}

export function validateReportDownloadUrl(downloadUrl, upstreamBaseUrl) {
  const trustedOrigin = normalizeOrigin(`${String(upstreamBaseUrl || '').replace(/\/$/, '')}/`);
  let parsed;
  try {
    parsed = new URL(String(downloadUrl || '').trim());
  } catch {
    fail('SEARCHAD_REPORT_DOWNLOAD_URL_UNSAFE', 'SearchAd report download URL is invalid.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== trustedOrigin ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.pathname !== '/report-download'
  ) {
    fail('SEARCHAD_REPORT_DOWNLOAD_URL_UNSAFE', 'SearchAd report download URL is outside the trusted report-download boundary.');
  }

  const query = {};
  for (const [key, value] of parsed.searchParams.entries()) {
    if (Object.hasOwn(query, key)) {
      fail('SEARCHAD_REPORT_DOWNLOAD_URL_UNSAFE', 'Duplicate SearchAd report download query keys are not allowed.', 409, { key });
    }
    query[key] = value;
  }
  return { path: '/report-download', query };
}

export class SearchAdReportDownloadAdapter {
  constructor({ client, upstreamBaseUrl, maxBytes = 25 * 1024 * 1024 } = {}) {
    if (!client?.request) throw new TypeError('SearchAd client.request is required');
    this.client = client;
    this.upstreamBaseUrl = String(upstreamBaseUrl || '').replace(/\/$/, '');
    if (!this.upstreamBaseUrl) throw new TypeError('upstreamBaseUrl is required');
    this.maxBytes = Number(maxBytes);
    if (!Number.isInteger(this.maxBytes) || this.maxBytes <= 0) throw new TypeError('maxBytes must be a positive integer');
  }

  async download(input = {}) {
    const extra = Object.keys(input || {}).filter(key => !INPUT_KEYS.has(key));
    if (extra.length) {
      fail(
        'SEARCHAD_REPORT_DOWNLOAD_INPUT_INVALID',
        'SearchAd report download accepts only Customer and persisted server-owned download URL.',
        400,
        { rejectedFields: extra.sort() }
      );
    }
    const customerId = String(input.customerId || '').trim();
    const persistedDownloadUrl = String(input.persistedDownloadUrl || '').trim();
    if (!customerId || !persistedDownloadUrl) {
      fail('SEARCHAD_REPORT_DOWNLOAD_INPUT_INVALID', 'customerId and persistedDownloadUrl are required.', 400);
    }

    const target = validateReportDownloadUrl(persistedDownloadUrl, this.upstreamBaseUrl);
    const response = await this.client.request({
      customerId,
      method: 'GET',
      path: target.path,
      query: target.query,
      responseType: 'arrayBuffer',
      retrySafe: true,
      redirect: 'manual'
    });

    const status = Number(response?.status || 0);
    if (status >= 300 && status < 400) {
      fail('SEARCHAD_REPORT_DOWNLOAD_REDIRECT_BLOCKED', 'SearchAd report download redirects are blocked.', 409);
    }
    if (status < 200 || status >= 300) {
      fail('SEARCHAD_REPORT_DOWNLOAD_FAILED', 'SearchAd report download did not return a successful response.', 502, { status });
    }

    const contentLength = Number(response?.headers?.['content-length']);
    if (Number.isFinite(contentLength) && contentLength > this.maxBytes) {
      fail('SEARCHAD_REPORT_DOWNLOAD_TOO_LARGE', 'SearchAd report download exceeds the configured byte limit.', 413);
    }
    const bytes = Buffer.isBuffer(response?.data) ? response.data : Buffer.from(response?.data || []);
    if (bytes.length > this.maxBytes) {
      fail('SEARCHAD_REPORT_DOWNLOAD_TOO_LARGE', 'SearchAd report download exceeds the configured byte limit.', 413);
    }

    return {
      bytes,
      byteLength: bytes.length,
      contentType: String(response?.headers?.['content-type'] || 'application/octet-stream'),
      requestId: response?.requestId == null ? null : String(response.requestId)
    };
  }
}

export const _internal = { INPUT_KEYS, normalizeOrigin };
