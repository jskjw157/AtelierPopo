import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { listMigrationFiles, stripOuterTransaction } from '../src/infrastructure/postgres/migrator.js';

test('migrations are ordered and legacy transaction wrappers are removed', () => {
  const files = listMigrationFiles(path.resolve('migrations/postgres'));
  assert.deepEqual(files.map(item => item.version), ['0001', '0002', '0003', '0004', '0005']);
  assert.equal(files.at(-1).fileName, '0005_channel_import_mapping.sql');
  assert.equal(stripOuterTransaction('BEGIN;\nSELECT 1;\nCOMMIT;').trim(), 'SELECT 1;');
  assert.match(files.at(-1).checksum, /^[a-f0-9]{64}$/);
});
