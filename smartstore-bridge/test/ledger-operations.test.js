import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/infrastructure/ledger.js';

test('HTTP 작업과 멱등성 키를 SQLite에 저장한다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-ledger-'));
  const file = path.join(dir, 'ledger.sqlite');
  const ledger = new Ledger(file);
  try {
    ledger.createOperation({
      operationId: 'op-12345678',
      idempotencyKey: 'register-1905-001',
      operationType: 'register_product',
      sourceProductId: '1905',
      request: { productId: '1905' }
    });
    assert.equal(ledger.findOperationByIdempotencyKey('register-1905-001').status, 'queued');
    ledger.markOperation('op-12345678', 'running');
    ledger.markOperation('op-12345678', 'succeeded', { result: { status: 'created' } });
    const row = ledger.getOperation('op-12345678');
    assert.equal(row.status, 'succeeded');
    assert.equal(JSON.parse(row.result_json).status, 'created');
    assert.equal(ledger.operationCounts().succeeded, 1);
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('재시작 시 남아 있던 queued/running 작업을 interrupted로 복구한다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-ledger-'));
  const file = path.join(dir, 'ledger.sqlite');
  const ledger = new Ledger(file);
  try {
    ledger.createOperation({
      operationId: 'op-87654321',
      idempotencyKey: 'register-1905-002',
      operationType: 'register_product',
      sourceProductId: '1905',
      request: {}
    });
    assert.equal(ledger.recoverInterruptedOperations(), 1);
    assert.equal(ledger.getOperation('op-87654321').status, 'interrupted');
  } finally {
    ledger.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
