import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { SearchAdWriteError } from '../write/errors.js';
import { contentHash } from '../write/canonical.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const IDENTITY = { specSha: 'spec_sha', credentialFingerprint: 'credential_fingerprint', upstreamBaseUrl: 'upstream_base_url' };
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const REASON = Object.freeze({ code: 'UNUSED_CAMPAIGN_PLAN_EXPIRED' });
const KIND = 'haar_unused_campaign_plan_retirement_v1';
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const epoch = v => v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
const validActor = v => typeof v === 'string' && v.length > 0 && v === v.trim();
function fail(suffix, message, status = 409) {
  throw new SearchAdWriteError(`SEARCHAD_CAMPAIGN_PLAN_RETIREMENT_${suffix}`, message, {}, status);
}
function projection(s, changed) {
  return Object.freeze({ customerId: s.customerId, hierarchyRunId: s.hierarchyRunId,
    hierarchyObjectId: s.hierarchyObjectId, planId: s.planId, planStatus: 'expired', runStatus: 'failed',
    changed, remoteDispatched: false, replacementCreated: false, requiresNewApproval: true });
}
function scopedEvent(e, s, phase, status, lifecycleKind) {
  return e && e.customer_id === s.customerId && e.hierarchy_run_id === s.hierarchyRunId &&
    e.hierarchy_object_id === s.hierarchyObjectId && e.phase === phase && e.status === status &&
    e.operation_key === OPS.campaign.create && e.lifecycle_kind === lifecycleKind &&
    e.request_id === null && e.error_json === null && record(e.details_json);
}
function scopedAttempt(a, s, phase, status, fingerprint, details, time) {
  return a && a.plan_id === s.planId && a.phase === phase && a.status === status &&
    a.request_fingerprint === fingerprint && equal(a.response_json, details) &&
    a.request_json === null && a.error_json === null && a.remote_request_id === null && epoch(a.created_at) === time;
}

/**
 * Terminates only an expired never-dispatched root CREATE plan. The old planned
 * object and all approvals are historical records, not deleted remote objects.
 * This class neither creates a replacement nor releases/consumes risk.
 */
export class PostgresCampaignPlanRetirementRepository {
  #pool; #recipe; #current; #clock;
  constructor({ pool, dailyBudget, current, clock = Date.now } = {}) {
    if (typeof pool?.connect !== 'function' || typeof pool?.query !== 'function' ||
        typeof current !== 'function' || typeof clock !== 'function') {
      throw new TypeError('PostgreSQL, a synchronous server identity resolver and clock are required');
    }
    this.#pool = pool; this.#recipe = createHierarchyCampaignRecipe({ dailyBudget });
    this.#current = current; this.#clock = clock;
  }
  #now() {
    const n = this.#clock();
    if (!Number.isSafeInteger(n) || !Number.isFinite(new Date(n).getTime())) fail('CLOCK_CHANGED', 'Server clock is invalid.', 503);
    return n;
  }
  #identity(run) {
    let value;
    try { value = this.#current(run.customer_id); }
    catch { fail('CONTEXT_UNAVAILABLE', 'Current SearchAd identity is unavailable.', 503); }
    if (!record(value) || typeof value.then === 'function' || Object.entries(IDENTITY).some(([key, column]) =>
      typeof value[key] !== 'string' || !value[key] || value[key] !== run[column])) {
      fail('CONTEXT_MISMATCH', 'Current SearchAd identity does not match the recorded run.');
    }
  }
  async #transaction(work) {
    let c, committing = false, discard = false;
    try {
      c = await this.#pool.connect(); await c.query('BEGIN');
      const result = await work(c);
      committing = true; await c.query('COMMIT'); return result;
    } catch (error) {
      if (committing) { discard = true; fail('COMMIT_UNKNOWN', 'Local retirement commit acknowledgement is unknown; inspect the same local scope.', 503); }
      if (c) try { await c.query('ROLLBACK'); } catch { discard = true; }
      if (error instanceof SearchAdWriteError) throw error;
      fail('STORE_FAILED', 'Local plan retirement storage failed; no replacement or send permission was issued.', 503);
    } finally { if (c) c.release(discard); }
  }

  async retire(input) {
    const keys = ['customerId', 'hierarchyRunId', 'hierarchyObjectId', 'planId', 'actorPrincipalId'];
    if (!record(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(k => !keys.includes(k))) {
      fail('INPUT_INVALID', 'An exact copied internal retirement scope is required.', 400);
    }
    const s = Object.freeze(Object.fromEntries(keys.map(k => [k, input[k]])));
    if (typeof s.customerId !== 'string' || !/^\d{1,30}$/.test(s.customerId) ||
        ['hierarchyRunId', 'hierarchyObjectId', 'planId'].some(k => typeof s[k] !== 'string' || !UUID.test(s[k])) || !validActor(s.actorPrincipalId)) {
      fail('INPUT_INVALID', 'Invalid copied retirement scope.', 400);
    }
    return this.#transaction(async c => {
      // Same account -> run -> object -> hold -> plan -> approval -> intent order
      // as the existing root producer/dispatcher. There is no upstream I/O here.
      const account = (await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE', [s.customerId])).rows[0];
      const run = (await c.query('SELECT * FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE', [s.hierarchyRunId, s.customerId])).rows[0];
      if (!account || !run) fail('NOT_FOUND', 'Exact local campaign scope was not found.', 404);
      const objects = (await c.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 OR parent_object_id=$2 ORDER BY hierarchy_object_id FOR UPDATE', [s.hierarchyRunId, s.hierarchyObjectId])).rows;
      const object = objects.find(o => o.hierarchy_object_id === s.hierarchyObjectId && o.customer_id === s.customerId && o.hierarchy_run_id === s.hierarchyRunId);
      if (!object) fail('NOT_FOUND', 'Exact local campaign scope was not found.', 404);
      if (objects.length !== 1) fail('PRIOR_WORK', 'A root with any additional or cross-scope child cannot be retired.');
      const holds = await c.query('SELECT ownership_id FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=$2 OR parent_hierarchy_object_id=$2 ORDER BY ownership_id FOR UPDATE', [s.hierarchyRunId, s.hierarchyObjectId]);
      const plan = (await c.query('SELECT * FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE', [s.planId, s.customerId])).rows[0];
      if (!plan) fail('NOT_FOUND', 'Exact local campaign plan was not found.', 404);
      if (!['created', 'failed'].includes(run.status) || !['planned', 'approved', 'expired'].includes(plan.status) ||
          object.object_type !== 'campaign' || object.parent_object_id !== null || object.remote_id !== null ||
          object.state !== 'planned' || object.deleted_at !== null ||
          plan.applied_at !== null || plan.applied_after_json !== null || plan.applied_after_hash !== null || plan.rolled_back_at !== null) {
        fail('NOT_UNUSED', 'Only a never-dispatched planned root campaign is eligible; unknown or applied work must be preserved.');
      }
      const approvals = (await c.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1 ORDER BY approval_id FOR UPDATE', [s.planId])).rows;
      const intentId = `hierarchy:campaign:create:${s.planId}`;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [intentId]);
      const risks = await c.query('SELECT reservation_id FROM searchad_risk_reservations WHERE owner_run_id=$1 OR intent_id=$2 ORDER BY reservation_id FOR UPDATE', [s.hierarchyRunId, intentId]);
      const locks = await c.query('SELECT purpose FROM searchad_write_locks WHERE plan_id=$1', [s.planId]);
      if (holds.rowCount || risks.rowCount || locks.rowCount || approvals.some(a => a.used_at !== null)) {
        fail('PRIOR_WORK', 'Ownership, any risk intent, execution lock or used approval prevents retirement.');
      }
      const events = (await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 OR hierarchy_object_id=$2 ORDER BY event_id', [s.hierarchyRunId, s.hierarchyObjectId])).rows;
      const attempts = (await c.query('SELECT * FROM searchad_write_attempts WHERE plan_id=$1 ORDER BY attempt_id', [s.planId])).rows;
      if (events.some(e => !['campaign_plan', 'campaign_plan_retired'].includes(e.phase)) ||
          attempts.some(a => !['campaign_plan', 'campaign_plan_retired'].includes(a.phase))) {
        fail('PRIOR_WORK', 'Non-planning events or attempts prevent retirement, even if no send is known.');
      }
      this.#identity(run);
      const now = this.#now(), started = epoch(run.started_at), expires = epoch(plan.expires_at);
      if (!Number.isFinite(started) || !Number.isFinite(expires) || expires <= started || now < started) fail('PROVENANCE', 'Original plan time bounds are invalid.');
      if (now < expires) fail('NOT_EXPIRED', 'The plan itself has not expired; token expiry alone is insufficient.');
      const descriptor = this.#recipe.createCampaign({ customerId: s.customerId, hierarchyRunId: s.hierarchyRunId });
      const fingerprint = contentHash(descriptor);
      const planned = events.filter(e => e.phase === 'campaign_plan');
      const planAttempts = attempts.filter(a => a.phase === 'campaign_plan');
      const plannedDetails = { planId: s.planId, actorPrincipalId: run.started_by_principal_id, requestFingerprint: fingerprint };
      if (run.recipe_id !== this.#recipe.id || !validActor(run.started_by_principal_id) ||
          plan.created_by !== run.started_by_principal_id || object.create_operation_key !== OPS.campaign.create ||
          object.read_operation_key !== OPS.campaign.read || object.delete_operation_key !== OPS.campaign.delete ||
          plan.mutation_operation_key !== OPS.campaign.create || !equal(plan.mutation_json, descriptor) ||
          !equal(plan.read_json, {}) || !equal(plan.before_json, {}) || plan.before_hash !== contentHash({}) ||
          !equal(plan.expected_after_json, descriptor.body) || plan.rollback_json !== null ||
          [plan.created_at, object.created_at, object.updated_at].some(v => epoch(v) !== started) ||
          planned.length !== 1 || !scopedEvent(planned[0], s, 'campaign_plan', 'planned', 'create') ||
          !equal(planned[0].details_json, plannedDetails) || epoch(planned[0].created_at) !== started ||
          planAttempts.length !== 1 || !scopedAttempt(planAttempts[0], s, 'campaign_plan', 'planned', fingerprint, plannedDetails, started)) {
        fail('PROVENANCE', 'The original producer descriptor, immutable planning event and planning attempt must agree.');
      }
      if (approvals.some(a => !validActor(a.actor) || a.confirmation !== 'APPROVE_SEARCHAD_CHANGE' ||
          typeof a.token_hash !== 'string' || !/^[a-f0-9]{64}$/.test(a.token_hash) ||
          !Number.isFinite(epoch(a.created_at)) || epoch(a.created_at) < started || epoch(a.created_at) > now ||
          !Number.isFinite(epoch(a.expires_at)) || epoch(a.expires_at) <= epoch(a.created_at)) ||
          (plan.approved_at === null ? approvals.length !== 0 || plan.status === 'approved' :
            plan.status === 'planned' || !approvals.some(a => epoch(a.created_at) === epoch(plan.approved_at)))) {
        fail('PROVENANCE', 'Stored approvals must remain unused and bound to the original plan history.');
      }
      const retired = events.filter(e => e.phase === 'campaign_plan_retired');
      const retirementAttempts = attempts.filter(a => a.phase === 'campaign_plan_retired');
      if (retired.length || retirementAttempts.length || run.status === 'failed') {
        const event = retired[0], details = event?.details_json;
        const expected = { kind: KIND, planId: s.planId, requestFingerprint: fingerprint,
          actorPrincipalId: details?.actorPrincipalId, expiredAt: new Date(expires).toISOString(),
          priorStatus: details?.priorStatus, remoteDispatched: false, replacementCreated: false, requiresNewApproval: true };
        const retiredAt = epoch(event?.created_at);
        if (retired.length !== 1 || retirementAttempts.length !== 1 || run.status !== 'failed' || plan.status !== 'expired' ||
            !equal(run.last_error_json, REASON) || !equal(plan.last_error_json, REASON) ||
            !scopedEvent(event, s, 'campaign_plan_retired', 'expired_unused', null) || !equal(details, expected) ||
            !validActor(details?.actorPrincipalId) || !['planned', 'approved', 'expired'].includes(details?.priorStatus) ||
            !Number.isFinite(retiredAt) || retiredAt < expires || retiredAt > now || epoch(run.completed_at) !== retiredAt ||
            !scopedAttempt(retirementAttempts[0], s, 'campaign_plan_retired', 'expired_unused', fingerprint, expected, retiredAt)) {
          fail('PROVENANCE', 'Already-retired status is trusted only with its exact local retirement audit proof.');
        }
        this.#identity(run);
        if (this.#now() < now) fail('CLOCK_CHANGED', 'Server clock moved backwards during retirement.');
        return projection(s, false);
      }
      if (run.status !== 'created' || run.completed_at !== null || run.last_error_json !== null || plan.last_error_json !== null) {
        fail('NOT_UNUSED', 'Only an unchanged fresh local run can be terminated without remote reconciliation.');
      }
      const at = new Date(now).toISOString();
      const details = { kind: KIND, planId: s.planId, requestFingerprint: fingerprint,
        actorPrincipalId: s.actorPrincipalId, expiredAt: new Date(expires).toISOString(), priorStatus: plan.status,
        remoteDispatched: false, replacementCreated: false, requiresNewApproval: true };
      await c.query("UPDATE searchad_write_change_plans SET status='expired',last_error_json=$2::jsonb WHERE plan_id=$1", [s.planId, JSON.stringify(REASON)]);
      await c.query("UPDATE searchad_hierarchy_canary_runs SET status='failed',completed_at=$2,last_error_json=$3::jsonb WHERE hierarchy_run_id=$1", [s.hierarchyRunId, at, JSON.stringify(REASON)]);
      await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at)
        VALUES($1,$2,$3,$4,'campaign_plan_retired','expired_unused',$5,NULL,$6::jsonb,$7)`, [randomUUID(), s.hierarchyRunId, s.hierarchyObjectId, s.customerId, OPS.campaign.create, JSON.stringify(details), at]);
      await c.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,request_fingerprint,response_json,created_at)
        VALUES($1,$2,'campaign_plan_retired','expired_unused',$3,$4::jsonb,$5)`, [randomUUID(), s.planId, fingerprint, JSON.stringify(details), at]);
      this.#identity(run);
      const finalNow = this.#now();
      if (finalNow < now || finalNow < expires) fail('CLOCK_CHANGED', 'Server clock moved backwards during retirement.');
      return projection(s, true);
    });
  }
}
