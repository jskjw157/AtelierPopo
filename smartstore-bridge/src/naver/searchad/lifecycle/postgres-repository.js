function cloneJson(value) {
  if (value == null) return value;
  return structuredClone(value);
}

function iso(value) {
  return value?.toISOString?.() || value;
}

function runRow(row) {
  if (!row) return null;
  return {
    hierarchyRunId: row.hierarchy_run_id,
    customerId: row.customer_id,
    recipeId: row.recipe_id,
    status: row.status,
    startedByPrincipalId: row.started_by_principal_id,
    specSha: row.spec_sha,
    credentialFingerprint: row.credential_fingerprint,
    upstreamBaseUrl: row.upstream_base_url,
    activationId: row.activation_id,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    lastError: cloneJson(row.last_error_json)
  };
}

function objectRow(row) {
  if (!row) return null;
  return {
    hierarchyObjectId: row.hierarchy_object_id,
    hierarchyRunId: row.hierarchy_run_id,
    customerId: row.customer_id,
    objectType: row.object_type,
    parentObjectId: row.parent_object_id,
    createOperationKey: row.create_operation_key,
    readOperationKey: row.read_operation_key,
    deleteOperationKey: row.delete_operation_key,
    remoteId: row.remote_id,
    state: row.state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: iso(row.deleted_at)
  };
}

function eventRow(row) {
  if (!row) return null;
  return {
    eventId: row.event_id,
    hierarchyRunId: row.hierarchy_run_id,
    hierarchyObjectId: row.hierarchy_object_id,
    customerId: row.customer_id,
    phase: row.phase,
    status: row.status,
    operationKey: row.operation_key,
    lifecycleKind: row.lifecycle_kind,
    requestId: row.request_id,
    details: cloneJson(row.details_json || {}),
    error: cloneJson(row.error_json),
    createdAt: iso(row.created_at)
  };
}

function ownershipRow(row) {
  if (!row) return null;
  return {
    ownershipId: row.ownership_id,
    customerId: row.customer_id,
    objectType: row.object_type,
    remoteId: row.remote_id,
    ownerKind: row.owner_kind,
    ownerRunId: row.owner_run_id,
    hierarchyObjectId: row.hierarchy_object_id,
    parentHierarchyObjectId: row.parent_hierarchy_object_id,
    createdOperationKey: row.created_operation_key,
    state: row.state,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

const RUN_PATCH_COLUMNS = Object.freeze({
  status: 'status',
  activationId: 'activation_id',
  completedAt: 'completed_at',
  lastError: 'last_error_json'
});

const OBJECT_PATCH_COLUMNS = Object.freeze({
  remoteId: 'remote_id',
  state: 'state',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at'
});

const OWNERSHIP_PATCH_COLUMNS = Object.freeze({
  state: 'state',
  updatedAt: 'updated_at'
});

function jsonPatchValue(key, value) {
  if (key === 'lastError') return value == null ? null : JSON.stringify(value);
  return value;
}

async function patchById(pool, { table, idColumn, id, customerId, patch, allowedColumns, mapper }) {
  const entries = Object.entries(patch || {}).filter(([key]) => allowedColumns[key]);
  if (!entries.length) {
    const params = [id];
    let where = `${idColumn}=$1`;
    if (customerId != null) {
      params.push(String(customerId));
      where += ` AND customer_id=$${params.length}`;
    }
    const current = await pool.query(`SELECT * FROM ${table} WHERE ${where}`, params);
    return mapper(current.rows[0]);
  }
  const values = [id];
  const assignments = entries.map(([key, value]) => {
    values.push(jsonPatchValue(key, value));
    const cast = key === 'lastError' ? '::jsonb' : '';
    return `${allowedColumns[key]}=$${values.length}${cast}`;
  });
  let where = `${idColumn}=$1`;
  if (customerId != null) {
    values.push(String(customerId));
    where += ` AND customer_id=$${values.length}`;
  }
  const result = await pool.query(
    `UPDATE ${table} SET ${assignments.join(', ')} WHERE ${where} RETURNING *`,
    values
  );
  return mapper(result.rows[0]);
}

export class PostgresSearchAdLifecycleRepository {
  constructor({ pool } = {}) {
    if (!pool?.query) throw new TypeError('PostgreSQL pool is required');
    this.pool = pool;
  }

  async createRun(run = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_hierarchy_canary_runs (
         hierarchy_run_id, customer_id, recipe_id, status, started_by_principal_id,
         spec_sha, credential_fingerprint, upstream_base_url, activation_id,
         started_at, completed_at, last_error_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       RETURNING *`,
      [
        run.hierarchyRunId,
        String(run.customerId),
        String(run.recipeId),
        String(run.status),
        String(run.startedByPrincipalId),
        String(run.specSha),
        String(run.credentialFingerprint),
        String(run.upstreamBaseUrl),
        run.activationId || null,
        run.startedAt,
        run.completedAt || null,
        run.lastError == null ? null : JSON.stringify(run.lastError)
      ]
    );
    return runRow(result.rows[0]);
  }

  async getRun(hierarchyRunId, customerId = null) {
    const values = [hierarchyRunId];
    let where = 'hierarchy_run_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(`SELECT * FROM searchad_hierarchy_canary_runs WHERE ${where}`, values);
    return runRow(result.rows[0]);
  }

  async listRuns({ customerIds = [], statuses = [], limit = 100 } = {}) {
    const ids = [...new Set((customerIds || []).map(String).filter(Boolean))];
    if (!ids.length) return [];
    const values = [ids];
    const conditions = ['customer_id = ANY($1::text[])'];
    const normalizedStatuses = [...new Set((statuses || []).map(String).filter(Boolean))];
    if (normalizedStatuses.length) {
      values.push(normalizedStatuses);
      conditions.push(`status = ANY($${values.length}::text[])`);
    }
    values.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    const result = await this.pool.query(
      `SELECT * FROM searchad_hierarchy_canary_runs
       WHERE ${conditions.join(' AND ')}
       ORDER BY started_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(runRow);
  }

  async updateRun(hierarchyRunId, patch = {}, customerId = null) {
    return patchById(this.pool, {
      table: 'searchad_hierarchy_canary_runs',
      idColumn: 'hierarchy_run_id',
      id: hierarchyRunId,
      customerId,
      patch,
      allowedColumns: RUN_PATCH_COLUMNS,
      mapper: runRow
    });
  }

  async createObject(object = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_hierarchy_objects (
         hierarchy_object_id, hierarchy_run_id, customer_id, object_type, parent_object_id,
         create_operation_key, read_operation_key, delete_operation_key, remote_id, state,
         created_at, updated_at, deleted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        object.hierarchyObjectId,
        object.hierarchyRunId,
        String(object.customerId),
        String(object.objectType),
        object.parentObjectId || null,
        String(object.createOperationKey),
        String(object.readOperationKey),
        String(object.deleteOperationKey),
        object.remoteId == null ? null : String(object.remoteId),
        String(object.state),
        object.createdAt,
        object.updatedAt,
        object.deletedAt || null
      ]
    );
    return objectRow(result.rows[0]);
  }

  async getObject(hierarchyObjectId, customerId = null) {
    const values = [hierarchyObjectId];
    let where = 'hierarchy_object_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(`SELECT * FROM searchad_hierarchy_objects WHERE ${where}`, values);
    return objectRow(result.rows[0]);
  }

  async listObjects(hierarchyRunId, customerId = null) {
    const values = [hierarchyRunId];
    let where = 'hierarchy_run_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(
      `SELECT * FROM searchad_hierarchy_objects WHERE ${where} ORDER BY created_at ASC, hierarchy_object_id ASC`,
      values
    );
    return result.rows.map(objectRow);
  }

  async updateObject(hierarchyObjectId, patch = {}, customerId = null) {
    return patchById(this.pool, {
      table: 'searchad_hierarchy_objects',
      idColumn: 'hierarchy_object_id',
      id: hierarchyObjectId,
      customerId,
      patch,
      allowedColumns: OBJECT_PATCH_COLUMNS,
      mapper: objectRow
    });
  }

  async listLiveChildren(parentObjectId, customerId = null) {
    const values = [parentObjectId];
    let where = `parent_object_id=$1 AND state <> 'deleted'`;
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(
      `SELECT * FROM searchad_hierarchy_objects WHERE ${where} ORDER BY created_at ASC, hierarchy_object_id ASC`,
      values
    );
    return result.rows.map(objectRow);
  }

  async addEvent(event = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_hierarchy_events (
         event_id, hierarchy_run_id, hierarchy_object_id, customer_id, phase, status,
         operation_key, lifecycle_kind, request_id, details_json, error_json, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
       RETURNING *`,
      [
        event.eventId,
        event.hierarchyRunId,
        event.hierarchyObjectId || null,
        String(event.customerId),
        String(event.phase),
        String(event.status),
        event.operationKey == null ? null : String(event.operationKey),
        event.lifecycleKind == null ? null : String(event.lifecycleKind),
        event.requestId == null ? null : String(event.requestId),
        JSON.stringify(event.details || {}),
        event.error == null ? null : JSON.stringify(event.error),
        event.createdAt
      ]
    );
    return eventRow(result.rows[0]);
  }

  async listEvents(hierarchyRunId, customerId = null) {
    const values = [hierarchyRunId];
    let where = 'hierarchy_run_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(
      `SELECT * FROM searchad_hierarchy_events WHERE ${where} ORDER BY created_at ASC, event_id ASC`,
      values
    );
    return result.rows.map(eventRow);
  }

  async holdOwnership(ownership = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_remote_object_ownership (
         ownership_id, customer_id, object_type, remote_id, owner_kind, owner_run_id,
         hierarchy_object_id, parent_hierarchy_object_id, created_operation_key, state,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        ownership.ownershipId,
        String(ownership.customerId),
        String(ownership.objectType),
        String(ownership.remoteId),
        String(ownership.ownerKind),
        String(ownership.ownerRunId),
        ownership.hierarchyObjectId || null,
        ownership.parentHierarchyObjectId || null,
        String(ownership.createdOperationKey),
        String(ownership.state),
        ownership.createdAt,
        ownership.updatedAt
      ]
    );
    return ownershipRow(result.rows[0]);
  }

  async getOwnership({ customerId, objectType, remoteId } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM searchad_remote_object_ownership
       WHERE customer_id=$1 AND object_type=$2 AND remote_id=$3`,
      [String(customerId), String(objectType), String(remoteId)]
    );
    return ownershipRow(result.rows[0]);
  }

  async listOwnershipByRun({ ownerKind, ownerRunId, customerId = null } = {}) {
    const values = [String(ownerKind), String(ownerRunId)];
    let where = 'owner_kind=$1 AND owner_run_id=$2';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(
      `SELECT * FROM searchad_remote_object_ownership WHERE ${where} ORDER BY created_at ASC, ownership_id ASC`,
      values
    );
    return result.rows.map(ownershipRow);
  }

  async updateOwnership(ownershipId, patch = {}, customerId = null) {
    return patchById(this.pool, {
      table: 'searchad_remote_object_ownership',
      idColumn: 'ownership_id',
      id: ownershipId,
      customerId,
      patch,
      allowedColumns: OWNERSHIP_PATCH_COLUMNS,
      mapper: ownershipRow
    });
  }
}

export const _internal = { runRow, objectRow, eventRow, ownershipRow };
