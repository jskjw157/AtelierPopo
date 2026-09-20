import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { SearchAdWriteError } from '../write/errors.js';
import { contentHash } from '../write/canonical.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { assertCampaignProvenance, IDENTITY_COLUMNS } from './adgroup-create-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const REASON = Object.freeze({ code: 'UNUSED_ADGROUP_PLAN_EXPIRED' });
const KIND = 'haar_unused_adgroup_plan_retirement_v1';
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const epoch = v => v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
const actor = v => typeof v === 'string' && v.length > 0 && v === v.trim();
const uuid = v => typeof v === 'string' && UUID.test(v);
function fail(code, message, status = 409) {
  throw new SearchAdWriteError(`SEARCHAD_ADGROUP_PLAN_RETIREMENT_${code}`, message, {}, status);
}
function projection(s, changed) {
  return Object.freeze({ customerId: s.customerId, hierarchyRunId: s.hierarchyRunId,
    parentObjectId: s.parentObjectId, hierarchyObjectId: s.hierarchyObjectId, planId: s.planId,
    planStatus: 'expired', runStatus: 'cleanup_pending', changed, targetRemoteDispatched: false,
    runTerminated: false, replacementCreated: false, requiresNewApproval: true,
    replanningSupported: false, cleanupAuthority: false });
}
function eventMatches(e, s, phase, status, lifecycle, details, at) {
  return e && e.customer_id === s.customerId && e.hierarchy_run_id === s.hierarchyRunId &&
    e.hierarchy_object_id === s.hierarchyObjectId && e.phase === phase && e.status === status &&
    e.operation_key === OPS.adgroup.create && e.lifecycle_kind === lifecycle &&
    e.request_id === null && e.error_json === null && equal(e.details_json, details) && epoch(e.created_at) === at;
}
function attemptMatches(a, s, phase, status, fingerprint, details, at) {
  return a && a.plan_id === s.planId && a.phase === phase && a.status === status &&
    a.request_fingerprint === fingerprint && equal(a.response_json, details) &&
    a.request_json === null && a.error_json === null && a.remote_request_id === null && epoch(a.created_at) === at;
}

/**
 * Expires only a never-dispatched child plan. The owned parent, planned child,
 * live run, consumed parent risk and historical approvals remain unchanged.
 * No transport, replacement generation, deletion inference or risk refund.
 */
export class PostgresAdgroupPlanRetirementRepository {
  #pool; #rootRecipe; #childRecipe = createHierarchyChildRecipe(); #current; #clock;
  constructor({ pool, dailyBudget, current, clock = Date.now } = {}) {
    if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function' || typeof current !== 'function' || typeof clock !== 'function') {
      throw new TypeError('PostgreSQL and synchronous server identity/clock resolvers are required');
    }
    this.#pool = pool; this.#rootRecipe = createHierarchyCampaignRecipe({ dailyBudget });
    this.#current = current; this.#clock = clock;
  }
  #now() {
    const value = this.#clock();
    if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) fail('CLOCK_CHANGED', 'Server clock is invalid.', 503);
    return value;
  }
  #identity(run) {
    let value;
    try { value = this.#current(run.customer_id); }
    catch { fail('CONTEXT_UNAVAILABLE', 'Current SearchAd identity is unavailable.', 503); }
    if (!record(value) || typeof value.then === 'function' || Object.entries(IDENTITY_COLUMNS).some(([key, column]) =>
      typeof value[key] !== 'string' || !value[key] || value[key] !== run[column])) {
      fail('CONTEXT_MISMATCH', 'Current identity differs from the persisted parent run.');
    }
  }
  async #transaction(work) {
    let c, committing = false, discard = false;
    try {
      c = await this.#pool.connect(); await c.query('BEGIN');
      const result = await work(c); committing = true; await c.query('COMMIT'); return result;
    } catch (error) {
      if (committing) { discard = true; fail('COMMIT_UNKNOWN', 'Local retirement commit acknowledgement is unknown; inspect the same local scope.', 503); }
      if (c) try { await c.query('ROLLBACK'); } catch { discard = true; }
      if (error instanceof SearchAdWriteError) throw error;
      fail('STORE_FAILED', 'Local retirement storage failed; no replacement or send permission was issued.', 503);
    } finally { if (c) c.release(discard); }
  }
  async retire(input) {
    const keys = ['customerId','hierarchyRunId','parentObjectId','hierarchyObjectId','planId','actorPrincipalId'];
    if (!record(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(k => !keys.includes(k))) fail('INPUT_INVALID', 'An exact copied internal retirement scope is required.', 400);
    const s = Object.freeze(Object.fromEntries(keys.map(k => [k,input[k]])));
    if (typeof s.customerId !== 'string' || !/^\d{1,30}$/.test(s.customerId) ||
        ['hierarchyRunId','parentObjectId','hierarchyObjectId','planId'].some(k => !uuid(s[k])) || !actor(s.actorPrincipalId)) fail('INPUT_INVALID', 'Invalid copied retirement scope.', 400);
    return this.#transaction(async c => {
      // Same lock prefix as the existing adgroup producer: account -> run ->
      // objects -> holds -> parent plan -> child plan -> approvals -> intent.
      const account = (await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE', [s.customerId])).rows[0];
      const run = (await c.query('SELECT * FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE', [s.hierarchyRunId,s.customerId])).rows[0];
      if (!account || !run) fail('NOT_FOUND', 'Exact local parent/child scope was not found.', 404);
      const ids = [s.parentObjectId,s.hierarchyObjectId];
      const objects = (await c.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 OR parent_object_id=ANY($2::uuid[]) ORDER BY hierarchy_object_id FOR UPDATE', [s.hierarchyRunId,ids])).rows;
      const parent = objects.find(o => o.hierarchy_object_id === s.parentObjectId && o.customer_id === s.customerId && o.hierarchy_run_id === s.hierarchyRunId);
      const child = objects.find(o => o.hierarchy_object_id === s.hierarchyObjectId && o.customer_id === s.customerId && o.hierarchy_run_id === s.hierarchyRunId);
      if (!parent || !child) fail('NOT_FOUND', 'Exact local parent/child scope was not found.', 404);
      if (objects.length !== 2 || parent === child) fail('PRIOR_WORK', 'Only one root and its selected unused child are eligible; extra or foreign links are not ignored.');
      const holds = (await c.query('SELECT * FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) OR parent_hierarchy_object_id=ANY($2::uuid[]) ORDER BY ownership_id FOR UPDATE', [s.hierarchyRunId,ids])).rows;
      const events = (await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) ORDER BY event_id', [s.hierarchyRunId,ids])).rows;
      if (events.some(e => e.customer_id !== s.customerId || e.hierarchy_run_id !== s.hierarchyRunId)) fail('PRIOR_WORK', 'Cross-scope linked audit history is not ignored.');
      const rootResult = events.find(e => e.hierarchy_object_id === s.parentObjectId && e.phase === 'create_result');
      if (!uuid(rootResult?.details_json?.planId)) fail('PARENT_PROVENANCE', 'Original parent creation plan is required.');
      const parentPlan = (await c.query('SELECT * FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE', [rootResult.details_json.planId,s.customerId])).rows[0];
      const plan = (await c.query('SELECT * FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE', [s.planId,s.customerId])).rows[0];
      if (!plan) fail('NOT_FOUND', 'Exact local child plan was not found.', 404);
      if (run.status !== 'cleanup_pending' || run.completed_at !== null || run.last_error_json !== null ||
          child.object_type !== 'adgroup' || child.parent_object_id !== s.parentObjectId || child.state !== 'planned' || child.remote_id !== null || child.deleted_at !== null ||
          !['planned','approved','expired'].includes(plan.status) || plan.applied_at !== null || plan.applied_after_json !== null || plan.applied_after_hash !== null || plan.rolled_back_at !== null) {
        fail('NOT_UNUSED', 'Only a never-dispatched child plan in its still-live parent run is eligible.');
      }
      const parentHold = holds.find(h => h.hierarchy_object_id === s.parentObjectId);
      if (holds.length !== 1) fail('PRIOR_WORK', 'Unexpected ownership or a returned child hold prevents retirement.');
      try { assertCampaignProvenance({ parent, parentHold, parentPlan, run, events }, s, this.#rootRecipe); }
      catch { fail('PARENT_PROVENANCE', 'Parent must retain its exact owned creation snapshot and immutable provenance.'); }
      this.#identity(run);
      const approvals = (await c.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1 ORDER BY approval_id FOR UPDATE', [s.planId])).rows;
      if (approvals.some(a => a.used_at !== null)) fail('PRIOR_WORK', 'A used child approval is prior work, even without a known send.');
      const locks = await c.query('SELECT plan_id FROM searchad_write_locks WHERE plan_id=$1 FOR UPDATE', [s.planId]);
      const intentId = `hierarchy:adgroup:create:${s.planId}`, parentIntent = `hierarchy:campaign:create:${parentPlan.plan_id}`;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [intentId]);
      const risks = (await c.query('SELECT * FROM searchad_risk_reservations WHERE owner_run_id=$1 OR intent_id=ANY($2::text[]) ORDER BY reservation_id FOR UPDATE', [s.hierarchyRunId,[intentId,parentIntent]])).rows;
      // Do not reject/refund the already-created parent's legitimate consumed risk.
      if (locks.rowCount || risks.length !== 1 || risks.some(r => r.intent_id !== parentIntent || r.customer_id !== s.customerId ||
          r.operation_key !== OPS.campaign.create || r.lifecycle_kind !== 'create' || r.owner_kind !== 'hierarchy_canary' || r.owner_run_id !== s.hierarchyRunId ||
          r.state !== 'consumed' || !Number.isSafeInteger(r.units) || r.units <= 0 || !Number.isFinite(epoch(r.consumed_at)))) {
        fail('PRIOR_WORK', 'Child risk/locks or inconsistent parent risk prevent retirement; even released child intents are not unused.');
      }
      const childEvents = events.filter(e => e.hierarchy_object_id === s.hierarchyObjectId);
      const attempts = (await c.query('SELECT * FROM searchad_write_attempts WHERE plan_id=$1 ORDER BY attempt_id', [s.planId])).rows;
      if (childEvents.some(e => !['adgroup_plan','adgroup_plan_retired'].includes(e.phase)) || attempts.some(a => !['adgroup_plan','adgroup_plan_retired'].includes(a.phase))) fail('PRIOR_WORK', 'Non-planning child history prevents retirement.');
      const now = this.#now(), started = epoch(plan.created_at), expires = epoch(plan.expires_at);
      if (!Number.isFinite(started) || !Number.isFinite(expires) || expires <= started || now < started ||
          !Number.isFinite(epoch(parentPlan.applied_at)) || epoch(parentPlan.applied_at) > started || epoch(run.started_at) > started) fail('PROVENANCE', 'Original parent/child plan time bounds are invalid.');
      if (now < expires) fail('NOT_EXPIRED', 'The child plan itself has not expired; approval expiry alone is insufficient.');
      const planned = childEvents.filter(e => e.phase === 'adgroup_plan'), planningAttempts = attempts.filter(a => a.phase === 'adgroup_plan');
      const activationId = planned[0]?.details_json?.activationId;
      if (!uuid(activationId)) fail('PROVENANCE', 'Original child activation binding is required.');
      const descriptor = this.#childRecipe.createAdgroup({ customerId: s.customerId, hierarchyRunId: s.hierarchyRunId,
        parent: { customerId: s.customerId, hierarchyRunId: s.hierarchyRunId, objectType: 'campaign', state: 'owned', remoteId: parent.remote_id } });
      const fingerprint = contentHash(descriptor);
      const meta = { kind: 'haar_adgroup_create_v1', customerId: s.customerId, hierarchyRunId: s.hierarchyRunId,
        hierarchyObjectId: s.hierarchyObjectId, parentObjectId: s.parentObjectId, parentRemoteId: parent.remote_id,
        parentCreatePlanId: parentPlan.plan_id, parentAfterHash: parentPlan.applied_after_hash, activationId };
      const beforeHash = contentHash(meta);
      const planningDetails = { planId: s.planId, activationId, beforeHash, requestFingerprint: fingerprint, actorPrincipalId: plan.created_by };
      if (!actor(plan.created_by) || child.create_operation_key !== OPS.adgroup.create || child.read_operation_key !== OPS.adgroup.read || child.delete_operation_key !== OPS.adgroup.delete ||
          plan.mutation_operation_key !== OPS.adgroup.create || !equal(plan.mutation_json, descriptor) || !equal(plan.expected_after_json, descriptor.body) ||
          !equal(plan.before_json, meta) || plan.before_hash !== beforeHash || !equal(plan.read_json, {}) || plan.rollback_json !== null ||
          [child.created_at,child.updated_at].some(v => epoch(v) !== started) || planned.length !== 1 || planningAttempts.length !== 1 ||
          !eventMatches(planned[0],s,'adgroup_plan','planned','create',planningDetails,started) ||
          !attemptMatches(planningAttempts[0],s,'adgroup_plan','planned',fingerprint,planningDetails,started)) {
        fail('PROVENANCE', 'Exact original parent metadata, child descriptor and immutable planning event/attempt must agree.');
      }
      if (approvals.some(a => !actor(a.actor) || a.confirmation !== 'APPROVE_SEARCHAD_CHANGE' || typeof a.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(a.token_hash) ||
          !Number.isFinite(epoch(a.created_at)) || epoch(a.created_at) < started || epoch(a.created_at) > now || !Number.isFinite(epoch(a.expires_at)) || epoch(a.expires_at) <= epoch(a.created_at)) ||
          (plan.approved_at === null ? approvals.length !== 0 || plan.status === 'approved' : plan.status === 'planned' || !approvals.some(a => epoch(a.created_at) === epoch(plan.approved_at)))) {
        fail('PROVENANCE', 'Stored unused approvals must agree with the original child plan history.');
      }
      const retired = childEvents.filter(e => e.phase === 'adgroup_plan_retired'), retirementAttempts = attempts.filter(a => a.phase === 'adgroup_plan_retired');
      const detailsFor = (principalId, priorStatus) => ({ kind: KIND, planId: s.planId, parentObjectId: s.parentObjectId,
        parentCreatePlanId: parentPlan.plan_id, beforeHash, requestFingerprint: fingerprint, actorPrincipalId: principalId,
        expiredAt: new Date(expires).toISOString(), priorStatus, targetRemoteDispatched: false, runTerminated: false,
        replacementCreated: false, requiresNewApproval: true, cleanupAuthority: false });
      if (retired.length || retirementAttempts.length) {
        const event = retired[0], details = event?.details_json, at = epoch(event?.created_at);
        const expected = detailsFor(details?.actorPrincipalId, details?.priorStatus);
        if (retired.length !== 1 || retirementAttempts.length !== 1 || plan.status !== 'expired' || !equal(plan.last_error_json,REASON) ||
            !actor(details?.actorPrincipalId) || !['planned','approved','expired'].includes(details?.priorStatus) || !Number.isFinite(at) || at < expires || at > now ||
            !eventMatches(event,s,'adgroup_plan_retired','expired_unused',null,expected,at) ||
            !attemptMatches(retirementAttempts[0],s,'adgroup_plan_retired','expired_unused',fingerprint,expected,at)) fail('PROVENANCE', 'Idempotent success requires the exact existing local retirement audit proof.');
        this.#identity(run); if (this.#now() < now) fail('CLOCK_CHANGED', 'Server clock moved backwards during retirement.');
        return projection(s,false);
      }
      if (plan.last_error_json !== null) fail('PROVENANCE', 'An unexplained child plan error cannot be cleared by retirement.');
      const at = new Date(now).toISOString(), details = detailsFor(s.actorPrincipalId,plan.status);
      await c.query("UPDATE searchad_write_change_plans SET status='expired',last_error_json=$2::jsonb WHERE plan_id=$1", [s.planId,JSON.stringify(REASON)]);
      await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at)
        VALUES($1,$2,$3,$4,'adgroup_plan_retired','expired_unused',$5,NULL,$6::jsonb,$7)`, [randomUUID(),s.hierarchyRunId,s.hierarchyObjectId,s.customerId,OPS.adgroup.create,JSON.stringify(details),at]);
      await c.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,request_fingerprint,response_json,created_at)
        VALUES($1,$2,'adgroup_plan_retired','expired_unused',$3,$4::jsonb,$5)`, [randomUUID(),s.planId,fingerprint,JSON.stringify(details),at]);
      this.#identity(run);
      if (this.#now() < now) fail('CLOCK_CHANGED', 'Server clock moved backwards during retirement.');
      return projection(s,true);
    });
  }
}
