import { DatabaseSync } from 'node:sqlite';

export class Ledger {
  constructor(filePath) {
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
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
    if (status) {
      return this.db.prepare('SELECT * FROM product_jobs WHERE status=? ORDER BY updated_at ASC LIMIT ? OFFSET ?').all(status, limit, offset);
    }
    return this.db.prepare('SELECT * FROM product_jobs ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  }

  counts() {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM product_jobs GROUP BY status').all();
    return Object.fromEntries(rows.map(row => [row.status, Number(row.count)]));
  }
}
