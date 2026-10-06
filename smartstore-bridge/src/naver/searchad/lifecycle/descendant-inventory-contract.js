import { REMOTE_ID, record } from './sibling-create-contract.js';

export const DESCENDANT_INVENTORY_OPERATIONS = Object.freeze({
  campaignAdgroup: 'ncc.get.get_groups_using_get_2__p_ncc_adgroups__q_base_search_id_ncc_campaign_id_record_size_selector',
  adgroupKeyword: 'ncc.get.get_by_adgroup_id_using_get_1__p_ncc_keywords__q_base_search_id_ncc_adgroup_id_record_size_selector',
  adgroupCreative: 'ncc.get.get_by_adgroup_id_using_get__p_ncc_ads__q_ncc_adgroup_id'
});

export const DESCENDANT_INVENTORY_PAGE_SIZE = 1000;

const CUSTOMER_ID = /^\d{1,30}$/;
const INPUT_KEYS = Object.freeze(['customerId', 'parentType', 'parentRemoteId', 'childType']);

const RELATIONS = Object.freeze({
  'campaign:adgroup': Object.freeze({
    operationKey: DESCENDANT_INVENTORY_OPERATIONS.campaignAdgroup,
    parentQueryKey: 'nccCampaignId',
    parentResponseKey: 'nccCampaignId',
    childResponseKey: 'nccAdgroupId',
    paged: true
  }),
  'adgroup:keyword': Object.freeze({
    operationKey: DESCENDANT_INVENTORY_OPERATIONS.adgroupKeyword,
    parentQueryKey: 'nccAdgroupId',
    parentResponseKey: 'nccAdgroupId',
    childResponseKey: 'nccKeywordId',
    paged: true
  }),
  'adgroup:creative': Object.freeze({
    operationKey: DESCENDANT_INVENTORY_OPERATIONS.adgroupCreative,
    parentQueryKey: 'nccAdgroupId',
    parentResponseKey: 'nccAdgroupId',
    childResponseKey: 'nccAdId',
    paged: false
  })
});

function unresolved() {
  return Object.freeze({
    kind: 'unresolved',
    count: 0,
    remoteIds: Object.freeze([]),
    completeAbsence: false
  });
}

function exactScope(input) {
  if (!record(input)) return null;
  const keys = Object.keys(input);
  if (keys.length !== INPUT_KEYS.length || keys.some(key => !INPUT_KEYS.includes(key))) return null;
  if (typeof input.customerId !== 'string' || !CUSTOMER_ID.test(input.customerId)) return null;
  if (typeof input.parentRemoteId !== 'string' || !REMOTE_ID.test(input.parentRemoteId)) return null;
  if (typeof input.parentType !== 'string' || typeof input.childType !== 'string') return null;

  const relation = RELATIONS[`${input.parentType}:${input.childType}`];
  if (!relation) return null;

  return Object.freeze({
    customerId: input.customerId,
    parentType: input.parentType,
    parentRemoteId: input.parentRemoteId,
    childType: input.childType,
    relation
  });
}

export function buildDescendantInventoryDescriptor(input) {
  const scope = exactScope(input);
  if (!scope) {
    throw Object.assign(new Error('Exact descendant inventory scope is required.'), {
      code: 'SEARCHAD_DESCENDANT_INVENTORY_INPUT_INVALID',
      status: 400
    });
  }

  const query = {
    [scope.relation.parentQueryKey]: scope.parentRemoteId
  };
  if (scope.relation.paged) query.recordSize = DESCENDANT_INVENTORY_PAGE_SIZE;

  return Object.freeze({
    operationKey: scope.relation.operationKey,
    customerId: scope.customerId,
    query: Object.freeze(query)
  });
}

/**
 * Read-only remote descendant classifier.
 *
 * This contract proves presence only. It deliberately does not treat an empty
 * list as complete remote absence, does not map remote descendants onto local
 * unresolved objects, does not create ownership and does not grant cleanup
 * authority.
 */
export function classifyDescendantInventoryPage(result, scopeInput) {
  const scope = exactScope(scopeInput);
  if (
    !scope ||
    !record(result) ||
    Object.hasOwn(result, 'body') ||
    Object.hasOwn(result, 'value') ||
    result.operation?.operationKey !== scope.relation.operationKey ||
    result.operation?.sideEffect !== false ||
    result.upstream?.status !== 200 ||
    !Array.isArray(result.data) ||
    result.data.length > DESCENDANT_INVENTORY_PAGE_SIZE
  ) {
    return unresolved();
  }

  const remoteIds = [];
  const seen = new Set();

  for (const item of result.data) {
    if (!record(item)) return unresolved();
    if (String(item.customerId ?? '') !== scope.customerId) return unresolved();
    if (item[scope.relation.parentResponseKey] !== scope.parentRemoteId) return unresolved();

    const remoteId = String(item[scope.relation.childResponseKey] ?? '').trim();
    if (!REMOTE_ID.test(remoteId) || seen.has(remoteId)) return unresolved();

    seen.add(remoteId);
    remoteIds.push(remoteId);
  }

  if (remoteIds.length === 0) {
    return Object.freeze({
      kind: 'empty_unproven',
      count: 0,
      remoteIds: Object.freeze([]),
      completeAbsence: false
    });
  }

  return Object.freeze({
    kind: 'present_remote_descendants',
    count: remoteIds.length,
    remoteIds: Object.freeze(remoteIds),
    completeAbsence: false
  });
}

export const _internal = Object.freeze({ exactScope, RELATIONS });
