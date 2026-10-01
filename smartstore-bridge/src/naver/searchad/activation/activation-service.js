import { randomUUID } from 'node:crypto';
import { SearchAdWriteError } from '../write/errors.js';

const ACTIVATE_KEYS = new Set(['evidenceId']);

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function normalizePrincipal(context = {}) {
  const principal = context?.principal || {};
  return {
    principalId: String(principal.principalId || '').trim(),
    role: String(principal.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal.customerIds) ? principal.customerIds.map(String) : []
  };
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function publicGrant(grant) {
  if (!grant) return null;
  const {
    credentialFingerprint: _credentialFingerprint,
    ...safe
  } = structuredClone(grant);
  return safe;
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

function sameStringArray(left = [], right = []) {
  const a = [...left].map(String).sort();
  const b = [...right].map(String).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function grantMatchesEvidence(grant, evidence) {
  return Boolean(
    grant && evidence &&
    String(grant.evidenceId) === String(evidence.evidenceId) &&
    String(grant.evidenceType) === String(evidence.evidenceType) &&
    String(grant.customerId) === String(evidence.customerId) &&
    String(grant.specSha) === String(evidence.specSha) &&
    String(grant.credentialFingerprint) === String(evidence.credentialFingerprint) &&
    normalizeBaseUrl(grant.upstreamBaseUrl) === normalizeBaseUrl(evidence.upstreamBaseUrl) &&
    sameStringArray(grant.operationKeys, evidence.operationKeys) &&
    sameStringArray(grant.fieldScope, evidence.fieldScope) &&
    sameStringArray(grant.lifecycleKinds, evidence.lifecycleKinds) &&
    String(grant.expiresAt) === String(evidence.expiresAt)
  );
}

export class SearchAdActivationService {
  constructor({
    repository,
    gateway,
    credentialFingerprintResolver,
    gatewayContext,
    clock = Date.now
  } = {}) {
    if (!repository?.getEvidence || !repository?.createActivation || !repository?.getActivationByEvidence) {
      throw new TypeError('activation repository is required');
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

  assertInput(input = {}) {
    const extra = Object.keys(input || {}).filter(key => !ACTIVATE_KEYS.has(key));
    if (extra.length) {
      fail(
        'SEARCHAD_ACTIVATION_INPUT_INVALID',
        'SearchAd activation accepts only evidenceId; Customer and scope are evidence-owned.',
        400,
        { rejectedFields: extra }
      );
    }
    const evidenceId = String(input?.evidenceId || '').trim();
    if (!evidenceId) fail('SEARCHAD_ACTIVATION_INPUT_INVALID', 'evidenceId is required.', 400);
    return evidenceId;
  }

  assertAdmin(context = {}) {
    const principal = normalizePrincipal(context);
    if (principal.role !== 'admin' || !principal.principalId) {
      fail('SEARCHAD_ADMIN_REQUIRED', 'SearchAd Admin role is required.', 403);
    }
    return principal;
  }

  async activate(input = {}, context = {}) {
    const evidenceId = this.assertInput(input);
    const principal = this.assertAdmin(context);
    const evidence = await this.repository.getEvidence(evidenceId);

    if (!evidence || !principal.customerIds.includes(String(evidence.customerId))) {
      fail('SEARCHAD_ACTIVATION_NOT_FOUND', 'SearchAd activation evidence was not found.', 404);
    }

    const now = Number(this.clock());
    const expiresAt = Date.parse(evidence.expiresAt || '');
    if (evidence.result !== 'verified' || !Number.isFinite(expiresAt) || expiresAt <= now) {
      fail('SEARCHAD_ACTIVATION_EVIDENCE_INVALID', 'SearchAd evidence is not verified and current.', 409);
    }
    if (!Array.isArray(evidence.operationKeys) || !evidence.operationKeys.length ||
        !Array.isArray(evidence.fieldScope) || !evidence.fieldScope.length) {
      fail('SEARCHAD_ACTIVATION_SCOPE_INVALID', 'SearchAd evidence scope is empty or malformed.', 409);
    }

    const currentCredential = String(await this.credentialFingerprintResolver(String(evidence.customerId)) || '').trim();
    const contextMatches = Boolean(
      this.gatewayContext.specSha &&
      this.gatewayContext.upstreamBaseUrl &&
      String(evidence.specSha) === this.gatewayContext.specSha &&
      String(evidence.credentialFingerprint) === currentCredential &&
      normalizeBaseUrl(evidence.upstreamBaseUrl) === this.gatewayContext.upstreamBaseUrl
    );
    if (!contextMatches) {
      fail('SEARCHAD_ACTIVATION_CONTEXT_MISMATCH', 'SearchAd evidence no longer matches current spec, credential, or upstream context.', 409);
    }

    if (!evidence.operationKeys.every(operationKey => operationStillVerified(this.gateway, operationKey))) {
      fail('SEARCHAD_ACTIVATION_SCOPE_INVALID', 'SearchAd evidence contains an operation that is no longer in the verified public tier.', 409);
    }

    const existing = await this.repository.getActivationByEvidence(evidenceId);
    if (existing) {
      if (!grantMatchesEvidence(existing, evidence)) {
        fail('SEARCHAD_ACTIVATION_SCOPE_INVALID', 'Stored activation no longer matches its immutable evidence scope.', 409);
      }
      return publicGrant(existing);
    }

    const activatedAt = new Date(now).toISOString();
    const grant = await this.repository.createActivation({
      activationId: randomUUID(),
      evidenceId: evidence.evidenceId,
      evidenceType: evidence.evidenceType,
      customerId: evidence.customerId,
      specSha: evidence.specSha,
      credentialFingerprint: evidence.credentialFingerprint,
      upstreamBaseUrl: normalizeBaseUrl(evidence.upstreamBaseUrl),
      operationKeys: structuredClone(evidence.operationKeys),
      fieldScope: structuredClone(evidence.fieldScope),
      lifecycleKinds: structuredClone(evidence.lifecycleKinds || []),
      activatedByPrincipalId: principal.principalId,
      activatedAt,
      expiresAt: evidence.expiresAt
    });
    return publicGrant(grant);
  }
}

export const _internal = {
  normalizePrincipal,
  normalizeBaseUrl,
  publicGrant,
  operationStillVerified,
  grantMatchesEvidence
};
