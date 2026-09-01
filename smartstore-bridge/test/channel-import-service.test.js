import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteChannelImportRepository } from '../src/catalog/channel-import/sqlite-repository.js';
import { ChannelProductRegistrar } from '../src/catalog/channel-import/registrar.js';
import { ChannelImportService } from '../src/catalog/channel-import/import-service.js';

function fixture(importer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-import-service-'));
  let sequence = 0;
  const repository = new SqliteChannelImportRepository({
    databasePath: path.join(dir, 'channel-import.sqlite'),
    idFactory: () => `row-${++sequence}`,
    clock: () => '2026-08-28T13:00:00.000Z'
  }).initialize();
  let runSequence = 0;
  const registrar = new ChannelProductRegistrar({ repository });
  const service = new ChannelImportService({
    repository,
    registrar,
    importers: new Map([['haar_naver_smartstore', importer]]),
    idFactory: () => `run-${++runSequence}`
  });
  return {
    dir,
    repository,
    registrar,
    service,
    close() {
      repository.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function draft(remoteProductId, code = `HAAR-${remoteProductId}`) {
  return {
    channelId: 'haar_naver_smartstore',
    remoteProductId,
    productName: `상품 ${remoteProductId}`,
    sellerManagementCode: code,
    raw: { channelProductNo: remoteProductId, sellerManagementCode: code },
    normalized: { remoteProductId, sellerManagementCode: code },
    identifiers: [{
      type: 'seller_management_code',
      value: code,
      normalizedValue: code,
      scope: 'product',
      variantReference: '',
      eligibleForExactMatch: true
    }],
    variants: []
  };
}

function twoPageImporter(counter = { calls: 0 }) {
  return {
    async preview() { return { remoteCount: 2, pageSize: 1 }; },
    async *iterate({ checkpoint } = {}) {
      counter.calls += 1;
      const start = checkpoint?.page || 1;
      if (start <= 1) {
        yield {
          page: 1,
          remoteCount: 2,
          items: [draft('N1')],
          nextCheckpoint: { page: 2 }
        };
      }
      yield {
        page: 2,
        remoteCount: 2,
        items: [draft('N2')],
        nextCheckpoint: null
      };
    }
  };
}

test('multi-page full import registers every listing and reuses the successful run', async () => {
  const counter = { calls: 0 };
  const f = fixture(twoPageImporter(counter));
  try {
    const result = await f.service.run({
      channelId: 'haar_naver_smartstore',
      mode: 'full',
      idempotencyKey: 'full-import-0001'
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.importedCount, 2);
    assert.equal(result.failedCount, 0);
    assert.equal(result.missingMarkedCount, 0);
    const products = f.repository.listChannelProducts({ channelId: 'haar_naver_smartstore' });
    assert.equal(products.length, 2);
    assert.equal(products.every(item => item.haarProductId), true);
    assert.equal(products.every(item => item.missingFromLatestFullImport === false), true);

    const reused = await f.service.run({
      channelId: 'haar_naver_smartstore',
      mode: 'full',
      idempotencyKey: 'full-import-0001'
    });
    assert.equal(reused.importRunId, result.importRunId);
    assert.equal(reused.reused, true);
    assert.equal(counter.calls, 1);
  } finally {
    f.close();
  }
});

test('same idempotency key with a different request is rejected', async () => {
  const f = fixture(twoPageImporter());
  try {
    await f.service.run({
      channelId: 'haar_naver_smartstore',
      mode: 'full',
      idempotencyKey: 'idempotency-conflict'
    });
    await assert.rejects(
      () => f.service.run({
        channelId: 'haar_naver_smartstore',
        mode: 'incremental',
        idempotencyKey: 'idempotency-conflict'
      }),
      error => error.code === 'CHANNEL_IMPORT_IDEMPOTENCY_CONFLICT'
    );
  } finally {
    f.close();
  }
});

test('second-page failure preserves checkpoint, skips missing marking, and resumes same run', async () => {
  let failSecondPage = true;
  const importer = {
    async preview() { return { remoteCount: 2, pageSize: 1 }; },
    async *iterate({ checkpoint } = {}) {
      const start = checkpoint?.page || 1;
      if (start <= 1) {
        yield {
          page: 1,
          remoteCount: 2,
          items: [draft('N1')],
          nextCheckpoint: { page: 2 }
        };
      }
      if (failSecondPage) {
        failSecondPage = false;
        throw Object.assign(new Error('page two unavailable'), { code: 'NAVER_PAGE_FAILED' });
      }
      yield {
        page: 2,
        remoteCount: 2,
        items: [draft('N2')],
        nextCheckpoint: null
      };
    }
  };
  const f = fixture(importer);
  let missingCalls = 0;
  const originalMarkMissing = f.repository.markMissingAfterSuccessfulFullImport.bind(f.repository);
  f.repository.markMissingAfterSuccessfulFullImport = (...args) => {
    missingCalls += 1;
    return originalMarkMissing(...args);
  };
  try {
    const partial = await f.service.run({
      channelId: 'haar_naver_smartstore',
      mode: 'full',
      idempotencyKey: 'resumable-full-1'
    });
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.cursor, { page: 2 });
    assert.equal(partial.importedCount, 1);
    assert.equal(missingCalls, 0);

    const resumed = await f.service.run({
      channelId: 'haar_naver_smartstore',
      mode: 'full',
      idempotencyKey: 'resumable-full-1'
    });
    assert.equal(resumed.importRunId, partial.importRunId);
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.status, 'succeeded');
    assert.equal(resumed.importedCount, 2);
    assert.equal(missingCalls, 1);
  } finally {
    f.close();
  }
});

test('one invalid item does not roll back a valid sibling', async () => {
  const importer = {
    async preview() { return { remoteCount: 2 }; },
    async *iterate() {
      yield {
        remoteCount: 2,
        items: [draft('N1'), {
          channelId: 'haar_naver_smartstore',
          remoteProductId: 'BROKEN',
          productName: '',
          raw: {}, normalized: {}, identifiers: []
        }],
        nextCheckpoint: null
      };
    }
  };
  const f = fixture(importer);
  try {
    const result = await f.service.run({
      channelId: 'haar_naver_smartstore',
      mode: 'full',
      idempotencyKey: 'sibling-isolation-1'
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.importedCount, 1);
    assert.equal(result.failedCount, 1);
    assert.equal(result.cursor.complete, true);
    assert.equal(f.repository.listChannelProducts({ channelId: 'haar_naver_smartstore' }).length, 1);
  } finally {
    f.close();
  }
});
