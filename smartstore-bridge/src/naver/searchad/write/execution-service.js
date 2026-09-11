import { randomUUID } from 'node:crypto';
import { contentHash, getPath, isSubset, requestFingerprint } from './canonical.js';
import { isAmbiguousSearchAdWriteError, SearchAdWriteError } from './errors.js';

function iso(clock) { return new Date(clock()).toISOString(); }

function extract(value, path) {
  const result = getPath(value, path);
  if (path && result === undefined) {
    throw new SearchAdWriteError('SEARCHAD_VERIFICATION_PATH_NOT_FOUND', '원격 응답에서 검증 대상을 찾을 수 없습니다.', { extractPath: path }, 422);
  }
  return result;
}

function remoteRequestId(result) {
  return result?.upstream?.requestId || result?.requestId || result?.request_id || result?.headers?.['x-request-id'] || result?.headers?.['x-transaction-id'] || null;
}

function publicError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || 'SEARCHAD_REMOTE_ERROR',
    message: error?.message || 'SearchAd 원격 요청에 실패했습니다.',
    status: Number(error?.status || error?.statusCode || 0) || undefined,
    details: error?.details || undefined
  };
}

export class SearchAdExecutionService {
  constructor({ repository, remote, approvalService, activationGuard = null, ownershipGuard = null, config, clock = () => Date.now() }) {
    this.repository = repository;
    this.remote = remote;
    this.approvalService = approvalService;
    this.activationGuard = activationGuard;
    this.ownershipGuard = ownershipGuard;
    this.config = config;
    this.clock = clock;
  }

  async readCurrent(plan, context = {}) {
    const read = { ...plan.read_json };
    const extractPath = read.extractPath || '';
    delete read.extractPath;
    const result = await this.remote.read({ ...read, customerId: plan.customer_id }, {
      customerId: plan.customer_id,
      requestId: context.requestId
    });
    return { result, value: structuredClone(extract(result.value, extractPath)) };
  }

  get(planId) {
    const plan = this.repository.getPlan(planId);
    if (!plan) throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId }, 404);
    return plan;
  }

  async assertOwnershipAvailable(plan, descriptor = plan.mutation_json) {
    if (!this.ownershipGuard?.assertMutationNotCanaryOwned) return { allowed: true, skipped: true };
    return this.ownershipGuard.assertMutationNotCanaryOwned({
      customerId: plan.customer_id,
      descriptor: structuredClone(descriptor),
      planId: plan.plan_id
    });
  }

  async execute(planId, input = {}, context = {}) {
    if (!this.config.enabled || !this.config.allowWrites) {
      throw new SearchAdWriteError('SEARCHAD_WRITES_PREVALIDATION_GATED', 'SearchAd 쓰기는 Capability·Canary 검증 전 임시 게이트 상태입니다.', {
        activationMode: this.config.initialActivationMode,
        requiredEnv: 'ATELIER_SEARCHAD_ALLOW_WRITES=true'
      }, 403);
    }
    const plan = this.get(planId);
    if (plan.customer_id !== String(input.customerId || plan.customer_id)) {
      throw new SearchAdWriteError('SEARCHAD_CUSTOMER_SCOPE_MISMATCH', '변경 계획의 광고계정 범위가 요청과 일치하지 않습니다.', { planId }, 403);
    }
    if (plan.status !== 'approved') {
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_EXECUTABLE', '승인된 변경 계획만 실행할 수 있습니다.', { planId, status: plan.status }, 409);
    }
    const nowMs = this.clock();
    if (Date.parse(plan.expires_at) <= nowMs) {
      this.repository.updatePlan(planId, { status: 'expired' }, { expectedStatuses: ['approved'] });
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_EXPIRED', '변경 계획이 만료되었습니다.', { planId }, 409);
    }

    const beforeCheck = await this.readCurrent(plan, context);
    const actualBeforeHash = contentHash(beforeCheck.value);
    if (actualBeforeHash !== plan.before_hash) {
      const error = new SearchAdWriteError('SEARCHAD_STALE_PLAN', '계획 작성 후 원격 값이 변경되어 실행을 중단했습니다.', {
        planId, expectedBeforeHash: plan.before_hash, actualBeforeHash
      }, 409);
      this.repository.addAttempt({
        attempt_id: randomUUID(), plan_id: planId, phase: 'preflight', status: 'stale',
        request_fingerprint: requestFingerprint(plan.mutation_json),
        response_json: { actualBeforeHash }, error_json: publicError(error), created_at: iso(this.clock)
      });
      this.repository.updatePlan(planId, { status: 'stale', last_error_json: publicError(error) }, { expectedStatuses: ['approved'] });
      throw error;
    }

    if (!this.activationGuard?.assertMutationAllowed) {
      throw new SearchAdWriteError(
        'SEARCHAD_ACTIVATION_GUARD_NOT_READY',
        'SearchAd activation guard가 준비되지 않아 새 쓰기를 실행할 수 없습니다.',
        { planId },
        503
      );
    }
    await this.activationGuard.assertMutationAllowed({
      customerId: plan.customer_id,
      descriptor: structuredClone(plan.mutation_json),
      planId
    });
    await this.assertOwnershipAvailable(plan);

    this.approvalService.claim(planId, input.executionToken);

    const attemptId = randomUUID();
    const mutation = { ...plan.mutation_json, customerId: plan.customer_id };
    try {
      const response = await this.remote.mutate(mutation, {
        customerId: plan.customer_id,
        requestId: context.requestId,
        idempotencyKey: input.idempotencyKey
      });
      this.repository.addAttempt({
        attempt_id: attemptId, plan_id: planId, phase: 'execute', status: 'remote_accepted',
        request_fingerprint: requestFingerprint(mutation), request_json: mutation,
        response_json: response, remote_request_id: remoteRequestId(response), created_at: iso(this.clock)
      });
    } catch (error) {
      const ambiguous = isAmbiguousSearchAdWriteError(error);
      const status = ambiguous ? 'unknown_outcome' : 'failed';
      const safe = publicError(error);
      this.repository.addAttempt({
        attempt_id: attemptId, plan_id: planId, phase: 'execute', status,
        request_fingerprint: requestFingerprint(mutation), request_json: mutation,
        error_json: safe, created_at: iso(this.clock)
      });
      this.repository.updatePlan(planId, { status, last_error_json: safe }, { expectedStatuses: ['approved'] });
      if (ambiguous) {
        throw new SearchAdWriteError('SEARCHAD_UNKNOWN_OUTCOME', '원격 결과가 불명확합니다. 동일 쓰기를 재시도하지 말고 reconcile을 실행하세요.', { planId, original: safe }, 409);
      }
      throw error;
    }

    let afterCheck;
    try {
      afterCheck = await this.readCurrent(plan, context);
    } catch (error) {
      const safe = publicError(error);
      this.repository.addAttempt({
        attempt_id: randomUUID(), plan_id: planId, phase: 'verify', status: 'failed',
        error_json: safe, created_at: iso(this.clock)
      });
      this.repository.updatePlan(planId, {
        status: 'verification_failed', last_error_json: safe
      }, { expectedStatuses: ['approved'] });
      throw new SearchAdWriteError('SEARCHAD_REMOTE_VERIFICATION_UNAVAILABLE', '원격 쓰기 응답은 수신했지만 변경 후 재조회에 실패했습니다. reconcile을 실행하세요.', { planId, original: safe }, 409);
    }
    const appliedAfter = afterCheck.value;
    const appliedAfterHash = contentHash(appliedAfter);
    if (!isSubset(appliedAfter, plan.expected_after_json)) {
      const error = new SearchAdWriteError('SEARCHAD_REMOTE_VERIFICATION_FAILED', '원격 변경 후 값이 계획과 일치하지 않습니다.', {
        planId, appliedAfterHash, expectedAfter: plan.expected_after_json
      }, 409);
      this.repository.addAttempt({
        attempt_id: randomUUID(), plan_id: planId, phase: 'verify', status: 'failed',
        response_json: { appliedAfter, appliedAfterHash }, error_json: publicError(error), created_at: iso(this.clock)
      });
      this.repository.updatePlan(planId, {
        status: 'verification_failed', applied_after_json: appliedAfter,
        applied_after_hash: appliedAfterHash, last_error_json: publicError(error)
      }, { expectedStatuses: ['approved'] });
      throw error;
    }

    const appliedAt = iso(this.clock);
    const updated = this.repository.updatePlan(planId, {
      status: 'applied', applied_at: appliedAt,
      applied_after_json: appliedAfter, applied_after_hash: appliedAfterHash,
      last_error_json: null
    }, { expectedStatuses: ['approved'] });
    this.repository.addAttempt({
      attempt_id: randomUUID(), plan_id: planId, phase: 'verify', status: 'succeeded',
      response_json: { appliedAfterHash }, created_at: appliedAt
    });
    return updated;
  }

  async reconcile(planId, _input = {}, context = {}) {
    if (!this.config.enabled || !this.config.allowReconcile) {
      throw new SearchAdWriteError('SEARCHAD_RECONCILE_DISABLED', 'SearchAd reconcile 기능이 비활성화되어 있습니다.', {}, 403);
    }
    const plan = this.get(planId);
    if (!['unknown_outcome', 'verification_failed'].includes(plan.status)) {
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_RECONCILABLE', '현재 상태에서는 reconcile할 수 없습니다.', { planId, status: plan.status }, 409);
    }
    const current = await this.readCurrent(plan, context);
    const currentHash = contentHash(current.value);
    let status = 'manual_review';
    if (isSubset(current.value, plan.expected_after_json)) status = 'applied_reconciled';
    else if (currentHash === plan.before_hash) status = 'not_applied';
    const now = iso(this.clock);
    const patch = status === 'applied_reconciled'
      ? { status, applied_at: plan.applied_at || now, applied_after_json: current.value, applied_after_hash: currentHash, last_error_json: null }
      : { status, last_error_json: status === 'manual_review' ? { code: 'SEARCHAD_RECONCILE_MANUAL_REVIEW', message: '현재 원격값이 변경 전·예상 변경 후 어느 쪽과도 일치하지 않습니다.' } : null };
    const updated = this.repository.updatePlan(planId, patch, { expectedStatuses: [plan.status] });
    this.repository.addAttempt({
      attempt_id: randomUUID(), plan_id: planId, phase: 'reconcile', status,
      response_json: { currentHash }, created_at: now
    });
    return updated;
  }

  async rollback(planId, input = {}, context = {}) {
    if (!this.config.enabled || !this.config.allowRollback) {
      throw new SearchAdWriteError('SEARCHAD_ROLLBACK_PREVALIDATION_GATED', 'SearchAd 롤백은 Capability·Canary 검증 전 임시 게이트 상태입니다.', { requiredEnv: 'ATELIER_SEARCHAD_ALLOW_ROLLBACK=true' }, 403);
    }
    const plan = this.get(planId);
    if (!['applied', 'applied_reconciled'].includes(plan.status)) {
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_ROLLBACKABLE', '적용 완료된 변경 계획만 롤백할 수 있습니다.', { planId, status: plan.status }, 409);
    }
    if (!plan.rollback_json?.mutation) {
      throw new SearchAdWriteError('SEARCHAD_ROLLBACK_NOT_PLANNED', '이 변경 계획에는 롤백 작업이 정의되지 않았습니다.', { planId }, 409);
    }
    if (String(input.confirmation || '') !== 'ROLLBACK_SEARCHAD_CHANGE') {
      throw new SearchAdWriteError('SEARCHAD_ROLLBACK_CONFIRMATION_REQUIRED', 'confirmation은 ROLLBACK_SEARCHAD_CHANGE이어야 합니다.');
    }
    const current = await this.readCurrent(plan, context);
    const currentHash = contentHash(current.value);
    if (currentHash !== plan.applied_after_hash) {
      throw new SearchAdWriteError('SEARCHAD_ROLLBACK_DRIFT', '적용 후 다른 변경이 감지되어 자동 롤백을 중단했습니다.', {
        planId, expectedAppliedHash: plan.applied_after_hash, currentHash
      }, 409);
    }
    await this.assertOwnershipAvailable(plan, plan.rollback_json.mutation);
    const mutation = { ...plan.rollback_json.mutation, customerId: plan.customer_id };
    try {
      const response = await this.remote.mutate(mutation, {
        customerId: plan.customer_id,
        requestId: context.requestId,
        idempotencyKey: input.idempotencyKey
      });
      this.repository.addAttempt({
        attempt_id: randomUUID(), plan_id: planId, phase: 'rollback', status: 'remote_accepted',
        request_fingerprint: requestFingerprint(mutation), request_json: mutation,
        response_json: response, remote_request_id: remoteRequestId(response), created_at: iso(this.clock)
      });
    } catch (error) {
      const status = isAmbiguousSearchAdWriteError(error) ? 'rollback_unknown_outcome' : 'rollback_failed';
      const safe = publicError(error);
      this.repository.updatePlan(planId, { status, last_error_json: safe }, { expectedStatuses: [plan.status] });
      this.repository.addAttempt({
        attempt_id: randomUUID(), plan_id: planId, phase: 'rollback', status,
        request_fingerprint: requestFingerprint(mutation), request_json: mutation,
        error_json: safe, created_at: iso(this.clock)
      });
      throw error;
    }
    const after = await this.readCurrent(plan, context);
    if (!isSubset(after.value, plan.rollback_json.expectedBefore)) {
      const error = new SearchAdWriteError('SEARCHAD_ROLLBACK_VERIFICATION_FAILED', '롤백 후 원격값이 변경 전 상태와 일치하지 않습니다.', { planId }, 409);
      this.repository.updatePlan(planId, { status: 'rollback_verification_failed', last_error_json: publicError(error) }, { expectedStatuses: [plan.status] });
      throw error;
    }
    const rolledBackAt = iso(this.clock);
    const updated = this.repository.updatePlan(planId, {
      status: 'rolled_back', rolled_back_at: rolledBackAt, last_error_json: null
    }, { expectedStatuses: [plan.status] });
    this.repository.addAttempt({
      attempt_id: randomUUID(), plan_id: planId, phase: 'rollback_verify', status: 'succeeded',
      response_json: { currentHash: contentHash(after.value) }, created_at: rolledBackAt
    });
    return updated;
  }
}
