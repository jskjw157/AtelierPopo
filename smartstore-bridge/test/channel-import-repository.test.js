import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stableJson, sha256Json } from '../src/catalog/channel-import/canonical-json.js';
import { SqliteChannelImportRepository } from '../src/catalog/channel-import/sqlite-repository.js';

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

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-repo-'));
  let sequence = 0;
  const repository = new SqliteChannelImportRepository({
    databasePath: path.join(dir, 'channel-import.sqlite'),
    idFactory: () => `id-${++sequence}`,
    clock: () => '2026-08-28T10:00:00.000Z'
  });
  repository.initialize();
  return {
    repository,
    close() {
      repository.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function draft(remoteProductId, code = 'HAAR-EAR-0012', overrides = {}) {
  return {
    channelId: 'haar_naver_smartstore',
    remoteProductId,
    productName: `상품 ${remoteProductId}`,
    sellerManagementCode: code,
    raw: { channelProductNo: remoteProductId, sellerManagementCode: code },
    normalized: { remoteProductId },
    identifiers: [{
      type: 'seller_management_code',
      value: code,
      normalizedValue: code,
      scope: 'product',
      variantReference: '',
      eligibleForExactMatch: true
    }],
    variants: [],
    ...overrides
  };
}

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
  assert.match(sql, /channel_products RENAME COLUMN channel_product_key TO channel_product_id/);
  assert.match(sql, /product_ad_mappings RENAME COLUMN channel_product_key TO channel_product_id/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS/);
  assert.match(sql, /channel_products_seller_code_idx/);
  assert.match(sql, /imported_unverified/);
  assert.match(sql, /channel_product_snapshots/);
  assert.match(sql, /channel_match_candidates/);
  assert.match(sql, /haar_product_merge_history/);
});

test('new listing creates one provisional HAAR product and snapshot', () => {
  const f = fixture();
  try {
    const run = f.repository.createImportRun({
      importRunId: 'run-1',
      channelId: 'haar_naver_smartstore',
      mode: 'full',
      idempotencyKey: 'naver-full-1'
    });
    const result = f.repository.upsertImportedChannelProduct({
      importRunId: run.importRunId,
      draft: draft('13732645378')
    });
    assert.equal(result.created, true);
    assert.equal(result.channelProduct.channelProductKey, 'haar_naver_smartstore:13732645378');
    assert.equal(result.haarProduct.status, 'imported_unverified');
    assert.equal(f.repository.listSnapshots(result.channelProduct.channelProductId).length, 1);
  } finally {
    f.close();
  }
});

test('same hash reimport is unchanged and preserves the HAAR id', () => {
  const f = fixture();
  try {
    const one = f.repository.createImportRun({
      importRunId: 'run-1', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'one-key'
    });
    const first = f.repository.upsertImportedChannelProduct({
      importRunId: one.importRunId, draft: draft('1001')
    });
    const two = f.repository.createImportRun({
      importRunId: 'run-2', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'two-key'
    });
    const second = f.repository.upsertImportedChannelProduct({
      importRunId: two.importRunId, draft: draft('1001')
    });
    assert.equal(second.unchanged, true);
    assert.equal(second.snapshotCreated, false);
    assert.equal(second.haarProduct.haarProductId, first.haarProduct.haarProductId);
    assert.equal(f.repository.listSnapshots(first.channelProduct.channelProductId).length, 1);
  } finally {
    f.close();
  }
});

test('changed content adds a snapshot without replacing the HAAR product', () => {
  const f = fixture();
  try {
    const one = f.repository.createImportRun({
      importRunId: 'run-1', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'changed-one'
    });
    const first = f.repository.upsertImportedChannelProduct({
      importRunId: one.importRunId, draft: draft('1001')
    });
    const two = f.repository.createImportRun({
      importRunId: 'run-2', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'changed-two'
    });
    const second = f.repository.upsertImportedChannelProduct({
      importRunId: two.importRunId,
      draft: draft('1001', 'HAAR-EAR-0012', {
        productName: '변경된 상품명',
        raw: { channelProductNo: '1001', sellerManagementCode: 'HAAR-EAR-0012', name: '변경' }
      })
    });
    assert.equal(second.updated, true);
    assert.equal(second.haarProduct.haarProductId, first.haarProduct.haarProductId);
    assert.equal(f.repository.listSnapshots(first.channelProduct.channelProductId).length, 2);
  } finally {
    f.close();
  }
});

test('duplicate codes are stored instead of rejected', () => {
  const f = fixture();
  try {
    const run = f.repository.createImportRun({
      importRunId: 'run-1', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'duplicates-key'
    });
    f.repository.upsertImportedChannelProduct({
      importRunId: run.importRunId, draft: draft('1001', 'DUP')
    });
    f.repository.upsertImportedChannelProduct({
      importRunId: run.importRunId, draft: draft('1002', 'DUP')
    });
    assert.equal(f.repository.listIdentifiers({
      type: 'seller_management_code',
      normalizedValue: 'DUP',
      channelId: 'haar_naver_smartstore'
    }).length, 2);
  } finally {
    f.close();
  }
});

test('only a succeeded full import may mark unseen products missing', () => {
  const f = fixture();
  try {
    const firstRun = f.repository.createImportRun({
      importRunId: 'run-1', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'missing-one'
    });
    const first = f.repository.upsertImportedChannelProduct({
      importRunId: firstRun.importRunId, draft: draft('1001')
    });
    const second = f.repository.upsertImportedChannelProduct({
      importRunId: firstRun.importRunId, draft: draft('1002')
    });
    f.repository.finishImportRun(firstRun.importRunId, { status: 'succeeded' });

    const partialRun = f.repository.createImportRun({
      importRunId: 'run-2', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'missing-two'
    });
    f.repository.upsertImportedChannelProduct({
      importRunId: partialRun.importRunId, draft: draft('1001')
    });
    f.repository.finishImportRun(partialRun.importRunId, { status: 'partial' });
    assert.throws(
      () => f.repository.markMissingAfterSuccessfulFullImport('haar_naver_smartstore', partialRun.importRunId),
      /succeeded full import/
    );

    const finalRun = f.repository.createImportRun({
      importRunId: 'run-3', channelId: 'haar_naver_smartstore',
      mode: 'full', idempotencyKey: 'missing-three'
    });
    f.repository.upsertImportedChannelProduct({
      importRunId: finalRun.importRunId, draft: draft('1001')
    });
    f.repository.finishImportRun(finalRun.importRunId, { status: 'succeeded' });
    assert.equal(f.repository.markMissingAfterSuccessfulFullImport('haar_naver_smartstore', finalRun.importRunId), 1);
    assert.equal(f.repository.getChannelProductByKey(first.channelProduct.channelProductKey).missingFromLatestFullImport, false);
    assert.equal(f.repository.getChannelProductByKey(second.channelProduct.channelProductKey).missingFromLatestFullImport, true);
  } finally {
    f.close();
  }
});
