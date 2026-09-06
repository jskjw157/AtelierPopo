import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { clearSessionCookies } from './auth.js';
import { audit, query } from './db.js';
import { AppError } from './http.js';
import { PasswordPolicyError, validatePasswordChange } from './password-policy.js';

export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'PASSWORD_CHANGE_RATE_LIMITED',
      message: '비밀번호 변경 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    }
  }
});

export function createChangePasswordHandler({
  queryFn = query,
  compareFn = bcrypt.compare,
  hashFn = bcrypt.hash,
  auditFn = audit,
  clearSessionCookiesFn = clearSessionCookies,
  onAuditFailure = () => console.error('Password change audit write failed.'),
  errorFactory = (status, code, message) => new AppError(status, code, message)
} = {}) {
  return async function changePassword(req, res) {
    let input;
    try {
      input = validatePasswordChange(req.body || {});
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw errorFactory(400, error.code, error.message);
      }
      throw error;
    }

    const result = await queryFn(
      `SELECT id, password_hash
       FROM users
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [req.user.sub]
    );
    const user = result.rows[0];
    if (!user) throw errorFactory(401, 'UNAUTHORIZED', '로그인이 필요합니다.');

    const currentValid = await compareFn(input.currentPassword, user.password_hash);
    if (!currentValid) {
      throw errorFactory(400, 'CURRENT_PASSWORD_INVALID', '현재 비밀번호가 올바르지 않습니다.');
    }

    const reusesStoredPassword = await compareFn(input.newPassword, user.password_hash);
    if (reusesStoredPassword) {
      throw errorFactory(400, 'PASSWORD_REUSE', '현재 비밀번호와 다른 비밀번호를 사용해 주세요.');
    }

    const passwordHash = await hashFn(input.newPassword, 12);
    const updated = await queryFn(
      `UPDATE users
       SET password_hash = $2, updated_at = NOW()
       WHERE id = $1 AND password_hash = $3
       RETURNING id`,
      [user.id, passwordHash, user.password_hash]
    );
    if (!updated.rowCount) {
      throw errorFactory(
        409,
        'PASSWORD_CHANGED_CONCURRENTLY',
        '비밀번호가 다른 요청에서 먼저 변경되었습니다. 다시 로그인해 주세요.'
      );
    }

    try {
      await auditFn(user.id, 'auth.password_changed', 'user', user.id, {});
    } catch {
      // The credential was already changed. Do not report a false failure that
      // could make the administrator retry an operation that already succeeded.
      onAuditFailure();
    }

    clearSessionCookiesFn(res);
    return res.json({
      ok: true,
      message: '비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.'
    });
  };
}

export const changePassword = createChangePasswordHandler();
