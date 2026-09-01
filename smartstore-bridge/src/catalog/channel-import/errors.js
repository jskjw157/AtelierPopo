export class ChannelImportError extends Error {
  constructor(code, message, { status = 400, details = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ChannelImportError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asChannelImportError(error, fallbackCode = 'CHANNEL_IMPORT_ERROR') {
  if (error instanceof ChannelImportError) return error;
  return new ChannelImportError(
    error?.code || fallbackCode,
    error?.message || '채널 상품 가져오기 중 오류가 발생했습니다.',
    { status: Number(error?.status || 500), details: error?.details || null, cause: error }
  );
}
