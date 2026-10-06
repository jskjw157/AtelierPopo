import { getApplicationSearchAdWriteRuntime } from '../naver/searchad/write/runtime-production.js';
import { HttpError } from './errors.js';

export function requireSearchAdHttpWrites(context) {
  if (!context.httpConfig?.allowWrites) {
    throw new HttpError(403, 'HTTP_WRITES_DISABLED', 'ATELIER_HTTP_ALLOW_WRITES=false입니다.');
  }
}

export function requiredSearchAdIdempotencyKey(req, body = {}) {
  const value = String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || body.idempotencyKey || '').trim();
  if (!value) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 헤더 또는 idempotencyKey가 필요합니다.');
  if (value.length > 200) throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey는 200자 이하여야 합니다.');
  return value;
}

export function getSearchAdWriteRuntime(context) { return getApplicationSearchAdWriteRuntime(context); }
