const RUN_COLUMN_MAP = Object.freeze({
  status: 'status',
  beforeSpend: 'before_spend',
  afterSpend: 'after_spend',
  spendDelta: 'spend_delta',
  remoteId: 'remote_id',
  cleanupVerifiedAt: 'cleanup_verified_at',
  evidenceId: 'evidence_id',
  completedAt: 'completed_at',
  lastError: 'last_error_json'
});

const OBJECT_COLUMN_MAP = Object.freeze({
  cleanupStatus: 'cleanup_status',
  cleanedAt: 'cleaned_at'
});

function cloneJson(value) {
  if (value == null) return value;
  return structuredClone(value);
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
    result: row.result,
    sourceRunId: row.source_run_id,
    recipeId: row.recipe_id,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at
  };
}

function accountRow(row) {
  if (!row) return null;
  return {
    customerId: row.customer_id,
    suspended: Boolean(row.suspended),
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

function runRow(row) {
  if (!row) return null;
  return {
    canaryRunId: row.canary_run_id,
    customerId: row.customer_id,
    passiveEvidenceId: row.passive_evidence_id,
    recipeId: row.recipe_id,
    status: row.status,
    startedByPrincipalId: row.started_by_principal_id,
    specSha: row.spec_sha,
    credentialFingerprint: row.credential_fingerprint,
    upstreamBaseUrl: row.upstream_base_url,
    verifiedOperationScope: cloneJson(row.verified_operation_scope_json || {}),
    startedAt: row.started_at?.toISOString?.() || row.started_at,
    beforeSpend: row.before_spend == null ? null : Number(row.before_spend),
    afterSpend: row.after_spend == null ? null : Number(row.after_spend),
    spendDelta: row.spend_delta == null ? null : Number(row.spend_delta),
    remoteId: row.remote_id,
    cleanupVerifiedAt: row.cleanup_verified_at?.toISOString?.() || row.cleanup_verified_at,
    evidenceId: row.evidence_id,
    completedAt: row.completed_at?.toISOString?.() || row.completed_at,
    lastError: cloneJson(row.last_error_json)
  };
}

function objectRow(row) {
  if (!row) return null;
  return {
    canaryRunId: row.canary_run_id,
    customerId: row.customer_id,
    objectType: row.object_type,
    remoteId: row.remote_id,
    cleanupStatus: row.cleanup_status,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    cleanedAt: row.cleaned_at?.toISOString?.() || row.cleaned_at
  };
}

export class PostgresActiveCanaryRepository {
  constructor({ pool } = {}) {
    if (!pool?.query) throw new TypeError('PostgreSQL pool is required');
    this.pool = pool;
  }

  async upsertAccount({ customerId, suspended = false } = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_canary_accounts (customer_id, suspended, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (customer_id)
       DO UPDATE SET suspended = EXCLUDED.suspended, updated_at = now()
       RETURNING *`,
      [String(customerId), Boolean(suspended)]
    );
    return accountRow(result.rows[0]);
  }

  async getAccount(customerId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_canary_accounts WHERE customer_id=$1',
      [String(customerId)]
    );
    return accountRow(result.rows[0]);
  }

  async createEvidence(evidence = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_verification_evidence (
         evidence_id, evidence_type, customer_id, spec_sha, credential_fingerprint,
         upstream_base_url, operation_keys_json, field_scope_json, result,
         source_run_id, recipe_id, created_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        String(evidence.evidenceId),
        String(evidence.evidenceType),
        String(evidence.customerId),
        String(evidence.specSha),
        String(evidence.credentialFingerprint),
        String(evidence.upstreamBaseUrl),
        JSON.stringify(evidence.operationKeys || []),
        JSON.stringify(evidence.fieldScope || []),
        String(evidence.result),
        evidence.sourceRunId == null ? null : String(evidence.sourceRunId),
        evidence.recipeId == null ? null : String(evidence.recipeId),
        evidence.createdAt,
        evidence.expiresAt
      ]
    );
    return evidenceRow(result.rows[0]);
  }

  async getEvidence(evidenceId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_verification_evidence WHERE evidence_id=$1',
      [String(evidenceId)]
    );
    return evidenceRow(result.rows[0]);
  }

  async createRun(run = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_canary_runs (
         canary_run_id, customer_id, passive_evidence_id, recipe_id, status,
         started_by_principal_id, spec_sha, credential_fingerprint, upstream_base_url,
         verified_operation_scope_json, started_at, before_spend, after_spend,
         spend_delta, remote_id, cleanup_verified_at, evidence_id, completed_at, last_error_json
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb
       ) RETURNING *`,
      [
        run.canaryRunId,
        String(run.customerId),
        String(run.passiveEvidenceId),
        String(run.recipeId),
        String(run.status),
        String(run.startedByPrincipalId),
        String(run.specSha),
        String(run.credentialFingerprint),
        String(run.upstreamBaseUrl),
        JSON.stringify(run.verifiedOperationScope || {}),
        run.startedAt,
        run.beforeSpend ?? null,
        run.afterSpend ?? null,
        run.spendDelta ?? null,
        run.remoteId ?? null,
        run.cleanupVerifiedAt ?? null,
        run.evidenceId ?? null,
        run.completedAt ?? null,
        run.lastError == null ? null : JSON.stringify(run.lastError)
      ]
    );
    return runRow(result.rows[0]);
  }

  async getRun(canaryRunId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_canary_runs WHERE canary_run_id=$1',
      [canaryRunId]
    );
    return runRow(result.rows[0]);
  }

  async findActiveRun(customerId) {
    const result = await this.pool.query(
      `SELECT * FROM searchad_canary_runs
       WHERE customer_id=$1
         AND status NOT IN ('passed','failed','blocked','spend_detected','expired')
       ORDER BY started_at DESC
       LIMIT 1`,
      [String(customerId)]
    );
    return runRow(result.rows[0]);
  }

  async listRuns({ customerId, status, limit = 100 } = {}) {
    const conditions = [];
    const values = [];
    if (customerId) {
      values.push(String(customerId));
      conditions.push(`customer_id=$${values.length}`);
    }
    if (status) {
      values.push(String(status));
      conditions.push(`status=$${values.length}`);
    }
    values.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT * FROM searchad_canary_runs ${where} ORDER BY started_at DESC LIMIT $${values.length}`,
      values
    );
    return result.rows.map(runRow);
  }

  async updateRun(canaryRunId, patch = {}) {
    const entries = Object.entries(patch).filter(([key]) => Object.hasOwn(RUN_COLUMN_MAP, key));
    if (!entries.length) return this.getRun(canaryRunId);
    const sets = [];
    const values = [];
    for (const [key, value] of entries) {
      values.push(key === 'lastError' && value != null ? JSON.stringify(value) : value);
      const cast = key === 'lastError' ? '::jsonb' : '';
      sets.push(`${RUN_COLUMN_MAP[key]}=$${values.length}${cast}`);
    }
    values.push(canaryRunId);
    const result = await this.pool.query(
      `UPDATE searchad_canary_runs SET ${sets.join(', ')} WHERE canary_run_id=$${values.length} RETURNING *`,
      values
    );
    return runRow(result.rows[0]);
  }

  async addObject(object = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_canary_objects (
         canary_run_id, customer_id, object_type, remote_id, cleanup_status, created_at, cleaned_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        object.canaryRunId,
        String(object.customerId),
        String(object.objectType),
        String(object.remoteId),
        String(object.cleanupStatus),
        object.createdAt,
        object.cleanedAt ?? null
      ]
    );
    return objectRow(result.rows[0]);
  }

  async updateObject(canaryRunId, remoteId, patch = {}) {
    const entries = Object.entries(patch).filter(([key]) => Object.hasOwn(OBJECT_COLUMN_MAP, key));
    if (!entries.length) {
      const rows = await this.listObjects(canaryRunId);
      return rows.find(item => String(item.remoteId) === String(remoteId)) || null;
    }
    const sets = [];
    const values = [];
    for (const [key, value] of entries) {
      values.push(value);
      sets.push(`${OBJECT_COLUMN_MAP[key]}=$${values.length}`);
    }
    values.push(canaryRunId, String(remoteId));
    const result = await this.pool.query(
      `UPDATE searchad_canary_objects
       SET ${sets.join(', ')}
       WHERE canary_run_id=$${values.length - 1} AND remote_id=$${values.length}
       RETURNING *`,
      values
    );
    return objectRow(result.rows[0]);
  }

  async listObjects(canaryRunId) {
    const result = await this.pool.query(
      `SELECT * FROM searchad_canary_objects
       WHERE canary_run_id=$1
       ORDER BY created_at ASC, remote_id ASC`,
      [canaryRunId]
    );
    return result.rows.map(objectRow);
  }

  async addEvent(event = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_canary_events (
         event_id, canary_run_id, customer_id, phase, status,
         operation_key, request_id, error_json, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       RETURNING event_id`,
      [
        event.eventId,
        event.canaryRunId,
        String(event.customerId),
        String(event.phase),
        String(event.status),
        event.operationKey == null ? null : String(event.operationKey),
        event.requestId == null ? null : String(event.requestId),
        event.error == null ? null : JSON.stringify(event.error),
        event.createdAt
      ]
    );
    return result.rows[0]?.event_id || null;
  }
}
