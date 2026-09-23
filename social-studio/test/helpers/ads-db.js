import pg from 'pg';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
export const testDbUrl = process.env.ADS_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
export async function testDatabase() {
  const url = new URL(testDbUrl);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('Ads tests require a local *_test database.');
  const schema = 'ads_' + randomUUID().replaceAll('-','');
  const admin = new pg.Pool({connectionString:testDbUrl});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({connectionString:testDbUrl, options:`-c search_path=${schema}`, max:5});
  const base = await fs.readFile(new URL('../../server/schema.sql', import.meta.url),'utf8');
  await pool.query(base);
  return {pool, async migrateAds() {
    const extra = await fs.readFile(new URL('../../server/meta/ads/schema.sql',import.meta.url),'utf8');
    await pool.query(extra);
  }, async close() {
    await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }};
}
