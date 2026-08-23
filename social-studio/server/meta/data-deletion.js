import crypto, { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { AppError } from '../http.js';
import { randomToken } from '../security.js';

function decodeBase64Url(value) {
  return Buffer.from(String(value), 'base64url');
}

function parseSignedRequest(signedRequest) {
  const [encodedSignature, encodedPayload] = String(signedRequest || '').split('.');
  if (!encodedSignature || !encodedPayload) {
    throw new AppError(400, 'SIGNED_REQUEST_INVALID', 'Meta 삭제 요청 형식이 올바르지 않습니다.');
  }
  const actual = decodeBase64Url(encodedSignature);
  const expected = crypto.createHmac('sha256', config.meta.appSecret).update(encodedPayload).digest();
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new AppError(400, 'SIGNED_REQUEST_INVALID', 'Meta 삭제 요청 서명을 확인할 수 없습니다.');
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
  } catch {
    throw new AppError(400, 'SIGNED_REQUEST_INVALID', 'Meta 삭제 요청 내용을 해석할 수 없습니다.');
  }
  if (String(payload.algorithm || '').toUpperCase() !== 'HMAC-SHA256') {
    throw new AppError(400, 'SIGNED_REQUEST_INVALID', '지원하지 않는 Meta 삭제 요청 서명 방식입니다.');
  }
  return payload;
}

export async function receiveMetaDeletionRequest(signedRequest) {
  if (!config.meta.appSecret) {
    throw new AppError(409, 'META_NOT_CONFIGURED', 'META_APP_SECRET 설정이 필요합니다.');
  }
  const payload = parseSignedRequest(signedRequest);
  const confirmationCode = randomToken(18);
  await query(
    `INSERT INTO data_deletion_requests
      (id, confirmation_code, provider_user_id, status)
     VALUES ($1, $2, $3, 'received')`,
    [randomUUID(), confirmationCode, payload.user_id || null]
  );
  return {
    url: `${config.appBaseUrl}/data-deletion?code=${encodeURIComponent(confirmationCode)}`,
    confirmation_code: confirmationCode
  };
}

export async function createManualDeletionRequest(email) {
  const confirmationCode = randomToken(18);
  await query(
    `INSERT INTO data_deletion_requests
      (id, confirmation_code, email, status)
     VALUES ($1, $2, $3, 'received')`,
    [randomUUID(), confirmationCode, String(email).trim().toLowerCase()]
  );
  return { confirmationCode };
}

export async function getDeletionStatus(code) {
  const result = await query(
    `SELECT confirmation_code, status, requested_at, completed_at
     FROM data_deletion_requests WHERE confirmation_code = $1`,
    [code]
  );
  if (!result.rowCount) throw new AppError(404, 'DELETION_REQUEST_NOT_FOUND', '삭제 요청을 찾지 못했습니다.');
  return result.rows[0];
}
