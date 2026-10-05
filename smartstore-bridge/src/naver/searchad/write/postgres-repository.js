import { currentAutomationPreparation, PostgresAutomationRepository } from '../automation/postgres-repository.js';
import { randomUUID } from 'node:crypto';
import { SearchAdWriteError } from './errors.js';

const JSON_COLUMNS = new Set([
  'mutation_json', 'read_json', 'before_json', 'expected_after_json', 'rollback_json',
  'applied_after_json', 'last_error_json', 'request_json', 'response_json', 'error_json'
]);

const TIME_COLUMNS = new Set([
  'created_at', 'expires_at', 'approved_at', 'applied_at', 'rolled_back_at', 'used_at', 'acquired_at'
]);

const PLAN_PATCH_COLUMNS = new Set([
  'status', 'approved_at', 'applied_at', 'applied_after_json', 'applied_after_hash',
  'rolled_back_at', 'last_error_json'
]);

function hydrate(row) {
  if (!row) return null;
  const result = { ...row };
  for (const column of JSON_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(result, column) && typeof result[column] === 'string') {
      try { result[column] = JSON.parse(result[column]); } catch { result[column] = null; }
    }
  }
  for (const column of TIME_COLUMNS) {
    if (result[column] instanceof Date) result[column] = result[column].toISOString();
  }
  return result;
}

function boundedLimit(value) {
  return Math.max(1, Math.min(500, Number(value) || 100));
}

async function rollbackQuietly(client) {
  try { await client.query('ROLLBACK'); } catch {}
}

export class PostgresSearchAdWriteRepository {
  constructor({ pool, clock=Date.now, identityResolver=null } = {}) {
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      throw new SearchAdWriteError('SEARCHAD_WRITE_POSTGRES_POOL_REQUIRED', 'SearchAd write PostgreSQL pool이 필요합니다.', {}, 500);
    }
    this.pool = pool;
    this.automation = new PostgresAutomationRepository({pool,clock,identityResolver});
  }

  async lockAccountForPlan(client, planId) {
    const locked = await client.query('SELECT a.customer_id,p.customer_id AS plan_customer_id FROM searchad_canary_accounts a JOIN searchad_write_change_plans p ON p.customer_id=a.customer_id WHERE p.plan_id=$1 FOR UPDATE OF a', [planId]);
    if (locked.rows.length === 1 && typeof locked.rows[0].customer_id === 'string' && locked.rows[0].customer_id === locked.rows[0].plan_customer_id) return;
    const plan = await client.query('SELECT customer_id FROM searchad_write_change_plans WHERE plan_id=$1', [planId]);
    if (!plan.rows.length) throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId }, 404);
    throw new SearchAdWriteError('SEARCHAD_SOURCE_ACCOUNT_REQUIRED', 'An existing locked Customer account is required for source persistence.', {}, 503);
  }
  async accountTransaction(planId, action) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); await this.lockAccountForPlan(client, planId); const value = await action(client); await client.query('COMMIT'); return value; }
    catch (error) { await rollbackQuietly(client); throw error; }
    finally { client.release(); }
  }

  async claimRollbackDispatch({ planId, attemptId, now }) {
    return this.accountTransaction(planId, async client => {
      const plan = await client.query('SELECT status FROM searchad_write_change_plans WHERE plan_id=$1 FOR UPDATE', [planId]);
      const prior = await client.query("SELECT attempt_id FROM searchad_write_attempts WHERE plan_id=$1 AND phase IN('rollback','rollback_verify') LIMIT 1", [planId]);
      if (!['applied','applied_reconciled'].includes(plan.rows[0]?.status) || prior.rows.length) throw new SearchAdWriteError('SEARCHAD_ROLLBACK_INTENT_USED', 'Rollback dispatch was already claimed or is unavailable.', {}, 409);
      await client.query("INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,created_at) VALUES($1,$2,'rollback','send_intent',$3)", [attemptId,planId,now]);
    });
  }

  async createPlan(plan) {
    const insert = async client => {
    const result = await client.query(`
      INSERT INTO searchad_write_change_plans (
        plan_id, customer_id, mutation_operation_key, mutation_json, read_json,
        before_json, before_hash, expected_after_json, rollback_json, reason,
        status, created_by, created_at, expires_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5::jsonb,
        $6::jsonb, $7, $8::jsonb, $9::jsonb, $10,
        $11, $12, $13::timestamptz, $14::timestamptz
      )
      RETURNING *
    `, [
      plan.plan_id,
      plan.customer_id,
      plan.mutation_operation_key,
      plan.mutation_json,
      plan.read_json,
      plan.before_json,
      plan.before_hash,
      plan.expected_after_json,
      plan.rollback_json ?? null,
      plan.reason,
      plan.status,
      plan.created_by,
      plan.created_at,
      plan.expires_at
    ]);
    return hydrate(result.rows[0]);
    };
    const preparation=currentAutomationPreparation();
    if (preparation) {
      if (preparation.pool!==this.pool) throw new SearchAdWriteError('SEARCHAD_AUTOMATION_STORE_MISMATCH','Preparation requires the same primary store.',{},503);
      return preparation.persist(plan,insert);
    }
    return insert(this.pool);
  }

  async getPlan(planId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_write_change_plans WHERE plan_id = $1',
      [planId]
    );
    return hydrate(result.rows[0]);
  }

  async listPlans({ customerId, status, limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (customerId) {
      params.push(customerId);
      clauses.push(`customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    params.push(boundedLimit(limit));
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT * FROM searchad_write_change_plans ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return result.rows.map(hydrate);
  }

  async updatePlan(planId, patch, { expectedStatuses } = {}) {
    const entries = Object.entries(patch || {});
    for (const [key] of entries) {
      if (!PLAN_PATCH_COLUMNS.has(key)) {
        throw new SearchAdWriteError('SEARCHAD_WRITE_INVALID_COLUMN', '허용되지 않은 저장 필드입니다.', { key }, 500);
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockAccountForPlan(client, planId);
      const currentResult = await client.query(
        'SELECT * FROM searchad_write_change_plans WHERE plan_id = $1 FOR UPDATE',
        [planId]
      );
      const current = hydrate(currentResult.rows[0]);
      if (!current) {
        throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId }, 404);
      }
      if (expectedStatuses?.length && !expectedStatuses.includes(current.status)) {
        throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_STATE_CONFLICT', '현재 상태에서는 변경 계획을 갱신할 수 없습니다.', {
          planId,
          currentStatus: current.status,
          expectedStatuses
        }, 409);
      }
      if (!entries.length) {
        await client.query('COMMIT');
        return current;
      }

      const params = [];
      const assignments = entries.map(([key, value]) => {
        params.push(value ?? null);
        const cast = JSON_COLUMNS.has(key) ? '::jsonb' : TIME_COLUMNS.has(key) ? '::timestamptz' : '';
        return `${key} = $${params.length}${cast}`;
      });
      params.push(planId);
      const updated = await client.query(
        `UPDATE searchad_write_change_plans SET ${assignments.join(', ')} WHERE plan_id = $${params.length} RETURNING *`,
        params
      );
      await client.query('COMMIT');
      return hydrate(updated.rows[0]);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async createApproval(approval) {
    const pending=await this.automation.reservePlanPhase(approval.plan_id,'approval_pending');
    const insert=async client=>{
    if(pending) await this.automation.planAuthority(approval.plan_id,{client,states:['approval_pending']});
    const result = await client.query(`
      INSERT INTO searchad_write_approvals (
        approval_id, plan_id, actor, confirmation, token_hash, created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
      RETURNING *
    `, [
      approval.approval_id,
      approval.plan_id,
      approval.actor,
      approval.confirmation,
      approval.token_hash,
      approval.created_at,
      approval.expires_at
    ]);
    if(pending){
      await client.query("UPDATE searchad_automation_runs SET approval_id=$2,state='approved',updated_at=$3 WHERE plan_id=$1 AND approval_id IS NULL",[approval.plan_id,approval.approval_id,approval.created_at]);
      await this.automation.event(client,pending.run,'approved',{approvalId:approval.approval_id,actor:approval.actor});
    }
    return hydrate(result.rows[0]);
    };
    try { return pending ? await this.accountTransaction(approval.plan_id,insert) : await insert(this.pool); }
    catch(error){ if(pending)try{await this.automation.settleRun({customerId:pending.run.customerId,runId:pending.run.runId,state:'manual_review'});}catch{} throw error; }
  }

  async getApproval(approvalId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_write_approvals WHERE approval_id = $1',
      [approvalId]
    );
    return hydrate(result.rows[0]);
  }

  async assertAutomationAuthority(planId,phase='execute') { return this.automation.planAuthority(planId,{states:phase==='execute'?['approved']:undefined}); }
  async claimApproval({ planId, tokenHash, now }) {
    const pending=await this.automation.reservePlanPhase(planId,'claim_pending',async(client,bound)=>{
      const row=(await client.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1 AND token_hash=$2',[planId,tokenHash])).rows[0];
      if(!row || row.approval_id!==bound.run.approvalId)throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_INVALID','Invalid execution token.',{},403);
      if(row.used_at)throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_USED','Execution token is consumed.',{},409);
      if(Date.parse(row.expires_at)<=Date.parse(now))throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_EXPIRED','Execution token is expired.',{},409);
    });
    let client, claimError;
    let discardClient = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await this.lockAccountForPlan(client, planId);
      if(pending)await this.automation.planAuthority(planId,{client,states:['claim_pending']});
      const result = await client.query(`
        SELECT * FROM searchad_write_approvals
        WHERE plan_id = $1 AND token_hash = $2
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `, [planId, tokenHash]);
      const row = hydrate(result.rows[0]);
      if (!row) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_INVALID', '실행 토큰이 올바르지 않습니다.', { planId }, 403);
      }
      if (row.used_at) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_USED', '이미 사용된 실행 토큰입니다.', { planId }, 409);
      }
      if (Date.parse(row.expires_at) <= Date.parse(now)) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_EXPIRED', '실행 토큰이 만료되었습니다.', { planId, expiresAt: row.expires_at }, 409);
      }
      const unresolved = await client.query(`SELECT c.ordinal FROM searchad_write_execution_claims c
        LEFT JOIN LATERAL (SELECT outcome FROM searchad_write_execution_outcomes o WHERE o.customer_id=c.customer_id AND o.ordinal=c.ordinal ORDER BY version DESC LIMIT 1) terminal ON true
        WHERE c.customer_id=(SELECT customer_id FROM searchad_write_change_plans WHERE plan_id=$1) AND (terminal.outcome IS NULL OR terminal.outcome='unknown') LIMIT 1`, [planId]);
      if (unresolved.rows.length) throw new SearchAdWriteError('SEARCHAD_EXECUTION_ORDER_UNRESOLVED', 'An earlier accepted attempt has no known terminal outcome.', {}, 409);
      const plan = (await client.query('SELECT * FROM searchad_write_change_plans WHERE plan_id=$1', [planId])).rows[0];
      const entity = Object.entries(plan.mutation_json?.pathParams || {})[0];
      const entityType = entity?.[0]?.replace(/^ncc/, '').replace(/Id$/, '').toLowerCase() || 'plan';
      const entityId = entity?.[1] || planId;
      const rule = (await client.query(`INSERT INTO searchad_automation_rules(rule_id,customer_id,entity_type,entity_id) VALUES($1,$2,$3,$4)
        ON CONFLICT(customer_id,entity_type,entity_id) DO UPDATE SET entity_id=EXCLUDED.entity_id RETURNING rule_id`, [randomUUID(),plan.customer_id,entityType,entityId])).rows[0];
      const ordinal = (await client.query(`INSERT INTO searchad_write_execution_counters(customer_id,last_ordinal) VALUES($1,1)
        ON CONFLICT(customer_id) DO UPDATE SET last_ordinal=searchad_write_execution_counters.last_ordinal+1 RETURNING last_ordinal`, [plan.customer_id])).rows[0].last_ordinal;
      await client.query('INSERT INTO searchad_write_execution_claims(customer_id,ordinal,plan_id,approval_id,rule_id,accepted_at) VALUES($1,$2,$3,$4,$5,$6)', [plan.customer_id,ordinal,planId,row.approval_id,rule.rule_id,now]);
      const claimed = await client.query(`
        UPDATE searchad_write_approvals
        SET used_at = $1::timestamptz
        WHERE approval_id = $2 AND used_at IS NULL
        RETURNING *
      `, [now, row.approval_id]);
      if (claimed.rowCount !== 1) {
        throw new SearchAdWriteError('SEARCHAD_EXECUTION_TOKEN_RACE', '실행 토큰을 다른 요청이 먼저 사용했습니다.', { planId }, 409);
      }
      if(pending){
        await client.query("UPDATE searchad_automation_runs SET state='executing',updated_at=$2 WHERE plan_id=$1",[planId,now]);
        await client.query("UPDATE searchad_automation_reservations SET state='consumed',updated_at=$3 WHERE customer_id=$1 AND run_id=$2",[pending.run.customerId,pending.run.runId,now]);
        await this.automation.event(client,pending.run,'execute_claimed',{approvalId:row.approval_id,ordinal:String(ordinal)},Date.parse(now));
      }
      await client.query('COMMIT');
      return { ...hydrate(claimed.rows[0]), execution_ordinal: ordinal };
    } catch (error) {
      claimError = error;
      if (client) {
        try { await client.query('ROLLBACK'); }
        catch { discardClient = true; }
      }
    } finally {
      // Retirement opens another transaction. Release this slot first, even
      // when COMMIT acknowledgement was lost or rollback could not complete.
      try { client?.release(discardClient); }
      catch (error) { if (!claimError) throw error; }
    }
    if (pending) {
      try { await this.automation.settleRun({customerId:pending.run.customerId,runId:pending.run.runId,state:'manual_review'}); }
      catch { /* Preserve the primary claim error and durable pending authority. */ }
    }
    throw claimError;
  }

  async addAttempt(attempt) {
    const insert = async client => {
    const result = await client.query(`
      INSERT INTO searchad_write_attempts (
        attempt_id, plan_id, phase, status, request_fingerprint, request_json,
        response_json, error_json, remote_request_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb,
        $7::jsonb, $8::jsonb, $9, $10::timestamptz
      )
      RETURNING *
    `, [
      attempt.attempt_id,
      attempt.plan_id,
      attempt.phase,
      attempt.status,
      attempt.request_fingerprint || null,
      attempt.request_json ?? null,
      attempt.response_json ?? null,
      attempt.error_json ?? null,
      attempt.remote_request_id || null,
      attempt.created_at
    ]);
    await this.appendOrderedOutcome(client, attempt);
    return hydrate(result.rows[0]);
    };
    if (attempt.phase !== 'plan' || attempt.status !== 'succeeded') return this.accountTransaction(attempt.plan_id, insert);
    // A neutral planning audit is not a mutation outcome/source. It may be
    // appended without an account only while its existing owned plan is planned.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const plan = (await client.query('SELECT status FROM searchad_write_change_plans WHERE plan_id=$1 FOR UPDATE', [attempt.plan_id])).rows[0];
      if (!plan) throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.', { planId: attempt.plan_id }, 404);
      if (plan.status !== 'planned') throw new SearchAdWriteError('SEARCHAD_CHANGE_PLAN_STATE_CONFLICT', 'Planning audit requires a still-planned change.', {}, 409);
      const result = await insert(client); await client.query('COMMIT'); return result;
    } catch (error) { await rollbackQuietly(client); throw error; }
    finally { client.release(); }
  }

  async appendOrderedOutcome(client, attempt) {
    let outcome = null;
    if (attempt.phase === 'execute' && attempt.status === 'failed') outcome = 'failed';
    if ((attempt.phase === 'execute' && attempt.status === 'unknown_outcome') || (attempt.phase === 'verify' && attempt.status === 'failed') || (attempt.phase === 'reconcile' && attempt.status === 'manual_review')) outcome = 'unknown';
    if (attempt.phase === 'verify' && attempt.status === 'succeeded') outcome = 'applied';
    if (attempt.phase === 'reconcile' && ['applied_reconciled','not_applied'].includes(attempt.status)) outcome = attempt.status;
    if (!outcome) return;
    const claim = (await client.query('SELECT c.*,p.status FROM searchad_write_execution_claims c JOIN searchad_write_change_plans p USING(plan_id) WHERE c.plan_id=$1', [attempt.plan_id])).rows[0];
    if (!claim) return; // Pre-protocol/other primary writers remain explicitly unordered.
    if (['applied','applied_reconciled','not_applied'].includes(outcome) && claim.status !== outcome) throw new SearchAdWriteError('SEARCHAD_EXECUTION_OUTCOME_UNPROVEN', 'A verified primary plan outcome is required.', {}, 409);
    await client.query(`INSERT INTO searchad_write_execution_outcomes(outcome_id,customer_id,ordinal,version,source_attempt_id,outcome,occurred_at)
      SELECT $1,$2,$3,COALESCE(max(version),0)+1,$4,$5,$6 FROM searchad_write_execution_outcomes WHERE customer_id=$2 AND ordinal=$3`, [randomUUID(),claim.customer_id,claim.ordinal,attempt.attempt_id,outcome,attempt.created_at]);
    const run=(await client.query('UPDATE searchad_automation_runs SET state=$2,updated_at=$3 WHERE plan_id=$1 RETURNING run_id,customer_id',[attempt.plan_id,outcome==='unknown'?'unknown_outcome':outcome,attempt.created_at])).rows[0];
    if(run)await this.automation.event(client,{runId:run.run_id,customerId:run.customer_id},'primary_outcome',{outcome,ordinal:String(claim.ordinal),sourceAttemptId:attempt.attempt_id},Date.parse(attempt.created_at));
  }

  async listAttempts(planId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_write_attempts WHERE plan_id = $1 ORDER BY created_at ASC',
      [planId]
    );
    return result.rows.map(hydrate);
  }

  async tryAcquireLock({ planId, purpose, acquiredAt, staleBefore }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM searchad_write_locks WHERE acquired_at < $1::timestamptz', [staleBefore]);
      const result = await client.query(`
        INSERT INTO searchad_write_locks (plan_id, purpose, acquired_at)
        VALUES ($1, $2, $3::timestamptz)
        ON CONFLICT (plan_id, purpose) DO NOTHING
        RETURNING plan_id
      `, [planId, purpose, acquiredAt]);
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseLock({ planId, purpose }) {
    await this.pool.query(
      'DELETE FROM searchad_write_locks WHERE plan_id = $1 AND purpose = $2',
      [planId, purpose]
    );
  }

  async close() {}
}
