import { withCircuitWriteContext } from '../circuit/service.js';
import { randomUUID } from 'node:crypto';
import { SearchAdExecutionService } from './execution-service.js';
import { SafeSearchAdExecutionService } from './safe-execution-service.js';
import { SearchAdWriteError } from './errors.js';
import { redactSearchAdWriteValue } from './redaction.js';

function safeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || 'SEARCHAD_REMOTE_ERROR',
    message: error?.message || 'SearchAd 원격 요청에 실패했습니다.',
    status: Number(error?.status || error?.statusCode || 0) || undefined,
    details: redactSearchAdWriteValue(error?.details || {})
  };
}

export class ProductionSearchAdExecutionService extends SafeSearchAdExecutionService {
  constructor(options) { super(options); this.circuitGuard = options.circuitGuard || null; }
  async beforeRollbackDispatch(plan) {
    if (!this.circuitGuard) return; // Component-only service composition has no production Circuit authority.
    this.rollbackClaims ||= new Set();
    if (this.rollbackClaims.has(plan.plan_id)) throw new SearchAdWriteError('SEARCHAD_ROLLBACK_INTENT_USED', 'Rollback dispatch was already claimed.', {}, 409);
    this.rollbackClaims.add(plan.plan_id);
    try {
      await this.repository.claimRollbackDispatch({ planId: plan.plan_id, attemptId: randomUUID(), now: new Date(this.clock()).toISOString() });
    } catch (error) {
      if (error?.code === 'SEARCHAD_ROLLBACK_INTENT_USED') throw error;
      try { await this.repository.updatePlan(plan.plan_id, { status: 'rollback_unknown_outcome' }, { expectedStatuses: ['applied','applied_reconciled'] }); } catch { /* Durable intent, if committed, still holds. No transport was entered. */ }
      throw new SearchAdWriteError('SEARCHAD_ROLLBACK_INTENT_UNCERTAIN', 'Rollback intent acknowledgement is unavailable; no dispatch is authorized.', {}, 503);
    }
  }
  async circuitOperation(planId, purpose, task) {
    const plan = await this.get(planId);
    try { return await withCircuitWriteContext({ customerId: plan.customer_id, planId, purpose, before: plan.before_json, mutation: purpose === 'rollback' ? plan.rollback_json : plan.mutation_json }, task); }
    finally { try { await this.circuitGuard?.projectOutcome(plan.customer_id); } catch { /* Primary outcome/error remains authoritative. */ } }
  }
  async execute(planId, input = {}, context = {}) {
    return this.circuitOperation(planId, 'ordinary', () => super.execute(planId, input, context));
  }
  async reconcile(planId, input = {}, context = {}) {
    return this.circuitOperation(planId, 'read', () => super.reconcile(planId, input, context));
  }
  async rollback(planId, input = {}, context = {}) {
    return this.circuitOperation(planId, 'rollback', () => this.withLock(planId, 'rollback', async () => {
      try {
        return await SearchAdExecutionService.prototype.rollback.call(this, planId, input, context);
      } catch (error) {
        const plan = await this.repository.getPlan(planId);
        const attempts = await this.repository.listAttempts(planId);
        const remoteAccepted = attempts.some(attempt =>
          attempt.phase === 'rollback' && attempt.status === 'remote_accepted'
        );
        if (remoteAccepted && ['applied', 'applied_reconciled'].includes(plan?.status)) {
          const now = new Date(this.clock()).toISOString();
          const storedError = safeError(error);
          await this.repository.updatePlan(planId, {
            status: 'rollback_unknown_outcome',
            last_error_json: storedError
          }, { expectedStatuses: [plan.status] });
          await this.repository.addAttempt({
            attempt_id: randomUUID(),
            plan_id: planId,
            phase: 'rollback_verify',
            status: 'failed',
            error_json: storedError,
            created_at: now
          });
          throw new SearchAdWriteError(
            'SEARCHAD_ROLLBACK_UNKNOWN_OUTCOME',
            '롤백 요청은 수신됐지만 변경 후 재검증에 실패했습니다. 같은 롤백을 반복하지 말고 운영자 검토와 원격 재조정을 수행하세요.',
            { planId, original: storedError },
            409
          );
        }
        throw error;
      }
    }));
  }
}
