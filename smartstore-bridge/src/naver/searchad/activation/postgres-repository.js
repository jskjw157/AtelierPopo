import { randomUUID } from 'node:crypto';

function cloneJson(value) {
  if (value == null) return value;
  return structuredClone(value);
}

function iso(value) {
  return value?.toISOString?.() || value;
}

function evidenceRow(row) {
  if (!row) return null;
  return {
    evidenceId: row.evidence_id,
    evidenceType: row.evidence_type,
    customerId: row.customer_id,
    specSha: row.spec_sha,
    credentialFingerprint: row.credential_fingerprint,
    upstreamBaseUrl: row.upstream_base_url,
    operationKeys: cloneJson(row.operation_keys_json || []),
    fieldScope: cloneJson(row.field_scope_json || []),
    lifecycleKinds: cloneJson(row.lifecycle_kinds_json || []),
    result: row.result,
    sourceRunId: row.source_run_id,
    recipeId: row.recipe_id,
    details: cloneJson(row.details_json || {}),
    createdByPrincipalId: row.created_by_principal_id,
    sourceRequestId: row.source_request_id,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at)
  };
}

function activationRow(row) {
  if (!row) return null;
  return {
    activationId: row.activation_id,
    evidenceId: row.evidence_id,
    evidenceType: row.evidence_type,
    customerId: row.customer_id,
    specSha: row.spec_sha,
    credentialFingerprint: row.credential_fingerprint,
    upstreamBaseUrl: row.upstream_base_url,
    operationKeys: cloneJson(row.operation_keys_json || []),
    fieldScope: cloneJson(row.field_scope_json || []),
    lifecycleKinds: cloneJson(row.lifecycle_kinds_json || []),
    activatedByPrincipalId: row.activated_by_principal_id,
    activatedAt: iso(row.activated_at),
    expiresAt: iso(row.expires_at)
  };
}

function accountRow(row) {
  if (!row) return null;
  return {
    customerId: row.customer_id,
    suspended: Boolean(row.suspended),
    updatedAt: iso(row.updated_at)
  };
}

export class PostgresSearchAdActivationRepository {
  constructor({ pool } = {}) {
    if (!pool?.query) throw new TypeError('PostgreSQL pool is required');
    this.pool = pool;
  }

  async createEvidence(evidence = {}) {
    const common = [
      String(evidence.evidenceId),
      String(evidence.evidenceType),
      String(evidence.customerId),
      String(evidence.specSha),
      String(evidence.credentialFingerprint),
      String(evidence.upstreamBaseUrl),
      JSON.stringify(evidence.operationKeys || []),
      JSON.stringify(evidence.fieldScope || [])
    ];
    const tail = [
      String(evidence.result),
      evidence.sourceRunId == null ? null : String(evidence.sourceRunId),
      evidence.recipeId == null ? null : String(evidence.recipeId),
      JSON.stringify(evidence.details || {}),
      evidence.createdByPrincipalId == null ? null : String(evidence.createdByPrincipalId),
      evidence.sourceRequestId == null ? null : String(evidence.sourceRequestId),
      evidence.createdAt,
      evidence.expiresAt
    ];
    let result;
    try {
      result = await this.pool.query(
        `INSERT INTO searchad_verification_evidence (
           evidence_id, evidence_type, customer_id, spec_sha, credential_fingerprint,
           upstream_base_url, operation_keys_json, field_scope_json, lifecycle_kinds_json, result,
           source_run_id, recipe_id, details_json, created_by_principal_id,
           source_request_id, created_at, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16,$17
         ) RETURNING *`,
        [...common, JSON.stringify(evidence.lifecycleKinds || []), ...tail]
      );
    } catch (error) {
      if (error?.code !== '42703') throw error;
      result = await this.pool.query(
        `INSERT INTO searchad_verification_evidence (
           evidence_id, evidence_type, customer_id, spec_sha, credential_fingerprint,
           upstream_base_url, operation_keys_json, field_scope_json, result,
           source_run_id, recipe_id, details_json, created_by_principal_id,
           source_request_id, created_at, expires_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15,$16
         ) RETURNING *`,
        [...common, ...tail]
      );
    }
    return evidenceRow(result.rows[0]);
  }

  async getEvidence(evidenceId, client=this.pool) {
    const result = await client.query(
      'SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1',
      [String(evidenceId)]
    );
    return evidenceRow(result.rows[0]);
  }

  async listEvidence({ customerIds = [], evidenceType, limit = 100 } = {}) {
    const ids = [...new Set((customerIds || []).map(String).filter(Boolean))];
    if (!ids.length) return [];
    const values = [ids];
    const conditions = ['customer_id = ANY($1::text[])'];
    if (evidenceType) {
      values.push(String(evidenceType));
      conditions.push(`evidence_type=$${values.length}`);
    }
    values.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    const result = await this.pool.query(
      `SELECT * FROM searchad_verification_evidence
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(evidenceRow);
  }

  async createActivation(grant = {}) {
    const common = [
      grant.activationId,
      String(grant.evidenceId),
      String(grant.evidenceType),
      String(grant.customerId),
      String(grant.specSha),
      String(grant.credentialFingerprint),
      String(grant.upstreamBaseUrl),
      JSON.stringify(grant.operationKeys || []),
      JSON.stringify(grant.fieldScope || [])
    ];
    const tail = [
      String(grant.activatedByPrincipalId),
      grant.activatedAt,
      grant.expiresAt
    ];
    let result;
    try {
      result = await this.pool.query(
        `INSERT INTO searchad_activation_grants (
           activation_id, evidence_id, evidence_type, customer_id, spec_sha,
           credential_fingerprint, upstream_base_url, operation_keys_json,
           field_scope_json, lifecycle_kinds_json, activated_by_principal_id, activated_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13)
         RETURNING *`,
        [...common, JSON.stringify(grant.lifecycleKinds || []), ...tail]
      );
    } catch (error) {
      if (error?.code !== '42703') throw error;
      result = await this.pool.query(
        `INSERT INTO searchad_activation_grants (
           activation_id, evidence_id, evidence_type, customer_id, spec_sha,
           credential_fingerprint, upstream_base_url, operation_keys_json,
           field_scope_json, activated_by_principal_id, activated_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)
         RETURNING *`,
        [...common, ...tail]
      );
    }
    return activationRow(result.rows[0]);
  }

  async getActivation(activationId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_activation_grants WHERE activation_id=$1',
      [activationId]
    );
    return activationRow(result.rows[0]);
  }

  async getActivationByEvidence(evidenceId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_activation_grants WHERE evidence_id=$1',
      [String(evidenceId)]
    );
    return activationRow(result.rows[0]);
  }

  async listActivations({ customerIds = [], evidenceType, limit = 100 } = {}) {
    const ids = [...new Set((customerIds || []).map(String).filter(Boolean))];
    if (!ids.length) return [];
    const values = [ids];
    const conditions = ['customer_id = ANY($1::text[])'];
    if (evidenceType) {
      values.push(String(evidenceType));
      conditions.push(`evidence_type=$${values.length}`);
    }
    values.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    const result = await this.pool.query(
      `SELECT * FROM searchad_activation_grants
       WHERE ${conditions.join(' AND ')}
       ORDER BY activated_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(activationRow);
  }

  async findUsableActivation({ customerId, operationKey, now = new Date() } = {}, client=this.pool) {
    const result = await client.query(
      `SELECT * FROM searchad_activation_grants
       WHERE customer_id=$1
         AND expires_at>$2
         AND operation_keys_json @> $3::jsonb
       ORDER BY activated_at DESC
       LIMIT 1`,
      [String(customerId), now, JSON.stringify([String(operationKey)])]
    );
    return activationRow(result.rows[0]);
  }

  async getAccount(customerId, client=this.pool) {
    const result = await client.query(
      'SELECT * FROM searchad_canary_accounts WHERE customer_id=$1',
      [String(customerId)]
    );
    return accountRow(result.rows[0]);
  }

  async listAccounts(customerIds = []) {
    const ids = [...new Set((customerIds || []).map(String).filter(Boolean))];
    if (!ids.length) return [];
    const result = await this.pool.query(
      `SELECT * FROM searchad_canary_accounts
       WHERE customer_id = ANY($1::text[])
       ORDER BY customer_id ASC`,
      [ids]
    );
    return result.rows.map(accountRow);
  }

  async setAccountSuspended({ customerId, suspended, actorPrincipalId, requestId = null, createdAt = new Date().toISOString() } = {}) {
    const id = String(customerId);
    const target = Boolean(suspended);
    const actor = String(actorPrincipalId || '').trim();
    if (!id || !actor) throw new TypeError('customerId and actorPrincipalId are required');

    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    const release = client !== this.pool && typeof client.release === 'function' ? () => client.release() : () => {};
    try {
      await client.query('BEGIN');
      let currentResult = await client.query(
        'SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',
        [id]
      );
      if (!currentResult.rows[0]) {
        await client.query(
          `INSERT INTO searchad_canary_accounts (customer_id, suspended, updated_at)
           VALUES ($1, false, $2)
           ON CONFLICT (customer_id) DO NOTHING`,
          [id, createdAt]
        );
        currentResult = await client.query(
          'SELECT * FROM searchad_canary_accounts WHERE customer_id=$1 FOR UPDATE',
          [id]
        );
      }
      const current = accountRow(currentResult.rows[0]);
      if (current?.suspended === target) {
        await client.query('COMMIT');
        return current;
      }

      const updated = await client.query(
        `UPDATE searchad_canary_accounts
         SET suspended=$2, updated_at=$3
         WHERE customer_id=$1
         RETURNING *`,
        [id, target, createdAt]
      );
      await client.query(
        `INSERT INTO searchad_account_state_events (
           event_id, customer_id, action, actor_principal_id, request_id, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), id, target ? 'suspend' : 'resume', actor, requestId == null ? null : String(requestId), createdAt]
      );
      await client.query('COMMIT');
      return accountRow(updated.rows[0]);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      release();
    }
  }
}

export const _internal = { evidenceRow, activationRow, accountRow };
