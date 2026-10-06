import { SearchAdExecutionService } from './execution-service.js';
import { SearchAdWriteError } from './errors.js';

export class SafeSearchAdExecutionService extends SearchAdExecutionService {
  constructor(options) {
    super(options);
    this.lockTtlMs = Math.max(60_000, Number(options?.lockTtlMs || 15 * 60_000));
  }

  async withLock(planId, purpose, task) {
    const nowMs = this.clock();
    const acquired = await this.repository.tryAcquireLock({
      planId,
      purpose,
      acquiredAt: new Date(nowMs).toISOString(),
      staleBefore: new Date(nowMs - this.lockTtlMs).toISOString()
    });
    if (!acquired) {
      throw new SearchAdWriteError('SEARCHAD_WRITE_ALREADY_IN_PROGRESS', '같은 변경 계획의 작업이 이미 진행 중입니다.', {
        planId,
        purpose
      }, 409);
    }
    try {
      return await task();
    } finally {
      await this.repository.releaseLock({ planId, purpose });
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
