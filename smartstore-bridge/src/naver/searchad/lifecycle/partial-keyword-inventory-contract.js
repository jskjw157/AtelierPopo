import { REMOTE_ID, record } from './sibling-create-contract.js';

export const PARTIAL_KEYWORD_INVENTORY_OPERATION =
  'ncc.get.get_by_adgroup_id_using_get_1__p_ncc_keywords__q_base_search_id_ncc_adgroup_id_record_size_selector';
export const PARTIAL_KEYWORD_INVENTORY_PAGE_SIZE = 1000;

const CUSTOMER_ID = /^\d{1,30}$/;
const INPUT_KEYS = Object.freeze(['customerId', 'adgroupRemoteId']);

function unresolved() {
  return Object.freeze({
    kind: 'unresolved',
    count: 0,
    remoteIds: Object.freeze([]),
    completeAbsence: false
  });
}

function exactScope(scope) {
  if (!record(scope)) return null;
  const keys = Object.keys(scope);
  if (keys.length !== INPUT_KEYS.length || keys.some(key => !INPUT_KEYS.includes(key))) return null;
  if (typeof scope.customerId !== 'string' || !CUSTOMER_ID.test(scope.customerId)) return null;
  if (typeof scope.adgroupRemoteId !== 'string' || !REMOTE_ID.test(scope.adgroupRemoteId)) return null;
  return Object.freeze({ customerId: scope.customerId, adgroupRemoteId: scope.adgroupRemoteId });
}

export function buildPartialKeywordInventoryDescriptor(input) {
  const scope = exactScope(input);
  if (!scope) {
    throw Object.assign(new Error('Exact partial keyword inventory scope is required.'), {
      code: 'SEARCHAD_PARTIAL_KEYWORD_INVENTORY_INPUT_INVALID',
      status: 400
    });
  }
  return Object.freeze({
    operationKey: PARTIAL_KEYWORD_INVENTORY_OPERATION,
    customerId: scope.customerId,
    query: Object.freeze({
      nccAdgroupId: scope.adgroupRemoteId,
      recordSize: PARTIAL_KEYWORD_INVENTORY_PAGE_SIZE
    })
  });
}

/**
 * The official adgroup keyword listing endpoint is documented as a partial list.
 * This classifier can establish presence only. Even an empty page is never
 * promoted to complete remote absence and never binds a remote result to an
 * unresolved local keyword object.
 */
export function classifyPartialKeywordInventoryPage(result, scopeInput) {
  const scope = exactScope(scopeInput);
  if (!scope || !record(result) || Object.hasOwn(result, 'body') || Object.hasOwn(result, 'value')) return unresolved();
  if (
    result.operation?.operationKey !== PARTIAL_KEYWORD_INVENTORY_OPERATION ||
    result.operation?.sideEffect !== false ||
    result.upstream?.status !== 200 ||
    !Array.isArray(result.data) ||
    result.data.length > PARTIAL_KEYWORD_INVENTORY_PAGE_SIZE
  ) return unresolved();

  const remoteIds = [];
  const seen = new Set();
  for (const item of result.data) {
    if (!record(item)) return unresolved();
    if (String(item.customerId ?? '') !== scope.customerId) return unresolved();
    if (item.nccAdgroupId !== scope.adgroupRemoteId) return unresolved();
    const remoteId = String(item.nccKeywordId ?? '').trim();
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
