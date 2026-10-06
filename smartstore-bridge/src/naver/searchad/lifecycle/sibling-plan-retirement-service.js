import { SearchAdWriteError } from '../write/errors.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const KEYS = ['customerId','hierarchyRunId','parentObjectId','planId','kind','confirmation'];
const CONFIRM = Object.freeze({ keywords:'RETIRE_EXPIRED_UNUSED_KEYWORD_PLAN', creative:'RETIRE_EXPIRED_UNUSED_CREATIVE_PLAN' });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message, status) {
  throw new SearchAdWriteError(`SEARCHAD_SIBLING_PLAN_RETIREMENT_${code}`, message, {}, status);
}

/** Default-OFF internal, local-only action. No create/delete/approval adapter. */
export class SiblingPlanRetirementService {
  #repository; #enabled;
  constructor({ repository, enabled = false } = {}) {
    if (typeof repository?.retire !== 'function' || typeof enabled !== 'boolean') {
      throw new TypeError('A sibling retirement repository and boolean internal gate are required');
    }
    this.#repository = repository;
    this.#enabled = enabled;
  }
  async retire(input = {}, context = {}) {
    if (!this.#enabled) fail('DISABLED', 'Local sibling plan retirement is disabled.', 403);
    if (!record(input) || Object.keys(input).length !== KEYS.length || Object.keys(input).some(key => !KEYS.includes(key))) {
      fail('INPUT_INVALID', 'Only exact local scope, sibling kind and retirement confirmation are accepted.', 400);
    }
    const scope = Object.fromEntries(KEYS.map(key => [key,input[key]]));
    if (typeof scope.customerId !== 'string' || !/^\d{1,30}$/.test(scope.customerId) ||
        ['hierarchyRunId','parentObjectId','planId'].some(key => typeof scope[key] !== 'string' || !UUID.test(scope[key])) ||
        !['keywords','creative'].includes(scope.kind) || scope.confirmation !== CONFIRM[scope.kind]) {
      fail('INPUT_INVALID', 'Invalid sibling plan scope or kind-specific confirmation.', 400);
    }
    const p = context?.principal, actor = p?.principalId;
    if (!record(p) || p.role !== 'admin' || typeof actor !== 'string' || !actor || actor !== actor.trim() ||
        !Array.isArray(p.customerIds) || !p.customerIds.includes(scope.customerId)) {
      fail('FORBIDDEN', 'Authenticated Admin with explicit Customer access is required.', 403);
    }
    // Copy scalars and actor before any asynchronous access; never trust caller IDs for batch members.
    delete scope.confirmation;
    for (const key of ['hierarchyRunId','parentObjectId','planId']) scope[key] = scope[key].toLowerCase();
    return this.#repository.retire(Object.freeze({ ...scope, actorPrincipalId: actor }));
  }
}
