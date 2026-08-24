import { HttpError, toHttpError as toBaseHttpError } from './errors.js';
import { DriveBoundaryError } from '../drive/boundary.js';
import { DriveServiceError, normalizeDriveError } from '../drive/service.js';

function driveStatus(error) {
  const code = String(error.code || '');
  const upstreamStatus = Number(error.details?.status || 0);
  if (code === 'DRIVE_FILE_NOT_FOUND' || code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('OUTSIDE_ALLOWED_ROOT') || code.includes('ROOT_OPERATION_NOT_ALLOWED')) return 403;
  if (code.includes('DISABLED') || code.includes('NOT_CONFIGURED')) return 503;
  if (code.includes('TOO_LARGE')) return 413;
  if (code.includes('CONFLICT') || code.includes('REQUIRES_USER_OAUTH')) return 409;
  if (code.startsWith('DRIVE_') && (
    code.includes('INVALID') ||
    code.includes('REQUIRED') ||
    code.includes('NOT_ALLOWED') ||
    code.includes('MULTIPLE_CONTENT') ||
    code.includes('EXPORT_MIME')
  )) return 400;
  if ([401, 403, 404, 409, 429].includes(upstreamStatus)) return upstreamStatus;
  return 502;
}

export function toHttpErrorV03(error) {
  if (error instanceof HttpError) return error;
  const normalizedDrive = normalizeDriveError(error);
  if (normalizedDrive instanceof DriveServiceError || normalizedDrive instanceof DriveBoundaryError) {
    return new HttpError(
      driveStatus(normalizedDrive),
      normalizedDrive.code || 'GOOGLE_DRIVE_ERROR',
      normalizedDrive.message,
      normalizedDrive.details
    );
  }
  return toBaseHttpError(error);
}

export function errorPayload(error, requestId, { exposeInternal = false } = {}) {
  const normalized = toHttpErrorV03(error);
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
