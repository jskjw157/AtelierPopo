import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { contentHash } from '../write/canonical.js';
import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_APPROVAL_CONFIRMATION } from '../write/approval-service.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { campaignResponse } from './postgres-campaign-create-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { ADGROUP_CREATE_FIELDS, IDENTITY_COLUMNS, REMOTE_ID, problem, epoch, active, sameSet, assertCampaignProvenance, adgroupResponse } from './adgroup-create-contract.js';

/** Default-OFF internal service owns this coordinator. No token issuance or I/O. */
export class PostgresAdgroupCreateRepository {
  #pool; #rootRecipe; #recipe = createHierarchyChildRecipe(); #current; #gate; #clock; #ttl; #maxAge; #units; #capacity; #tickets = new WeakMap();
  constructor({ pool, dailyBudget, current, gate, clock, planTtlSeconds, preflightMaxAgeMs, riskUnits, dailyCapacityUnits }) {
    this.#pool = pool; this.#rootRecipe = createHierarchyCampaignRecipe({ dailyBudget }); this.#current = current; this.#gate = gate; this.#clock = clock;
    this.#ttl = planTtlSeconds; this.#maxAge = preflightMaxAgeMs; this.#units = riskUnits; this.#capacity = dailyCapacityUnits;
  }
  #now() {
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) problem('CLOCK', 'Invalid server clock.', 503);
    return now;
  }
  #identity(run) {
    const value = this.#current(run.customer_id);
    if (!value || typeof value.then === 'function' || Object.entries(IDENTITY_COLUMNS).some(([key, column]) => !value[key] || value[key] !== run[column])) problem('CONTEXT', 'Current identity differs from the persisted parent.');
    return value;
  }
  async #tx(work) {
    let client, committing = false, discard = false;
    try {
      client = await this.#pool.connect(); await client.query('BEGIN'); const result = await work(client);
      committing = true; await client.query('COMMIT'); return result;
    } catch (error) {
      if (committing) { discard = true; problem('COMMIT_UNKNOWN', 'Commit acknowledgement is unknown; no send permission is issued.', 503); }
      if (client) try { await client.query('ROLLBACK'); } catch { discard = true; }
      if (error instanceof SearchAdWriteError) throw error;
      problem('STORE_FAILED', 'Adgroup persistence failed; inspect without blind replay.', 503);
    } finally { if (client) client.release(discard); }
  }
  async #graph(c, s) {
    // Same prefix order as existing campaign creation/cleanup. Broad parent links
    // expose malformed foreign children instead of hiding them behind a tenant filter.
    const account = (await c.query('SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE', [s.customerId])).rows[0];
    const run = (await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1 AND customer_id=$2 FOR UPDATE', [s.hierarchyRunId, s.customerId])).rows[0];
    if (!run) problem('NOT_FOUND', 'Local parent scope was not found.', 404);
    const ids = [s.parentObjectId, s.hierarchyObjectId].filter(Boolean);
    const objects = (await c.query('SELECT *,xmin::text AS version FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 OR parent_object_id=ANY($2::uuid[]) ORDER BY hierarchy_object_id FOR UPDATE', [s.hierarchyRunId, ids])).rows;
    const holds = (await c.query('SELECT *,xmin::text AS version FROM searchad_remote_object_ownership WHERE owner_run_id=$1 OR hierarchy_object_id=ANY($2::uuid[]) OR parent_hierarchy_object_id=ANY($2::uuid[]) ORDER BY ownership_id FOR UPDATE', [s.hierarchyRunId, ids])).rows;
    const events = (await c.query('SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 ORDER BY event_id', [s.hierarchyRunId])).rows;
    const parent = objects.find(o => o.hierarchy_object_id === s.parentObjectId);
    const parentHold = holds.find(h => h.hierarchy_object_id === s.parentObjectId);
    const parentResult = events.find(e => e.hierarchy_object_id === s.parentObjectId && e.phase === 'create_result');
    const parentPlan = parentResult ? (await c.query('SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE', [parentResult.details_json?.planId, s.customerId])).rows[0] : null;
    const plan = s.planId ? (await c.query('SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=$1 AND customer_id=$2 FOR UPDATE', [s.planId, s.customerId])).rows[0] : null;
    const child = s.hierarchyObjectId ? objects.find(o => o.hierarchy_object_id === s.hierarchyObjectId) : null;
    const childHold = child ? holds.find(h => h.hierarchy_object_id === child.hierarchy_object_id) : null;
    const g = { account, run, objects, holds, events, parent, parentHold, parentPlan, child, childHold, plan };
    g.parentDescriptor = assertCampaignProvenance(g, s, this.#rootRecipe);
    if (objects.length !== (s.hierarchyObjectId ? 2 : 1) || holds.length !== (childHold ? 2 : 1)) problem('GRAPH', 'Only the verified root and one selected adgroup may be present.');
    if (s.hierarchyObjectId && (!child || child.customer_id !== s.customerId || child.hierarchy_run_id !== s.hierarchyRunId || child.parent_object_id !== s.parentObjectId || child.object_type !== 'adgroup' || child.deleted_at !== null || child.create_operation_key !== OPS.adgroup.create || child.read_operation_key !== OPS.adgroup.read || child.delete_operation_key !== OPS.adgroup.delete)) problem('GRAPH', 'Child must have the exact Customer, run, parent and operations.');
    if (child && ((child.remote_id !== null) !== Boolean(childHold) || (child.remote_id !== null && (typeof child.remote_id !== 'string' || !REMOTE_ID.test(child.remote_id))))) problem('GRAPH', 'Returned child ID and ownership hold must agree.');
    if (childHold && (childHold.customer_id !== s.customerId || childHold.object_type !== 'adgroup' || childHold.remote_id !== child.remote_id || childHold.owner_kind !== 'hierarchy_canary' || childHold.owner_run_id !== s.hierarchyRunId || childHold.parent_hierarchy_object_id !== s.parentObjectId || childHold.created_operation_key !== OPS.adgroup.create)) problem('GRAPH', 'Child ownership belongs to another scope.');
    g.descriptor = this.#recipe.createAdgroup({ customerId: s.customerId, hierarchyRunId: s.hierarchyRunId, parent: { customerId: s.customerId, hierarchyRunId: s.hierarchyRunId, objectType: 'campaign', state: 'owned', remoteId: parent.remote_id } });
    return g;
  }
  #available(g) {
    if (!g.account || g.account.suspended !== false) problem('SUSPENDED', 'Customer is unavailable or suspended.', 403);
    if (g.run.status !== 'cleanup_pending') problem('STATE', 'Parent run has unresolved work.');
    this.#identity(g.run);
  }
  async #authority(c, g, activationId, now) {
    this.#identity(g.run);
    const grant = (await c.query('SELECT * FROM searchad_activation_grants WHERE activation_id=$1', [activationId])).rows[0];
    const evidence = grant ? (await c.query('SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1', [grant.evidence_id])).rows[0] : null;
    if (!grant || !evidence || [grant, evidence].some(v => v.customer_id !== g.run.customer_id || v.evidence_type !== 'active_canary' || Object.values(IDENTITY_COLUMNS).some(k => v[k] !== g.run[k]) || !equal(v.operation_keys_json, [OPS.adgroup.create]) || !equal(v.lifecycle_kinds_json, ['create']) || !sameSet(v.field_scope_json, ADGROUP_CREATE_FIELDS)) || evidence.result !== 'verified' || !active(grant.activated_at, grant.expires_at, now) || !active(evidence.created_at, evidence.expires_at, now)) problem('AUTHORITY', 'Separate current adgroup-create-only active evidence and grant are required.', 403);
    return Math.min(epoch(grant.expires_at), epoch(evidence.expires_at));
  }
  #meta(g, s, activationId) {
    return { kind: 'haar_adgroup_create_v1', customerId: s.customerId, hierarchyRunId: s.hierarchyRunId, hierarchyObjectId: s.hierarchyObjectId, parentObjectId: s.parentObjectId, parentRemoteId: g.parent.remote_id, parentCreatePlanId: g.parentPlan.plan_id, parentAfterHash: g.parentPlan.applied_after_hash, activationId };
  }
  #binding(g, s) {
    const matches = g.events.filter(e => e.hierarchy_object_id === s.hierarchyObjectId && e.phase === 'adgroup_plan');
    const e = matches[0], p = g.plan;
    if (matches.length !== 1 || !p || e.customer_id !== s.customerId || e.operation_key !== OPS.adgroup.create || e.lifecycle_kind !== 'create' || e.status !== 'planned' || e.details_json?.planId !== s.planId) problem('PLAN', 'A server-produced adgroup plan is required.');
    const meta = this.#meta(g, s, e.details_json.activationId);
    if (p.mutation_operation_key !== OPS.adgroup.create || !equal(p.mutation_json, g.descriptor) || !equal(p.expected_after_json, g.descriptor.body) || !equal(p.read_json, {}) || p.rollback_json !== null || !equal(p.before_json, meta) || p.before_hash !== contentHash(meta) || e.details_json.beforeHash !== p.before_hash || e.details_json.requestFingerprint !== contentHash(g.descriptor)) problem('PLAN', 'Approved body and immutable parent/activation binding must match exactly.');
    return meta;
  }
  async #audit(c, s, phase, status, details, at = new Date(this.#now()).toISOString()) {
    const safe = { planId: s.planId, ...details };
    await c.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'create',$8::jsonb,$9)`, [randomUUID(),s.hierarchyRunId,s.hierarchyObjectId,s.customerId,phase,status,OPS.adgroup.create,JSON.stringify(safe),at]);
    await c.query(`INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,request_fingerprint,response_json,created_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [randomUUID(),s.planId,phase,status,details.requestFingerprint ?? null,JSON.stringify(safe),at]);
  }
  #signature(g) { return JSON.stringify([g.run.version, g.objects.map(o => [o.hierarchy_object_id,o.version]), g.holds.map(h => [h.ownership_id,h.version]), g.parentPlan.version, g.plan?.version, g.events.map(e => e.event_id)]); }
  #ticket(g, scope, stage, extra = {}) { const ticket = Object.freeze({}); this.#tickets.set(ticket, { signature: this.#signature(g), scope: structuredClone(scope), stage, ...extra }); return ticket; }
  #take(ticket, stage) { const v = this.#tickets.get(ticket); this.#tickets.delete(ticket); if (!v || v.stage !== stage) problem('TICKET', 'An unused internal stage ticket is required.'); return v; }
  #unchanged(g, v) { if (this.#signature(g) !== v.signature) problem('STALE', 'Parent or child state changed during I/O; no blind replay.'); }
  #projection(g, s) { return { customerId: s.customerId, hierarchyRunId: s.hierarchyRunId, parentObjectId: s.parentObjectId, hierarchyObjectId: s.hierarchyObjectId, planId: s.planId, state: g.child.state, remoteId: g.child.remote_id }; }
  async prepare(s) {
    return this.#tx(async c => {
      const g = await this.#graph(c, s); this.#available(g);
      const until = await this.#authority(c, g, s.activationId, this.#now());
      if (g.events.some(e => e.phase.startsWith('adgroup_'))) problem('PRIOR_PLAN', 'A prior adgroup plan cannot be replaced or repeated.');
      const scope = { ...s, hierarchyObjectId: randomUUID(), planId: randomUUID() };
      const meta = this.#meta(g, scope, s.activationId), now = this.#now(), at = new Date(now).toISOString();
      const expiresAt = new Date(Math.min(until, now + this.#ttl * 1000)).toISOString();
      await c.query(`INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at)
        VALUES($1,$2,$3,'adgroup',$4,$5,$6,$7,'planned',$8,$8)`, [scope.hierarchyObjectId,s.hierarchyRunId,s.customerId,s.parentObjectId,OPS.adgroup.create,OPS.adgroup.read,OPS.adgroup.delete,at]);
      await c.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,rollback_json,reason,status,created_by,created_at,expires_at)
        VALUES($1,$2,$3,$4::jsonb,'{}',$5::jsonb,$6,$7::jsonb,NULL,'Create one stopped adgroup under the verified server-created campaign.','planned',$8,$9,$10)`, [scope.planId,s.customerId,OPS.adgroup.create,JSON.stringify(g.descriptor),JSON.stringify(meta),contentHash(meta),JSON.stringify(g.descriptor.body),s.actorPrincipalId,at,expiresAt]);
      await this.#audit(c, scope, 'adgroup_plan', 'planned', { activationId: s.activationId, beforeHash: contentHash(meta), requestFingerprint: contentHash(g.descriptor), actorPrincipalId: s.actorPrincipalId }, at);
      await this.#authority(c, g, s.activationId, this.#now());
      if (this.#now() >= Date.parse(expiresAt)) problem('EXPIRED', 'Plan expired before commit.');
      return { customerId: s.customerId, hierarchyRunId: s.hierarchyRunId, parentObjectId: s.parentObjectId, hierarchyObjectId: scope.hierarchyObjectId, planId: scope.planId, state: 'planned', expiresAt };
    });
  }
  async #approved(c, g, s, meta) {
    this.#available(g);
    if (g.child.state !== 'planned' || g.child.remote_id !== null || g.childHold || g.plan.status !== 'approved' || g.events.some(e => e.hierarchy_object_id === s.hierarchyObjectId && e.phase === 'adgroup_dispatch_intent')) problem('REPLAY', 'Only a separately approved, unclaimed child may execute.');
    const approval = (await c.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1 AND token_hash=$2 FOR UPDATE', [s.planId,s.tokenHash])).rows[0];
    if (!approval || approval.used_at !== null || approval.confirmation !== SEARCHAD_APPROVAL_CONFIRMATION || !approval.actor?.trim()) problem('APPROVAL', 'An unused token for this exact adgroup plan is required.', 403);
    const now = this.#now(), until = await this.#authority(c, g, meta.activationId, now);
    if (!active(g.plan.created_at,g.plan.expires_at,now) || !active(approval.created_at,approval.expires_at,now) || !Number.isFinite(epoch(g.plan.approved_at)) || epoch(g.plan.approved_at) > now) problem('EXPIRED', 'Plan or approval expired.');
    return { approval, validUntil: Math.min(until,epoch(g.plan.expires_at),epoch(approval.expires_at)) };
  }
  async executionSnapshot(s) {
    return this.#tx(async c => {
      const g = await this.#graph(c, s), meta = this.#binding(g, s); await this.#approved(c,g,s,meta); this.#gate(g.descriptor);
      return { ticket: this.#ticket(g,s,'preflight',{ startedAt: this.#now() }), descriptor: { operationKey: OPS.campaign.read, customerId: s.customerId, pathParams: { campaignId: g.parent.remote_id } } };
    });
  }
  async claim(ticket, parentResponse) {
    const v = this.#take(ticket,'preflight'), s = v.scope;
    return this.#tx(async c => {
      const g = await this.#graph(c,s); this.#unchanged(g,v); const meta = this.#binding(g,s);
      if (!campaignResponse(parentResponse,g.parentDescriptor,false,g.parent.remote_id)) problem('PREFLIGHT', 'Parent was not authoritatively observed as the exact stopped campaign.');
      let a = await this.#approved(c,g,s,meta);
      const intentId = `hierarchy:adgroup:create:${s.planId}`;
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[intentId]);
      if ((await c.query('SELECT reservation_id FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE',[intentId])).rowCount) problem('REPLAY','A prior risk intent cannot be recycled.');
      const day = new Date(this.#now()).toISOString().slice(0,10);
      await c.query(`INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at)
        VALUES($1,$2::date,$3,0,0,$4) ON CONFLICT(customer_id,risk_date) DO NOTHING`,[s.customerId,day,this.#capacity,new Date(this.#now()).toISOString()]);
      const balance = (await c.query('SELECT * FROM searchad_daily_risk_capacity WHERE customer_id=$1 AND risk_date=$2::date FOR UPDATE',[s.customerId,day])).rows[0];
      a = await this.#approved(c,g,s,meta); const now = this.#now(), at = new Date(now).toISOString();
      if (at.slice(0,10) !== day || now < v.startedAt || now - v.startedAt >= this.#maxAge) problem('STALE_PREFLIGHT','Stopped parent observation expired during lock wait.');
      if (!balance || balance.capacity_units !== this.#capacity || balance.reserved_units + balance.consumed_units + this.#units > balance.capacity_units) problem('CAPACITY','Established shared risk capacity is exhausted or differs from policy.');
      const used = await c.query('UPDATE searchad_write_approvals SET used_at=$2 WHERE approval_id=$1 AND used_at IS NULL RETURNING approval_id',[a.approval.approval_id,at]);
      if (used.rowCount !== 1) problem('APPROVAL','Approval was already consumed.');
      await c.query('UPDATE searchad_daily_risk_capacity SET consumed_units=consumed_units+$3,updated_at=$4 WHERE customer_id=$1 AND risk_date=$2::date',[s.customerId,day,this.#units,at]);
      await c.query(`INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,consumed_at)
        VALUES($1,$2,$3,$4::date,$5,'create',$6,'consumed','hierarchy_canary',$7,$8,$8,$8)`,[randomUUID(),intentId,s.customerId,day,OPS.adgroup.create,this.#units,s.hierarchyRunId,at]);
      await c.query("UPDATE searchad_hierarchy_objects SET state='dispatching',updated_at=$2 WHERE hierarchy_object_id=$1",[s.hierarchyObjectId,at]);
      await c.query("UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1",[s.planId]);
      await c.query("UPDATE searchad_hierarchy_canary_runs SET status='unknown_outcome' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);
      await this.#audit(c,s,'adgroup_dispatch_intent','attempt_once',{ intentId, approvalId: a.approval.approval_id, riskDate: day, riskUnits: this.#units, actorPrincipalId: s.actorPrincipalId, requestFingerprint: contentHash(g.descriptor) },at);
      const after = await this.#graph(c,s); await this.#authority(c,g,meta.activationId,this.#now()); this.#gate(g.descriptor);
      const validUntil = Math.min(a.validUntil,v.startedAt + this.#maxAge);
      if (this.#now() >= validUntil || new Date(this.#now()).toISOString().slice(0,10) !== day) problem('EXPIRED','Authority or parent observation expired before commit.');
      return { ticket: this.#ticket(after,s,'send'), descriptor: structuredClone(g.descriptor), identity: this.#identity(g.run), riskDate: day, validUntil };
    });
  }
  async #settle(ticket,stage,work) {
    const v = this.#take(ticket,stage);
    return this.#tx(async c => { const g = await this.#graph(c,v.scope); this.#unchanged(g,v); this.#binding(g,v.scope); return work(c,g,v.scope); });
  }
  async capture(ticket,result,unavailable) {
    return this.#settle(ticket,'send',async(c,g,s) => {
      if (g.child.state !== 'dispatching' || g.childHold || g.plan.status !== 'unknown_outcome' || g.run.status !== 'unknown_outcome') problem('STATE','Child has no pending creation claim.');
      const data = unavailable ? null : adgroupResponse(result,g.descriptor,true), at = new Date(this.#now()).toISOString();
      const state = data || unavailable ? 'create_unknown' : 'manual_review';
      await c.query('UPDATE searchad_hierarchy_objects SET remote_id=$2,state=$3,updated_at=$4 WHERE hierarchy_object_id=$1',[s.hierarchyObjectId,data?.nccAdgroupId ?? null,state,at]);
      if (data) await c.query(`INSERT INTO searchad_remote_object_ownership(ownership_id,customer_id,object_type,remote_id,owner_kind,owner_run_id,hierarchy_object_id,parent_hierarchy_object_id,created_operation_key,state,created_at,updated_at)
        VALUES($1,$2,'adgroup',$3,'hierarchy_canary',$4,$5,$6,$7,'manual_review',$8,$8)`,[randomUUID(),s.customerId,data.nccAdgroupId,s.hierarchyRunId,s.hierarchyObjectId,s.parentObjectId,OPS.adgroup.create,at]);
      if (state === 'manual_review') {
        await c.query("UPDATE searchad_write_change_plans SET status='manual_review' WHERE plan_id=$1",[s.planId]);
        await c.query("UPDATE searchad_hierarchy_canary_runs SET status='manual_review' WHERE hierarchy_run_id=$1",[s.hierarchyRunId]);
      }
      await this.#audit(c,s,'adgroup_create_result',data ? 'returned_id_recorded' : unavailable ? 'outcome_unknown' : 'mismatch',{ returnedIdRecorded: Boolean(data), returnedSnapshotHash: data ? contentHash(data) : null },at);
      const after = await this.#graph(c,s);
      return { projection: this.#projection(after,s), ticket: data ? this.#ticket(after,s,'verification') : null };
    });
  }
  async verify(ticket,result,{ unavailable = false, contextMismatch = false } = {}) {
    return this.#settle(ticket,'verification',async(c,g,s) => {
      if (g.child.state !== 'create_unknown' || g.childHold?.state !== 'manual_review' || g.plan.status !== 'unknown_outcome') problem('STATE','Returned-ID verification hold changed.');
      try { this.#identity(g.run); } catch { contextMismatch = true; }
      const data = unavailable || contextMismatch ? null : adgroupResponse(result,g.descriptor,false,g.child.remote_id);
      const state = data ? 'owned' : unavailable && !contextMismatch ? 'create_unknown' : 'manual_review', at = new Date(this.#now()).toISOString();
      await c.query('UPDATE searchad_hierarchy_objects SET state=$2,updated_at=$3 WHERE hierarchy_object_id=$1',[s.hierarchyObjectId,state,at]);
      await c.query('UPDATE searchad_remote_object_ownership SET state=$2,updated_at=$3 WHERE ownership_id=$1',[g.childHold.ownership_id,data ? 'owned' : 'manual_review',at]);
      await c.query('UPDATE searchad_hierarchy_canary_runs SET status=$2 WHERE hierarchy_run_id=$1',[s.hierarchyRunId,data ? 'cleanup_pending' : state === 'manual_review' ? 'manual_review' : 'unknown_outcome']);
      if (data) await c.query("UPDATE searchad_write_change_plans SET status='applied',applied_at=$2,applied_after_json=$3::jsonb,applied_after_hash=$4 WHERE plan_id=$1",[s.planId,at,JSON.stringify(data),contentHash(data)]);
      else if (state === 'manual_review') await c.query("UPDATE searchad_write_change_plans SET status='manual_review' WHERE plan_id=$1",[s.planId]);
      await this.#audit(c,s,'adgroup_create_verification',data ? 'verified' : state === 'manual_review' ? 'mismatch' : 'unavailable',{ readOnly: true, returnedIdRecorded: true },at);
      // The audit insert awaits I/O too. Never promote owned using a credential
      // identity that changed while those final writes were in progress.
      if (data) this.#identity(g.run);
      return { ...this.#projection(g,s), state };
    });
  }
}
