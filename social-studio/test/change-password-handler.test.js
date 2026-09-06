import { describe, expect, it } from 'vitest';
import { createChangePasswordHandler } from '../server/password.js';

function responseDouble() {
  return {
    payload: null,
    json(value) {
      this.payload = value;
      return this;
    }
  };
}

function successfulQueryDouble(queries) {
  return async (sql, params) => {
    queries.push({ sql, params });
    if (/^SELECT/i.test(sql.trim())) {
      return { rowCount: 1, rows: [{ id: 'user-1', password_hash: 'stored-hash' }] };
    }
    return { rowCount: 1, rows: [{ id: 'user-1' }] };
  };
}

describe('change password handler', () => {
  it('rejects an incorrect current password without updating the account', async () => {
    const queries = [];
    const handler = createChangePasswordHandler({
      queryFn: async (sql, params) => {
        queries.push({ sql, params });
        return { rowCount: 1, rows: [{ id: 'user-1', password_hash: 'stored-hash' }] };
      },
      compareFn: async () => false,
      hashFn: async () => 'unused',
      auditFn: async () => {},
      clearSessionCookiesFn: () => {}
    });

    await expect(handler(
      {
        user: { sub: 'user-1' },
        body: {
          currentPassword: 'wrong-password-1',
          newPassword: 'New-password-456!',
          confirmPassword: 'New-password-456!'
        }
      },
      responseDouble()
    )).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' });

    expect(queries).toHaveLength(1);
  });

  it('updates the hash, writes a secret-free audit record, and clears the session', async () => {
    const queries = [];
    const audits = [];
    let cleared = false;
    const handler = createChangePasswordHandler({
      queryFn: successfulQueryDouble(queries),
      compareFn: async (candidate) => candidate === 'Current-password-123!',
      hashFn: async (candidate, rounds) => {
        expect(candidate).toBe('New-password-456!');
        expect(rounds).toBe(12);
        return 'new-hash';
      },
      auditFn: async (...args) => audits.push(args),
      clearSessionCookiesFn: () => {
        cleared = true;
      }
    });
    const response = responseDouble();

    await handler(
      {
        user: { sub: 'user-1' },
        body: {
          currentPassword: 'Current-password-123!',
          newPassword: 'New-password-456!',
          confirmPassword: 'New-password-456!'
        }
      },
      response
    );

    expect(queries).toHaveLength(2);
    expect(queries[1].sql).toMatch(/UPDATE users/i);
    expect(queries[1].params).toEqual(['user-1', 'new-hash', 'stored-hash']);
    expect(cleared).toBe(true);
    expect(response.payload).toEqual({
      ok: true,
      message: '비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.'
    });
    expect(audits).toEqual([
      ['user-1', 'auth.password_changed', 'user', 'user-1', {}]
    ]);
  });

  it('returns success and clears the session when the audit write fails after the hash update', async () => {
    const queries = [];
    let cleared = false;
    let auditFailureReported = false;
    const handler = createChangePasswordHandler({
      queryFn: successfulQueryDouble(queries),
      compareFn: async (candidate) => candidate === 'Current-password-123!',
      hashFn: async () => 'new-hash',
      auditFn: async () => {
        throw new Error('audit database unavailable');
      },
      onAuditFailure: () => {
        auditFailureReported = true;
      },
      clearSessionCookiesFn: () => {
        cleared = true;
      }
    });
    const response = responseDouble();

    await handler(
      {
        user: { sub: 'user-1' },
        body: {
          currentPassword: 'Current-password-123!',
          newPassword: 'New-password-456!',
          confirmPassword: 'New-password-456!'
        }
      },
      response
    );

    expect(queries).toHaveLength(2);
    expect(auditFailureReported).toBe(true);
    expect(cleared).toBe(true);
    expect(response.payload?.ok).toBe(true);
  });
});
