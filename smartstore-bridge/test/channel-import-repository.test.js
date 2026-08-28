import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stableJson, sha256Json } from '../src/catalog/channel-import/canonical-json.js';

const sqliteMigrationPath = path.resolve('migrations/sqlite/0001_channel_import_mapping.sql');
const postgresMigrationPath = path.resolve('migrations/postgres/0005_channel_import_mapping.sql');

const expectedTables = [
  'schema_migrations',
  'haar_products',
  'channel_import_runs',
  'channel_products',
  'channel_product_snapshots',
  'channel_product_identifiers',
  'channel_match_runs',
  'channel_match_candidates',
  'channel_match_reviews',
  'haar_product_merge_history'
];

test('canonical hash ignores object key order and preserves array order', () => {
  assert.equal(stableJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(sha256Json({ b: 2, a: 1 }), sha256Json({ a: 1, b: 2 }));
  assert.notEqual(sha256Json([1, 2]), sha256Json([2, 1]));
});

test('SQLite migration creates the complete channel import schema', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(fs.readFileSync(sqliteMigrationPath, 'utf8'));
    const tables = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(row => row.name);
    assert.deepEqual(tables, [...expectedTables].sort());

    const channelProductSql = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_products'
    `).get().sql;
    assert.match(channelProductSql, /UNIQUE \(channel_id, remote_product_id\)/);
    assert.doesNotMatch(channelProductSql, /UNIQUE \(channel_id, seller_management_code\)/);

    const identifiersSql = db.prepare(`
      SELECT sql FROM sqlite_master WHERE type='table' AND name='channel_product_identifiers'
    `).get().sql;
    assert.match(identifiersSql, /eligible_for_exact_match/);
  } finally {
    db.close();
  }
});

test('PostgreSQL migration preserves duplicate seller codes and renames legacy IDs', () => {
  const sql = fs.readFileSync(postgresMigrationPath, 'utf8');
  assert.match(sql, /RENAME COLUMN channel_product_key TO channel_product_id/);
  assert.match(sql, /RENAME COLUMN channel_product_key TO channel_product_id/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS/);
  assert.match(sql, /channel_products_seller_code_idx/);
  assert.match(sql, /imported_unverified/);
  assert.match(sql, /channel_product_snapshots/);
  assert.match(sql, /channel_match_candidates/);
  assert.match(sql, /haar_product_merge_history/);
});
