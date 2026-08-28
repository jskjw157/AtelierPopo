import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sha256Json } from './canonical-json.js';

function json(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return JSON.stringify(fallback);
  return JSON.stringify(value);
}

function parseJson(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return structuredClone(fallback);
  try { return JSON.parse(value); } catch { return structuredClone(fallback); }
}

function integerBoolean(value) {
  return value ? 1 : 0;
}

function publicHaarProduct(row) {
  if (!row) return null;
  return {
    haarProductId: row.haar_product_id,
    internalSku: row.internal_sku,
    productName: row.product_name,
    brandName: row.brand_name,
    status: row.status,
    canonicalAttributes: parseJson(row.canonical_attributes_json),
    canonicalContent: parseJson(row.canonical_content_json),
    mergedIntoHaarProductId: row.merged_into_haar_product_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicChannelProduct(row) {
  if (!row) return null;
  return {
    channelProductId: row.channel_product_id,
    channelProductKey: row.channel_product_key,
    channelId: row.channel_id,
    haarProductId: row.haar_product_id,
    remoteProductId: row.remote_product_id,
    originProductNo: row.origin_product_no,
    sellerManagementCode: row.seller_management_code,
    productName: row.product_name,
    channelStatus: row.channel_status,
    channelUrl: row.channel_url,
    sourceModifiedAt: row.source_modified_at,
    latestSnapshotId: row.latest_snapshot_id,
    linkProvenance: row.link_provenance,
    missingFromLatestFullImport: Boolean(row.missing_from_latest_full_import),
    lastSeenImportRunId: row.last_seen_import_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function publicImportRun(row) {
  if (!row) return null;
  return {
    importRunId: row.import_run_id,
    channelId: row.channel_id,
    mode: row.mode,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    remoteCount: Number(row.remote_count),
    importedCount: Number(row.imported_count),
    updatedCount: Number(row.updated_count),
    unchangedCount: Number(row.unchanged_count),
    failedCount: Number(row.failed_count),
    cursor: parseJson(row.cursor_json),
    error: parseJson(row.error_json),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  };
}

export class SqliteChannelImportRepository {
  constructor({
    databasePath,
    migrationsDir = path.resolve('migrations/sqlite'),
    idFactory = () => crypto.randomUUID(),
    clock = () => new Date().toISOString()
  } = {}) {
    if (!databasePath) throw new Error('SqliteChannelImportRepository에는 databasePath가 필요합니다.');
    this.databasePath = databasePath;
    this.migrationsDir = migrationsDir;
    this.idFactory = idFactory;
    this.clock = clock;
    this.db = null;
  }

  initialize() {
    if (this.db) return this;
    if (this.databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(this.databasePath)), { recursive: true });
    }
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (this.databasePath !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.#runMigrations();
    return this;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  #requireDb() {
    if (!this.db) throw new Error('SqliteChannelImportRepository.initialize()를 먼저 호출해야 합니다.');
    return this.db;
  }

  #runMigrations() {
    const db = this.#requireDb();
    const files = fs.readdirSync(this.migrationsDir)
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    for (const fileName of files) {
      const version = fileName.slice(0, 4);
      const sql = fs.readFileSync(path.join(this.migrationsDir, fileName), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      let applied = null;
      try {
        applied = db.prepare('SELECT checksum FROM schema_migrations WHERE version=?').get(version);
      } catch {
        // The first migration creates schema_migrations.
      }
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(`SQLite migration checksum mismatch: ${fileName}`);
        }
        continue;
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(sql);
        db.prepare(`
          INSERT INTO schema_migrations(version,file_name,checksum,applied_at)
          VALUES (?,?,?,?)
        `).run(version, fileName, checksum, this.clock());
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    }
  }

  transaction(callback) {
    const db = this.#requireDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  createImportRun(input) {
    const db = this.#requireDb();
    const now = this.clock();
    const importRunId = String(input.importRunId || this.idFactory());
    const requestHash = String(input.requestHash || sha256Json({
      channelId: input.channelId,
      mode: input.mode || 'full',
      request: input.request || {}
    }));
    db.prepare(`
      INSERT INTO channel_import_runs(
        import_run_id,channel_id,mode,status,idempotency_key,request_hash,
        cursor_json,error_json,created_at
      ) VALUES (?,?,?,'queued',?,?, '{}','{}',?)
    `).run(
      importRunId,
      String(input.channelId),
      String(input.mode || 'full'),
      String(input.idempotencyKey),
      requestHash,
      now
    );
    return publicImportRun(db.prepare('SELECT * FROM channel_import_runs WHERE import_run_id=?').get(importRunId));
  }

  getImportRun(importRunId) {
    const row = this.#requireDb().prepare('SELECT * FROM channel_import_runs WHERE import_run_id=?').get(importRunId);
    return publicImportRun(row);
  }

  findImportRunByIdempotencyKey(idempotencyKey) {
    const row = this.#requireDb().prepare('SELECT * FROM channel_import_runs WHERE idempotency_key=?').get(idempotencyKey);
    return publicImportRun(row);
  }

  updateImportCheckpoint(importRunId, patch = {}) {
    const current = this.getImportRun(importRunId);
    if (!current) throw new Error(`channel import run not found: ${importRunId}`);
    const status = patch.status || current.status;
    const startedAt = patch.startedAt ?? (status === 'running' && !current.startedAt ? this.clock() : current.startedAt);
    this.#requireDb().prepare(`
      UPDATE channel_import_runs SET
        status=?,remote_count=?,imported_count=?,updated_count=?,unchanged_count=?,
        failed_count=?,cursor_json=?,error_json=?,started_at=?
      WHERE import_run_id=?
    `).run(
      status,
      patch.remoteCount ?? current.remoteCount,
      patch.importedCount ?? current.importedCount,
      patch.updatedCount ?? current.updatedCount,
      patch.unchangedCount ?? current.unchangedCount,
      patch.failedCount ?? current.failedCount,
      json(patch.cursor ?? current.cursor),
      json(patch.error ?? current.error),
      startedAt,
      importRunId
    );
    return this.getImportRun(importRunId);
  }

  finishImportRun(importRunId, patch = {}) {
    const status = String(patch.status || 'succeeded');
    if (!['succeeded', 'partial', 'failed'].includes(status)) {
      throw new Error(`invalid terminal import status: ${status}`);
    }
    const updated = this.updateImportCheckpoint(importRunId, { ...patch, status });
    this.#requireDb().prepare(`
      UPDATE channel_import_runs SET completed_at=? WHERE import_run_id=?
    `).run(patch.completedAt || this.clock(), importRunId);
    return { ...updated, completedAt: patch.completedAt || this.clock(), status };
  }

  upsertImportedChannelProduct({ importRunId, draft }) {
    const channelId = String(draft?.channelId || '').trim();
    const remoteProductId = String(draft?.remoteProductId || '').trim();
    const productName = String(draft?.productName || '').trim();
    if (!channelId || !remoteProductId || !productName) {
      throw new Error('draft.channelId, draft.remoteProductId, draft.productName are required');
    }
    const run = this.getImportRun(importRunId);
    if (!run) throw new Error(`channel import run not found: ${importRunId}`);
    if (run.channelId !== channelId) throw new Error('import run channel does not match draft channel');

    const channelProductKey = `${channelId}:${remoteProductId}`;
    const raw = draft.raw || {};
    const normalized = draft.normalized || {};
    const contentHash = sha256Json({ raw, normalized });
    const now = this.clock();

    return this.transaction(db => {
      const existingRow = db.prepare('SELECT * FROM channel_products WHERE channel_product_key=?').get(channelProductKey);
      let haarProductId;
      let channelProductId;
      let created = false;
      let updated = false;
      let unchanged = false;

      if (!existingRow) {
        created = true;
        haarProductId = String(this.idFactory());
        channelProductId = String(this.idFactory());
        db.prepare(`
          INSERT INTO haar_products(
            haar_product_id,internal_sku,product_name,brand_name,status,
            canonical_attributes_json,canonical_content_json,created_at,updated_at
          ) VALUES (?,?,?,'HAAR','imported_unverified','{}','{}',?,?)
        `).run(
          haarProductId,
          draft.internalSku || null,
          productName,
          now,
          now
        );
        db.prepare(`
          INSERT INTO channel_products(
            channel_product_id,channel_product_key,channel_id,haar_product_id,
            remote_product_id,origin_product_no,seller_management_code,product_name,
            channel_status,channel_url,source_modified_at,link_provenance,
            missing_from_latest_full_import,last_seen_import_run_id,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'imported_unverified',0,?,?,?)
        `).run(
          channelProductId,
          channelProductKey,
          channelId,
          haarProductId,
          remoteProductId,
          draft.originProductNo || null,
          draft.sellerManagementCode || null,
          productName,
          draft.channelStatus || null,
          draft.channelUrl || null,
          draft.sourceModifiedAt || null,
          importRunId,
          now,
          now
        );
      } else {
        haarProductId = existingRow.haar_product_id;
        channelProductId = existingRow.channel_product_id;
        db.prepare(`
          UPDATE channel_products SET
            origin_product_no=?,seller_management_code=?,product_name=?,channel_status=?,
            channel_url=?,source_modified_at=?,missing_from_latest_full_import=0,
            last_seen_import_run_id=?,updated_at=?
          WHERE channel_product_id=?
        `).run(
          draft.originProductNo || null,
          draft.sellerManagementCode || null,
          productName,
          draft.channelStatus || null,
          draft.channelUrl || null,
          draft.sourceModifiedAt || null,
          importRunId,
          now,
          channelProductId
        );
      }

      const priorSnapshot = db.prepare(`
        SELECT snapshot_id FROM channel_product_snapshots
        WHERE channel_product_id=? AND content_hash=?
      `).get(channelProductId, contentHash);
      let snapshotId = priorSnapshot?.snapshot_id || null;
      let snapshotCreated = false;
      if (!priorSnapshot) {
        snapshotId = String(this.idFactory());
        snapshotCreated = true;
        updated = !created;
        db.prepare(`
          INSERT INTO channel_product_snapshots(
            snapshot_id,channel_product_id,import_run_id,source_modified_at,
            raw_json,normalized_json,content_hash,captured_at
          ) VALUES (?,?,?,?,?,?,?,?)
        `).run(
          snapshotId,
          channelProductId,
          importRunId,
          draft.sourceModifiedAt || null,
          json(raw),
          json(normalized),
          contentHash,
          now
        );
      } else if (!created) {
        unchanged = true;
      }
      db.prepare(`
        UPDATE channel_products SET latest_snapshot_id=?,updated_at=?
        WHERE channel_product_id=?
      `).run(snapshotId, now, channelProductId);

      db.prepare(`
        UPDATE channel_product_identifiers
        SET is_active=0,updated_at=?
        WHERE channel_product_id=?
      `).run(now, channelProductId);

      for (const identifier of Array.isArray(draft.identifiers) ? draft.identifiers : []) {
        const normalizedValue = String(identifier.normalizedValue || '').trim();
        if (!normalizedValue) continue;
        db.prepare(`
          INSERT INTO channel_product_identifiers(
            identifier_id,channel_product_id,identifier_type,identifier_value,
            normalized_value,scope,variant_reference,eligible_for_exact_match,
            is_active,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,1,?,?)
          ON CONFLICT(
            channel_product_id,identifier_type,normalized_value,scope,variant_reference
          ) DO UPDATE SET
            identifier_value=excluded.identifier_value,
            eligible_for_exact_match=excluded.eligible_for_exact_match,
            is_active=1,
            updated_at=excluded.updated_at
        `).run(
          String(this.idFactory()),
          channelProductId,
          String(identifier.type),
          String(identifier.value ?? normalizedValue),
          normalizedValue,
          String(identifier.scope || 'product'),
          String(identifier.variantReference || ''),
          integerBoolean(identifier.eligibleForExactMatch),
          now,
          now
        );
      }

      const channelProduct = publicChannelProduct(
        db.prepare('SELECT * FROM channel_products WHERE channel_product_id=?').get(channelProductId)
      );
      const haarProduct = publicHaarProduct(
        db.prepare('SELECT * FROM haar_products WHERE haar_product_id=?').get(haarProductId)
      );
      return {
        created,
        updated,
        unchanged,
        snapshotCreated,
        contentHash,
        channelProduct,
        haarProduct
      };
    });
  }

  getChannelProductByKey(channelProductKey) {
    const row = this.#requireDb().prepare('SELECT * FROM channel_products WHERE channel_product_key=?').get(channelProductKey);
    return publicChannelProduct(row);
  }

  getHaarProduct(haarProductId) {
    const row = this.#requireDb().prepare('SELECT * FROM haar_products WHERE haar_product_id=?').get(haarProductId);
    return publicHaarProduct(row);
  }

  listChannelProducts({ channelId, haarProductId, missing, limit = 100, offset = 0 } = {}) {
    const clauses = [];
    const values = [];
    if (channelId) { clauses.push('channel_id=?'); values.push(channelId); }
    if (haarProductId) { clauses.push('haar_product_id=?'); values.push(haarProductId); }
    if (missing !== undefined) {
      clauses.push('missing_from_latest_full_import=?');
      values.push(integerBoolean(missing));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    return this.#requireDb().prepare(`
      SELECT * FROM channel_products ${where}
      ORDER BY channel_id,remote_product_id LIMIT ? OFFSET ?
    `).all(...values, safeLimit, safeOffset).map(publicChannelProduct);
  }

  listIdentifiers({ type, normalizedValue, channelId, active = true, limit = 500 } = {}) {
    const clauses = [];
    const values = [];
    if (type) { clauses.push('i.identifier_type=?'); values.push(type); }
    if (normalizedValue) { clauses.push('i.normalized_value=?'); values.push(normalizedValue); }
    if (channelId) { clauses.push('p.channel_id=?'); values.push(channelId); }
    if (active !== undefined) { clauses.push('i.is_active=?'); values.push(integerBoolean(active)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.max(1, Math.min(5_000, Number(limit) || 500));
    return this.#requireDb().prepare(`
      SELECT i.*,p.channel_id,p.channel_product_key,p.haar_product_id
      FROM channel_product_identifiers i
      JOIN channel_products p ON p.channel_product_id=i.channel_product_id
      ${where}
      ORDER BY i.normalized_value,p.channel_product_key
      LIMIT ?
    `).all(...values, safeLimit).map(row => ({
      identifierId: row.identifier_id,
      channelProductId: row.channel_product_id,
      channelProductKey: row.channel_product_key,
      channelId: row.channel_id,
      haarProductId: row.haar_product_id,
      type: row.identifier_type,
      value: row.identifier_value,
      normalizedValue: row.normalized_value,
      scope: row.scope,
      variantReference: row.variant_reference,
      eligibleForExactMatch: Boolean(row.eligible_for_exact_match),
      active: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listSnapshots(channelProductId) {
    return this.#requireDb().prepare(`
      SELECT * FROM channel_product_snapshots
      WHERE channel_product_id=? ORDER BY captured_at,snapshot_id
    `).all(channelProductId).map(row => ({
      snapshotId: row.snapshot_id,
      channelProductId: row.channel_product_id,
      importRunId: row.import_run_id,
      sourceModifiedAt: row.source_modified_at,
      raw: parseJson(row.raw_json),
      normalized: parseJson(row.normalized_json),
      contentHash: row.content_hash,
      capturedAt: row.captured_at
    }));
  }

  markMissingAfterSuccessfulFullImport(channelId, importRunId) {
    const run = this.getImportRun(importRunId);
    if (!run) throw new Error(`channel import run not found: ${importRunId}`);
    if (run.channelId !== channelId || run.mode !== 'full' || run.status !== 'succeeded') {
      throw new Error('missing detection requires a succeeded full import for the same channel');
    }
    return this.transaction(db => {
      db.prepare(`
        UPDATE channel_products
        SET missing_from_latest_full_import=0,updated_at=?
        WHERE channel_id=? AND last_seen_import_run_id=?
      `).run(this.clock(), channelId, importRunId);
      const result = db.prepare(`
        UPDATE channel_products
        SET missing_from_latest_full_import=1,updated_at=?
        WHERE channel_id=? AND last_seen_import_run_id<>?
      `).run(this.clock(), channelId, importRunId);
      return Number(result.changes || 0);
    });
  }
}

export const _internal = {
  publicHaarProduct,
  publicChannelProduct,
  publicImportRun,
  parseJson
};
