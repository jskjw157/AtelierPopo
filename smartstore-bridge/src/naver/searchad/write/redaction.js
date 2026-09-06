import { SearchAdWriteError } from './errors.js';

const SENSITIVE_KEY = /(secret|token|authorization|signature|api[-_]?key|access[-_]?license|client[-_]?secret|password|credential)/i;
const BEARER_VALUE = /^Bearer\s+/i;

export function redactSearchAdWriteValue(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return BEARER_VALUE.test(value) ? '[REDACTED]' : value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactSearchAdWriteValue(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSearchAdWriteValue(item, seen);
  }
  return output;
}

export function sanitizeSearchAdRemoteError(error) {
  const safe = new SearchAdWriteError(
    error?.code || 'SEARCHAD_REMOTE_ERROR',
    error?.message || 'SearchAd 원격 요청에 실패했습니다.',
    redactSearchAdWriteValue(error?.details || error?.response || {}),
    Number(error?.status || error?.statusCode || 0) || 502
  );
  safe.name = error?.name || 'SearchAdRemoteError';
  if (error?.name === 'AbortError') safe.name = 'AbortError';
  return safe;
}
