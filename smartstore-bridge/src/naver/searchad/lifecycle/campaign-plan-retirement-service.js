import { SearchAdWriteError } from '../write/errors.js';

export const CAMPAIGN_PLAN_RETIREMENT_CONFIRMATION = 'RETIRE_EXPIRED_UNUSED_CAMPAIGN_PLAN';
const KEYS = ['customerId', 'hierarchyRunId', 'hierarchyObjectId', 'planId', 'confirmation'];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(suffix, message, status) {
  throw new SearchAdWriteError(`SEARCHAD_CAMPAIGN_PLAN_RETIREMENT_${suffix}`, message, {}, status);
}

/** Internal, default-disabled LOCAL retirement only. No transport or token issuer. */
export class CampaignPlanRetirementService {
  #repository; #enabled;
  constructor({ repository, enabled = false } = {}) {
    if (typeof repository?.retire !== 'function' || typeof enabled !== 'boolean') {
      throw new TypeError('A retirement repository and an explicit boolean gate are required');
    }
    this.#repository = repository;
    this.#enabled = enabled;
  }

  async retire(input = {}, context = {}) {
    if (!this.#enabled) fail('DISABLED', 'Local campaign plan retirement is disabled.', 403);
    if (!record(input) || Object.keys(input).length !== KEYS.length || Object.keys(input).some(k => !KEYS.includes(k))) {
      fail('INPUT_INVALID', 'Only exact local scope and the retirement confirmation are accepted.', 400);
    }
    const s = Object.fromEntries(KEYS.map(k => [k, input[k]]));
    if (typeof s.customerId !== 'string' || !/^\d{1,30}$/.test(s.customerId) ||
        ['hierarchyRunId', 'hierarchyObjectId', 'planId'].some(k => typeof s[k] !== 'string' || !UUID.test(s[k])) ||
        s.confirmation !== CAMPAIGN_PLAN_RETIREMENT_CONFIRMATION) {
      fail('INPUT_INVALID', 'Exact Customer, local UUIDs and retirement confirmation are required.', 400);
    }
    const p = context?.principal;
    if (!record(p) || p.role !== 'admin' || typeof p.principalId !== 'string' || !p.principalId.trim() ||
        p.principalId !== p.principalId.trim() || !Array.isArray(p.customerIds) || !p.customerIds.includes(s.customerId)) {
      fail('FORBIDDEN', 'Authenticated Admin with explicit Customer access is required.', 403);
    }
    // Copy actor and target before the repository's first awaited connection.
    return this.#repository.retire(Object.freeze({
      customerId: s.customerId,
      hierarchyRunId: s.hierarchyRunId.toLowerCase(),
      hierarchyObjectId: s.hierarchyObjectId.toLowerCase(),
      planId: s.planId.toLowerCase(),
      actorPrincipalId: p.principalId
    }));
  }
}
