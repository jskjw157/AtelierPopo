import { describe, expect, it } from 'vitest';
import { ensureBootstrapAdmin } from '../server/bootstrap-admin.js';

describe('administrator bootstrap', () => {
  it('does not overwrite an existing administrator password hash on restart', async () => {
    const calls = [];
    const queryFn = async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [{ id: 'existing-admin' }] };
    };

    const id = await ensureBootstrapAdmin({
      queryFn,
      email: 'admin@example.com',
      passwordHash: 'new-env-hash',
      idFactory: () => 'unused'
    });

    expect(id).toBe('existing-admin');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/SELECT id FROM users/i);
    expect(calls[0].params).toEqual(['admin@example.com']);
  });

  it('uses the bootstrap hash when creating the first administrator', async () => {
    const calls = [];
    const queryFn = async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    };

    const id = await ensureBootstrapAdmin({
      queryFn,
      email: 'admin@example.com',
      passwordHash: 'initial-hash',
      idFactory: () => 'new-admin'
    });

    expect(id).toBe('new-admin');
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).toMatch(/password_hash/i);
    expect(calls[1].params).toEqual(['new-admin', 'admin@example.com', 'initial-hash']);
  });
});
