import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from './operations.js';

const CAMPAIGN_UPDATE = 'ncc.put.modify_using_put_5__p_ncc_campaigns_campaign_id__q_fields';
const BLOCKING_STATES = new Set(['owned', 'delete_unknown', 'manual_review']);

const TARGET_RULES = new Map([
  [CAMPAIGN_UPDATE, { objectType: 'campaign', pathKey: 'campaignId' }],
  [SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete, { objectType: 'campaign', pathKey: 'campaignId' }],
  [SEARCHAD_HIERARCHY_OPERATIONS.adgroup.delete, { objectType: 'adgroup', pathKey: 'adgroupId' }],
  [SEARCHAD_HIERARCHY_OPERATIONS.keyword.delete, { objectType: 'keyword', pathKey: 'nccKeywordId' }],
  [SEARCHAD_HIERARCHY_OPERATIONS.creative.delete, { objectType: 'creative', pathKey: 'adId' }]
]);

const NO_EXISTING_TARGET_OPERATIONS = new Set([
  SEARCHAD_HIERARCHY_OPERATIONS.campaign.create,
  SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create,
  SEARCHAD_HIERARCHY_OPERATIONS.keyword.create,
  SEARCHAD_HIERARCHY_OPERATIONS.creative.create
]);

function fail(code, message, details = {}, status = 409) {
  throw new SearchAdWriteError(code, message, details, status);
}

export function resolveSearchAdMutationTarget(descriptor = {}) {
  const operationKey = String(descriptor?.operationKey || '').trim();
  if (!operationKey) {
    fail('SEARCHAD_OWNERSHIP_TARGET_UNSUPPORTED', 'SearchAd ownership protection requires a pinned mutation operationKey.');
  }
  if (NO_EXISTING_TARGET_OPERATIONS.has(operationKey)) return null;
  const rule = TARGET_RULES.get(operationKey);
  if (!rule) {
    fail(
      'SEARCHAD_OWNERSHIP_TARGET_UNSUPPORTED',
      'SearchAd mutation target cannot be safely resolved from the pinned ownership rule set.',
      { operationKey }
    );
  }
  const remoteId = String(descriptor?.pathParams?.[rule.pathKey] || '').trim();
  if (!remoteId) {
    fail(
      'SEARCHAD_OWNERSHIP_TARGET_REQUIRED',
      'SearchAd mutation target ID is missing from the canonical pinned path parameter.',
      { operationKey, pathKey: rule.pathKey }
    );
  }
  return { objectType: rule.objectType, remoteId };
}

export class SearchAdCanaryOwnershipGuard {
  constructor({ repository } = {}) {
    if (!repository?.getOwnership) throw new TypeError('SearchAd Canary ownership repository is required');
    this.repository = repository;
  }

  async assertMutationNotCanaryOwned({ customerId, descriptor } = {}) {
    const normalizedCustomerId = String(customerId || '').trim();
    if (!normalizedCustomerId) {
      fail('SEARCHAD_CUSTOMER_ID_REQUIRED', 'SearchAd Customer ID is required for ownership protection.', {}, 400);
    }
    const target = resolveSearchAdMutationTarget(descriptor);
    if (!target) return { allowed: true, target: null, ownership: null };
    const ownership = await this.repository.getOwnership({
      customerId: normalizedCustomerId,
      objectType: target.objectType,
      remoteId: target.remoteId
    });
    if (ownership && BLOCKING_STATES.has(String(ownership.state))) {
      fail(
        'SEARCHAD_CANARY_OWNERSHIP_HELD',
        'This SearchAd object is held by a Canary workflow and cannot be mutated through the normal write path.',
        {
          customerId: normalizedCustomerId,
          objectType: target.objectType,
          remoteId: target.remoteId,
          ownerKind: ownership.ownerKind || null,
          ownershipState: ownership.state
        }
      );
    }
    return { allowed: true, target, ownership: ownership || null };
  }
}

export const _internal = {
  CAMPAIGN_UPDATE,
  TARGET_RULES,
  NO_EXISTING_TARGET_OPERATIONS,
  BLOCKING_STATES
};