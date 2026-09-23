import { SearchAdWriteError } from '../write/errors.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const KEYS = Object.freeze(['customerId', 'hierarchyRunId', 'parentObjectId', 'activationId', 'predecessorPlanId', 'confirmation']);
const CONFIRMATIONS = Object.freeze({
  keywords: 'REPLAN_EXPIRED_UNUSED_KEYWORD_PLAN',
  creative: 'REPLAN_EXPIRED_UNUSED_CREATIVE_PLAN'
});
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, message, status = 400) {
  throw new SearchAdWriteError(`SEARCHAD_SIBLING_${code}`, message, {}, status);
}

/** Local planning scope only. This confirmation never authorizes a remote write. */
export function siblingReplanScope(input, context, kind) {
  if (!Object.hasOwn(CONFIRMATIONS, kind) || !record(input) || Object.keys(input).length !== KEYS.length ||
    Object.keys(input).some(key => !KEYS.includes(key))) {
    fail('INPUT_INVALID', 'Only the exact local replacement scope is accepted.');
  }
  const copied = Object.fromEntries(KEYS.map(key => [key, input[key]]));
  if (typeof copied.customerId !== 'string' || !/^\d{1,30}$/.test(copied.customerId) ||
    KEYS.filter(key => key.endsWith('Id') && key !== 'customerId').some(key => typeof copied[key] !== 'string' || !UUID.test(copied[key])) ||
    copied.confirmation !== CONFIRMATIONS[kind]) {
    fail('INPUT_INVALID', 'Valid local identifiers and the exact kind-specific replan confirmation are required.');
  }
  const principal = context?.principal;
  if (!record(principal) || principal.role !== 'admin' || typeof principal.principalId !== 'string' ||
    !principal.principalId.trim() || principal.principalId !== principal.principalId.trim() ||
    !Array.isArray(principal.customerIds) || !principal.customerIds.includes(copied.customerId)) {
    fail('FORBIDDEN', 'Authenticated Admin with explicit Customer access is required.', 403);
  }
  delete copied.confirmation;
  for (const key of Object.keys(copied)) if (key.endsWith('Id') && key !== 'customerId') copied[key] = copied[key].toLowerCase();
  return Object.freeze({ ...copied, actorPrincipalId: principal.principalId });
}
