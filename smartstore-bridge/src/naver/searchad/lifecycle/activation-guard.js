import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_LIFECYCLE_KINDS } from './operations.js';

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function includesValue(values, expected) {
  return Array.isArray(values) && values.map(String).includes(String(expected));
}

function sameStringArray(left = [], right = []) {
  const a = [...(Array.isArray(left) ? left : [])].map(String).sort();
  const b = [...(Array.isArray(right) ? right : [])].map(String).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function operationStillVerified(gateway, operationKey) {
  try {
    const operation = gateway.get(String(operationKey));
    return Boolean(
      operation &&
      operation.runtimeAllowlisted === true &&
      String(operation.state || '') === 'public_documented' &&
      String(operation.tier || '') === 'B'
    );
  } catch {
    return false;
  }
}

function assertExactGrantEvidenceScope(grant, evidence, { customerId, operationKey, lifecycleKind }) {
  if (
    String(grant.customerId) !== customerId ||
    String(evidence.customerId) !== customerId ||
    String(grant.evidenceId) !== String(evidence.evidenceId)
  ) {
    fail('SEARCHAD_ACTIVATION_CONTEXT_MISMATCH', 'SearchAd lifecycle activation Customer or evidence identity no longer matches.', 403);
  }

  const grantHasScope = includesValue(grant.operationKeys, operationKey) && includesValue(grant.lifecycleKinds, lifecycleKind);
  const evidenceHasScope = includesValue(evidence.operationKeys, operationKey) && includesValue(evidence.lifecycleKinds, lifecycleKind);
  const immutableScopeMatches = sameStringArray(grant.operationKeys, evidence.operationKeys) &&
    sameStringArray(grant.lifecycleKinds, evidence.lifecycleKinds) &&
    sameStringArray(grant.fieldScope, evidence.fieldScope);

  if (!grantHasScope || !evidenceHasScope || !immutableScopeMatches) {
    fail('SEARCHAD_LIFECYCLE_SCOPE_MISMATCH', 'SearchAd lifecycle activation does not cover this exact operation and lifecycle kind.', 403);
  }
}

export class SearchAdLifecycleActivationGuard {
  constructor({
    repository,
    gateway,
    credentialFingerprintResolver,
    gatewayContext,
    clock = Date.now
  } = {}) {
    if (!repository?.getAccount || !repository?.findUsableLifecycleActivation || !repository?.getEvidence) {
      throw new TypeError('lifecycle activation repository is required');
    }
    if (!gateway?.get) throw new TypeError('gateway is required');
    if (typeof credentialFingerprintResolver !== 'function') {
      throw new TypeError('credentialFingerprintResolver is required');
    }
    this.repository = repository;
    this.gateway = gateway;
    this.credentialFingerprintResolver = credentialFingerprintResolver;
    this.gatewayContext = {
      specSha: String(gatewayContext?.specSha || '').trim(),
      upstreamBaseUrl: normalizeBaseUrl(gatewayContext?.upstreamBaseUrl)
    };
    this.clock = clock;
  }

  async assertLifecycleMutationAllowed({ customerId, operationKey, lifecycleKind } = {}) {
    const id = String(customerId || '').trim();
    const key = String(operationKey || '').trim();
    const kind = String(lifecycleKind || '').trim();
    if (!id || !key || !kind || !SEARCHAD_LIFECYCLE_KINDS.includes(kind)) {
      fail('SEARCHAD_LIFECYCLE_SCOPE_MISMATCH', 'A valid Customer, operationKey and lifecycle kind are required.', 403);
    }

    const account = await this.repository.getAccount(id);
    if (!account) fail('SEARCHAD_ACCOUNT_NOT_FOUND', 'SearchAd Customer account state is not initialized.', 404);
    if (account.suspended) fail('SEARCHAD_ACCOUNT_SUSPENDED', 'SearchAd Customer is suspended.', 403);

    if (!operationStillVerified(this.gateway, key)) {
      fail('SEARCHAD_ACTIVATION_OPERATION_UNVERIFIED', 'SearchAd lifecycle operation is no longer in the verified public tier.', 403);
    }

    const now = Number(this.clock());
    const grant = await this.repository.findUsableLifecycleActivation({
      customerId: id,
      operationKey: key,
      lifecycleKind: kind,
      now: new Date(now)
    });
    if (!grant) {
      fail('SEARCHAD_LIFECYCLE_ACTIVATION_REQUIRED', 'A matching SearchAd lifecycle activation is required.', 403);
    }

    if (String(grant.customerId) !== id) {
      fail('SEARCHAD_ACTIVATION_CONTEXT_MISMATCH', 'SearchAd lifecycle activation belongs to a different Customer.', 403);
    }

    const grantExpiry = Date.parse(grant.expiresAt || '');
    if (!Number.isFinite(grantExpiry) || grantExpiry <= now) {
      fail('SEARCHAD_ACTIVATION_EXPIRED', 'SearchAd lifecycle activation has expired.', 403);
    }

    if (String(grant.evidenceType) !== 'active_canary') {
      fail('SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED', 'Passive capability evidence cannot authorize lifecycle mutation.', 403);
    }

    const evidence = await this.repository.getEvidence(grant.evidenceId);
    const evidenceExpiry = Date.parse(evidence?.expiresAt || '');
    if (
      !evidence ||
      String(evidence.evidenceType) !== 'active_canary' ||
      String(evidence.result) !== 'verified' ||
      !Number.isFinite(evidenceExpiry) ||
      evidenceExpiry <= now
    ) {
      fail('SEARCHAD_ACTIVATION_EVIDENCE_INVALID', 'SearchAd lifecycle activation evidence is not verified and current.', 403);
    }

    assertExactGrantEvidenceScope(grant, evidence, { customerId: id, operationKey: key, lifecycleKind: kind });

    const currentCredential = String(await this.credentialFingerprintResolver(id) || '').trim();
    const currentSpecSha = this.gatewayContext.specSha;
    const currentUpstream = this.gatewayContext.upstreamBaseUrl;
    const contextMatches = Boolean(
      currentSpecSha &&
      currentUpstream &&
      String(grant.specSha) === currentSpecSha &&
      String(evidence.specSha) === currentSpecSha &&
      String(grant.credentialFingerprint) === currentCredential &&
      String(evidence.credentialFingerprint) === currentCredential &&
      normalizeBaseUrl(grant.upstreamBaseUrl) === currentUpstream &&
      normalizeBaseUrl(evidence.upstreamBaseUrl) === currentUpstream
    );
    if (!contextMatches) {
      fail('SEARCHAD_ACTIVATION_CONTEXT_MISMATCH', 'SearchAd lifecycle activation no longer matches current spec, credential, or upstream context.', 403);
    }

    if (!operationStillVerified(this.gateway, key)) {
      fail('SEARCHAD_ACTIVATION_OPERATION_UNVERIFIED', 'SearchAd lifecycle operation is no longer in the verified public tier.', 403);
    }

    return {
      allowed: true,
      activationId: grant.activationId,
      evidenceId: grant.evidenceId,
      customerId: id,
      operationKey: key,
      lifecycleKind: kind
    };
  }
}

export const _internal = {
  normalizeBaseUrl,
  includesValue,
  sameStringArray,
  operationStillVerified,
  assertExactGrantEvidenceScope
};
