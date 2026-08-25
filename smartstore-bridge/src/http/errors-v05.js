import { HttpError } from './errors.js';
import { toHttpErrorV04 } from './errors-v04.js';
import { SearchAdGatewayError } from '../naver/searchad/gateway.js';
import { SearchAdError } from '../naver/searchad/errors.js';
import { SearchAdSpecError } from '../naver/searchad/spec-registry.js';

export function toHttpErrorV05(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof SearchAdGatewayError || error instanceof SearchAdSpecError) {
    return new HttpError(error.status || 400, error.code || 'SEARCHAD_ERROR', error.message, error.details);
  }
  if (error instanceof SearchAdError) {
    return new HttpError(error.status || 502, error.code || 'SEARCHAD_UPSTREAM_ERROR', error.message, {
      upstreamStatus: error.upstreamStatus,
      requestId: error.requestId,
      retryable: error.retryable,
      ...(error.details ? { upstream: error.details } : {})
    });
  }
  return toHttpErrorV04(error);
}

export function errorPayloadV05(error, requestId, { exposeInternal = false } = {}) {
  const normalized = toHttpErrorV05(error);
  const publicMessage = normalized.status >= 500 && normalized.code === 'INTERNAL_ERROR' && !exposeInternal
    ? '서버 내부 오류가 발생했습니다.'
    : normalized.message;
  return {
    status: normalized.status,
    body: {
      ok: false,
      error: {
        code: normalized.code,
        message: publicMessage,
        ...(normalized.details ? { details: normalized.details } : {}),
        requestId
      }
    }
  };
}

export { HttpError };
