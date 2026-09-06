export class PasswordPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PasswordPolicyError';
    this.code = code;
  }
}

export function validatePasswordChange({ currentPassword, newPassword, confirmPassword }) {
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    throw new PasswordPolicyError('CURRENT_PASSWORD_REQUIRED', '현재 비밀번호를 입력해 주세요.');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 12) {
    throw new PasswordPolicyError('PASSWORD_TOO_SHORT', '새 비밀번호는 12자 이상이어야 합니다.');
  }
  if (Buffer.byteLength(newPassword, 'utf8') > 72) {
    throw new PasswordPolicyError('PASSWORD_TOO_LONG', '새 비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.');
  }
  if (newPassword !== confirmPassword) {
    throw new PasswordPolicyError('PASSWORD_CONFIRMATION_MISMATCH', '새 비밀번호 확인이 일치하지 않습니다.');
  }
  if (newPassword === currentPassword) {
    throw new PasswordPolicyError('PASSWORD_REUSE', '현재 비밀번호와 다른 비밀번호를 사용해 주세요.');
  }
  return { currentPassword, newPassword };
}
