import { describe, expect, it } from 'vitest';
import { validatePasswordChange } from '../server/password-policy.js';

describe('password change policy', () => {
  it('rejects a new password shorter than 12 characters', () => {
    expect(() => validatePasswordChange({
      currentPassword: 'Old-password-123',
      newPassword: 'short123!',
      confirmPassword: 'short123!'
    })).toThrowError(expect.objectContaining({ code: 'PASSWORD_TOO_SHORT' }));
  });

  it('rejects a new password that does not match confirmation', () => {
    expect(() => validatePasswordChange({
      currentPassword: 'Old-password-123',
      newPassword: 'New-password-456!',
      confirmPassword: 'different-password'
    })).toThrowError(expect.objectContaining({ code: 'PASSWORD_CONFIRMATION_MISMATCH' }));
  });

  it('rejects reusing the current password', () => {
    expect(() => validatePasswordChange({
      currentPassword: 'Same-password-123!',
      newPassword: 'Same-password-123!',
      confirmPassword: 'Same-password-123!'
    })).toThrowError(expect.objectContaining({ code: 'PASSWORD_REUSE' }));
  });

  it('rejects a new password longer than bcrypt 72-byte limit', () => {
    const tooLong = '가'.repeat(25);
    expect(() => validatePasswordChange({
      currentPassword: 'Old-password-123',
      newPassword: tooLong,
      confirmPassword: tooLong
    })).toThrowError(expect.objectContaining({ code: 'PASSWORD_TOO_LONG' }));
  });

  it('rejects a missing current password', () => {
    expect(() => validatePasswordChange({
      currentPassword: '',
      newPassword: 'New-password-456!',
      confirmPassword: 'New-password-456!'
    })).toThrowError(expect.objectContaining({ code: 'CURRENT_PASSWORD_REQUIRED' }));
  });

  it('accepts a matching new password of at least 12 characters', () => {
    expect(validatePasswordChange({
      currentPassword: 'Old-password-123',
      newPassword: 'New-password-456!',
      confirmPassword: 'New-password-456!'
    })).toEqual({
      currentPassword: 'Old-password-123',
      newPassword: 'New-password-456!'
    });
  });
});
