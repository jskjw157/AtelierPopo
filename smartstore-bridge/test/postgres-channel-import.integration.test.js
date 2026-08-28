import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';

test('channel import schema is migrated and seeds exactly one Cafe24 own mall', async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: url, sslMode: 'disable' });
  try {
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres') });
    const ownMall = await pool.query(
      "SELECT channel_id,platform_type,primary_domain FROM sales_channels WHERE channel_role='owned_store' ORDER BY channel_id"
    );
    assert.deepEqual(ownMall.rows, [
      { channel_id: 'haar_own_mall', platform_type: 'cafe24', primary_domain: 'haar.co.kr' }
    ]);
    const table = await pool.query("SELECT to_regclass('public.channel_match_candidates') AS name");
    assert.equal(table.rows[0].name, 'channel_match_candidates');
  } finally {
    await closePostgresPool(pool);
  }
});
