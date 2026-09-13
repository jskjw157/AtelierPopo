import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { fail, record } from './postgres-campaign-create-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

export const ADGROUP_CREATE_FIELDS = Object.freeze(['adgroup.nccCampaignId', 'adgroup.name', 'adgroup.userLock']);
export const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
export const IDENTITY_COLUMNS = Object.freeze({ specSha: 'spec_sha', credentialFingerprint: 'credential_fingerprint', upstreamBaseUrl: 'upstream_base_url' });
export const problem = (code, message, status = 409) => fail(`SEARCHAD_ADGROUP_CREATE_${code}`, message, status);
export const epoch = value => value instanceof Date ? value.getTime() : Date.parse(value);
export const active = (start, end, now) => Number.isFinite(epoch(start)) && epoch(start) <= now && Number.isFinite(epoch(end)) && epoch(end) > now;
export const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && new Set(a).size === a.length && b.every(v => a.includes(v));

export function adgroupScope(input, context, execute = false) {
  const keys = ['customerId', 'hierarchyRunId', 'parentObjectId', ...(execute ? ['hierarchyObjectId', 'planId', 'executionToken'] : ['activationId'])];
  if (!record(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(k => !keys.includes(k))) problem('INPUT', 'Only exact local identifiers and the issued token are accepted.', 400);
  const scope = Object.fromEntries(keys.map(k => [k, input[k]]));
  if (typeof scope.customerId !== 'string' || !/^\d{1,30}$/.test(scope.customerId) || keys.filter(k => k.endsWith('Id') && k !== 'customerId').some(k => typeof scope[k] !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(scope[k]))) problem('INPUT', 'Invalid local scope identifiers.', 400);
  const principal = context?.principal;
  if (!record(principal) || principal.role !== 'admin' || typeof principal.principalId !== 'string' || !principal.principalId.trim() || principal.principalId !== principal.principalId.trim() || !Array.isArray(principal.customerIds) || !principal.customerIds.includes(scope.customerId)) problem('FORBIDDEN', 'Authenticated Admin with explicit Customer access is required.', 403);
  if (execute) {
    if (typeof scope.executionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(scope.executionToken)) problem('INPUT', 'Invalid execution token.', 400);
    scope.tokenHash = createHash('sha256').update(scope.executionToken).digest('hex');
    delete scope.executionToken;
  }
  for (const key of keys) if (key.endsWith('Id') && key !== 'customerId') scope[key] = scope[key].toLowerCase();
  return Object.freeze({ ...scope, actorPrincipalId: principal.principalId });
}

// A root ID or ownership row alone is not evidence that this service created it.
export function assertCampaignProvenance(g, scope, recipe) {
  const { parent: p, parentHold: h, parentPlan: plan, run } = g;
  if (!p || !h || p.customer_id !== scope.customerId || p.hierarchy_run_id !== scope.hierarchyRunId || p.object_type !== 'campaign' || p.parent_object_id !== null || p.state !== 'owned' || p.deleted_at !== null || typeof p.remote_id !== 'string' || !REMOTE_ID.test(p.remote_id) ||
      p.create_operation_key !== OPS.campaign.create || p.read_operation_key !== OPS.campaign.read || p.delete_operation_key !== OPS.campaign.delete ||
      h.customer_id !== scope.customerId || h.object_type !== 'campaign' || h.remote_id !== p.remote_id || h.owner_kind !== 'hierarchy_canary' || h.owner_run_id !== scope.hierarchyRunId || h.hierarchy_object_id !== scope.parentObjectId || h.parent_hierarchy_object_id !== null || h.created_operation_key !== OPS.campaign.create || h.state !== 'owned' || run.recipe_id !== recipe.id || run.completed_at !== null) problem('PARENT', 'A matching owned server-created campaign and hold are required.');
  const descriptor = recipe.createCampaign({ customerId: scope.customerId, hierarchyRunId: scope.hierarchyRunId });
  const snapshot = { customerId: scope.customerId, nccCampaignId: p.remote_id, ...descriptor.body };
  if (!plan || plan.status !== 'applied' || plan.customer_id !== scope.customerId || plan.mutation_operation_key !== OPS.campaign.create || !equal(plan.mutation_json, descriptor) || !equal(plan.expected_after_json, descriptor.body) || !equal(plan.applied_after_json, snapshot) || plan.applied_after_hash !== contentHash(snapshot)) problem('PROVENANCE', 'Parent ID must match its verified creation snapshot and hash.');
  for (const [phase, status] of [['create_result', 'returned_id_recorded'], ['create_verification', 'verified']]) {
    const events = g.events.filter(e => e.hierarchy_object_id === scope.parentObjectId && e.phase === phase);
    if (events.length !== 1 || events.some(e => e.customer_id !== scope.customerId || e.operation_key !== OPS.campaign.create || e.lifecycle_kind !== 'create' || e.status !== status || e.details_json?.planId !== plan.plan_id || e.details_json?.returnedIdRecorded !== true)) problem('PROVENANCE', 'Matching immutable parent creation and verification events are required.');
  }
  if (g.events.some(e => e.hierarchy_object_id === scope.parentObjectId && e.phase.startsWith('cleanup_'))) problem('PARENT_CLEANUP', 'Parent cleanup planning has begun; child creation is forbidden.');
  return descriptor;
}

// A bounded recipe response projection, not a general-purpose Adgroup parser.
export function adgroupResponse(result, descriptor, create, remoteId = null) {
  if (!record(result) || Object.hasOwn(result, 'body') || Object.hasOwn(result, 'value') || result.operation?.operationKey !== (create ? OPS.adgroup.create : OPS.adgroup.read) || result.operation?.sideEffect !== create || !(create ? [200, 201] : [200]).includes(result.upstream?.status) || !record(result.data)) return null;
  const data = result.data;
  const customerId = typeof data.customerId === 'string' ? data.customerId : Number.isSafeInteger(data.customerId) && data.customerId >= 0 ? String(data.customerId) : null;
  if (customerId !== descriptor.customerId || typeof data.nccAdgroupId !== 'string' || !REMOTE_ID.test(data.nccAdgroupId) || (remoteId !== null && data.nccAdgroupId !== remoteId) || ['nccKeywordId', 'nccAdId'].some(k => Object.hasOwn(data, k)) || Object.entries(descriptor.body).some(([k, v]) => !Object.hasOwn(data, k) || data[k] !== v)) return null;
  return Object.freeze({ customerId, nccAdgroupId: data.nccAdgroupId, ...descriptor.body });
}
