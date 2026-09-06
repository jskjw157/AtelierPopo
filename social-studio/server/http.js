export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' } });
}

export function errorHandler(error, _req, res, _next) {
  if (error?.name === 'MulterError') {
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: error.message } });
  }
  const status = Number(error?.status || 500);
  const code = error?.code || 'INTERNAL_ERROR';
  const message = status >= 500 ? '서버에서 요청을 처리하지 못했습니다.' : error.message;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: { code, message, details: error?.details } });
}
