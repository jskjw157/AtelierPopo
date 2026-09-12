import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_APPROVAL_CONFIRMATION } from '../write/approval-service.js';
import { contentHash } from '../write/canonical.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INPUT = ['customerId', 'hierarchyRunId', 'hierarchyObjectId', 'planId', 'executionToken'];
const IDENTITY = { specSha: 'spec_sha', credentialFingerprint: 'credential_fingerprint', upstreamBaseUrl: 'upstream_base_url' };
const SCOPE = ['operation_keys_json', 'field_scope_json', 'lifecycle_kinds_json'];
const FIELDS = ['campaign.campaignTp', 'campaign.name', 'campaign.userLock', 'campaign.dailyBudget'];
function fail(code, message, status = 409) { throw new SearchAdWriteError(code, message, {}, status); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function epoch(value) { return value instanceof Date ? value.getTime() : Date.parse(value); }
function activeInterval(start, end, now) {
  return Number.isFinite(epoch(start)) && Number.isFinite(epoch(end)) && epoch(start) <= now && epoch(end) > now;
}
function exactSet(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.every(v => typeof v === 'string' && v.length > 0) &&
    new Set(a).size === a.length && new Set(b).size === b.length && a.length === b.length && a.every(v => b.includes(v));
}
function inputCopy(input, context) {
  if (!record(input) || Object.keys(input).length !== INPUT.length || Object.keys(input).some(k => !INPUT.includes(k))) {
    fail('SEARCHAD_HIERARCHY_DISPATCH_INPUT_INVALID', 'Only explicit local scope IDs and an execution token are accepted.', 400);
  }
  const copy = Object.fromEntries(INPUT.map(k => [k, input[k]]));
  if (typeof copy.customerId !== 'string' || !/^\d{1,30}$/.test(copy.customerId) ||
      ['hierarchyRunId', 'hierarchyObjectId', 'planId'].some(k => typeof copy[k] !== 'string' || !UUID.test(copy[k])) ||
      typeof copy.executionToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(copy.executionToken)) {
    fail('SEARCHAD_HIERARCHY_DISPATCH_INPUT_INVALID', 'Local IDs and token must have their exact issued types and format.', 400);
  }
  const principal = context?.principal;
  if (!record(principal) || principal.role !== 'admin' || typeof principal.principalId !== 'string' ||
      !principal.principalId.trim() || principal.principalId !== principal.principalId.trim() ||
      !Array.isArray(principal.customerIds) || !principal.customerIds.includes(copy.customerId)) {
    fail('SEARCHAD_HIERARCHY_DISPATCH_FORBIDDEN', 'An authenticated Admin with explicit Customer access is required.', 403);
  }
  // Do not retain a mutable caller object or pass a raw token to another service.
  const tokenHash = createHash('sha256').update(copy.executionToken).digest('hex');
  delete copy.executionToken;
  return Object.freeze({ ...copy, tokenHash, actorPrincipalId: principal.principalId });
}

/**
 * Internal LOCAL campaign dispatch-intent transaction. No HTTP/runtime wiring,
 * network dispatch, returned-ID settlement, ownership acquisition or PASS.
 * Existing executors do not automatically participate in this coordinator.
 */
export class PostgresCampaignDispatchRepository {
  #pool; #enabled; #recipe; #riskUnits; #capacity; #context; #clock; #registry;
  constructor({ pool, registry, enabled = false, dailyBudget, riskUnits, dailyCapacityUnits, contextResolver, clock = Date.now } = {}) {
    if (typeof pool?.query !== 'function' || typeof pool?.connect !== 'function') throw new TypeError('A PostgreSQL pool is required');
    if (typeof registry?.get !== 'function' || typeof registry?.status !== 'function') throw new TypeError('Current pinned operation registry is required');
    if (typeof enabled !== 'boolean' || typeof contextResolver !== 'function' || typeof clock !== 'function') throw new TypeError('Explicit boolean gate, synchronous identity resolver and clock are required');
    for (const value of [dailyBudget, riskUnits, dailyCapacityUnits]) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) throw new TypeError('Server budget and internal risk limits must be positive bounded integers');
    }
    if (riskUnits > dailyCapacityUnits) throw new TypeError('Risk units cannot exceed capacity');
    this.#registry = registry; this.#pool = pool; this.#enabled = enabled; this.#recipe = createHierarchyCampaignRecipe({ dailyBudget });
    this.#riskUnits = riskUnits; this.#capacity = dailyCapacityUnits; this.#context = contextResolver; this.#clock = clock;
  }

  #now() {
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) throw new TypeError('Dispatch clock must return epoch milliseconds');
    return now;
  }
  #assertIdentity(run) {
    let operation; let spec;
    try { operation = this.#registry.get(OPS.campaign.create); spec = this.#registry.status().specRef; }
    catch { fail('SEARCHAD_HIERARCHY_DISPATCH_OPERATION_UNVERIFIED', 'The current pinned campaign operation is unavailable.', 403); }
    if (spec !== run.spec_sha || operation?.operationKey !== OPS.campaign.create ||
        operation.runtimeAllowlisted !== true || operation.state !== 'public_documented' || operation.tier !== 'B' ||
        operation.method !== 'POST' || operation.path !== '/ncc/campaigns' || operation.sideEffect !== true || operation.requiredGate !== 'creates') {
      fail('SEARCHAD_HIERARCHY_DISPATCH_OPERATION_UNVERIFIED', 'Campaign creation is no longer verified in the pinned registry.', 403);
    }
    let current;
    try { current = this.#context(run.customer_id); }
    catch { fail('SEARCHAD_HIERARCHY_DISPATCH_CONTEXT_UNAVAILABLE', 'Current identity could not be resolved.', 503); }
    if (!record(current) || typeof current.then === 'function' || Object.entries(IDENTITY).some(([key, column]) =>
      typeof current[key] !== 'string' || !current[key] || current[key] !== run[column])) {
      fail('SEARCHAD_HIERARCHY_DISPATCH_CONTEXT_MISMATCH', 'Current identity does not match the persisted run.');
    }
  }
  #assertAuthority(run, grant, evidence, plan, approval, now) {
    this.#assertIdentity(run);
    if (!grant || !evidence || grant.evidence_id !== evidence.evidence_id ||
        [grant, evidence].some(r => r.customer_id !== run.customer_id || r.evidence_type !== 'active_canary' ||
          Object.values(IDENTITY).some(column => r[column] !== run[column])) || evidence.result !== 'verified' ||
        !activeInterval(grant.activated_at, grant.expires_at, now) || !activeInterval(evidence.created_at, evidence.expires_at, now) ||
        SCOPE.some(column => !exactSet(grant[column], evidence[column])) ||
        !grant.operation_keys_json.includes(OPS.campaign.create) || !grant.lifecycle_kinds_json.includes('create') ||
        FIELDS.some(field => !grant.field_scope_json.includes(field))) {
      fail('SEARCHAD_HIERARCHY_DISPATCH_ACTIVATION_REQUIRED', 'Matching current active-Canary grant and evidence with exact create scope are required.', 403);
    }
    if (!activeInterval(plan.created_at, plan.expires_at, now) ||
        !Number.isFinite(epoch(plan.approved_at)) || epoch(plan.approved_at) > now ||
        !activeInterval(approval.created_at, approval.expires_at, now)) {
      fail('SEARCHAD_HIERARCHY_DISPATCH_EXPIRED', 'Plan and approval must remain valid after all lock waits.');
    }
  }

  async claim(input = {}, context = {}) {
    if (!this.#enabled) fail('SEARCHAD_HIERARCHY_DISPATCH_DISABLED', 'Campaign dispatch preparation is disabled.', 403);
    const scope = inputCopy(input, context);
    const intentId = `hierarchy:campaign:create:${scope.planId.toLowerCase()}`;
    let client;
    try { client = await this.#pool.connect(); }
    catch { fail('SEARCHAD_HIERARCHY_DISPATCH_TRANSACTION_FAILED', 'Dispatch database connection is unavailable.', 503); }
    let commitStarted = false; let discard = false;
    try {
      await client.query('BEGIN');
      // Same lock order as reconciliation after the account lock. Hold no
      // transaction open around upstream I/O; this component performs none.
      const account = (await client.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE', [scope.customerId])).rows[0];
      if (!account || account.suspended !== false) fail('SEARCHAD_HIERARCHY_DISPATCH_SUSPENDED', 'Customer is missing or suspended.', 403);
      const run = (await client.query('SELECT * FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE', [scope.hierarchyRunId, scope.customerId])).rows[0];
      if (!run) fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy scope was not found.', 404);
      if (!['created', 'preflight_verified'].includes(run.status) || run.completed_at !== null || run.recipe_id !== this.#recipe.id) {
        fail('SEARCHAD_HIERARCHY_DISPATCH_STATE_INVALID', 'Only a fresh matching campaign run can be claimed.');
      }
      const objects = (await client.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 ORDER BY hierarchy_object_id FOR UPDATE', [run.hierarchy_run_id])).rows;
      const object = objects[0];
      if (objects.length !== 1 || object.hierarchy_object_id !== scope.hierarchyObjectId.toLowerCase() ||
          object.customer_id !== scope.customerId || object.object_type !== 'campaign' || object.parent_object_id !== null ||
          object.remote_id !== null || object.state !== 'planned' || object.deleted_at !== null ||
          object.create_operation_key !== OPS.campaign.create || object.read_operation_key !== OPS.campaign.read || object.delete_operation_key !== OPS.campaign.delete) {
        fail('SEARCHAD_HIERARCHY_DISPATCH_GRAPH_INVALID', 'Exactly one unowned planned top campaign with pinned operations is required.');
      }
      const holds = await client.query(`SELECT ownership_id FROM searchad_remote_object_ownership
        WHERE owner_run_id=$1 OR hierarchy_object_id=$2 OR parent_hierarchy_object_id=$2 ORDER BY ownership_id FOR UPDATE`,
      [run.hierarchy_run_id, object.hierarchy_object_id]);
      const children = await client.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE parent_object_id=$1 LIMIT 1', [object.hierarchy_object_id]);
      const events = await client.query('SELECT event_id FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase=$2 LIMIT 1', [run.hierarchy_run_id, 'dispatch_intent']);
      if (holds.rowCount || children.rowCount || events.rowCount) fail('SEARCHAD_HIERARCHY_DISPATCH_PRIOR_WORK', 'Existing ownership, children or dispatch intent requires separate review.');
      const plan = (await client.query('SELECT * FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE', [scope.planId, scope.customerId])).rows[0];
      if (!plan) fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Approved plan was not found.', 404);
      const descriptor = this.#recipe.createCampaign({ customerId: scope.customerId, hierarchyRunId: run.hierarchy_run_id });
      if (plan.status !== 'approved' || plan.mutation_operation_key !== OPS.campaign.create ||
          !isDeepStrictEqual(plan.mutation_json, descriptor) || !isDeepStrictEqual(plan.expected_after_json, descriptor.body) ||
          !isDeepStrictEqual(plan.before_json, {}) || plan.before_hash !== contentHash({}) ||
          !isDeepStrictEqual(plan.read_json, {}) || plan.rollback_json !== null) {
        fail('SEARCHAD_HIERARCHY_DISPATCH_PLAN_INVALID', 'Approved plan must exactly match the fresh server campaign descriptor.');
      }
      const attempts = await client.query('SELECT attempt_id FROM searchad_write_attempts WHERE plan_id=$1 AND phase=$2 LIMIT 1', [plan.plan_id, 'dispatch_intent']);
      if (attempts.rowCount) fail('SEARCHAD_HIERARCHY_DISPATCH_PRIOR_WORK', 'Plan already has a dispatch intent.');
      const approval = (await client.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1 AND token_hash=$2 FOR UPDATE', [plan.plan_id, scope.tokenHash])).rows[0];
      if (!approval || approval.used_at !== null || approval.confirmation !== SEARCHAD_APPROVAL_CONFIRMATION || !approval.actor?.trim()) {
        fail('SEARCHAD_EXECUTION_TOKEN_INVALID', 'An unused matching approval token is required.', 403);
      }
      // Grants/evidence are immutable. Read them here, never create or promote
      // evidence to make a pending operation appear authorized.
      const grant = (await client.query('SELECT * FROM searchad_activation_grants WHERE activation_id=$1', [run.activation_id])).rows[0];
      const evidence = grant ? (await client.query('SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1', [grant.evidence_id])).rows[0] : null;
      this.#assertAuthority(run, grant, evidence, plan, approval, this.#now());
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [intentId]);
      const prior = await client.query('SELECT reservation_id FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE', [intentId]);
      if (prior.rowCount) fail('SEARCHAD_HIERARCHY_DISPATCH_PRIOR_WORK', 'A risk intent cannot be reused, including released intents.');
      const riskDate = new Date(this.#now()).toISOString().slice(0, 10);
      await client.query(`INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at)
        VALUES($1,$2::date,$3,0,0,$4) ON CONFLICT(customer_id,risk_date) DO NOTHING`,
      [scope.customerId, riskDate, this.#capacity, new Date(this.#now()).toISOString()]);
      const balance = (await client.query('SELECT * FROM searchad_daily_risk_capacity WHERE customer_id=$1 AND risk_date=$2::date FOR UPDATE', [scope.customerId, riskDate])).rows[0];
      const now = this.#now(); const at = new Date(now).toISOString();
      this.#assertAuthority(run, grant, evidence, plan, approval, now);
      if (riskDate !== at.slice(0, 10)) fail('SEARCHAD_HIERARCHY_DISPATCH_DAY_CHANGED', 'UTC risk day changed during a lock wait; no claim is committed.');
      if (!balance || balance.capacity_units !== this.#capacity || balance.reserved_units + balance.consumed_units + this.#riskUnits > balance.capacity_units) {
        fail('SEARCHAD_RISK_CAPACITY_EXCEEDED', 'The established shared risk capacity cannot cover this dispatch.');
      }
      const requestFingerprint = contentHash(descriptor);
      const used = await client.query('UPDATE searchad_write_approvals SET used_at=$2 WHERE approval_id=$1 AND used_at IS NULL RETURNING approval_id', [approval.approval_id, at]);
      if (used.rowCount !== 1) fail('SEARCHAD_EXECUTION_TOKEN_USED', 'The approval has already been used.');
      await client.query('UPDATE searchad_daily_risk_capacity SET consumed_units=consumed_units+$3,updated_at=$4 WHERE customer_id=$1 AND risk_date=$2::date', [scope.customerId, riskDate, this.#riskUnits, at]);
      await client.query(`INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,
        units,state,owner_kind,owner_run_id,created_at,updated_at,consumed_at)
        VALUES($1,$2,$3,$4::date,$5,'create',$6,'consumed','hierarchy_canary',$7,$8,$8,$8)`,
      [randomUUID(), intentId, scope.customerId, riskDate, OPS.campaign.create, this.#riskUnits, run.hierarchy_run_id, at]);
      await client.query("UPDATE searchad_hierarchy_objects SET state='dispatching',updated_at=$2 WHERE hierarchy_object_id=$1", [object.hierarchy_object_id, at]);
      // Existing schema has no executing plan state. Ambiguous/pending work must
      // remain non-replayable even when no upstream response can be recorded.
      await client.query("UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1", [plan.plan_id]);
      await client.query("UPDATE searchad_hierarchy_canary_runs SET status='unknown_outcome' WHERE hierarchy_run_id=$1", [run.hierarchy_run_id]);
      const details = { planId: plan.plan_id, approvalId: approval.approval_id, intentId, requestFingerprint,
        actorPrincipalId: scope.actorPrincipalId, remoteDispatched: false, riskDate, riskUnits: this.#riskUnits };
      await client.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,request_fingerprint,request_json,created_at)
        VALUES($1,$2,'dispatch_intent','committed_pending',$3,$4::jsonb,$5)`,
      [randomUUID(), plan.plan_id, requestFingerprint, JSON.stringify({ hierarchyRunId: run.hierarchy_run_id, hierarchyObjectId: object.hierarchy_object_id, ...details }), at]);
      await client.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at)
        VALUES($1,$2,$3,$4,'dispatch_intent','committed_pending',$5,'create',$6::jsonb,$7)`,
      [randomUUID(), run.hierarchy_run_id, object.hierarchy_object_id, scope.customerId, OPS.campaign.create, JSON.stringify(details), at]);
      const finalNow = this.#now();
      this.#assertAuthority(run, grant, evidence, plan, approval, finalNow);
      if (new Date(finalNow).toISOString().slice(0, 10) !== riskDate) fail('SEARCHAD_HIERARCHY_DISPATCH_DAY_CHANGED', 'Risk day changed before commit.');
      commitStarted = true;
      await client.query('COMMIT');
      return { dispatchCommitted: true, remoteDispatched: false, hierarchyRunId: run.hierarchy_run_id,
        hierarchyObjectId: object.hierarchy_object_id, planId: plan.plan_id, intentId, requestFingerprint, descriptor };
    } catch (error) {
      if (commitStarted) {
        discard = true;
        fail('SEARCHAD_HIERARCHY_DISPATCH_COMMIT_UNKNOWN', 'Commit outcome is unknown. Do not dispatch or replay; inspect persisted state.', 503);
      }
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      if (error instanceof SearchAdWriteError) throw error;
      fail('SEARCHAD_HIERARCHY_DISPATCH_TRANSACTION_FAILED', 'Dispatch preparation failed without a confirmed commit.', 503);
    } finally { client.release(discard); }
  }
}
