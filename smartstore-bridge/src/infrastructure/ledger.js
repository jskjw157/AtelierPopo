import { DatabaseSync } from 'node:sqlite';

function stringify(value) {
  return value === undefined ? null : JSON.stringify(value);
}

export class Ledger {
  constructor(filePath) {
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS product_jobs (
        source_product_id TEXT PRIMARY KEY,
        seller_management_code TEXT NOT NULL,
        source_path TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        origin_product_no TEXT,
        channel_product_no TEXT,
        last_error TEXT,
        payload_json TEXT,
        result_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_product_jobs_status ON product_jobs(status);

      CREATE TABLE IF NOT EXISTS api_operations (
        operation_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        operation_type TEXT NOT NULL,
        source_product_id TEXT,
        status TEXT NOT NULL,
        request_json TEXT,
        result_json TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_api_operations_status ON api_operations(status);
      CREATE INDEX IF NOT EXISTS idx_api_operations_product ON api_operations(source_product_id);
    `);
  }

  close() { this.db.close(); }

  upsertQueued({ sourceProductId, sellerManagementCode, sourcePath }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO product_jobs(source_product_id, seller_management_code, source_path, status, updated_at)
      VALUES (?, ?, ?, 'queued', ?)
      ON CONFLICT(source_product_id) DO UPDATE SET
        seller_management_code=excluded.seller_management_code,
        source_path=excluded.source_path,
        updated_at=excluded.updated_at
    `).run(sourceProductId, sellerManagementCode, sourcePath, now);
  }

  mark(sourceProductId, status, details = {}) {
    const current = this.get(sourceProductId);
    if (!current) throw new Error(`원장에 없는 상품입니다: ${sourceProductId}`);
    const attempts = Number(current.attempts || 0) + (status === 'creating' ? 1 : 0);
    this.db.prepare(`
      UPDATE product_jobs SET
        status=?, attempts=?, origin_product_no=?, channel_product_no=?, last_error=?, payload_json=?, result_json=?, updated_at=?
      WHERE source_product_id=?
    `).run(
      status,
      attempts,
      details.originProductNo ?? current.origin_product_no,
      details.channelProductNo ?? current.channel_product_no,
      details.lastError ?? null,
      details.payload ? JSON.stringify(details.payload) : current.payload_json,
      details.result ? JSON.stringify(details.result) : current.result_json,
      new Date().toISOString(),
      sourceProductId
    );
  }

  get(sourceProductId) {
    return this.db.prepare('SELECT * FROM product_jobs WHERE source_product_id=?').get(sourceProductId);
  }

  list({ status, limit = 100, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    if (status) {
      return this.db.prepare('SELECT * FROM product_jobs WHERE status=? ORDER BY updated_at ASC LIMIT ? OFFSET ?').all(status, safeLimit, safeOffset);
    }
    return this.db.prepare('SELECT * FROM product_jobs ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(safeLimit, safeOffset);
  }

  counts() {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM product_jobs GROUP BY status').all();
    return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
  }

  createOperation({ operationId, idempotencyKey, operationType, sourceProductId, request }) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO api_operations(
        operation_id, idempotency_key, operation_type, source_product_id,
        status, request_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
    `).run(
      operationId,
      idempotencyKey,
      operationType,
      sourceProductId ?? null,
      stringify(request),
      now,
      now
    );
    return this.getOperation(operationId);
  }

  markOperation(operationId, status, details = {}) {
    const current = this.getOperation(operationId);
    if (!current) throw new Error(`원장에 없는 API 작업입니다: ${operationId}`);
    const now = new Date().toISOString();
    const startedAt = status === 'running' && !current.started_at ? now : current.started_at;
    const terminal = ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status);
    const completedAt = terminal ? now : current.completed_at;
    this.db.prepare(`
      UPDATE api_operations SET
        status=?, result_json=?, error_json=?, started_at=?, completed_at=?, updated_at=?
      WHERE operation_id=?
    `).run(
      status,
      details.result !== undefined ? stringify(details.result) : current.result_json,
      details.error !== undefined ? stringify(details.error) : current.error_json,
      startedAt,
      completedAt,
      now,
      operationId
    );
    return this.getOperation(operationId);
  }

  getOperation(operationId) {
    return this.db.prepare('SELECT * FROM api_operations WHERE operation_id=?').get(operationId);
  }

  findOperationByIdempotencyKey(idempotencyKey) {
    return this.db.prepare('SELECT * FROM api_operations WHERE idempotency_key=?').get(idempotencyKey);
  }

  listOperations({ status, operationType, limit = 100, offset = 0 } = {}) {
    const clauses = [];
    const values = [];
    if (status) {
      clauses.push('status=?');
      values.push(status);
    }
    if (operationType) {
      clauses.push('operation_type=?');
      values.push(operationType);
    }
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT * FROM api_operations ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...values, safeLimit, safeOffset);
  }

  operationCounts() {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM api_operations GROUP BY status').all();
    return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
  }

  recoverInterruptedOperations() {
    const now = new Date().toISOString();
    const error = JSON.stringify({
      code: 'PROCESS_RESTARTED',
      message: '서버 프로세스가 재시작되어 실행 중이던 작업을 완료 여부 미확인 상태로 종료했습니다.'
    });
    const result = this.db.prepare(`
      UPDATE api_operations
      SET status='interrupted', error_json=?, completed_at=?, updated_at=?
      WHERE status IN ('queued', 'running')
    `).run(error, now, now);
    return Number(result.changes || 0);
  }
}
