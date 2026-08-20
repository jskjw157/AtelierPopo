import { NaverApiError } from '../naver/errors.js';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toHttpError(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof NaverApiError) {
    return new HttpError(
      502,
      error.code || 'NAVER_UPSTREAM_ERROR',
      error.message,
      {
        upstreamStatus: error.status,
        traceId: error.traceId,
        invalidInputs: error.invalidInputs
      }
    );
  }
  if (error?.code === 'CATALOG_PRODUCT_NOT_FOUND') {
    return new HttpError(404, error.code, error.message);
  }
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return new HttpError(409, 'IDEMPOTENCY_CONFLICT', '동일한 멱등성 키가 이미 사용되었습니다.');
  }
  return new HttpError(500, 'INTERNAL_ERROR', error?.message || '서버 내부 오류가 발생했습니다.');
}

export function errorPayload(error, requestId, { exposeInternal = false } = {}) {
  const normalized = toHttpError(error);
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
