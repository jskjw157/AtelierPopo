import { SearchAdExecutionService } from './execution-service.js';
import { SearchAdWriteError } from './errors.js';

function isUniqueConstraint(error) {
  return String(error?.code || '').includes('SQLITE_CONSTRAINT') || /UNIQUE constraint failed/i.test(String(error?.message || ''));
}

export class SafeSearchAdExecutionService extends SearchAdExecutionService {
  constructor(options) {
    super(options);
    this.lockTtlMs = Math.max(60_000, Number(options?.lockTtlMs || 15 * 60_000));
    this.repository.database.exec(`
      CREATE TABLE IF NOT EXISTS searchad_write_locks (
        plan_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        PRIMARY KEY (plan_id, purpose)
      );
      CREATE INDEX IF NOT EXISTS searchad_write_locks_acquired_idx
        ON searchad_write_locks(acquired_at);
    `);
  }

  async withLock(planId, purpose, task) {
    const nowMs = this.clock();
    const staleBefore = new Date(nowMs - this.lockTtlMs).toISOString();
    this.repository.database.prepare('DELETE FROM searchad_write_locks WHERE acquired_at < ?').run(staleBefore);
    try {
      this.repository.database.prepare(`
        INSERT INTO searchad_write_locks (plan_id, purpose, acquired_at)
        VALUES (?, ?, ?)
      `).run(planId, purpose, new Date(nowMs).toISOString());
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new SearchAdWriteError('SEARCHAD_WRITE_ALREADY_IN_PROGRESS', '같은 변경 계획의 작업이 이미 진행 중입니다.', {
          planId,
          purpose
        }, 409);
      }
      throw error;
    }
    try {
      return await task();
    } finally {
      this.repository.database.prepare('DELETE FROM searchad_write_locks WHERE plan_id = ? AND purpose = ?').run(planId, purpose);
    }
  }

  async execute(planId, input = {}, context = {}) {
    return this.withLock(planId, 'execute', () => super.execute(planId, input, context));
  }

  async reconcile(planId, input = {}, context = {}) {
    return this.withLock(planId, 'reconcile', () => super.reconcile(planId, input, context));
  }

  async rollback(planId, input = {}, context = {}) {
    return this.withLock(planId, 'rollback', () => super.rollback(planId, input, context));
  }
}
