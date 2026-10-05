import { currentWorkerSource } from '../worker/postgres-repository.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { contentHash } from '../write/canonical.js';
import { randomUUID } from 'node:crypto';
import { automationError, UUID } from './policy.js';
import { CAMPAIGN_READ } from './recipes.js';
const preparations=new AsyncLocalStorage();
export function currentAutomationPreparation() { return preparations.getStore(); }
const iso=value=>new Date(value).toISOString();
function policy(row) { return row ? { ...row.policy_json, policyId:row.policy_id, customerId:row.customer_id, revision:row.revision, ruleId:row.rule_id, mode:row.mode, enabled:row.enabled, entityType:row.entity_type, entityId:row.entity_id } : null; }
export function publicRun(row) { return row ? { runId:row.run_id,customerId:row.customer_id,policyId:row.policy_id,policyRevision:row.policy_revision,ruleId:row.rule_id,decisionKey:row.decision_key,inputHash:row.input_hash,state:row.state,planId:row.plan_id,approvalId:row.approval_id,revokedAt:row.revoked_at,decision:row.decision_json,createdAt:iso(row.created_at) } : null; }
export class PostgresAutomationRepository {
  #permits=new WeakMap();
  constructor({ pool, clock=Date.now, identityResolver=null }) { Object.assign(this,{pool,clock,identityResolver}); }
  async transaction(customerId, task) {
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); if ((await client.query('SELECT customer_id FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',[customerId])).rows.length!==1) throw automationError('ACCOUNT_UNAVAILABLE',503); const result=await task(client); await client.query('COMMIT'); return result; }
    catch(error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
    finally { client.release(); }
  }
  async event(client,run,type,details,now=this.clock()) {
    await client.query('INSERT INTO searchad_automation_events(event_id,customer_id,run_id,event_type,event_json,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),run.customerId,run.runId,type,details,iso(now)]);
  }
  async authority({customerId,runId,planId,client=this.pool,now=this.clock(),states}) {
    const raw=(await client.query(`SELECT r.* FROM searchad_automation_runs r WHERE r.customer_id=$1 AND ($2::uuid IS NULL OR r.run_id=$2) AND ($3::uuid IS NULL OR r.plan_id=$3)`,[customerId,runId || null,planId || null])).rows[0];
    if (!raw) { if(planId)return null; throw automationError('RUN_NOT_FOUND',404); }
    const run=publicRun(raw), p=await this.findPolicy({customerId,policyId:run.policyId,client});
    const observation=run.decision.selected?.current;
    if (!Number.isFinite(now) || !p || p.revision!==run.policyRevision || !p.enabled || p.mode!=='approve' || run.revokedAt || !run.decision.allowed || (states && !states.includes(run.state)) || !observation || now<observation.observedAt || now>=observation.observedAt+p.maxCurrentAgeMs) throw automationError('AUTHORITY_REVOKED');
    if (!this.identityResolver || contentHash(await this.identityResolver(customerId))!==contentHash(run.decision.selected.identity)) throw automationError('IDENTITY_CHANGED');
    const identity=run.decision.selected.identity, stats=run.decision.selected.stats;
    const currentSource=(await client.query(`SELECT * FROM searchad_automation_current_observations
      WHERE customer_id=$1 AND observation_id=$2 AND entity_type=$3 AND entity_id=$4 AND operation_key=$5
      AND spec_sha=$6 AND credential_fingerprint=$7 AND upstream_base_url=$8`,[customerId,observation.observationId,p.entityType,p.entityId,CAMPAIGN_READ,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl])).rows[0];
    if(!currentSource || currentSource.snapshot_hash!==observation.snapshotHash || contentHash(currentSource.snapshot_json)!==observation.snapshotHash || Date.parse(currentSource.observed_at)!==observation.observedAt)throw automationError('CURRENT_BINDING');
    const statsSource=stats?.observationId && (await client.query(`SELECT * FROM searchad_stats_observations
      WHERE customer_id=$1 AND observation_id=$2 AND entity_type=$3 AND entity_id=$4
      AND spec_sha=$5 AND credential_fingerprint=$6 AND upstream_base_url=$7 AND response_sha=$8`,[customerId,stats.observationId,p.entityType,p.entityId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,stats.responseSha])).rows[0];
    const observedAt=Date.parse(statsSource?.observed_at), cycleAt=Date.parse(statsSource?.cycle_at);
    const validUntil=Math.min(observation.observedAt+p.maxCurrentAgeMs,observedAt+p.maxCurrentAgeMs,cycleAt+p.maxCurrentAgeMs);
    if(!Number.isFinite(validUntil) || now>=validUntil || observedAt>now || cycleAt>now)throw automationError('EVIDENCE_EXPIRED');
    const reservation=(await client.query('SELECT * FROM searchad_automation_reservations WHERE customer_id=$1 AND run_id=$2',[customerId,run.runId])).rows[0] || null;
    if(['approved','claim_pending','executing'].includes(run.state)){
      const approval=(await client.query('SELECT * FROM searchad_write_approvals WHERE approval_id=$1 AND plan_id=$2',[run.approvalId,run.planId])).rows[0];
      if(run.state==='executing'){
        const claim=(await client.query(`SELECT c.* FROM searchad_write_execution_claims c
          WHERE customer_id=$1 AND plan_id=$2 AND approval_id=$3 AND rule_id=$4
          AND NOT EXISTS(SELECT 1 FROM searchad_write_execution_outcomes o WHERE o.customer_id=c.customer_id AND o.ordinal=c.ordinal)`,[customerId,run.planId,run.approvalId,run.ruleId])).rows[0];
        if(!approval?.used_at || !claim || reservation?.state!=='consumed')throw automationError('CLAIM_BINDING');
      } else if(!approval || approval.used_at || Date.parse(approval.expires_at)<=now || reservation?.state!=='reserved')throw automationError('APPROVAL_BINDING');
    }
    if(planId) {
      const plan=(await client.query('SELECT * FROM searchad_write_change_plans WHERE customer_id=$1 AND plan_id=$2',[customerId,planId])).rows[0];
      if(!plan || !reservation || plan.before_hash!==observation.snapshotHash || contentHash(plan.mutation_json)!==contentHash(run.decision.recipe.mutation) || plan.customer_id!==customerId) throw automationError('PLAN_BINDING');
    }
    return {run,policy:p,reservation,validUntil};
  }
  async planAuthority(planId,{client=this.pool,now=this.clock(),states}={}) {
    const row=(await client.query('SELECT customer_id FROM searchad_automation_runs WHERE plan_id=$1',[planId])).rows[0];
    return row ? this.authority({customerId:row.customer_id,planId,client,now,states}) : null;
  }
  async reserveRun({customerId,runId,now}) {
    let attempting=false, result;
    try { result=await this.transaction(customerId,async client=>{
      const bound=await this.authority({customerId,runId,client,now,states:['ready']});
      attempting=true;
      const reservationId=randomUUID();
      await client.query(`INSERT INTO searchad_automation_reservations(reservation_id,customer_id,dispatch_key,run_id,entity_type,entity_id,state,dispatch_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'reserved',$7,$8,$8)`,[reservationId,customerId,bound.run.decisionKey,runId,bound.policy.entityType,bound.policy.entityId,{ruleId:bound.policy.ruleId},iso(now)]);
      await client.query("UPDATE searchad_automation_runs SET state='preparing',updated_at=$3 WHERE customer_id=$1 AND run_id=$2",[customerId,runId,iso(now)]);
      await this.event(client,bound.run,'prepare_reserved',{reservationId},now);
      return {customerId,runId,reservationId};
    }); } catch(error) {
      if(attempting)try{await this.settleRun({customerId,runId,state:'manual_review'});}catch{}
      throw error;
    }
    const permit=Object.freeze({}); this.#permits.set(permit,result); return permit;
  }
  async withPreparation(permit,task) {
    const binding=this.#permits.get(permit); this.#permits.delete(permit);
    if(!binding)throw automationError('PREPARATION_USED');
    let used=false;
    return preparations.run(Object.freeze({pool:this.pool,persist:async(plan,insert)=>{
      if(used)throw automationError('PREPARATION_USED'); used=true;
      return this.transaction(binding.customerId,async client=>{
        const bound=await this.authority({...binding,client,states:['preparing']});
        if(bound.run.planId || bound.reservation?.reservation_id!==binding.reservationId || bound.reservation.state!=='reserved' || plan.customer_id!==binding.customerId || plan.before_hash!==bound.run.decision.selected.current.snapshotHash || contentHash(plan.mutation_json)!==contentHash(bound.run.decision.recipe.mutation)) throw automationError('CURRENT_VALUE_DRIFT');
        const stored=await insert(client);
        await client.query("UPDATE searchad_automation_runs SET plan_id=$3,state='prepared',updated_at=$4 WHERE customer_id=$1 AND run_id=$2",[binding.customerId,binding.runId,plan.plan_id,iso(this.clock())]);
        await this.event(client,bound.run,'plan_attached',{planId:plan.plan_id,reservationId:binding.reservationId});
        return stored;
      });
    }}),task);
  }
  async attachPlan({customerId,runId,planId}) {
    const run=await this.getRun({customerId,runId});
    if(!run || run.planId!==planId || !planId)throw automationError('PLAN_BINDING');
    return run; // Association is inserted only by the opaque preparation above.
  }
  async reservePlanPhase(planId,phase,validate=async()=>{}) {
    const row=(await this.pool.query('SELECT customer_id FROM searchad_automation_runs WHERE plan_id=$1',[planId])).rows[0];
    if(!row)return null;
    const expected=phase==='approval_pending'?'prepared':'approved';
    let attempting=false, pendingRun;
    try { return await this.transaction(row.customer_id,async client=>{
      const bound=await this.planAuthority(planId,{client,states:[expected]});
      if(bound.reservation?.state!=='reserved')throw automationError('RESERVATION_USED');
      await validate(client,bound);
      pendingRun=bound.run;attempting=true;
      await client.query('UPDATE searchad_automation_runs SET state=$3,updated_at=$4 WHERE customer_id=$1 AND run_id=$2',[row.customer_id,bound.run.runId,phase,iso(this.clock())]);
      await this.event(client,bound.run,phase,{});return bound;
    }); } catch(error) {
      if(attempting)try{await this.settleRun({customerId:pendingRun.customerId,runId:pendingRun.runId,state:'manual_review'});}catch{}
      throw error;
    }
  }
  async settleRun({customerId,runId,state,now=this.clock()}) {
    return this.transaction(customerId,async client=>{
      const run=await this.getRun({customerId,runId,client});if(!run)throw automationError('RUN_NOT_FOUND',404);
      if(!['manual_review'].includes(state))throw automationError('INPUT',400);
      await client.query("UPDATE searchad_automation_runs SET state='manual_review',updated_at=$3 WHERE customer_id=$1 AND run_id=$2 AND state IN('ready','preparing','prepared','approved','approval_pending','claim_pending','executing')",[customerId,runId,iso(now)]);
      await this.event(client,run,'manual_review',{});return this.getRun({customerId,runId,client});
    });
  }
  async createPolicyRevision(input) {
    return this.transaction(input.customerId,async client=>{
      const previous=input.policyId ? await this.findPolicy({...input,client}) : null;
      if (input.policyId && (!previous || previous.revision!==input.expectedRevision || previous.entityType!==input.entityType || previous.entityId!==input.entityId)) throw automationError('REVISION_CONFLICT');
      const rule=(await client.query(`INSERT INTO searchad_automation_rules(rule_id,customer_id,entity_type,entity_id) VALUES($1,$2,$3,$4) ON CONFLICT(customer_id,entity_type,entity_id) DO UPDATE SET entity_id=EXCLUDED.entity_id RETURNING rule_id`,[randomUUID(),input.customerId,input.entityType,input.entityId])).rows[0];
      const policyId=input.policyId || randomUUID(), revision=(previous?.revision || 0)+1;
      const value={mode:input.mode,enabled:input.enabled,entityType:input.entityType,entityId:input.entityId,recipe:input.recipe,maxCurrentAgeMs:input.maxCurrentAgeMs,reason:input.reason};
      const row=(await client.query(`INSERT INTO searchad_automation_policies(policy_id,customer_id,revision,rule_id,mode,enabled,entity_type,entity_id,policy_json,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(policy_id) DO UPDATE SET revision=EXCLUDED.revision,mode=EXCLUDED.mode,enabled=EXCLUDED.enabled,policy_json=EXCLUDED.policy_json RETURNING *`,[policyId,input.customerId,revision,rule.rule_id,input.mode,input.enabled,input.entityType,input.entityId,value,input.actor,iso(input.now)])).rows[0];
      await client.query('INSERT INTO searchad_automation_policy_revisions(customer_id,policy_id,revision,rule_id,policy_json,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.customerId,policyId,revision,rule.rule_id,value,input.actor,iso(input.now)]);
      await client.query('UPDATE searchad_automation_runs SET revoked_at=$3 WHERE customer_id=$1 AND policy_id=$2 AND revoked_at IS NULL',[input.customerId,policyId,iso(input.now)]);
      return policy(row);
    });
  }
  async findPolicy({customerId,policyId,client=this.pool}) { if (!UUID.test(policyId || '')) return null; return policy((await client.query('SELECT * FROM searchad_automation_policies WHERE customer_id=$1 AND policy_id=$2',[customerId,policyId])).rows[0]); }
  async listPolicies({customerId}) { return (await this.pool.query('SELECT * FROM searchad_automation_policies WHERE customer_id=$1 ORDER BY policy_id',[customerId])).rows.map(policy); }
  async appendCurrent(row) {
    await this.pool.query(`INSERT INTO searchad_automation_current_observations(observation_id,customer_id,entity_type,entity_id,operation_key,spec_sha,credential_fingerprint,upstream_base_url,observed_at,source_request_id,snapshot_hash,snapshot_json,normalized_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[row.observationId,row.customerId,row.entityType,row.entityId,row.operationKey,row.specSha,row.credentialFingerprint,row.upstreamBaseUrl,iso(row.observedAt),row.sourceRequestId,row.snapshotHash,row.snapshot,row.normalized]);
    return row;
  }
  async createDecisionOnce(input) {
    return this.transaction(input.customerId,async client=>{
      const current=await this.findPolicy({...input,client});
      if (!current || current.revision!==input.policyRevision) throw automationError('REVISION_CONFLICT');
      const row=(await client.query(`INSERT INTO searchad_automation_runs(run_id,customer_id,policy_id,policy_revision,rule_id,decision_key,input_hash,state,decision_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(customer_id,decision_key) DO NOTHING RETURNING *`,[randomUUID(),input.customerId,input.policyId,input.policyRevision,current.ruleId,input.decisionKey,input.inputHash,input.state,input.decision,iso(input.now)])).rows[0];
      const run=publicRun(row || (await client.query('SELECT * FROM searchad_automation_runs WHERE customer_id=$1 AND decision_key=$2',[input.customerId,input.decisionKey])).rows[0]);
      const source=currentWorkerSource();
      if(source) { if(source.pool!==this.pool || source.customerId!==input.customerId)throw automationError('STORE_MISMATCH',503);await source.persist(client,run); }
      return run;
    });
  }
  async getRun({customerId,runId,client=this.pool}) { if (!UUID.test(runId || '')) return null; return publicRun((await client.query('SELECT * FROM searchad_automation_runs WHERE customer_id=$1 AND run_id=$2',[customerId,runId])).rows[0]); }
  async completedPrimaryRun({customerId,runId,planId}) {
    if(!UUID.test(runId || '') || !UUID.test(planId || ''))return null;
    // Plan status alone is not durable completion: updatePlan and addAttempt
    // commit separately. Match the latest accepted primary outcome and its exact
    // phase-linked source attempt, consumed approval and settled owned run.
    const row=(await this.pool.query(`SELECT r.* FROM searchad_automation_runs r
      JOIN searchad_write_change_plans p ON p.customer_id=r.customer_id AND p.plan_id=r.plan_id
      JOIN searchad_write_execution_claims c ON c.customer_id=r.customer_id AND c.plan_id=p.plan_id AND c.approval_id=r.approval_id AND c.rule_id=r.rule_id
      JOIN searchad_write_approvals approval ON approval.plan_id=p.plan_id AND approval.approval_id=c.approval_id AND approval.used_at IS NOT NULL
      JOIN LATERAL(SELECT source_attempt_id,outcome FROM searchad_write_execution_outcomes o WHERE o.customer_id=c.customer_id AND o.ordinal=c.ordinal ORDER BY version DESC LIMIT 1) terminal ON true
      JOIN searchad_write_attempts attempt ON attempt.attempt_id=terminal.source_attempt_id AND attempt.plan_id=p.plan_id
      WHERE r.customer_id=$1 AND r.run_id=$2 AND r.plan_id=$3 AND r.state=p.status AND terminal.outcome=p.status
      AND ((p.status='applied' AND attempt.phase='verify' AND attempt.status='succeeded')
        OR (p.status IN('applied_reconciled','not_applied') AND attempt.phase='reconcile' AND attempt.status=p.status))`,[customerId,runId,planId])).rows[0];
    return publicRun(row);
  }
  async listRuns({customerId}) { return (await this.pool.query('SELECT * FROM searchad_automation_runs WHERE customer_id=$1 ORDER BY created_at DESC,run_id LIMIT 100',[customerId])).rows.map(publicRun); }
}
