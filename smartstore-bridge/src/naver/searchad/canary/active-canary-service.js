import { randomUUID } from 'node:crypto';
import { SearchAdWriteError, isAmbiguousSearchAdWriteError } from '../write/errors.js';

const TERMINAL_STATUSES = new Set(['passed', 'failed', 'blocked', 'spend_detected', 'expired']);
const START_KEYS = new Set(['customerId', 'passiveEvidenceId']);

function fail(code, message, details = {}, status = 400) {
  throw new SearchAdWriteError(code, message, details, status);
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function safeError(error) {
  return {
    name: String(error?.name || 'Error'),
    code: String(error?.code || 'SEARCHAD_CANARY_REMOTE_ERROR'),
    message: String(error?.message || 'SearchAd Canary remote request failed.'),
    status: Number(error?.status || error?.statusCode || 0) || undefined
  };
}

function includesAll(actual = [], required = []) {
  const values = new Set((actual || []).map(String));
  return (required || []).every(value => values.has(String(value)));
}

function hasVerifiedSpendBaseline(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function normalizePrincipal(principal = {}) {
  return {
    principalId: String(principal?.principalId || '').trim(),
    role: String(principal?.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal?.customerIds)
      ? principal.customerIds.map(value => String(value))
      : []
  };
}

export class ActiveCanaryService {
  constructor({
    repository,
    remote,
    recipe,
    config = {},
    credentialFingerprintResolver = null,
    clock = Date.now
  } = {}) {
    if (!repository) throw new TypeError('repository is required');
    if (!remote) throw new TypeError('remote is required');
    if (!recipe) throw new TypeError('recipe is required');
    this.repository = repository;
    this.remote = remote;
    this.recipe = recipe;
    this.config = {
      allowActiveCanary: false,
      activationMode: 'prevalidation',
      observationPeriodMs: 48 * 60 * 60 * 1000,
      evidenceTtlMs: 24 * 60 * 60 * 1000,
      specSha: '',
      credentialFingerprint: '',
      upstreamBaseUrl: '',
      ...config
    };
    this.credentialFingerprintResolver = credentialFingerprintResolver;
    this.clock = clock;
  }

  assertAdminForCustomer(customerId, context = {}) {
    const principal = normalizePrincipal(context.principal);
    if (principal.role !== 'admin') {
      fail('SEARCHAD_CANARY_ADMIN_REQUIRED', 'Active Canary는 Admin principal만 시작하거나 검증할 수 있습니다.', {}, 403);
    }
    if (!principal.customerIds.includes(String(customerId))) {
      fail('SEARCHAD_CUSTOMER_FORBIDDEN', '이 principal은 해당 SearchAd Customer에 접근할 수 없습니다.', { customerId }, 403);
    }
    return principal;
  }

  assertStartInput(input = {}) {
    const keys = Object.keys(input || {});
    const extra = keys.filter(key => !START_KEYS.has(key));
    if (extra.length) {
      fail(
        'SEARCHAD_CANARY_INPUT_INVALID',
        'Active Canary 시작 요청은 customerId와 passiveEvidenceId만 받을 수 있습니다.',
        { rejectedFields: extra },
        400
      );
    }
    const customerId = String(input.customerId || '').trim();
    const passiveEvidenceId = String(input.passiveEvidenceId || '').trim();
    if (!customerId || !passiveEvidenceId) {
      fail('SEARCHAD_CANARY_INPUT_INVALID', 'customerId와 passiveEvidenceId가 필요합니다.');
    }
    return { customerId, passiveEvidenceId };
  }

  assertActivationGates() {
    if (!this.config.allowActiveCanary) {
      fail('SEARCHAD_ACTIVE_CANARY_DISABLED', 'Active Canary gate가 비활성화되어 있습니다.', {}, 403);
    }
    if (String(this.config.activationMode) !== 'canary') {
      fail('SEARCHAD_CANARY_MODE_REQUIRED', 'activationMode=canary에서만 Active Canary를 실행할 수 있습니다.', {}, 403);
    }
  }

  async resolveCredentialFingerprint(customerId) {
    const resolved = this.credentialFingerprintResolver
      ? await this.credentialFingerprintResolver(String(customerId))
      : this.config.credentialFingerprint;
    const fingerprint = String(resolved || '').trim();
    if (!fingerprint) {
      fail(
        'SEARCHAD_CANARY_CREDENTIAL_FINGERPRINT_REQUIRED',
        'Active Canary에는 현재 Customer credential fingerprint가 필요합니다.',
        { customerId },
        503
      );
    }
    return fingerprint;
  }

  async assertPassiveEvidence(customerId, passiveEvidenceId, credentialFingerprint) {
    const evidence = await this.repository.getEvidence(passiveEvidenceId);
    const now = this.clock();
    const matches = Boolean(
      evidence &&
      evidence.evidenceType === 'passive_capability' &&
      evidence.result === 'verified' &&
      String(evidence.customerId) === String(customerId) &&
      String(evidence.specSha) === String(this.config.specSha) &&
      String(evidence.credentialFingerprint) === String(credentialFingerprint) &&
      String(evidence.upstreamBaseUrl) === String(this.config.upstreamBaseUrl) &&
      Number.isFinite(Date.parse(evidence.expiresAt)) &&
      Date.parse(evidence.expiresAt) > now &&
      includesAll(evidence.operationKeys, this.recipe.requiredOperationKeys) &&
      includesAll(evidence.fieldScope, this.recipe.verifiedOperationScope?.fieldScope || [])
    );
    if (!matches) {
      fail(
        'SEARCHAD_CANARY_EVIDENCE_MISMATCH',
        'Passive Capability evidence가 현재 Customer/spec/credential/upstream/operation scope와 일치하지 않습니다.',
        { passiveEvidenceId, customerId },
        409
      );
    }
    return evidence;
  }

  async assertRunContextCurrent(run) {
    const credentialFingerprint = await this.resolveCredentialFingerprint(run.customerId);
    const current = Boolean(
      String(run.specSha) === String(this.config.specSha) &&
      String(run.credentialFingerprint) === String(credentialFingerprint) &&
      String(run.upstreamBaseUrl) === String(this.config.upstreamBaseUrl)
    );
    if (!current) {
      fail(
        'SEARCHAD_CANARY_CONTEXT_CHANGED',
        'Canary 시작 이후 spec/credential/upstream context가 변경되어 evidence를 발급할 수 없습니다.',
        { canaryRunId: run.canaryRunId, customerId: run.customerId },
        409
      );
    }
  }

  async addEvent(run, { phase, status, operationKey, error, requestId } = {}) {
    await this.repository.addEvent({
      eventId: randomUUID(),
      canaryRunId: run.canaryRunId,
      customerId: run.customerId,
      phase,
      status,
      operationKey: operationKey || null,
      requestId: requestId || null,
      error: error ? safeError(error) : null,
      createdAt: nowIso(this.clock)
    });
  }

  async markUnknown(run, phase, descriptor, error, status = 'unknown_outcome') {
    await this.repository.updateRun(run.canaryRunId, {
      status,
      lastError: safeError(error)
    });
    await this.addEvent(run, {
      phase,
      status,
      operationKey: descriptor?.operationKey,
      error
    });
    fail(
      'SEARCHAD_CANARY_UNKNOWN_OUTCOME',
      'Canary mutation 결과가 불명확합니다. 같은 mutation을 반복하지 말고 read-only reconcile을 수행해야 합니다.',
      { canaryRunId: run.canaryRunId, phase },
      409
    );
  }

  async mutateOnce(run, phase, descriptor) {
    await this.addEvent(run, {
      phase,
      status: 'send_intent',
      operationKey: descriptor?.operationKey
    });
    try {
      const result = await this.remote.mutate(descriptor);
      await this.addEvent(run, {
        phase,
        status: 'remote_accepted',
        operationKey: descriptor?.operationKey,
        requestId: result?.requestId || result?.upstream?.requestId
      });
      return result;
    } catch (error) {
      if (isAmbiguousSearchAdWriteError(error)) {
        return this.markUnknown(run, phase, descriptor, error);
      }
      await this.repository.updateRun(run.canaryRunId, {
        status: 'failed',
        lastError: safeError(error)
      });
      await this.addEvent(run, {
        phase,
        status: 'failed',
        operationKey: descriptor?.operationKey,
        error
      });
      throw error;
    }
  }

  async readSpend(descriptor) {
    const result = await this.remote.read(descriptor);
    const spend = this.recipe.parseSpend(result);
    if (!Number.isFinite(spend) || spend < 0) {
      fail('SEARCHAD_CANARY_SPEND_UNVERIFIED', 'Canary 비용 통계가 명시적인 유효 숫자로 검증되지 않았습니다.', {}, 409);
    }
    return spend;
  }

  async readCampaignForRecovery(run) {
    try {
      return await this.remote.read(this.recipe.readCampaign({
        customerId: run.customerId,
        remoteId: run.remoteId
      }));
    } catch (error) {
      const status = Number(error?.status || error?.statusCode || 0);
      if (status === 404) return null;
      throw error;
    }
  }

  async markCleanupVerified(run, phase) {
    const cleanupVerifiedAt = nowIso(this.clock);
    if (typeof this.repository.updateObject === 'function') {
      await this.repository.updateObject(run.canaryRunId, run.remoteId, {
        cleanupStatus: 'deleted_verified',
        cleanedAt: cleanupVerifiedAt
      });
    }
    await this.addEvent(run, {
      phase,
      status: 'deleted_verified',
      operationKey: this.recipe.readCampaign({ customerId: run.customerId, remoteId: run.remoteId })?.operationKey
    });
    return this.repository.updateRun(run.canaryRunId, {
      status: 'spend_check_pending',
      cleanupVerifiedAt,
      lastError: null
    });
  }

  async start(input = {}, context = {}) {
    const { customerId, passiveEvidenceId } = this.assertStartInput(input);
    const principal = this.assertAdminForCustomer(customerId, context);
    this.assertActivationGates();

    const account = await this.repository.getAccount(customerId);
    if (!account) fail('SEARCHAD_CANARY_ACCOUNT_NOT_FOUND', 'SearchAd Customer account 상태를 찾을 수 없습니다.', { customerId }, 404);
    if (account.suspended) {
      fail('SEARCHAD_CANARY_ACCOUNT_SUSPENDED', '중지된 SearchAd Customer에서는 새 Active Canary를 시작할 수 없습니다.', { customerId }, 409);
    }

    const credentialFingerprint = await this.resolveCredentialFingerprint(customerId);
    const evidence = await this.assertPassiveEvidence(customerId, passiveEvidenceId, credentialFingerprint);
    const existing = await this.repository.findActiveRun(customerId);
    if (existing && !TERMINAL_STATUSES.has(existing.status)) {
      fail('SEARCHAD_CANARY_ALREADY_ACTIVE', '같은 Customer의 미완료 Active Canary가 이미 존재합니다.', { canaryRunId: existing.canaryRunId }, 409);
    }

    const run = {
      canaryRunId: randomUUID(),
      customerId,
      passiveEvidenceId,
      recipeId: this.recipe.id,
      status: 'preflight_verified',
      startedByPrincipalId: principal.principalId,
      specSha: this.config.specSha,
      credentialFingerprint,
      upstreamBaseUrl: this.config.upstreamBaseUrl,
      verifiedOperationScope: structuredClone(this.recipe.verifiedOperationScope || {}),
      startedAt: nowIso(this.clock),
      beforeSpend: null,
      remoteId: null,
      cleanupVerifiedAt: null,
      completedAt: null,
      lastError: null
    };
    await this.repository.createRun(run);
    await this.addEvent(run, { phase: 'preflight', status: 'verified' });

    const createResult = await this.mutateOnce(
      run,
      'campaign_create',
      this.recipe.createCampaign({ customerId, canaryRunId: run.canaryRunId, evidence })
    );
    const remoteId = String(this.recipe.extractCampaignId(createResult) || '').trim();
    if (!remoteId) {
      await this.repository.updateRun(run.canaryRunId, { status: 'failed' });
      fail('SEARCHAD_CANARY_REMOTE_ID_REQUIRED', 'Canary create 응답에서 반환된 campaign ID를 확인할 수 없습니다.', {}, 409);
    }

    await this.repository.updateRun(run.canaryRunId, {
      remoteId,
      status: 'campaign_create_sent'
    });

    const canUpdateObject = typeof this.repository.updateObject === 'function';
    const objectRecord = {
      canaryRunId: run.canaryRunId,
      customerId,
      objectType: 'campaign',
      remoteId,
      cleanupStatus: 'pending',
      createdAt: nowIso(this.clock)
    };
    await this.repository.addObject(objectRecord);

    const createdSnapshot = await this.remote.read(this.recipe.readCampaign({ customerId, remoteId }));
    if (!this.recipe.assertCreatedStopped(createdSnapshot)) {
      await this.repository.updateRun(run.canaryRunId, { status: 'cleanup_required' });
      fail('SEARCHAD_CANARY_NOT_STOPPED', '새 Canary campaign이 안전한 stopped WEB_SITE 상태로 검증되지 않았습니다.', { remoteId }, 409);
    }
    await this.repository.updateRun(run.canaryRunId, { status: 'campaign_verified_off' });

    let beforeSpend;
    try {
      beforeSpend = await this.readSpend(this.recipe.beforeSpendRead({
        customerId,
        evidence,
        canaryRunId: run.canaryRunId,
        remoteId,
        snapshot: createdSnapshot
      }));
    } catch (error) {
      await this.repository.updateRun(run.canaryRunId, {
        status: 'cleanup_required',
        lastError: safeError(error)
      });
      await this.addEvent(run, {
        phase: 'baseline_spend',
        status: 'unverified',
        operationKey: this.recipe.beforeSpendRead({ customerId, remoteId })?.operationKey,
        error
      });
      throw error;
    }
    await this.repository.updateRun(run.canaryRunId, { beforeSpend });

    await this.mutateOnce(
      run,
      'budget_update',
      this.recipe.budgetMutation({ customerId, remoteId, before: createdSnapshot })
    );
    const updatedSnapshot = await this.remote.read(this.recipe.readCampaign({ customerId, remoteId }));
    if (!this.recipe.assertBudgetMutation(createdSnapshot, updatedSnapshot)) {
      await this.repository.updateRun(run.canaryRunId, { status: 'cleanup_required' });
      fail('SEARCHAD_CANARY_MUTATION_VERIFY_FAILED', 'Canary budget 변경 후 원격 상태 검증에 실패했습니다.', { remoteId }, 409);
    }

    await this.mutateOnce(
      run,
      'budget_restore',
      this.recipe.budgetRestore({ customerId, remoteId, before: createdSnapshot })
    );
    const restoredSnapshot = await this.remote.read(this.recipe.readCampaign({ customerId, remoteId }));
    if (!this.recipe.assertBudgetRestored(createdSnapshot, restoredSnapshot)) {
      await this.repository.updateRun(run.canaryRunId, { status: 'cleanup_required' });
      fail('SEARCHAD_CANARY_RESTORE_VERIFY_FAILED', 'Canary budget 원복 후 원격 상태 검증에 실패했습니다.', { remoteId }, 409);
    }

    await this.mutateOnce(
      run,
      'campaign_cleanup',
      this.recipe.cleanupCampaign({ customerId, remoteId })
    );
    let cleanupSnapshot;
    try {
      cleanupSnapshot = await this.remote.read(this.recipe.readCampaign({ customerId, remoteId }));
    } catch (error) {
      const status = Number(error?.status || error?.statusCode || 0);
      if (status === 404) cleanupSnapshot = null;
      else throw error;
    }
    if (!this.recipe.assertCleanup(cleanupSnapshot)) {
      await this.repository.updateRun(run.canaryRunId, { status: 'cleanup_required' });
      fail('SEARCHAD_CANARY_CLEANUP_REQUIRED', 'Canary campaign 정리가 원격에서 검증되지 않았습니다.', { remoteId }, 409);
    }

    const cleanupVerifiedAt = nowIso(this.clock);
    if (canUpdateObject) {
      await this.repository.updateObject(run.canaryRunId, remoteId, {
        cleanupStatus: 'deleted_verified',
        cleanedAt: cleanupVerifiedAt
      });
    }

    return this.repository.updateRun(run.canaryRunId, {
      status: 'spend_check_pending',
      remoteId,
      beforeSpend,
      cleanupVerifiedAt
    });
  }

  async reconcile(canaryRunId, context = {}) {
    const run = await this.repository.getRun(canaryRunId);
    if (!run) fail('SEARCHAD_CANARY_NOT_FOUND', 'Active Canary run을 찾을 수 없습니다.', { canaryRunId }, 404);
    this.assertAdminForCustomer(run.customerId, context);

    if (run.status === 'spend_check_pending' || run.status === 'passed') return run;
    if (!['cleanup_required', 'unknown_outcome'].includes(String(run.status))) {
      fail(
        'SEARCHAD_CANARY_RECONCILE_NOT_ALLOWED',
        '현재 Canary 상태에서는 read-only reconcile을 수행할 수 없습니다.',
        { status: run.status },
        409
      );
    }

    const remoteId = String(run.remoteId || '').trim();
    if (!remoteId) {
      await this.addEvent(run, { phase: 'reconcile', status: 'unresolved_no_remote_id' });
      fail(
        'SEARCHAD_CANARY_RECONCILE_UNRESOLVED',
        'returned remote ID가 없어 이름 검색 없이 안전하게 reconcile할 수 없습니다.',
        { canaryRunId },
        409
      );
    }

    const snapshot = await this.readCampaignForRecovery({ ...run, remoteId });
    if (this.recipe.assertCleanup(snapshot)) {
      if (!hasVerifiedSpendBaseline(run.beforeSpend)) {
        await this.addEvent(run, {
          phase: 'reconcile',
          status: 'cleanup_verified_spend_baseline_missing',
          operationKey: this.recipe.readCampaign({ customerId: run.customerId, remoteId })?.operationKey
        });
        return this.repository.updateRun(run.canaryRunId, {
          status: 'cleanup_required',
          cleanupVerifiedAt: nowIso(this.clock)
        });
      }
      return this.markCleanupVerified({ ...run, remoteId }, 'reconcile');
    }

    await this.addEvent(run, {
      phase: 'reconcile',
      status: 'remote_object_present',
      operationKey: this.recipe.readCampaign({ customerId: run.customerId, remoteId })?.operationKey
    });
    return run;
  }

  async cleanup(canaryRunId, context = {}) {
    const run = await this.repository.getRun(canaryRunId);
    if (!run) fail('SEARCHAD_CANARY_NOT_FOUND', 'Active Canary run을 찾을 수 없습니다.', { canaryRunId }, 404);
    this.assertAdminForCustomer(run.customerId, context);

    if (run.status !== 'cleanup_required') {
      fail(
        'SEARCHAD_CANARY_CLEANUP_NOT_ALLOWED',
        '현재 Canary 상태에서는 cleanup mutation을 수행할 수 없습니다.',
        { status: run.status },
        409
      );
    }

    const remoteId = String(run.remoteId || '').trim();
    if (!remoteId) {
      fail(
        'SEARCHAD_CANARY_REMOTE_ID_REQUIRED',
        'persisted returned remote ID 없이는 Canary cleanup을 수행할 수 없습니다.',
        { canaryRunId },
        409
      );
    }

    await this.mutateOnce(
      run,
      'campaign_cleanup_recovery',
      this.recipe.cleanupCampaign({ customerId: run.customerId, remoteId })
    );

    const snapshot = await this.readCampaignForRecovery({ ...run, remoteId });
    if (!this.recipe.assertCleanup(snapshot)) {
      await this.repository.updateRun(run.canaryRunId, { status: 'cleanup_required' });
      await this.addEvent(run, {
        phase: 'campaign_cleanup_recovery_verify',
        status: 'remote_object_present',
        operationKey: this.recipe.readCampaign({ customerId: run.customerId, remoteId })?.operationKey
      });
      fail(
        'SEARCHAD_CANARY_CLEANUP_REQUIRED',
        'Canary campaign 정리가 원격에서 검증되지 않았습니다.',
        { remoteId },
        409
      );
    }

    if (!hasVerifiedSpendBaseline(run.beforeSpend)) {
      const cleanupVerifiedAt = nowIso(this.clock);
      if (typeof this.repository.updateObject === 'function') {
        await this.repository.updateObject(run.canaryRunId, remoteId, {
          cleanupStatus: 'deleted_verified',
          cleanedAt: cleanupVerifiedAt
        });
      }
      await this.addEvent(run, {
        phase: 'campaign_cleanup_recovery_verify',
        status: 'deleted_verified_spend_baseline_missing',
        operationKey: this.recipe.readCampaign({ customerId: run.customerId, remoteId })?.operationKey
      });
      return this.repository.updateRun(run.canaryRunId, {
        status: 'cleanup_required',
        cleanupVerifiedAt,
        lastError: null
      });
    }

    return this.markCleanupVerified({ ...run, remoteId }, 'campaign_cleanup_recovery_verify');
  }

  async verifySpend(canaryRunId, context = {}) {
    const run = await this.repository.getRun(canaryRunId);
    if (!run) fail('SEARCHAD_CANARY_NOT_FOUND', 'Active Canary run을 찾을 수 없습니다.', { canaryRunId }, 404);
    this.assertAdminForCustomer(run.customerId, context);
    await this.assertRunContextCurrent(run);

    if (run.status === 'passed') return run;
    if (run.status !== 'spend_check_pending') {
      fail('SEARCHAD_CANARY_SPEND_CHECK_NOT_ALLOWED', '현재 Canary 상태에서는 zero-spend 검증을 수행할 수 없습니다.', { status: run.status }, 409);
    }

    const cleanupAt = Date.parse(run.cleanupVerifiedAt || '');
    const elapsed = this.clock() - cleanupAt;
    if (!Number.isFinite(cleanupAt) || elapsed < Number(this.config.observationPeriodMs)) {
      fail(
        'SEARCHAD_CANARY_OBSERVATION_PENDING',
        '정리 완료 후 zero-spend 관찰기간이 아직 끝나지 않았습니다.',
        { requiredMs: this.config.observationPeriodMs, elapsedMs: Math.max(0, elapsed || 0) },
        409
      );
    }

    const afterSpend = await this.readSpend(this.recipe.afterSpendRead({
      customerId: run.customerId,
      canaryRunId: run.canaryRunId,
      remoteId: run.remoteId
    }));
    const delta = afterSpend - Number(run.beforeSpend);
    if (!Number.isFinite(delta) || delta < 0) {
      fail('SEARCHAD_CANARY_SPEND_UNVERIFIED', 'Canary 비용 차이가 유효한 0 이상 값으로 검증되지 않았습니다.', { beforeSpend: run.beforeSpend, afterSpend }, 409);
    }
    if (delta !== 0) {
      await this.addEvent(run, { phase: 'spend_verify', status: 'spend_detected' });
      return this.repository.updateRun(run.canaryRunId, {
        status: 'spend_detected',
        afterSpend,
        spendDelta: delta,
        completedAt: nowIso(this.clock)
      });
    }

    const createdAt = nowIso(this.clock);
    const evidence = {
      evidenceId: randomUUID(),
      evidenceType: 'active_canary',
      customerId: run.customerId,
      specSha: run.specSha,
      credentialFingerprint: run.credentialFingerprint,
      upstreamBaseUrl: run.upstreamBaseUrl,
      operationKeys: structuredClone(run.verifiedOperationScope?.operationKeys || []),
      fieldScope: structuredClone(run.verifiedOperationScope?.fieldScope || []),
      result: 'verified',
      sourceRunId: run.canaryRunId,
      recipeId: run.recipeId,
      createdAt,
      expiresAt: new Date(this.clock() + Number(this.config.evidenceTtlMs)).toISOString()
    };
    await this.repository.createEvidence(evidence);
    await this.addEvent(run, { phase: 'spend_verify', status: 'verified_zero' });
    return this.repository.updateRun(run.canaryRunId, {
      status: 'passed',
      afterSpend,
      spendDelta: 0,
      evidenceId: evidence.evidenceId,
      completedAt: createdAt
    });
  }
}
