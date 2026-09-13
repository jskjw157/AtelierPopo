import { SearchAdError } from '../errors.js';
import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const INPUT_KEYS = new Set(['customerId', 'hierarchyRunId', 'hierarchyObjectId']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Conservative local target policy, not a statement of the upstream ID grammar.
const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const PARENT = Object.freeze({ campaign: null, adgroup: 'campaign', keyword: 'adgroup', creative: 'adgroup' });
const ID_KEY = Object.freeze({ campaign: 'nccCampaignId', adgroup: 'nccAdgroupId', keyword: 'nccKeywordId', creative: 'nccAdId' });
const PATH_KEY = Object.freeze({ campaign: 'campaignId', adgroup: 'adgroupId', keyword: 'nccKeywordId', creative: 'adId' });
export const RECONCILABLE_STATES = Object.freeze(['dispatching', 'create_unknown', 'delete_pending', 'delete_unknown', 'manual_review']);

function fail(code, message, status = 409) {
  throw new SearchAdWriteError(code, message, {}, status);
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validId(value) {
  return typeof value === 'string' && REMOTE_ID.test(value);
}
function inputScope(input, context) {
  if (!record(input) || Object.keys(input).some(key => !INPUT_KEYS.has(key)) ||
      typeof input.customerId !== 'string' || !input.customerId || input.customerId.trim() !== input.customerId ||
      typeof input.hierarchyRunId !== 'string' || !UUID.test(input.hierarchyRunId) ||
      typeof input.hierarchyObjectId !== 'string' || !UUID.test(input.hierarchyObjectId)) {
    fail('SEARCHAD_HIERARCHY_RECONCILE_INPUT_INVALID', 'Only explicit Customer, hierarchy run and object IDs are accepted.', 400);
  }
  const principal = context?.principal;
  if (typeof principal?.principalId !== 'string' || !principal.principalId.trim() ||
      String(principal.role || '').toLowerCase() !== 'admin' ||
      !Array.isArray(principal.customerIds) || !principal.customerIds.includes(input.customerId)) {
    fail('SEARCHAD_HIERARCHY_RECONCILE_FORBIDDEN', 'An authenticated Admin with explicit Customer access is required.', 403);
  }
  return { customerId: input.customerId, hierarchyRunId: input.hierarchyRunId, hierarchyObjectId: input.hierarchyObjectId };
}

/** Validate persisted relationships, not caller-supplied ownership-looking records. */
export function assertReconcileGraph(snapshot) {
  const { run, objects, ownerships, targetId } = snapshot;
  if (!run || !Array.isArray(objects) || !Array.isArray(ownerships)) {
    fail('SEARCHAD_HIERARCHY_RECONCILE_GRAPH_INVALID', 'Persisted hierarchy graph is incomplete.');
  }
  const byId = new Map(objects.map(o => [o.hierarchyObjectId, o]));
  if (byId.size !== objects.length) fail('SEARCHAD_HIERARCHY_RECONCILE_GRAPH_INVALID', 'Hierarchy graph has duplicate objects.');
  const object = byId.get(targetId);
  if (!object) fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy object was not found.', 404);
  const chain = []; const seen = new Set(); let item = object;
  while (item) {
    const operations = Object.hasOwn(OPS, item.objectType) ? OPS[item.objectType] : null;
    if (!operations || seen.has(item.hierarchyObjectId) || item.customerId !== run.customerId ||
        item.hierarchyRunId !== run.hierarchyRunId || item.createOperationKey !== operations.create ||
        item.readOperationKey !== operations.read || item.deleteOperationKey !== operations.delete) {
      fail('SEARCHAD_HIERARCHY_RECONCILE_GRAPH_INVALID', 'Hierarchy scope, operation or ancestor relationship is invalid.');
    }
    seen.add(item.hierarchyObjectId); chain.push(item);
    if (item !== object && item.state !== 'owned') {
      fail('SEARCHAD_HIERARCHY_RECONCILE_GRAPH_INVALID', 'An unresolved ancestor requires separate review.');
    }
    const missingId = item.remoteId === null || item.remoteId === undefined;
    if (!missingId && !validId(item.remoteId)) fail('SEARCHAD_HIERARCHY_RECONCILE_ID_INVALID', 'Persisted remote ID is not a safe opaque string.');
    if (!missingId) {
      const holds = ownerships.filter(o => o.hierarchyObjectId === item.hierarchyObjectId);
      const hold = holds[0];
      if (holds.length !== 1 || hold.customerId !== run.customerId || hold.objectType !== item.objectType ||
          hold.remoteId !== item.remoteId || hold.ownerKind !== 'hierarchy_canary' || hold.ownerRunId !== run.hierarchyRunId ||
          hold.parentHierarchyObjectId !== item.parentObjectId || hold.createdOperationKey !== operations.create ||
          !['owned', 'delete_unknown', 'manual_review'].includes(hold.state) || (item !== object && hold.state !== 'owned')) {
        fail('SEARCHAD_HIERARCHY_RECONCILE_OWNERSHIP_REQUIRED', 'A matching persisted hierarchy ownership hold is required.');
      }
    } else if (item !== object) {
      fail('SEARCHAD_HIERARCHY_RECONCILE_GRAPH_INVALID', 'An ancestor has no persisted returned ID.');
    }
    const parentType = PARENT[item.objectType];
    if (parentType === null) {
      if (item.parentObjectId !== null) fail('SEARCHAD_HIERARCHY_RECONCILE_GRAPH_INVALID', 'Top campaign must not have a parent.');
      break;
    }
    const parent = byId.get(item.parentObjectId);
    if (!parent || parent.objectType !== parentType) fail('SEARCHAD_HIERARCHY_RECONCILE_GRAPH_INVALID', 'Persisted parent type or scope is invalid.');
    item = parent;
  }
  if (['delete_pending', 'delete_unknown'].includes(object.state) && objects.some(o => o.parentObjectId === targetId && o.state !== 'deleted')) {
    fail('SEARCHAD_HIERARCHY_RECONCILE_LIVE_CHILDREN', 'A parent with a live child cannot be settled as deleted.');
  }
  return { object, chain };
}

function isExplicitNotFound(error) {
  return error instanceof SearchAdError && error.status === 404 && error.upstreamStatus === 404 &&
    error.retryable === false && typeof error.code === 'string' && error.code.startsWith('SEARCHAD_UPSTREAM_');
}
function matchingPresentResponse(result, object, chain) {
  if (!record(result) || Object.hasOwn(result, 'body') || Object.hasOwn(result, 'value') ||
      result.operation?.operationKey !== OPS[object.objectType].read || result.operation?.sideEffect !== false ||
      result.upstream?.status !== 200 || !record(result.data)) return false;
  const data = result.data;
  const customer = typeof data.customerId === 'string' ? data.customerId :
    Number.isSafeInteger(data.customerId) && data.customerId >= 0 ? String(data.customerId) : null;
  if (customer !== object.customerId || !validId(data[ID_KEY[object.objectType]]) || data[ID_KEY[object.objectType]] !== object.remoteId) return false;
  const expected = new Map(chain.map(o => [ID_KEY[o.objectType], o.remoteId]));
  for (const key of Object.values(ID_KEY)) {
    if (Object.hasOwn(data, key) && (!expected.has(key) || !validId(data[key]) || data[key] !== expected.get(key))) return false;
  }
  if (object.parentObjectId && data[ID_KEY[PARENT[object.objectType]]] !== chain[1]?.remoteId) return false;
  if (object.objectType === 'campaign' && data.campaignTp !== 'WEB_SITE') return false;
  if (object.objectType === 'creative' && data.type !== 'TEXT_45') return false;
  return true;
}

/** Internal, deliberately not wired to HTTP or a mutation orchestrator yet. */
export class HierarchyReconcileService {
  constructor({ repository, remote, contextResolver, clock = Date.now } = {}) {
    if (typeof repository?.loadSnapshot !== 'function' || typeof repository?.recordObservation !== 'function') throw new TypeError('A reconciliation repository is required');
    if (typeof remote?.read !== 'function') throw new TypeError('An explicit read-only remote adapter is required');
    if (typeof contextResolver !== 'function' || typeof clock !== 'function') throw new TypeError('Current context resolver and clock are required');
    this.repository = repository;
    this.read = remote.read.bind(remote); // Never retain/acquire a mutate method.
    this.contextResolver = contextResolver;
    this.clock = clock;
  }

  async assertCurrent(run) {
    let current;
    try { current = await this.contextResolver(run.customerId); }
    catch { fail('SEARCHAD_HIERARCHY_RECONCILE_CONTEXT_UNAVAILABLE', 'Current SearchAd identity is unavailable.', 503); }
    for (const key of ['specSha', 'credentialFingerprint', 'upstreamBaseUrl']) {
      if (typeof current?.[key] !== 'string' || !current[key] || current[key] !== run[key]) {
        fail('SEARCHAD_HIERARCHY_RECONCILE_CONTEXT_MISMATCH', 'Current SearchAd identity does not match the persisted run.');
      }
    }
  }

  async reconcile(input = {}, context = {}) {
    const scope = inputScope(input, context);
    const snapshot = await this.repository.loadSnapshot(scope);
    if (!snapshot || snapshot.run?.customerId !== scope.customerId || snapshot.run?.hierarchyRunId !== scope.hierarchyRunId || snapshot.targetId !== scope.hierarchyObjectId) {
      fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy object was not found.', 404);
    }
    await this.assertCurrent(snapshot.run);
    const target = snapshot.objects.find(o => o.hierarchyObjectId === scope.hierarchyObjectId);
    if (!target || target.customerId !== scope.customerId || target.hierarchyRunId !== scope.hierarchyRunId) {
      fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy object was not found.', 404);
    }
    if (!RECONCILABLE_STATES.includes(target.state)) {
      return { hierarchyRunId: scope.hierarchyRunId, hierarchyObjectId: scope.hierarchyObjectId, state: target.state, changed: false, kind: 'not_pending' };
    }
    const { object, chain } = assertReconcileGraph(snapshot);
    let kind = 'no_returned_id';
    if (object.remoteId !== null && object.remoteId !== undefined) {
      const descriptor = { operationKey: OPS[object.objectType].read, customerId: scope.customerId,
        pathParams: { [PATH_KEY[object.objectType]]: object.remoteId } };
      let result;
      try { result = await this.read(descriptor); }
      catch (error) { kind = isExplicitNotFound(error) ? 'absent' : 'unavailable'; }
      if (kind === 'no_returned_id') kind = matchingPresentResponse(result, object, chain) ? 'present' : 'mismatch';
    }
    await this.assertCurrent(snapshot.run);
    const instant = new Date(this.clock());
    if (!Number.isFinite(instant.getTime())) throw new TypeError('Reconciliation clock returned an invalid instant');
    // Neither upstream body/error/header/request-ID nor caller token is persisted.
    return this.repository.recordObservation(snapshot, { kind, observedAt: instant.toISOString() });
  }
}

export const _internal = { inputScope, validId, matchingPresentResponse, isExplicitNotFound };
