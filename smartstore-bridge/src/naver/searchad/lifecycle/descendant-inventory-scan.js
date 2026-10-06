import {
  buildDescendantInventoryDescriptor,
  classifyDescendantInventoryPage,
  DESCENDANT_INVENTORY_PAGE_SIZE
} from './descendant-inventory-contract.js';

export const DESCENDANT_SCAN_MAX_REQUESTS = 10;
const TERMINATIONS = new Set([
  'empty_page_observed', 'single_response_observed', 'request_limit',
  'repeated_id', 'invalid_page', 'read_unavailable'
]);
const SCAN_KEYS = ['requests', 'acceptedPages', 'termination', 'snapshotConsistency'];

/** Validate only traversal metadata; this never certifies snapshot consistency. */
export function validateInventoryScan(scan, count, childType) {
  if (!scan || typeof scan !== 'object' || Array.isArray(scan) ||
      Object.keys(scan).length !== SCAN_KEYS.length || Object.keys(scan).some(key => !SCAN_KEYS.includes(key)) ||
      !Number.isInteger(scan.requests) || scan.requests < 1 || scan.requests > DESCENDANT_SCAN_MAX_REQUESTS ||
      !Number.isInteger(scan.acceptedPages) || scan.acceptedPages < 0 || scan.acceptedPages > scan.requests ||
      !TERMINATIONS.has(scan.termination) || scan.snapshotConsistency !== 'unproven' ||
      !Number.isInteger(count) || count < 0 || count > scan.acceptedPages * DESCENDANT_INVENTORY_PAGE_SIZE ||
      !['adgroup', 'keyword', 'creative'].includes(childType)) throw new TypeError('Invalid inventory scan metadata');

  const failed = ['repeated_id', 'invalid_page', 'read_unavailable'].includes(scan.termination);
  if ((failed ? scan.acceptedPages !== scan.requests - 1 : scan.acceptedPages !== scan.requests) ||
      (scan.termination === 'repeated_id' && count === 0) ||
      (scan.termination === 'request_limit' && (scan.requests !== DESCENDANT_SCAN_MAX_REQUESTS || count < scan.requests)) ||
      (scan.termination === 'empty_page_observed' &&
        (count > (scan.acceptedPages - 1) * DESCENDANT_INVENTORY_PAGE_SIZE || count < scan.acceptedPages - 1)) ||
      (failed && count < scan.acceptedPages) ||
      (childType === 'creative' && (scan.requests !== 1 || !['single_response_observed', 'invalid_page', 'read_unavailable'].includes(scan.termination))) ||
      (childType !== 'creative' && scan.termination === 'single_response_observed')) throw new TypeError('Inconsistent inventory scan metadata');
  return Object.freeze({ ...scan });
}

/**
 * Internal bounded cursor walk. An empty page is an observation, not a complete
 * snapshot or deletion authority. The injected read adapter must enforce its
 * normal transport timeout; failed requests are never retried here.
 */
export async function scanDescendantInventory({ scope: input, read, assertCurrent } = {}) {
  if (typeof read !== 'function' || typeof assertCurrent !== 'function') throw new TypeError('Read and identity-check adapters are required');
  const first = buildDescendantInventoryDescriptor(input);
  const scope = Object.freeze({ ...input });
  const paged = scope.childType !== 'creative';
  const idKey = scope.childType === 'adgroup' ? 'nccAdgroupId' : scope.childType === 'keyword' ? 'nccKeywordId' : 'nccAdId';
  const ids = [], seen = new Set();
  let requests = 0, acceptedPages = 0, cursor = null;

  function finish(termination) {
    const noRowsObserved = acceptedPages > 0 && ['empty_page_observed', 'single_response_observed'].includes(termination);
    return Object.freeze({
      kind: ids.length ? 'present_remote_descendants' : noRowsObserved ? 'empty_unproven' : 'unresolved',
      count: ids.length, remoteIds: Object.freeze([...ids]), completeAbsence: false,
      scan: validateInventoryScan({ requests, acceptedPages, termination, snapshotConsistency: 'unproven' }, ids.length, scope.childType)
    });
  }

  while (requests < DESCENDANT_SCAN_MAX_REQUESTS) {
    await assertCurrent(); // Deliberately outside the remote-error catch.
    const descriptor = Object.freeze({
      operationKey: first.operationKey, customerId: first.customerId,
      query: Object.freeze({ ...first.query, ...(cursor === null ? {} : { baseSearchId: cursor, selector: 'NEXT' }) })
    });
    let result, unavailable = false;
    requests += 1;
    try { result = await read(descriptor); } catch { unavailable = true; }
    await assertCurrent();
    if (unavailable) return finish('read_unavailable');
    const page = classifyDescendantInventoryPage(result, scope);
    // A cursor is an exact opaque returned string, never a trimmed/coerced ID.
    if (page.kind === 'unresolved' || result.data.some((item, index) =>
      typeof item[idKey] !== 'string' || item[idKey] !== page.remoteIds[index])) return finish('invalid_page');
    if (page.remoteIds.some(id => seen.has(id))) return finish('repeated_id');
    acceptedPages += 1;
    for (const id of page.remoteIds) { seen.add(id); ids.push(id); }
    if (!paged) return finish('single_response_observed');
    if (page.remoteIds.length === 0) return finish('empty_page_observed');
    cursor = page.remoteIds.at(-1); // Preserve response order; never sort opaque IDs.
  }
  return finish('request_limit');
}
