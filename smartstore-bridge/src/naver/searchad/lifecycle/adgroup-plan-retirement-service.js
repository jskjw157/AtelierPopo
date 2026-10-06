import { SearchAdWriteError } from '../write/errors.js';

const IDS = ['customerId', 'hierarchyRunId', 'parentObjectId', 'hierarchyObjectId', 'planId'];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function fail(code, message, status) {
  throw new SearchAdWriteError(`SEARCHAD_ADGROUP_PLAN_RETIREMENT_${code}`, message, {}, status);
}

/** Local-only, default-OFF action. Retirement is not replacement or remote absence. */
export class AdgroupPlanRetirementService {
  #repository; #enabled;
  constructor({ repository, enabled = false } = {}) {
    if (typeof repository?.retire !== 'function' || typeof enabled !== 'boolean') {
      throw new TypeError('A retirement repository and a boolean internal gate are required');
    }
    this.#repository = repository; this.#enabled = enabled;
  }
  async retire(input = {}, context = {}) {
    if (!this.#enabled) fail('DISABLED', 'Local adgroup plan retirement is disabled.', 403);
    const keys = [...IDS, 'confirmation'];
    if (!record(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(k => !keys.includes(k))) {
      fail('INPUT_INVALID', 'Only exact local identifiers and retirement confirmation are accepted.', 400);
    }
    const scope = Object.fromEntries(keys.map(k => [k, input[k]]));
    if (scope.confirmation !== 'RETIRE_EXPIRED_UNUSED_ADGROUP_PLAN' ||
        typeof scope.customerId !== 'string' || !/^\d{1,30}$/.test(scope.customerId) ||
        IDS.filter(k => k !== 'customerId').some(k => typeof scope[k] !== 'string' || !UUID.test(scope[k]))) {
      fail('INPUT_INVALID', 'Invalid local retirement scope or confirmation.', 400);
    }
    const p = context?.principal, actor = p?.principalId;
    if (!record(p) || p.role !== 'admin' || typeof actor !== 'string' || !actor || actor !== actor.trim() ||
        !Array.isArray(p.customerIds) || !p.customerIds.includes(scope.customerId)) {
      fail('FORBIDDEN', 'Authenticated Admin with explicit Customer access is required.', 403);
    }
    // Copy before the first awaited repository access; never accept a caller actor.
    delete scope.confirmation;
    for (const key of IDS) if (key !== 'customerId') scope[key] = scope[key].toLowerCase();
    return this.#repository.retire(Object.freeze({ ...scope, actorPrincipalId: actor }));
  }
}
