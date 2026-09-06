import { randomUUID } from 'node:crypto';
import { contentHash, getPath, materializeBodyFromBefore, requestFingerprint } from './canonical.js';
import { SearchAdWriteError } from './errors.js';

function iso(value = Date.now()) { return new Date(value).toISOString(); }

function assertDescriptor(descriptor, name) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new SearchAdWriteError('SEARCHAD_OPERATION_DESCRIPTOR_REQUIRED', `${name} operation descriptor가 필요합니다.`, { name });
  }
  if (!String(descriptor.operationKey || '').trim()) {
    throw new SearchAdWriteError('SEARCHAD_OPERATION_KEY_REQUIRED', `${name} operationKey가 필요합니다.`, { name });
  }
  for (const forbidden of ['url', 'rawUrl', 'method', 'path', 'uri']) {
    if (descriptor[forbidden] != null) {
      throw new SearchAdWriteError('SEARCHAD_RAW_REQUEST_FORBIDDEN', '공식 operationKey 외의 raw URL·method·path는 사용할 수 없습니다.', { name, forbidden });
    }
  }
  return {
    operationKey: String(descriptor.operationKey).trim(),
    pathParams: descriptor.pathParams || {},
    query: descriptor.query || {},
    body: descriptor.body ?? null,
    confirmation: descriptor.confirmation,
    secondConfirmation: descriptor.secondConfirmation
  };
}

function extractReadValue(remoteValue, extractPath) {
  const extracted = getPath(remoteValue, extractPath);
  if (extractPath && extracted === undefined) {
    throw new SearchAdWriteError('SEARCHAD_VERIFICATION_PATH_NOT_FOUND', '원격 응답에서 검증 대상을 찾을 수 없습니다.', { extractPath }, 422);
  }
  return extracted;
}

export class SearchAdChangePlanService {
  constructor({ repository, remote, config, clock = () => Date.now() }) {
    this.repository = repository;
    this.remote = remote;
    this.config = config;
    this.clock = clock;
  }

  async create(input, context = {}) {
    if (!this.config.enabled || !this.config.allowPlans) {
      throw new SearchAdWriteError('SEARCHAD_CHANGE_PLANS_DISABLED', 'SearchAd 변경 계획 생성 기능이 비활성화되어 있습니다.', {}, 503);
    }
    const customerId = String(input?.customerId || '').trim();
    const reason = String(input?.reason || '').trim();
    const createdBy = String(input?.createdBy || context.actor || '').trim();
    if (!customerId) throw new SearchAdWriteError('SEARCHAD_CUSTOMER_ID_REQUIRED', '광고계정 Customer ID가 필요합니다.');
    if (!reason) throw new SearchAdWriteError('SEARCHAD_CHANGE_REASON_REQUIRED', '변경 사유가 필요합니다.');
    if (!createdBy) throw new SearchAdWriteError('SEARCHAD_CHANGE_ACTOR_REQUIRED', '변경 계획 작성자가 필요합니다.');

    const mutation = assertDescriptor(input.mutation, 'mutation');
    const read = assertDescriptor(input.verification?.read, 'verification.read');
    const extractPath = String(input.verification?.extractPath || '').trim();
    const beforeResult = await this.remote.read({ ...read, customerId }, { customerId, requestId: context.requestId });
    const before = structuredClone(extractReadValue(beforeResult.value, extractPath));
    if (before == null || typeof before !== 'object') {
      throw new SearchAdWriteError('SEARCHAD_BEFORE_SNAPSHOT_INVALID', '변경 전 원격 스냅샷이 객체가 아닙니다.', { extractPath }, 422);
    }

    const expectedAfter = input.verification?.expectedAfter != null
      ? structuredClone(input.verification.expectedAfter)
      : structuredClone(input.verification?.expectedPatch ?? mutation.body ?? {});
    if (!expectedAfter || typeof expectedAfter !== 'object' || Array.isArray(expectedAfter) || !Object.keys(expectedAfter).length) {
      throw new SearchAdWriteError('SEARCHAD_EXPECTED_AFTER_REQUIRED', '변경 후 원격 재검증에 사용할 expectedAfter 또는 expectedPatch가 필요합니다.', {}, 422);
    }

    let rollback = null;
    if (input.rollback?.mutation) {
      const rollbackMutation = assertDescriptor(input.rollback.mutation, 'rollback.mutation');
      rollbackMutation.body = materializeBodyFromBefore(before, rollbackMutation.body || {}, input.rollback.bodyFromBefore || {});
      rollback = {
        mutation: rollbackMutation,
        expectedBefore: structuredClone(input.rollback.expectedBefore ?? rollbackMutation.body)
      };
    }

    const nowMs = this.clock();
    const requestedTtl = Number(input.expiresInSeconds || this.config.planTtlSeconds);
    const ttlSeconds = Math.max(60, Math.min(86400, Number.isFinite(requestedTtl) ? requestedTtl : this.config.planTtlSeconds));
    const plan = {
      plan_id: randomUUID(),
      customer_id: customerId,
      mutation_operation_key: mutation.operationKey,
      mutation_json: mutation,
      read_json: { ...read, extractPath },
      before_json: before,
      before_hash: contentHash(before),
      expected_after_json: expectedAfter,
      rollback_json: rollback,
      reason,
      status: 'planned',
      created_by: createdBy,
      created_at: iso(nowMs),
      expires_at: iso(nowMs + ttlSeconds * 1000)
    };
    const stored = this.repository.createPlan(plan);
    this.repository.addAttempt({
      attempt_id: randomUUID(),
      plan_id: plan.plan_id,
      phase: 'plan',
      status: 'succeeded',
      request_fingerprint: requestFingerprint({ customerId, mutation, read, expectedAfter, rollback, reason }),
      request_json: { mutation, read, expectedAfter, rollback, reason },
      response_json: { beforeHash: plan.before_hash },
      created_at: iso(nowMs)
    });
    return stored;
  }

  get(planId) {
    const plan = this.repository.getPlan(planId);
    if (!plan) throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId }, 404);
    return { ...plan, attempts: this.repository.listAttempts(planId) };
  }

  list(filters = {}) {
    return this.repository.listPlans(filters);
  }
}
