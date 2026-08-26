export class MultiSourceCatalogError extends Error {
  constructor(code, message, { status = 400, details = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MultiSourceCatalogError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asMultiSourceCatalogError(error, fallbackCode = 'MULTI_SOURCE_CATALOG_ERROR') {
  if (error instanceof MultiSourceCatalogError) return error;
  return new MultiSourceCatalogError(
    error?.code || fallbackCode,
    error?.message || '다중 상품소스 처리 중 오류가 발생했습니다.',
    {
      status: Number(error?.status || 500),
      details: error?.details || null,
      cause: error
    }
  );
}
