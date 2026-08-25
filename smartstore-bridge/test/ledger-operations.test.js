import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/infrastructure/ledger.js';
import { OperationQueue } from '../src/application/operation-queue.js';
import { closeLedgerWhenQueueIdle, ensureSameIdempotentOperation } from '../src/http/runtime.js';

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

test('같은 멱등성 키에 다른 요청 본문을 재사용하면 충돌로 거부한다', () => {
  // Given
  const existing = {
    operation_type: 'commerce:change_status',
    source_product_id: 'product-1',
    request_json: JSON.stringify({ fingerprint: 'request-a', body: { status: 'SALE' } })
  };

  // When / Then
  assert.throws(
    () => ensureSameIdempotentOperation(existing, {
      operationType: 'commerce:change_status',
      sourceProductId: 'product-1',
      request: { fingerprint: 'request-b', body: { status: 'SUSPENSION' } }
    }),
    error => error.code === 'IDEMPOTENCY_KEY_REUSED'
  );
});

test('결과를 알 수 없는 쓰기는 failed가 아니라 interrupted로 기록한다', async () => {
  // Given
  const marks = [];
  const ledger = {
    recoverInterruptedOperations() {},
    markOperation(operationId, status, details) { marks.push({ operationId, status, details }); }
  };
  const queue = new OperationQueue({ ledger });

  // When
  queue.enqueue('op-unknown-write', async () => {
    const error = new Error('response lost');
    error.code = 'NAVER_WRITE_OUTCOME_UNKNOWN';
    throw error;
  });
  assert.equal(await queue.onIdle(), true);

  // Then
  assert.deepEqual(marks.map(item => item.status), ['running', 'interrupted']);
});

test('종료 시간 초과 시 활성 작업이 사용하는 ledger를 닫지 않는다', () => {
  // Given
  let closed = false;
  const ledger = { close() { closed = true; } };

  // When / Then
  assert.throws(
    () => closeLedgerWhenQueueIdle(ledger, false),
    error => error.code === 'OPERATION_QUEUE_SHUTDOWN_TIMEOUT'
  );
  assert.equal(closed, false);
});
