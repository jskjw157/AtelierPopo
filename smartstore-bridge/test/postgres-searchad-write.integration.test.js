import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';

test('PostgreSQL SearchAd write schema applies idempotently and enforces plan and token constraints', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  try {
    const options = { pool, migrationsDir: path.resolve('migrations/postgres') };
    const first = await runPostgresMigrations(options);
    assert.equal(first.currentVersion, '0006');
    const second = await runPostgresMigrations(options);
    assert.deepEqual(second.applied, []);
    assert.equal(second.currentVersion, '0006');
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name LIKE 'searchad_write_%' ORDER BY table_name`);
    assert.deepEqual(tables.rows.map(row => row.table_name), [
      'searchad_write_approvals', 'searchad_write_attempts', 'searchad_write_change_plans', 'searchad_write_locks'
    ]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const planId = randomUUID();
      await client.query(`INSERT INTO searchad_write_change_plans(
        plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,
        before_hash,expected_after_json,reason,status,created_by,created_at,expires_at
      ) VALUES($1,'fixture-customer','fixture.operation','{}','{}','{}', $2,'{}',
        'schema test','planned','fixture',now(),now()+interval '10 minutes')`, [planId, 'a'.repeat(64)]);
      await client.query(`INSERT INTO searchad_write_approvals(
        approval_id,plan_id,actor,confirmation,token_hash,created_at,expires_at
      ) VALUES($1,$2,'fixture','APPROVE_SEARCHAD_CHANGE',$3,now(),now()+interval '10 minutes')`,
        [randomUUID(), planId, 'b'.repeat(64)]);
      await client.query('SAVEPOINT invalid_status');
      await assert.rejects(() => client.query(
        "UPDATE searchad_write_change_plans SET status='invalid-status' WHERE plan_id=$1", [planId]
      ), { code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_status');
      await client.query('SAVEPOINT duplicate_token');
      await assert.rejects(() => client.query(`INSERT INTO searchad_write_approvals(
        approval_id,plan_id,actor,confirmation,token_hash,created_at,expires_at
      ) VALUES($1,$2,'fixture','APPROVE_SEARCHAD_CHANGE',$3,now(),now()+interval '10 minutes')`,
        [randomUUID(), planId, 'b'.repeat(64)]), { code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_token');
      const status = await client.query('SELECT status FROM searchad_write_change_plans WHERE plan_id=$1', [planId]);
      assert.equal(status.rows[0].status, 'planned');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  } finally { await closePostgresPool(pool); }
});
