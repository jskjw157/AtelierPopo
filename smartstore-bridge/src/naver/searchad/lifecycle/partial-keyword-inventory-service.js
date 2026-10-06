import { SearchAdWriteError } from '../write/errors.js';
import {
  buildPartialKeywordInventoryDescriptor,
  classifyPartialKeywordInventoryPage
} from './partial-keyword-inventory-contract.js';

const INPUT_KEYS = new Set(['customerId', 'hierarchyRunId', 'adgroupObjectId']);
const CUSTOMER_ID = /^\d{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code, message, status = 409) {
  throw new SearchAdWriteError(code, message, {}, status);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inputScope(input, context) {
  if (!record(input) || Object.keys(input).length !== INPUT_KEYS.size ||
      Object.keys(input).some(key => !INPUT_KEYS.has(key)) ||
      typeof input.customerId !== 'string' || !CUSTOMER_ID.test(input.customerId) ||
      typeof input.hierarchyRunId !== 'string' || !UUID.test(input.hierarchyRunId) ||
      typeof input.adgroupObjectId !== 'string' || !UUID.test(input.adgroupObjectId)) {
    fail(
      'SEARCHAD_PARTIAL_KEYWORD_INVENTORY_INPUT_INVALID',
      'Only explicit Customer, hierarchy run and adgroup object IDs are accepted.',
      400
    );
  }
  const principal = context?.principal;
  if (typeof principal?.principalId !== 'string' || !principal.principalId.trim() ||
      String(principal.role || '').toLowerCase() !== 'admin' ||
      !Array.isArray(principal.customerIds) || !principal.customerIds.includes(input.customerId)) {
    fail(
      'SEARCHAD_PARTIAL_KEYWORD_INVENTORY_FORBIDDEN',
      'An authenticated Admin with explicit Customer access is required.',
      403
    );
  }
  return Object.freeze({
    customerId: input.customerId,
    hierarchyRunId: input.hierarchyRunId,
    adgroupObjectId: input.adgroupObjectId
  });
}

function unresolvedObservation() {
  return Object.freeze({
    kind: 'unresolved',
    count: 0,
    remoteIds: Object.freeze([]),
    completeAbsence: false
  });
}

/**
 * Read-only inventory for a partial keyword create outcome. This service never
 * acquires or retains a mutation adapter and never maps discovered remote IDs
 * onto unresolved local keyword objects.
 */
export class PartialKeywordInventoryService {
  constructor({ repository, remote, contextResolver, clock = Date.now } = {}) {
    if (typeof repository?.loadSnapshot !== 'function' || typeof repository?.recordObservation !== 'function') {
      throw new TypeError('A partial keyword inventory repository is required');
    }
    if (typeof remote?.read !== 'function') throw new TypeError('An explicit read-only remote adapter is required');
    if (typeof contextResolver !== 'function' || typeof clock !== 'function') {
      throw new TypeError('Current context resolver and clock are required');
    }
    this.repository = repository;
    this.read = remote.read.bind(remote);
    this.contextResolver = contextResolver;
    this.clock = clock;
  }

  async assertCurrent(run) {
    let current;
    try { current = await this.contextResolver(run.customerId); }
    catch {
      fail(
        'SEARCHAD_PARTIAL_KEYWORD_INVENTORY_CONTEXT_UNAVAILABLE',
        'Current SearchAd identity is unavailable.',
        503
      );
    }
    for (const key of ['specSha', 'credentialFingerprint', 'upstreamBaseUrl']) {
      if (typeof current?.[key] !== 'string' || !current[key] || current[key] !== run[key]) {
        fail(
          'SEARCHAD_PARTIAL_KEYWORD_INVENTORY_CONTEXT_MISMATCH',
          'Current SearchAd identity does not match the persisted hierarchy run.'
        );
      }
    }
  }

  async inventory(input = {}, context = {}) {
    const scope = inputScope(input, context);
    const snapshot = await this.repository.loadSnapshot(scope);
    if (!snapshot || snapshot.run?.customerId !== scope.customerId ||
        snapshot.run?.hierarchyRunId !== scope.hierarchyRunId ||
        snapshot.adgroupObjectId !== scope.adgroupObjectId ||
        typeof snapshot.adgroupRemoteId !== 'string') {
      fail('SEARCHAD_PARTIAL_KEYWORD_INVENTORY_NOT_FOUND', 'Partial keyword inventory scope was not found.', 404);
    }

    await this.assertCurrent(snapshot.run);
    const descriptor = buildPartialKeywordInventoryDescriptor({
      customerId: scope.customerId,
      adgroupRemoteId: snapshot.adgroupRemoteId
    });

    let observation;
    try {
      const result = await this.read(descriptor);
      observation = classifyPartialKeywordInventoryPage(result, {
        customerId: scope.customerId,
        adgroupRemoteId: snapshot.adgroupRemoteId
      });
    } catch {
      observation = unresolvedObservation();
    }

    await this.assertCurrent(snapshot.run);
    const instant = new Date(this.clock());
    if (!Number.isFinite(instant.getTime())) throw new TypeError('Inventory clock returned an invalid instant');

    return this.repository.recordObservation(snapshot, {
      kind: observation.kind,
      count: observation.count,
      remoteIds: [...observation.remoteIds],
      completeAbsence: observation.completeAbsence,
      observedAt: instant.toISOString()
    });
  }
}

export const _internal = { inputScope };
