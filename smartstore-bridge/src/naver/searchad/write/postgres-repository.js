import { SearchAdWriteError } from './errors.js';

const JSON_COLUMNS = new Set([
  'mutation_json', 'read_json', 'before_json', 'expected_after_json', 'rollback_json',
  'applied_after_json', 'last_error_json', 'request_json', 'response_json', 'error_json'
]);

const TIME_COLUMNS = new Set([
  'created_at', 'expires_at', 'approved_at', 'applied_at', 'rolled_back_at', 'used_at', 'acquired_at'
]);

const PLAN_PATCH_COLUMNS = new Set([
  'status', 'approved_at', 'applied_at', 'applied_after_json', 'applied_after_hash',
  'rolled_back_at', 'last_error_json'
]);

function hydrate(row) {
  if (!row) return null;
  const result = { ...row };
  for (const column of JSON_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(result, column) && typeof result[column] === 'string') {
      try { result[column] = JSON.parse(result[column]); } catch { result[column] = null; }
    }
  }
  for (const column of TIME_COLUMNS) {
    if (result[column] instanceof Date) result[column] = result[column].toISOString();
  }
  return result;
}

function boundedLimit(value) {
  return Math.max(1, Math.min(500, Number(value) || 100));
}

async function rollbackQuietly(client) {
  try { await client.query('ROLLBACK'); } catch {}
}

export class PostgresSearchAdWriteRepository {
  constructor({ pool } = {}) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new SearchAdWriteError('SEARCHAD_WRITE_POSTGRES_POOL_REQUIRED', 'SearchAd write PostgreSQL pool이 필요합니다.', {}, 500);
    }
    this.pool = pool;
  }

  async createPlan(plan) {
    const result = await this.pool.query(`
      INSERT INTO searchad_write_change_plans (
        plan_id, customer_id, mutation_operation_key, mutation_json, read_json,
        before_json, before_hash, expected_after_json, rollback_json, reason,
        status, created_by, created_at, expires_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5::jsonb,
        $6::jsonb, $7, $8::jsonb, $9::jsonb, $10,
        $11, $12, $13::timestamptz, $14::timestamptz
      )
      RETURNING *
    `, [
      plan.plan_id,
      plan.customer_id,
      plan.mutation_operation_key,
      plan.mutation_json,
      plan.read_json,
      plan.before_json,
      plan.before_hash,
      plan.expected_after_json,
      plan.rollback_json ?? null,
      plan.reason,
      plan.status,
      plan.created_by,
      plan.created_at,
      plan.expires_at
    ]);
    return hydrate(result.rows[0]);
  }

  async getPlan(planId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_write_change_plans WHERE plan_id = $1',
      [planId]
    );
    return hydrate(result.rows[0]);
  }

  async listPlans({ customerId, status, limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (customerId) {
      params.push(customerId);
      clauses.push(`customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    params.push(boundedLimit(limit));
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT * FROM searchad_write_change_plans ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return result.rows.map(hydrate);
  }

  async updatePlan(planId, patch, { expectedStatuses } = {}) {
    const entries = Object.entries(patch || {});
    for (const [key] of entries) {
      if (!PLAN_PATCH_COLUMNS.has(key)) {
        throw new SearchAdWriteError('SEARCHAD_WRITE_INVALID_COLUMN', '허용되지 않은 저장 필드입니다.', { key }, 500);
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query(
        'SELECT * FROM searchad_write_change_plans WHERE plan_id = $1 FOR UPDATE',
        [planId]
      );
      const current = hydrate(currentResult.rows[0]);
      if (!current) {
        throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId }, 404);
      }
      if (expectedStatuses?.length && !expectedStatuses.includes(current.status)) {
        throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_STATE_CONFLICT', '현재 상태에서는 변경 계획을 갱신할 수 없습니다.', {
          planId,
          currentStatus: current.status,
          expectedStatuses
        }, 409);
      }
      if (!entries.length) {
        await client.query('COMMIT');
        return current;
      }

      const params = [];
      const assignments = entries.map(([key, value]) => {
        params.push(value ?? null);
        const cast = JSON_COLUMNS.has(key) ? '::jsonb' : TIME_COLUMNS.has(key) ? '::timestamptz' : '';
        return `${key} = $${params.length}${cast}`;
      });
      params.push(planId);
      const updated = await client.query(
        `UPDATE searchad_write_change_plans SET ${assignments.join(', ')} WHERE plan_id = $${params.length} RETURNING *`,
        params
      );
      await client.query('COMMIT');
      return hydrate(updated.rows[0]);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async createApproval(approval) {
    const result = await this.pool.query(`
      INSERT INTO searchad_write_approvals (
        approval_id, plan_id, actor, confirmation, token_hash, created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
      RETURNING *
    `, [
      approval.approval_id,
      approval.plan_id,
      approval.actor,
      approval.confirmation,
      approval.token_hash,
      approval.created_at,
      approval.expires_at
    ]);
    return hydrate(result.rows[0]);
  }

  async getApproval(approvalId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_write_approvals WHERE approval_id = $1',
      [approvalId]
    );
    return hydrate(result.rows[0]);
  }

  async claimApproval({ planId, tokenHash, now }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        SELECT * FROM searchad_write_approvals
        WHERE plan_id = $1 AND token_hash = $2
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [planId, tokenHash]);
      const row = hydrate(result.rows[0]);
      if (!row) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_INVALID', '실행 토큰이 올바르지 않습니다.', { planId }, 403);
      }
      if (row.used_at) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_USED', '이미 사용된 실행 토큰입니다.', { planId }, 409);
      }
      if (Date.parse(row.expires_at) <= Date.parse(now)) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_EXPIRED', '실행 토큰이 만료되었습니다.', { planId, expiresAt: row.expires_at }, 409);
      }
      const claimed = await client.query(`
        UPDATE searchad_write_approvals
        SET used_at = $1::timestamptz
        WHERE approval_id = $2 AND used_at IS NULL
        RETURNING *
      `, [now, row.approval_id]);
      if (claimed.rowCount !== 1) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_RACE', '실행 토큰을 다른 요청이 먼저 사용했습니다.', { planId }, 409);
      }
      await client.query('COMMIT');
      return hydrate(claimed.rows[0]);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async addAttempt(attempt) {
    const result = await this.pool.query(`
      INSERT INTO searchad_write_attempts (
        attempt_id, plan_id, phase, status, request_fingerprint, request_json,
        response_json, error_json, remote_request_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb,
        $7::jsonb, $8::jsonb, $9, $10::timestamptz
      )
      RETURNING *
    `, [
      attempt.attempt_id,
      attempt.plan_id,
      attempt.phase,
      attempt.status,
      attempt.request_fingerprint || null,
      attempt.request_json ?? null,
      attempt.response_json ?? null,
      attempt.error_json ?? null,
      attempt.remote_request_id || null,
      attempt.created_at
    ]);
    return hydrate(result.rows[0]);
  }

  async listAttempts(planId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_write_attempts WHERE plan_id = $1 ORDER BY created_at ASC',
      [planId]
    );
    return result.rows.map(hydrate);
  }

  async close() {}
}
