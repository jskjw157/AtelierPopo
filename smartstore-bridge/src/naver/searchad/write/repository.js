import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SearchAdWriteError } from './errors.js';

const JSON_COLUMNS = new Set([
  'mutation_json', 'read_json', 'before_json', 'expected_after_json', 'rollback_json',
  'applied_after_json', 'last_error_json', 'request_json', 'response_json', 'error_json'
]);

function parseJson(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hydrate(row) {
  if (!row) return null;
  const result = { ...row };
  for (const column of JSON_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(result, column)) result[column] = parseJson(result[column]);
  }
  return result;
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export class SearchAdWriteRepository {
  constructor({ databasePath, database } = {}) {
    if (!database && !databasePath) {
      throw new SearchAdWriteError('SEARCHAD_WRITE_DB_REQUIRED', 'SearchAd write database 경로가 필요합니다.', {}, 500);
    }
    if (databasePath && databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = database || new DatabaseSync(databasePath);
    this.ownsDatabase = !database;
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS searchad_write_change_plans (
        plan_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        mutation_operation_key TEXT NOT NULL,
        mutation_json TEXT NOT NULL,
        read_json TEXT NOT NULL,
        before_json TEXT NOT NULL,
        before_hash TEXT NOT NULL,
        expected_after_json TEXT NOT NULL,
        rollback_json TEXT,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        approved_at TEXT,
        applied_at TEXT,
        applied_after_json TEXT,
        applied_after_hash TEXT,
        rolled_back_at TEXT,
        last_error_json TEXT
      );
      CREATE INDEX IF NOT EXISTS searchad_write_plans_customer_created_idx
        ON searchad_write_change_plans(customer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS searchad_write_plans_status_idx
        ON searchad_write_change_plans(status, expires_at);
      CREATE TABLE IF NOT EXISTS searchad_write_approvals (
        approval_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES searchad_write_change_plans(plan_id) ON DELETE CASCADE,
        actor TEXT NOT NULL,
        confirmation TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS searchad_write_approvals_plan_idx
        ON searchad_write_approvals(plan_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS searchad_write_attempts (
        attempt_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES searchad_write_change_plans(plan_id) ON DELETE CASCADE,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        request_fingerprint TEXT,
        request_json TEXT,
        response_json TEXT,
        error_json TEXT,
        remote_request_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS searchad_write_attempts_plan_idx
        ON searchad_write_attempts(plan_id, created_at ASC);
      CREATE TABLE IF NOT EXISTS searchad_write_locks (
        plan_id TEXT NOT NULL REFERENCES searchad_write_change_plans(plan_id) ON DELETE CASCADE,
        purpose TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, purpose)
      );
      CREATE INDEX IF NOT EXISTS searchad_write_locks_acquired_idx
        ON searchad_write_locks(acquired_at);
    `);
  }

  createPlan(plan) {
    this.database.prepare(`
      INSERT INTO searchad_write_change_plans (
        plan_id, customer_id, mutation_operation_key, mutation_json, read_json,
        before_json, before_hash, expected_after_json, rollback_json, reason,
        status, created_by, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plan.plan_id, plan.customer_id, plan.mutation_operation_key, json(plan.mutation_json), json(plan.read_json),
      json(plan.before_json), plan.before_hash, json(plan.expected_after_json), json(plan.rollback_json), plan.reason,
      plan.status, plan.created_by, plan.created_at, plan.expires_at
    );
    return this.getPlan(plan.plan_id);
  }

  getPlan(planId) {
    return hydrate(this.database.prepare('SELECT * FROM searchad_write_change_plans WHERE plan_id = ?').get(planId));
  }

  listPlans({ customerId, status, limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (customerId) { clauses.push('customer_id = ?'); params.push(customerId); }
    if (status) { clauses.push('status = ?'); params.push(status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    return this.database.prepare(`SELECT * FROM searchad_write_change_plans ${where} ORDER BY created_at DESC LIMIT ?`).all(...params).map(hydrate);
  }

  updatePlan(planId, patch, { expectedStatuses } = {}) {
    const current = this.getPlan(planId);
    if (!current) throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId }, 404);
    if (expectedStatuses?.length && !expectedStatuses.includes(current.status)) {
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_STATE_CONFLICT', '현재 상태에서는 변경 계획을 갱신할 수 없습니다.', {
        planId, currentStatus: current.status, expectedStatuses
      }, 409);
    }
    const columns = [];
    const params = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!/^[a-z_]+$/.test(key)) throw new SearchAdWriteError('SEARCHAD_WRITE_INVALID_COLUMN', '허용되지 않은 저장 필드입니다.', { key }, 500);
      columns.push(`${key} = ?`);
      params.push(JSON_COLUMNS.has(key) ? json(value) : value);
    }
    if (!columns.length) return current;
    params.push(planId);
    this.database.prepare(`UPDATE searchad_write_change_plans SET ${columns.join(', ')} WHERE plan_id = ?`).run(...params);
    return this.getPlan(planId);
  }

  createApproval(approval) {
    this.database.prepare(`
      INSERT INTO searchad_write_approvals (
        approval_id, plan_id, actor, confirmation, token_hash, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      approval.approval_id, approval.plan_id, approval.actor, approval.confirmation,
      approval.token_hash, approval.created_at, approval.expires_at
    );
    return this.getApproval(approval.approval_id);
  }

  getApproval(approvalId) {
    return this.database.prepare('SELECT * FROM searchad_write_approvals WHERE approval_id = ?').get(approvalId) || null;
  }

  claimApproval({ planId, tokenHash, now }) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare(`
        SELECT * FROM searchad_write_approvals
        WHERE plan_id = ? AND token_hash = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(planId, tokenHash);
      if (!row) throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_INVALID', '실행 토큰이 올바르지 않습니다.', { planId }, 403);
      if (row.used_at) throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_USED', '이미 사용된 실행 토큰입니다.', { planId }, 409);
      if (Date.parse(row.expires_at) <= Date.parse(now)) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_EXPIRED', '실행 토큰이 만료되었습니다.', { planId, expiresAt: row.expires_at }, 409);
      }
      const result = this.database.prepare(`
        UPDATE searchad_write_approvals SET used_at = ?
        WHERE approval_id = ? AND used_at IS NULL
      `).run(now, row.approval_id);
      if (Number(result.changes) !== 1) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_RACE', '실행 토큰을 다른 요청이 먼저 사용했습니다.', { planId }, 409);
      }
      this.database.exec('COMMIT');
      return { ...row, used_at: now };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  addAttempt(attempt) {
    this.database.prepare(`
      INSERT INTO searchad_write_attempts (
        attempt_id, plan_id, phase, status, request_fingerprint, request_json,
        response_json, error_json, remote_request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      attempt.attempt_id, attempt.plan_id, attempt.phase, attempt.status,
      attempt.request_fingerprint || null, json(attempt.request_json), json(attempt.response_json),
      json(attempt.error_json), attempt.remote_request_id || null, attempt.created_at
    );
    return this.database.prepare('SELECT * FROM searchad_write_attempts WHERE attempt_id = ?').get(attempt.attempt_id);
  }

  listAttempts(planId) {
    return this.database.prepare('SELECT * FROM searchad_write_attempts WHERE plan_id = ? ORDER BY created_at ASC').all(planId).map(hydrate);
  }

  tryAcquireLock({ planId, purpose, acquiredAt, staleBefore }) {
    this.database.prepare('DELETE FROM searchad_write_locks WHERE acquired_at < ?').run(staleBefore);
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO searchad_write_locks (plan_id, purpose, acquired_at)
      VALUES (?, ?, ?)
    `).run(planId, purpose, acquiredAt);
    return Number(result.changes) === 1;
  }

  releaseLock({ planId, purpose }) {
    this.database.prepare('DELETE FROM searchad_write_locks WHERE plan_id = ? AND purpose = ?').run(planId, purpose);
  }

  close() {
    if (this.ownsDatabase) this.database.close();
  }
}
