import { randomUUID } from 'node:crypto';
import { SearchAdWriteError } from '../write/errors.js';

export function circuitError(code = 'UNAVAILABLE', status = 503, reasons = []) {
  return new SearchAdWriteError(`SEARCHAD_CIRCUIT_${code}`, 'SearchAd Circuit authorization is unavailable or denied.', { reasons }, status);
}
const SOURCE_SQL = {
  ordered_write: `SELECT o.outcome_id::text AS source_id,o.outcome AS status,'ordered' AS phase,o.occurred_at AS created_at,c.plan_id::text AS owner_id,p.mutation_json AS descriptor,p.mutation_operation_key AS operation_key,
    c.plan_id::text AS logical_id,c.rule_id::text AS rule_id,c.ordinal::text,o.version FROM searchad_write_execution_outcomes o JOIN searchad_write_execution_claims c USING(customer_id,ordinal) JOIN searchad_write_change_plans p USING(plan_id) WHERE o.customer_id=$1`,
  write: `SELECT a.attempt_id::text AS source_id,a.phase,a.status,a.created_at,p.plan_id::text AS owner_id,p.mutation_json AS descriptor,p.mutation_operation_key AS operation_key,p.before_json,
    EXISTS(SELECT 1 FROM searchad_write_execution_claims claim WHERE claim.plan_id=p.plan_id) AS protocol_claim,
    NULL::text AS object_id,p.plan_id::text AS logical_id,(SELECT ar.rule_id::text FROM searchad_automation_runs ar WHERE ar.customer_id=p.customer_id AND ar.plan_id=p.plan_id) AS rule_id FROM searchad_write_attempts a JOIN searchad_write_change_plans p USING(plan_id)
    WHERE p.customer_id=$1 AND a.phase<>'plan' AND NOT EXISTS(SELECT 1 FROM searchad_write_execution_outcomes o WHERE o.source_attempt_id=a.attempt_id) AND NOT EXISTS(SELECT 1 FROM searchad_hierarchy_events h WHERE h.customer_id=$1 AND h.details_json->>'planId'=p.plan_id::text)`,
  canary: `SELECT e.event_id::text AS source_id,e.phase,e.status,e.created_at,e.canary_run_id::text AS owner_id,'{}'::jsonb AS descriptor,e.operation_key,'{}'::jsonb AS before_json,
    r.remote_id AS object_id,e.canary_run_id::text||':'||e.phase AS logical_id FROM searchad_canary_events e JOIN searchad_canary_runs r USING(canary_run_id) WHERE e.customer_id=$1`,
  hierarchy: `SELECT e.event_id::text AS source_id,e.phase,e.status,e.created_at,e.hierarchy_run_id::text AS owner_id,COALESCE(p.mutation_json,'{}'::jsonb) AS descriptor,e.operation_key,'{}'::jsonb AS before_json,
    e.hierarchy_object_id::text AS object_id,COALESCE(e.details_json->>'planId',e.hierarchy_object_id::text||':'||COALESCE(e.lifecycle_kind,'read'),e.event_id::text) AS logical_id
    FROM searchad_hierarchy_events e LEFT JOIN searchad_write_change_plans p ON p.plan_id::text=e.details_json->>'planId' AND p.customer_id=e.customer_id WHERE e.customer_id=$1`
};
function sourceEvent(kind, row) {
  let outcome = 'neutral'; const phase = row.phase, status = row.status;
  if (['unknown_outcome','rollback_unknown_outcome','cleanup_unknown_outcome','outcome_unknown','unavailable','response_mismatch','mismatch','partial_ids_recorded','unverified'].includes(status) || (/verify|verification/.test(phase) && status === 'failed')) outcome = 'unknown';
  else if (['failed','rollback_failed','not_applied'].includes(status)) outcome = 'failed';
  else if (['succeeded','verified','deleted_verified','applied','applied_reconciled'].includes(status)) outcome = 'succeeded';
  else if (status === 'stale') outcome = 'manual_drift';
  if (kind === 'hierarchy') {
    if (phase === 'tree_cleanup_result' && status === 'unknown') outcome = 'unknown';
    if (phase === 'tree_cleanup_observation') outcome = status === 'absent' ? 'succeeded' : 'unknown';
    if (phase === 'cleanup_observation') outcome = status === 'deleted' ? 'succeeded' : 'unknown';
  }
  if (kind === 'write' && ['plan','read'].includes(phase)) outcome = 'neutral';
  if (kind === 'ordered_write' && status === 'unknown') outcome = 'unknown';
  if (kind === 'canary' && ['preflight','baseline_spend','spend_verify'].includes(phase)) outcome = 'neutral';
  const logicalKey = `${kind}:${row.logical_id}${kind === 'write' ? ':' + (phase.startsWith('rollback') ? 'rollback' : 'execute') : ''}`;
  const entity = Object.entries(row.descriptor?.pathParams || {})[0];
  return { logicalKey, outcome, occurredAt: new Date(row.created_at).getTime(), entityType: entity?.[0]?.replace(/^ncc/, '').replace(/Id$/, '').toLowerCase() || 'campaign', entityId: entity?.[1] || row.object_id || row.owner_id, operationKey: row.operation_key, ownerId: row.owner_id, ...(row.rule_id ? { ruleId: row.rule_id } : {}), ...(kind==='write' && row.protocol_claim ? {counterEligible:false} : {}), ...(kind === 'ordered_write' ? { ordinal: row.ordinal, version: row.version, outcomeId: row.source_id, primaryOutcome: status } : {}) };
}
// Preserve immutable old projections while interpreting their primary source
// with current known semantics. In particular, 0012 labelled not_applied success.
const LEGACY_SOURCE_COLUMNS = `
  (SELECT a.phase FROM searchad_write_attempts a WHERE c.source_kind='write' AND a.attempt_id::text=c.source_id) AS legacy_phase,
  (SELECT a.status FROM searchad_write_attempts a WHERE c.source_kind='write' AND a.attempt_id::text=c.source_id) AS legacy_status,
  EXISTS(SELECT 1 FROM searchad_write_attempts a JOIN searchad_write_execution_claims claim USING(plan_id) WHERE c.source_kind='write' AND a.attempt_id::text=c.source_id) AS protocol_claim,
  EXISTS(SELECT 1 FROM searchad_write_attempts a JOIN searchad_write_change_plans p USING(plan_id)
    WHERE c.source_kind='write' AND a.attempt_id::text=c.source_id AND p.customer_id=c.customer_id
    AND a.phase='reconcile' AND a.status='not_applied' AND p.status='not_applied') AS proved_not_applied`;
function projectedEvent(row) {
  const event={...row.event_json,eventId:row.event_id,provedNotApplied:row.proved_not_applied===true};
  if(!event.ordinal){
    event.entityType=event.entityType?.replace(/^ncc/,'').toLowerCase();
    if(row.legacy_status==='not_applied')event.outcome='failed';
    if(['plan','read'].includes(row.legacy_phase))event.outcome='neutral';
    if(row.protocol_claim)event.counterEligible=false;
  }
  return event;
}
/** Resolve the exact logical terminal before applying any failure exemption.
 * Proved not_applied is known but unsuccessful. An arbitrary failed event cannot
 * clear unknown, and an older unknown cannot reappear after terminal recovery. */
function reduceLegacyEvents(events) {
  const logical = new Map();
  for (const event of events) {
    if (!['failed','unknown','succeeded'].includes(event.outcome)) continue;
    const prior = logical.get(event.logicalKey);
    if (!prior || event.provedNotApplied || (!prior.provedNotApplied &&
        (event.outcome === 'succeeded' || (prior.outcome !== 'succeeded' && event.outcome === 'unknown')))) {
      logical.set(event.logicalKey, event);
    }
  }
  return logical;
}
/** All mutable primary outcome writers use account-first transactions. Projection
 * takes the same lock. Final fence reads never mutate these ledgers. */
export class PostgresCircuitRepository {
  constructor({ pool }) { this.pool = pool; }
  async transaction(customerId, task) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const account = await client.query('SELECT customer_id FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE', [customerId]);
      if (account.rows.length !== 1) throw circuitError();
      const result = await task(client); await client.query('COMMIT'); return result;
    } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }
  sources() { return Object.keys(SOURCE_SQL).map(kind => ({ kind, unprojected: ({ customerId }) => this.unprojected({ customerId, kind }) })); }
  async unprojected({ customerId, kind, client = this.pool }) {
    const result = await client.query(`SELECT s.* FROM (${SOURCE_SQL[kind]}) s WHERE NOT EXISTS(SELECT 1 FROM searchad_circuit_events c WHERE c.customer_id=$1 AND c.source_kind=$2 AND c.source_id=s.source_id) ORDER BY s.created_at,s.source_id`, [customerId, kind]);
    return result.rows.map(row => ({ sourceId: row.source_id, event: sourceEvent(kind, row) }));
  }
  async hasBacklog({ customerId, client = this.pool }) {
    for (const kind of Object.keys(SOURCE_SQL)) if ((await this.unprojected({ customerId, kind, client })).length) return true;
    return false;
  }
  async projectOnce({ customerId, sourceKind, sourceId, event, now }) {
    return this.transaction(customerId, async client => {
      const result = await client.query('INSERT INTO searchad_circuit_events(customer_id,source_kind,source_id,event_json,projected_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(customer_id,source_kind,source_id) DO NOTHING RETURNING event_id', [customerId, sourceKind, sourceId, JSON.stringify(event), new Date(now).toISOString()]);
      if (!result.rowCount) return false;
      await client.query('INSERT INTO searchad_circuit_projection_cursors(customer_id,source_kind,last_source_id,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(customer_id,source_kind) DO UPDATE SET last_source_id=EXCLUDED.last_source_id,updated_at=EXCLUDED.updated_at', [customerId, sourceKind, sourceId, new Date(now).toISOString()]);
      return true;
    });
  }
  async getPolicy({ customerId, client = this.pool }) { return (await client.query('SELECT policy_json FROM searchad_circuit_policies WHERE customer_id=$1', [customerId])).rows[0]?.policy_json || {}; }
  async getState({ customerId, entityType, entityId, client = this.pool }) {
    const row = (await client.query('SELECT manual_paused,reason FROM searchad_circuit_state WHERE customer_id=$1', [customerId])).rows[0];
    const events = (await client.query(`SELECT event_json,event_id::text,${LEGACY_SOURCE_COLUMNS} FROM searchad_circuit_events c WHERE c.customer_id=$1
      AND NOT(c.source_kind='write' AND EXISTS(SELECT 1 FROM searchad_write_attempts a JOIN searchad_write_change_plans p USING(plan_id)
        WHERE a.attempt_id::text=c.source_id AND p.customer_id=c.customer_id AND (a.phase='plan' OR EXISTS(SELECT 1 FROM searchad_write_execution_outcomes o WHERE o.source_attempt_id=a.attempt_id)))) ORDER BY c.event_id`, [customerId])).rows.map(projectedEvent);
    const rules=(await client.query('SELECT rule_id::text,entity_type,entity_id FROM searchad_automation_rules WHERE customer_id=$1',[customerId])).rows;
    const policyRules=(await client.query('SELECT policy_id::text,rule_id::text FROM searchad_automation_policies WHERE customer_id=$1',[customerId])).rows;
    for(const event of events) if(!event.ordinal){
      const mapped=policyRules.find(row=>row.policy_id===event.ruleId)?.rule_id || rules.find(row=>row.entity_type===event.entityType && row.entity_id===event.entityId)?.rule_id;
      if(mapped)event.ruleId=mapped;
    }
    const logical = reduceLegacyEvents(events.filter(event => !event.ordinal)); const state = { manualPaused: row?.manual_paused === true, reason: row?.reason || null, unknownCount: 0, counterBasis: 'unresolved_logical_failure_upper_bound', consecutiveFailures: {}, orderedConsecutiveFailures: {}, legacyFailures: {}, changedAt: null, manualChangedAt: null, dailyLossNetKrw: null };
    const ordered = new Map();
    const recovered = (await client.query('SELECT selected_json FROM searchad_circuit_failure_recoveries WHERE customer_id=$1', [customerId])).rows;
    const recoveredOutcomes = new Set(recovered.flatMap(row => row.selected_json?.outcomeIds || []));
    const recoveredLegacy = new Set(recovered.flatMap(row => row.selected_json?.legacyEventIds || []));
    for (const event of events) {
      if (event.ordinal) { const prior = ordered.get(event.ordinal); if (!prior || event.version > prior.version) ordered.set(event.ordinal,event); continue; }
      if (event.outcome === 'manual_drift' && event.entityType === entityType && event.entityId === entityId) state.manualChangedAt = Math.max(state.manualChangedAt || 0, event.occurredAt);
    }
    for (const event of logical.values()) {
      if (event.outcome === 'unknown') state.unknownCount++;
      // Upper bound without a causal send sequence: unrelated success cannot
      // reset late/backdated failures. Only exact logical verification resolves.
      if (event.counterEligible!==false && event.ruleId && event.outcome !== 'succeeded' && !recoveredLegacy.has(event.eventId)) state.legacyFailures[event.ruleId] = (state.legacyFailures[event.ruleId] || 0) + 1;
      if (event.outcome === 'succeeded' && event.entityType === entityType && event.entityId === entityId) state.changedAt = Math.max(state.changedAt || 0, event.occurredAt);
    }
    for (const event of [...ordered.values()].sort((a,b) => BigInt(a.ordinal) < BigInt(b.ordinal) ? -1 : 1)) {
      if (event.outcome === 'unknown') state.unknownCount++;
      if (event.outcome === 'succeeded') {
        state.orderedConsecutiveFailures[event.ruleId] = 0;
        if (event.entityType === entityType && event.entityId === entityId) state.changedAt = Math.max(state.changedAt || 0,event.occurredAt);
      } else if (!recoveredOutcomes.has(event.outcomeId)) state.orderedConsecutiveFailures[event.ruleId] = (state.orderedConsecutiveFailures[event.ruleId] || 0) + 1;
    }
    for (const key of new Set([...Object.keys(state.legacyFailures),...Object.keys(state.orderedConsecutiveFailures)])) state.consecutiveFailures[key] = (state.legacyFailures[key] || 0) + (state.orderedConsecutiveFailures[key] || 0);
    if (ordered.size) state.counterBasis = 'accepted_attempt_ordinals_plus_conservative_legacy';
    return state;
  }
  async unresolved({ customerId, owner = {}, dispatch = {}, client = this.pool }) {
    const pending=(await client.query(`SELECT c.ordinal FROM searchad_write_execution_claims c LEFT JOIN LATERAL(SELECT outcome FROM searchad_write_execution_outcomes o WHERE o.customer_id=c.customer_id AND o.ordinal=c.ordinal ORDER BY version DESC LIMIT 1) terminal ON true
      WHERE c.customer_id=$1 AND c.plan_id::text<>COALESCE($2,'') AND (terminal.outcome IS NULL OR terminal.outcome='unknown') LIMIT 1`,[customerId,owner.planId || null])).rows;
    if(pending.length)return true;
    const target = dispatch.entityId || null;
    const plans = await client.query(`SELECT p.plan_id FROM searchad_write_change_plans p WHERE p.customer_id=$1 AND p.plan_id::text<>COALESCE($2,'')
      AND NOT EXISTS(SELECT 1 FROM searchad_hierarchy_events h WHERE h.customer_id=$1 AND h.details_json->>'planId'=p.plan_id::text)
      AND ((EXISTS(SELECT 1 FROM searchad_write_attempts intent WHERE intent.plan_id=p.plan_id AND intent.phase='rollback' AND intent.status='send_intent')
        AND NOT EXISTS(SELECT 1 FROM searchad_write_attempts terminal WHERE terminal.plan_id=p.plan_id AND ((terminal.phase='rollback' AND terminal.status IN('rollback_failed','rollback_unknown_outcome')) OR (terminal.phase='rollback_verify' AND terminal.status IN('succeeded','failed')))))
      OR (p.status='approved' AND EXISTS(SELECT 1 FROM searchad_write_approvals a WHERE a.plan_id=p.plan_id AND a.used_at IS NOT NULL))
      OR (p.status IN('applied','applied_reconciled','not_applied','rolled_back','failed')
        AND EXISTS(SELECT 1 FROM searchad_write_approvals a WHERE a.plan_id=p.plan_id AND a.used_at IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM searchad_write_attempts a WHERE a.plan_id=p.plan_id AND
          ((p.status='applied' AND a.phase='verify' AND a.status='succeeded')
          OR (p.status IN('applied_reconciled','not_applied') AND a.phase='reconcile' AND a.status=p.status)
          OR (p.status='rolled_back' AND a.phase='rollback_verify' AND a.status='succeeded')
          OR (p.status='failed' AND a.phase='execute' AND a.status='failed'))))
      OR (p.status IN('unknown_outcome','verification_failed','manual_review','rollback_unknown_outcome','rollback_verification_failed') AND
        (NOT EXISTS(SELECT 1 FROM searchad_write_attempts a WHERE a.plan_id=p.plan_id AND ((p.status='unknown_outcome' AND a.phase='execute' AND a.status='unknown_outcome') OR (p.status='verification_failed' AND a.phase='verify' AND a.status='failed') OR (p.status='manual_review' AND a.phase='reconcile' AND a.status='manual_review') OR (p.status='rollback_unknown_outcome' AND ((a.phase='rollback' AND a.status='rollback_unknown_outcome') OR (a.phase='rollback_verify' AND a.status='failed'))) OR (p.status='rollback_verification_failed' AND a.phase='rollback_verify' AND a.status='failed')))
        OR COALESCE(p.mutation_json->'pathParams','{}'::jsonb)='{}'::jsonb
        OR EXISTS(SELECT 1 FROM jsonb_each_text(COALESCE(p.mutation_json->'pathParams','{}'::jsonb)) param WHERE param.value=$3)))) LIMIT 1`, [customerId, owner.planId || null, target]);
    if (plans.rows.length) return true;
    const canary = await client.query(`SELECT canary_run_id FROM searchad_canary_runs WHERE customer_id=$1
      AND ((status NOT IN('passed','failed','blocked','expired','spend_detected','unknown_outcome','cleanup_unknown_outcome','cleanup_required') AND canary_run_id::text<>COALESCE($2,''))
      OR (status IN('unknown_outcome','cleanup_unknown_outcome','cleanup_required') AND (remote_id IS NULL OR remote_id=$3))) LIMIT 1`, [customerId, owner.canaryRunId || null, target]);
    if (canary.rows.length) return true;
    // A transport receipt is not post-change verification. Missing a phase-linked
    // primary terminal event remains in-flight, including state/event commit gaps.
    const intents = await client.query(`SELECT e.event_id FROM searchad_canary_events e WHERE e.customer_id=$1 AND e.status='send_intent'
      AND NOT(e.canary_run_id::text=COALESCE($2,'') AND e.phase=COALESCE($3,''))
      AND NOT EXISTS(SELECT 1 FROM searchad_canary_events settled WHERE settled.canary_run_id=e.canary_run_id AND settled.phase=e.phase AND settled.status IN('verified','deleted_verified','failed','unknown_outcome','cleanup_unknown_outcome')) LIMIT 1`, [customerId,owner.canaryRunId || null,owner.phase || null]);
    if (intents.rows.length) return true;
    const hierarchyIntents = await client.query(`SELECT intent.event_id FROM searchad_hierarchy_events intent WHERE intent.customer_id=$1
      AND intent.phase IN('dispatch_intent','transport_intent','adgroup_dispatch_intent','sibling_dispatch_intent','cleanup_dispatch_intent','tree_cleanup_intent')
      AND COALESCE(intent.details_json->>'planId','')<>COALESCE($2,'no-owned-plan')
      AND NOT EXISTS(SELECT 1 FROM searchad_hierarchy_events terminal WHERE terminal.customer_id=$1
        AND terminal.details_json->>'planId'=intent.details_json->>'planId'
        AND terminal.phase IN('create_result','create_verification','adgroup_create_result','adgroup_create_verification','sibling_create_result','sibling_create_verification','cleanup_result','cleanup_observation','tree_cleanup_result','tree_cleanup_observation')
        AND terminal.status IN('outcome_unknown','response_mismatch','mismatch','unavailable','partial_ids_recorded','verified','unknown','absent','present','deleted','delete_unknown','manual_review')) LIMIT 1`, [customerId,owner.planId || null]);
    if (hierarchyIntents.rows.length) return true;
    const objects = await client.query(`SELECT hierarchy_object_id FROM searchad_hierarchy_objects o WHERE customer_id=$1
      AND (state IN('dispatching','delete_pending') OR (state IN('create_unknown','delete_unknown','manual_review') AND (hierarchy_object_id::text=$4 OR remote_id=$4)))
      AND NOT(hierarchy_object_id::text=ANY($2::text[])) AND NOT EXISTS(SELECT 1 FROM searchad_hierarchy_events h WHERE h.customer_id=$1 AND h.hierarchy_object_id=o.hierarchy_object_id AND h.details_json->>'planId'=$3) LIMIT 1`, [customerId,owner.objectIds || [],owner.planId || null,target]);
    if (objects.rows.length) return true;
    const reservations = await client.query(`SELECT r.reservation_id FROM searchad_automation_reservations r WHERE r.customer_id=$1 AND r.state IN('reserved','consumed','unknown') AND r.reservation_id::text<>COALESCE($2,'')
      AND NOT EXISTS(SELECT 1 FROM searchad_automation_runs ar JOIN searchad_write_execution_claims c ON c.plan_id=ar.plan_id
        JOIN LATERAL(SELECT outcome FROM searchad_write_execution_outcomes o WHERE o.customer_id=c.customer_id AND o.ordinal=c.ordinal ORDER BY version DESC LIMIT 1) terminal ON true
        WHERE ar.customer_id=r.customer_id AND ar.run_id=r.run_id AND terminal.outcome IN('failed','not_applied','applied','applied_reconciled')) LIMIT 1`, [customerId,owner.reservationId || null]);
    return reservations.rows.length > 0;
  }
  async reserveDispatch({ customerId, dispatchKey, dispatch, now }) {
    return this.transaction(customerId, async client => {
      const result = await client.query(`INSERT INTO searchad_automation_reservations(reservation_id,customer_id,dispatch_key,entity_type,entity_id,state,dispatch_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'reserved',$6::jsonb,$7,$7) ON CONFLICT(customer_id,dispatch_key) DO NOTHING RETURNING reservation_id`, [randomUUID(),customerId,dispatchKey,dispatch.entityType,dispatch.entityId,JSON.stringify(dispatch),new Date(now).toISOString()]);
      return result.rows[0]?.reservation_id || null;
    });
  }
  async recoverKnownFailures({customerId,policyId,expectedRevision,actor,reason,now}) {
    return this.transaction(customerId,async client=>{
      const policy=(await client.query('SELECT * FROM searchad_automation_policies WHERE customer_id=$1 AND policy_id=$2',[customerId,policyId])).rows[0];
      if(!policy || policy.revision!==expectedRevision)throw circuitError('RECOVERY_REVISION',409);
      const state=await this.getState({customerId,client});
      if(state.unknownCount || await this.hasBacklog({customerId,client}) || await this.unresolved({customerId,client}))throw circuitError('RECOVERY_UNRESOLVED',409);
      const prior=(await client.query('SELECT selected_json FROM searchad_circuit_failure_recoveries WHERE customer_id=$1 AND rule_id=$2',[customerId,policy.rule_id])).rows;
      const recoveredOutcomes=new Set(prior.flatMap(row=>row.selected_json.outcomeIds));
      const recoveredLegacy=new Set(prior.flatMap(row=>row.selected_json.legacyEventIds));
      const outcomes=(await client.query(`SELECT terminal.outcome_id FROM searchad_write_execution_claims c JOIN LATERAL(SELECT outcome_id,outcome FROM searchad_write_execution_outcomes o WHERE o.customer_id=c.customer_id AND o.ordinal=c.ordinal ORDER BY version DESC LIMIT 1) terminal ON true WHERE c.customer_id=$1 AND c.rule_id=$2 AND terminal.outcome IN('failed','not_applied')`,[customerId,policy.rule_id])).rows.map(row=>row.outcome_id).filter(id=>!recoveredOutcomes.has(id));
      const events=(await client.query(`SELECT c.event_id::text,c.event_json,${LEGACY_SOURCE_COLUMNS} FROM searchad_circuit_events c WHERE c.customer_id=$1 AND NOT(c.event_json ? 'ordinal')
        AND NOT EXISTS(SELECT 1 FROM searchad_write_execution_outcomes o WHERE c.source_kind='write' AND o.source_attempt_id::text=c.source_id) ORDER BY c.event_id`,[customerId])).rows;
      const logical=reduceLegacyEvents(events.map(projectedEvent));
      const legacy=[...logical.values()].filter(event=>event.counterEligible!==false && event.outcome==='failed' && !recoveredLegacy.has(event.eventId) && (event.ruleId===policy.rule_id || event.ruleId===policy.policy_id || (event.entityType===policy.entity_type && event.entityId===policy.entity_id))).map(event=>event.eventId);
      if(!outcomes.length && !legacy.length)throw circuitError('RECOVERY_EMPTY',409);
      const revision=(await client.query('UPDATE searchad_automation_rules SET recovery_revision=recovery_revision+1 WHERE customer_id=$1 AND rule_id=$2 RETURNING recovery_revision',[customerId,policy.rule_id])).rows[0].recovery_revision;
      const recoveryId=randomUUID(), selected={outcomeIds:outcomes,legacyEventIds:legacy};
      await client.query('INSERT INTO searchad_circuit_failure_recoveries(recovery_id,customer_id,rule_id,policy_id,policy_revision,recovery_revision,actor,reason,selected_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[recoveryId,customerId,policy.rule_id,policyId,expectedRevision,revision,actor,reason,selected,new Date(now).toISOString()]);
      await client.query('UPDATE searchad_automation_runs SET revoked_at=$3 WHERE customer_id=$1 AND rule_id=$2 AND revoked_at IS NULL',[customerId,policy.rule_id,new Date(now).toISOString()]);
      return {recoveryId,customerId,ruleId:policy.rule_id,policyRevision:expectedRevision,recoveryRevision:revision,selected};
    });
  }
  async appendManualControl({ customerId, paused, reason, actor, now }) {
    return this.transaction(customerId, async client => {
      await client.query('INSERT INTO searchad_circuit_state(customer_id,manual_paused,reason,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(customer_id) DO UPDATE SET manual_paused=EXCLUDED.manual_paused,reason=EXCLUDED.reason,updated_at=EXCLUDED.updated_at', [customerId,paused,reason,new Date(now).toISOString()]);
      await client.query("INSERT INTO searchad_circuit_events(customer_id,source_kind,source_id,event_json,projected_at) VALUES($1,'manual',$2,$3::jsonb,$4)", [customerId,randomUUID(),JSON.stringify({ action: paused ? 'pause' : 'resume', actor, reason }),new Date(now).toISOString()]);
      return { customerId, manualPaused: paused, reason };
    });
  }
}
