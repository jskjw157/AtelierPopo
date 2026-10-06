export class SearchAdWriteError extends Error {
  constructor(code, message, details = {}, status = 400) {
    super(message);
    this.name = 'SearchAdWriteError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export function searchAdWriteError(code, message, details = {}, status = 400) {
  return new SearchAdWriteError(code, message, details, status);
}

export function isAmbiguousSearchAdWriteError(error) {
  const code = String(error?.code || '').toUpperCase();
  // Circuit errors originate before transport entry, including a missing store.
  if (code.startsWith('SEARCHAD_CIRCUIT_')) return false;
  const status = Number(error?.status || error?.statusCode || 0);
  return Boolean(
    error?.name === 'AbortError' ||
    code.includes('TIMEOUT') ||
    code.includes('ABORT') ||
    code.includes('ECONNRESET') ||
    code.includes('EPIPE') ||
    status === 502 || status === 503 || status === 504
  );
}
