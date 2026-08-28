import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';

test('channel import schema uses stable text keys and permits duplicate seller codes', async t => {
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

    const columns = await pool.query(`
      SELECT column_name,data_type
      FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='channel_products'
        AND column_name IN ('channel_product_id','channel_product_key','remote_product_id')
      ORDER BY column_name
    `);
    assert.deepEqual(columns.rows, [
      { column_name: 'channel_product_id', data_type: 'uuid' },
      { column_name: 'channel_product_key', data_type: 'text' },
      { column_name: 'remote_product_id', data_type: 'text' }
    ]);

    const table = await pool.query("SELECT to_regclass('public.channel_match_candidates') AS name");
    assert.equal(table.rows[0].name, 'channel_match_candidates');

    await pool.query('BEGIN');
    const first = await pool.query(`
      INSERT INTO haar_products(internal_sku,product_name,status)
      VALUES('CI-DUP-1','중복 코드 테스트 1','imported_unverified')
      RETURNING haar_product_id
    `);
    const second = await pool.query(`
      INSERT INTO haar_products(internal_sku,product_name,status)
      VALUES('CI-DUP-2','중복 코드 테스트 2','imported_unverified')
      RETURNING haar_product_id
    `);
    await pool.query(`
      INSERT INTO channel_products(
        channel_id,haar_product_id,channel_product_no,channel_product_key,
        remote_product_id,seller_management_code,product_name,metadata_json
      ) VALUES
        ('haar_naver_smartstore',$1,'CI-REMOTE-1','haar_naver_smartstore:CI-REMOTE-1','CI-REMOTE-1','DUPLICATE-CODE','테스트 1','{}'::jsonb),
        ('haar_naver_smartstore',$2,'CI-REMOTE-2','haar_naver_smartstore:CI-REMOTE-2','CI-REMOTE-2','DUPLICATE-CODE','테스트 2','{}'::jsonb)
    `, [first.rows[0].haar_product_id, second.rows[0].haar_product_id]);
    const duplicateCount = await pool.query(`
      SELECT count(*)::int AS count
      FROM channel_products
      WHERE channel_id='haar_naver_smartstore' AND seller_management_code='DUPLICATE-CODE'
    `);
    assert.equal(duplicateCount.rows[0].count, 2);
    await pool.query('ROLLBACK');
  } finally {
    await closePostgresPool(pool);
  }
});
