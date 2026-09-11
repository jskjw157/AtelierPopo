import { randomUUID } from 'node:crypto';
import { SearchAdWriteError } from '../write/errors.js';

const ROLE_RANK = Object.freeze({ reader: 1, operator: 2, executor: 3, admin: 4 });
const ISSUE_KEYS = new Set(['customerId']);

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function principalFrom(context = {}) {
  const principal = context?.principal || {};
  return {
    principalId: String(principal.principalId || '').trim(),
    role: String(principal.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal.customerIds) ? principal.customerIds.map(String) : []
  };
}

function validateTargetOperation(gateway, operationKey) {
  try {
    const operation = gateway.get(String(operationKey));
    const verified = Boolean(
      operation &&
      operation.runtimeAllowlisted === true &&
      ['A', 'B'].includes(String(operation.tier || '')) &&
      String(operation.state || '') !== 'internal_quarantined'
    );
    return {
      operationKey: String(operationKey),
      verified,
      runtimeAllowlisted: Boolean(operation?.runtimeAllowlisted),
      tier: operation?.tier == null ? null : String(operation.tier),
      state: operation?.state == null ? null : String(operation.state)
    };
  } catch (error) {
    return {
      operationKey: String(operationKey),
      verified: false,
      runtimeAllowlisted: false,
      tier: null,
      state: 'missing'
    };
  }
}

function sanitizeProbeResult(item = {}) {
  const value = {
    operationKey: String(item.operationKey || ''),
    state: String(item.state || 'unknown'),
    supported: item.supported === true
  };
  const upstreamStatus = Number(item.upstreamStatus);
  if (Number.isFinite(upstreamStatus) && upstreamStatus > 0) value.upstreamStatus = upstreamStatus;
  if (item.requestId != null && String(item.requestId).trim()) value.requestId = String(item.requestId);
  return value;
}

export class PassiveCapabilityEvidenceService {
  constructor({
    repository,
    capabilityService,
    gateway,
    targetScope,
    credentialFingerprintResolver,
    gatewayContext,
    evidenceTtlMs = 60 * 60 * 1000,
    clock = Date.now
  } = {}) {
    if (!repository?.createEvidence) throw new TypeError('repository.createEvidence is required');
    if (!capabilityService?.runPassive || !capabilityService?.defaultPassiveOperations) {
      throw new TypeError('capabilityService is required');
    }
    if (!gateway?.get) throw new TypeError('gateway is required');
    if (!targetScope?.operationKeys || !targetScope?.fieldScope) throw new TypeError('targetScope is required');
    if (typeof credentialFingerprintResolver !== 'function') {
      throw new TypeError('credentialFingerprintResolver is required');
    }
    this.repository = repository;
    this.capabilityService = capabilityService;
    this.gateway = gateway;
    this.targetScope = {
      operationKeys: [...targetScope.operationKeys].map(String),
      fieldScope: [...targetScope.fieldScope].map(String)
    };
    this.credentialFingerprintResolver = credentialFingerprintResolver;
    this.gatewayContext = {
      specSha: String(gatewayContext?.specSha || '').trim(),
      upstreamBaseUrl: String(gatewayContext?.upstreamBaseUrl || '').replace(/\/$/, '')
    };
    this.evidenceTtlMs = Number(evidenceTtlMs);
    this.clock = clock;
  }

  assertInput(input = {}) {
    const extra = Object.keys(input || {}).filter(key => !ISSUE_KEYS.has(key));
    if (extra.length) {
      fail(
        'SEARCHAD_PASSIVE_EVIDENCE_INPUT_INVALID',
        'Trusted Passive evidence accepts only customerId; result and scope are server-derived.',
        400,
        { rejectedFields: extra }
      );
    }
    const customerId = String(input?.customerId || '').trim();
    if (!customerId) fail('SEARCHAD_CUSTOMER_ID_REQUIRED', 'customerId is required.', 400);
    return customerId;
  }

  assertOperator(customerId, context = {}) {
    const principal = principalFrom(context);
    if ((ROLE_RANK[principal.role] || 0) < ROLE_RANK.operator) {
      fail('SEARCHAD_OPERATOR_REQUIRED', 'SearchAd Operator role or higher is required.', 403);
    }
    if (!principal.principalId) {
      fail('SEARCHAD_PRINCIPAL_REQUIRED', 'Authenticated SearchAd principal is required.', 403);
    }
    if (!principal.customerIds.includes(String(customerId))) {
      fail('SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.', 403);
    }
    return principal;
  }

  async issue(input = {}, context = {}) {
    const customerId = this.assertInput(input);
    const principal = this.assertOperator(customerId, context);
    if (!this.gatewayContext.specSha || !this.gatewayContext.upstreamBaseUrl) {
      fail('SEARCHAD_PASSIVE_CONTEXT_REQUIRED', 'Pinned SearchAd spec and upstream context are required.', 503);
    }

    const probeOperations = this.capabilityService.defaultPassiveOperations();
    const probe = await this.capabilityService.runPassive({ customerId, operations: probeOperations });
    const sanitizedProbeOperations = (probe?.results || []).map(sanitizeProbeResult);
    const targetValidation = this.targetScope.operationKeys.map(operationKey =>
      validateTargetOperation(this.gateway, operationKey)
    );
    const probeVerified = sanitizedProbeOperations.length > 0
      && sanitizedProbeOperations.every(item => item.supported === true);
    const targetVerified = targetValidation.length > 0
      && targetValidation.every(item => item.verified === true);
    const result = probeVerified && targetVerified ? 'verified' : 'failed';

    const now = Number(this.clock());
    const createdAt = new Date(now).toISOString();
    const credentialFingerprint = String(await this.credentialFingerprintResolver(customerId) || '').trim();
    if (!credentialFingerprint) {
      fail('SEARCHAD_PASSIVE_CREDENTIAL_FINGERPRINT_REQUIRED', 'Customer credential fingerprint is required.', 503);
    }

    const evidence = {
      evidenceId: randomUUID(),
      evidenceType: 'passive_capability',
      customerId,
      specSha: this.gatewayContext.specSha,
      credentialFingerprint,
      upstreamBaseUrl: this.gatewayContext.upstreamBaseUrl,
      operationKeys: structuredClone(this.targetScope.operationKeys),
      fieldScope: structuredClone(this.targetScope.fieldScope),
      result,
      sourceRunId: null,
      recipeId: null,
      details: {
        probeOperations: sanitizedProbeOperations,
        targetValidation
      },
      createdByPrincipalId: principal.principalId,
      sourceRequestId: context?.requestId == null ? null : String(context.requestId),
      createdAt,
      expiresAt: new Date(now + this.evidenceTtlMs).toISOString()
    };

    return this.repository.createEvidence(evidence);
  }
}

export const _internal = { principalFrom, validateTargetOperation, sanitizeProbeResult };
