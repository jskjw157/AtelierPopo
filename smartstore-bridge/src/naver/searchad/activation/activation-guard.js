import { CANARY_OPERATION_KEYS } from '../canary/production-recipe.js';
import { SearchAdWriteError } from '../write/errors.js';

const KNOWN_UPDATE_BODY_KEYS = new Set(['nccCampaignId', 'dailyBudget', 'userLock']);

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function includesAll(actual = [], required = []) {
  const values = new Set((actual || []).map(String));
  return (required || []).every(value => values.has(String(value)));
}

function deriveMutableFields(descriptor = {}) {
  if (String(descriptor.operationKey || '') !== CANARY_OPERATION_KEYS.updateCampaign) {
    fail(
      'SEARCHAD_LIFECYCLE_ACTIVATION_REQUIRED',
      'SearchAd create/delete/batch lifecycle mutations require lifecycle-specific activation.',
      403
    );
  }

  const body = descriptor.body || descriptor.json || {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('SEARCHAD_ACTIVATION_FIELD_MAPPING_UNKNOWN', 'SearchAd update body cannot be mapped to verified mutable fields.', 409);
  }
  const unknownKeys = Object.keys(body).filter(key => !KNOWN_UPDATE_BODY_KEYS.has(key));
  if (unknownKeys.length) {
    fail(
      'SEARCHAD_ACTIVATION_FIELD_MAPPING_UNKNOWN',
      'SearchAd update contains mutable fields without an activation mapping.',
      409,
      { fields: unknownKeys }
    );
  }

  const queryFields = descriptor.query?.fields;
  if(queryFields === 'userLock') {
    if(Object.keys(body).length!==2 || !Object.hasOwn(body,'nccCampaignId') || !Object.hasOwn(body,'userLock') || typeof body.userLock!=='boolean' || typeof body.nccCampaignId!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(body.nccCampaignId) || body.nccCampaignId!==descriptor.pathParams?.campaignId) fail('SEARCHAD_ACTIVATION_FIELD_MAPPING_UNKNOWN','Exact campaign userLock body and path are required.',409);
    return ['campaign.userLock'];
  }
  if (queryFields != null && String(queryFields) !== 'budget') {
    fail(
      'SEARCHAD_ACTIVATION_FIELD_MAPPING_UNKNOWN',
      'SearchAd update query field mapping is not verified for activation.',
      409,
      { fields: String(queryFields) }
    );
  }

  const fields = new Set();
  if (String(queryFields || '') === 'budget' || Object.hasOwn(body, 'dailyBudget')) {
    fields.add('campaign.dailyBudget');
  }
  if (Object.hasOwn(body, 'userLock')) fields.add('campaign.userLock');
  if (!fields.size) {
    fail('SEARCHAD_ACTIVATION_FIELD_MAPPING_UNKNOWN', 'SearchAd update has no verified mutable field mapping.', 409);
  }
  return [...fields];
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

export class SearchAdActivationGuard {
  constructor({
    repository,
    gateway,
    credentialFingerprintResolver,
    gatewayContext,
    clock = Date.now
  } = {}) {
    if (!repository?.getAccount || !repository?.findUsableActivation || !repository?.getEvidence) {
      throw new TypeError('activation guard repository is required');
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

  async assertMutationAllowed({ customerId, descriptor } = {}) {
    const id = String(customerId || '').trim();
    if (!id) fail('SEARCHAD_CUSTOMER_ID_REQUIRED', 'customerId is required.', 400);
    if (!descriptor || typeof descriptor !== 'object' || !String(descriptor.operationKey || '').trim()) {
      fail('SEARCHAD_OPERATION_DESCRIPTOR_REQUIRED', 'SearchAd mutation descriptor with operationKey is required.', 400);
    }

    const account = await this.repository.getAccount(id);
    if (!account) fail('SEARCHAD_ACCOUNT_NOT_FOUND', 'SearchAd Customer account control state was not found.', 404);
    if (account.suspended) {
      fail('SEARCHAD_ACCOUNT_SUSPENDED', 'SearchAd Customer is suspended; new mutations are blocked.', 403);
    }

    const operationKey = String(descriptor.operationKey);
    const mutableFields = deriveMutableFields(descriptor);
    if (!operationStillVerified(this.gateway, operationKey)) {
      fail('SEARCHAD_ACTIVATION_OPERATION_UNVERIFIED', 'SearchAd operation is no longer in the verified public tier.', 403);
    }

    const nowMs = Number(this.clock());
    const grant = await this.repository.findUsableActivation({
      customerId: id,
      operationKey,
      now: new Date(nowMs)
    });
    if (!grant) {
      fail('SEARCHAD_ACTIVATION_REQUIRED', 'A current SearchAd activation grant is required.', 403);
    }
    const grantExpires = Date.parse(grant.expiresAt || '');
    if (!Number.isFinite(grantExpires) || grantExpires <= nowMs) {
      fail('SEARCHAD_ACTIVATION_EXPIRED', 'SearchAd activation grant is expired.', 403);
    }
    if (String(grant.evidenceType || '') !== 'active_canary') {
      fail('SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED', 'Normal SearchAd writes require activation backed by Active Canary evidence.', 403);
    }

    const evidence = await this.repository.getEvidence(grant.evidenceId);
    const evidenceExpires = Date.parse(evidence?.expiresAt || '');
    if (!evidence || evidence.result !== 'verified' || String(evidence.evidenceType || '') !== 'active_canary' ||
        !Number.isFinite(evidenceExpires) || evidenceExpires <= nowMs) {
      fail('SEARCHAD_ACTIVATION_EVIDENCE_INVALID', 'SearchAd activation evidence is missing, expired, or unverified.', 403);
    }

    const currentCredential = String(await this.credentialFingerprintResolver(id) || '').trim();
    const currentSpec = this.gatewayContext.specSha;
    const currentUpstream = this.gatewayContext.upstreamBaseUrl;
    const identityMatches = Boolean(
      String(grant.customerId) === id &&
      String(evidence.customerId) === id &&
      String(grant.specSha) === currentSpec &&
      String(evidence.specSha) === currentSpec &&
      String(grant.credentialFingerprint) === currentCredential &&
      String(evidence.credentialFingerprint) === currentCredential &&
      normalizeBaseUrl(grant.upstreamBaseUrl) === currentUpstream &&
      normalizeBaseUrl(evidence.upstreamBaseUrl) === currentUpstream
    );
    if (!identityMatches) {
      fail('SEARCHAD_ACTIVATION_CONTEXT_MISMATCH', 'SearchAd activation no longer matches current Customer/spec/credential/upstream context.', 403);
    }

    if (!includesAll(grant.operationKeys, [operationKey]) || !includesAll(evidence.operationKeys, [operationKey])) {
      fail('SEARCHAD_ACTIVATION_OPERATION_SCOPE_MISMATCH', 'SearchAd operation is outside the activated evidence scope.', 403);
    }
    if (!includesAll(grant.fieldScope, mutableFields) || !includesAll(evidence.fieldScope, mutableFields)) {
      fail('SEARCHAD_ACTIVATION_FIELD_SCOPE_MISMATCH', 'SearchAd mutable fields are outside the activated evidence scope.', 403);
    }

    return {
      allowed: true,
      activationId: grant.activationId,
      evidenceId: grant.evidenceId,
      customerId: id,
      operationKey,
      mutableFields
    };
  }
}

export const _internal = { deriveMutableFields, operationStillVerified, normalizeBaseUrl, includesAll };
