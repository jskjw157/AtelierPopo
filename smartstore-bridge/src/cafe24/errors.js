export class Cafe24Error extends Error {
  constructor(code, message, {
    status = 502,
    upstreamStatus = null,
    requestId = null,
    retryable = false,
    details = null,
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'Cafe24Error';
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.requestId = requestId;
    this.retryable = retryable;
    this.details = details;
  }
}

export function redactCafe24Value(value, key = '') {
  if (value === null || value === undefined) return value;
  if (/(authorization|access.?token|refresh.?token|client.?secret|password)/i.test(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) return value.map(item => redactCafe24Value(item, key));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactCafe24Value(child, key ? `${key}.${childKey}` : childKey)
    ]));
  }
  return value;
}

export function asCafe24Error(error, fallbackCode = 'CAFE24_ERROR') {
  if (error instanceof Cafe24Error) return error;
  return new Cafe24Error(error?.code || fallbackCode, error?.message || 'Cafe24 처리 중 오류가 발생했습니다.', {
    status: Number(error?.status || 500),
    cause: error
  });
}
