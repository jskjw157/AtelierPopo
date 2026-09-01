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
  async rollback(planId, input = {}, context = {}) {
    return this.withLock(planId, 'rollback', async () => {
      try {
        return await SearchAdExecutionService.prototype.rollback.call(this, planId, input, context);
      } catch (error) {
        const plan = this.repository.getPlan(planId);
        const attempts = this.repository.listAttempts(planId);
        const remoteAccepted = attempts.some(attempt =>
          attempt.phase === 'rollback' && attempt.status === 'remote_accepted'
        );
        if (remoteAccepted && ['applied', 'applied_reconciled'].includes(plan?.status)) {
          const now = new Date(this.clock()).toISOString();
          const storedError = safeError(error);
          this.repository.updatePlan(planId, {
            status: 'rollback_unknown_outcome',
            last_error_json: storedError
          }, { expectedStatuses: [plan.status] });
          this.repository.addAttempt({
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
    });
  }
}
