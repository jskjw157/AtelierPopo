import { randomUUID } from 'node:crypto';
import { SearchAdWriteError } from '../write/errors.js';

function cloneJson(value) {
  if (value == null) return value;
  return structuredClone(value);
}

function iso(value) {
  return value?.toISOString?.() || value;
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '');
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

function riskCapacityRow(row) {
  if (!row) return null;
  return {
    customerId: row.customer_id,
    riskDate: dateOnly(row.risk_date),
    capacityUnits: Number(row.capacity_units),
    reservedUnits: Number(row.reserved_units),
    consumedUnits: Number(row.consumed_units),
    updatedAt: iso(row.updated_at)
  };
}

function riskReservationRow(row) {
  if (!row) return null;
  return {
    reservationId: row.reservation_id,
    intentId: row.intent_id,
    customerId: row.customer_id,
    riskDate: dateOnly(row.risk_date),
    operationKey: row.operation_key,
    lifecycleKind: row.lifecycle_kind,
    units: Number(row.units),
    state: row.state,
    ownerKind: row.owner_kind,
    ownerRunId: row.owner_run_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    consumedAt: iso(row.consumed_at),
    releasedAt: iso(row.released_at)
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

function riskError(code, message, status, details = {}) {
  return new SearchAdWriteError(code, message, details, status);
}

function sameReservation(existing, input) {
  return existing.customerId === String(input.customerId)
    && existing.riskDate === dateOnly(input.riskDate)
    && existing.operationKey === String(input.operationKey)
    && existing.lifecycleKind === String(input.lifecycleKind)
    && existing.units === Number(input.units)
    && existing.ownerKind === String(input.ownerKind)
    && existing.ownerRunId === String(input.ownerRunId);
}

async function withTransaction(pool, work) {
  if (typeof pool.connect !== 'function') throw new TypeError('PostgreSQL pool.connect is required for transactional lifecycle persistence');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function lockRiskIntent(client, intentId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [String(intentId)]);
}

async function readRiskBalance(client, customerId, riskDate, { forUpdate = false } = {}) {
  const result = await client.query(
    `SELECT * FROM searchad_daily_risk_capacity
     WHERE customer_id=$1 AND risk_date=$2::date${forUpdate ? ' FOR UPDATE' : ''}`,
    [String(customerId), dateOnly(riskDate)]
  );
  return riskCapacityRow(result.rows[0]);
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

  async getRiskReservation(intentId) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_risk_reservations WHERE intent_id=$1',
      [String(intentId)]
    );
    return riskReservationRow(result.rows[0]);
  }

  async getDailyRiskCapacity(customerId, riskDate) {
    const result = await this.pool.query(
      'SELECT * FROM searchad_daily_risk_capacity WHERE customer_id=$1 AND risk_date=$2::date',
      [String(customerId), dateOnly(riskDate)]
    );
    return riskCapacityRow(result.rows[0]);
  }

  async reserveRisk(input = {}) {
    return withTransaction(this.pool, async client => {
      const intentId = String(input.intentId);
      await lockRiskIntent(client, intentId);

      const existingResult = await client.query(
        'SELECT * FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE',
        [intentId]
      );
      const existing = riskReservationRow(existingResult.rows[0]);
      if (existing) {
        if (!sameReservation(existing, input)) {
          throw riskError('SEARCHAD_RISK_INTENT_CONFLICT', 'Risk intent is already bound to a different immutable reservation.', 409, { intentId });
        }
        const balance = await readRiskBalance(client, existing.customerId, existing.riskDate, { forUpdate: true });
        return { reservation: existing, balance };
      }

      const customerId = String(input.customerId);
      const riskDate = dateOnly(input.riskDate);
      const units = Number(input.units);
      const capacityUnits = Number(input.capacityUnits);
      await client.query(
        `INSERT INTO searchad_daily_risk_capacity (
           customer_id, risk_date, capacity_units, reserved_units, consumed_units, updated_at
         ) VALUES ($1,$2::date,$3,0,0,$4)
         ON CONFLICT (customer_id, risk_date) DO NOTHING`,
        [customerId, riskDate, capacityUnits, input.createdAt]
      );

      const balance = await readRiskBalance(client, customerId, riskDate, { forUpdate: true });
      if (!balance) throw riskError('SEARCHAD_RISK_CAPACITY_MISSING', 'Risk capacity row could not be established.', 500);
      if (balance.capacityUnits !== capacityUnits) {
        throw riskError('SEARCHAD_RISK_CAPACITY_CONFLICT', 'Daily risk capacity is already fixed for this Customer and date.', 409, {
          customerId,
          riskDate
        });
      }
      if (balance.reservedUnits + balance.consumedUnits + units > balance.capacityUnits) {
        throw riskError('SEARCHAD_RISK_CAPACITY_EXCEEDED', 'Daily SearchAd risk capacity would be exceeded.', 409, {
          customerId,
          riskDate
        });
      }

      const capacityResult = await client.query(
        `UPDATE searchad_daily_risk_capacity
         SET reserved_units=reserved_units+$3, updated_at=$4
         WHERE customer_id=$1 AND risk_date=$2::date
         RETURNING *`,
        [customerId, riskDate, units, input.createdAt]
      );
      const reservationResult = await client.query(
        `INSERT INTO searchad_risk_reservations (
           reservation_id, intent_id, customer_id, risk_date, operation_key, lifecycle_kind,
           units, state, owner_kind, owner_run_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,'reserved',$8,$9,$10,$10)
         RETURNING *`,
        [
          randomUUID(),
          intentId,
          customerId,
          riskDate,
          String(input.operationKey),
          String(input.lifecycleKind),
          units,
          String(input.ownerKind),
          String(input.ownerRunId),
          input.createdAt
        ]
      );
      return {
        reservation: riskReservationRow(reservationResult.rows[0]),
        balance: riskCapacityRow(capacityResult.rows[0])
      };
    });
  }

  async consumeRisk({ intentId, updatedAt } = {}) {
    return withTransaction(this.pool, async client => {
      await lockRiskIntent(client, intentId);
      const result = await client.query(
        'SELECT * FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE',
        [String(intentId)]
      );
      let reservation = riskReservationRow(result.rows[0]);
      if (!reservation) {
        throw riskError('SEARCHAD_RISK_RESERVATION_NOT_FOUND', 'Risk reservation was not found.', 404, { intentId: String(intentId) });
      }
      let balance = await readRiskBalance(client, reservation.customerId, reservation.riskDate, { forUpdate: true });
      if (reservation.state === 'consumed') return { reservation, balance };
      if (reservation.state !== 'reserved') {
        throw riskError('SEARCHAD_RISK_STATE_INVALID', 'Only a reserved risk intent can be consumed.', 409, {
          intentId: reservation.intentId,
          state: reservation.state
        });
      }

      const balanceResult = await client.query(
        `UPDATE searchad_daily_risk_capacity
         SET reserved_units=reserved_units-$3, consumed_units=consumed_units+$3, updated_at=$4
         WHERE customer_id=$1 AND risk_date=$2::date
         RETURNING *`,
        [reservation.customerId, reservation.riskDate, reservation.units, updatedAt]
      );
      const reservationResult = await client.query(
        `UPDATE searchad_risk_reservations
         SET state='consumed', updated_at=$2, consumed_at=$2
         WHERE intent_id=$1
         RETURNING *`,
        [reservation.intentId, updatedAt]
      );
      reservation = riskReservationRow(reservationResult.rows[0]);
      balance = riskCapacityRow(balanceResult.rows[0]);
      return { reservation, balance };
    });
  }

  async releaseRisk({ intentId, updatedAt } = {}) {
    return withTransaction(this.pool, async client => {
      await lockRiskIntent(client, intentId);
      const result = await client.query(
        'SELECT * FROM searchad_risk_reservations WHERE intent_id=$1 FOR UPDATE',
        [String(intentId)]
      );
      let reservation = riskReservationRow(result.rows[0]);
      if (!reservation) {
        throw riskError('SEARCHAD_RISK_RESERVATION_NOT_FOUND', 'Risk reservation was not found.', 404, { intentId: String(intentId) });
      }
      let balance = await readRiskBalance(client, reservation.customerId, reservation.riskDate, { forUpdate: true });
      if (reservation.state === 'released') return { reservation, balance };
      if (reservation.state !== 'reserved') {
        throw riskError('SEARCHAD_RISK_STATE_INVALID', 'Consumed SearchAd risk cannot be released or recycled.', 409, {
          intentId: reservation.intentId,
          state: reservation.state
        });
      }

      const balanceResult = await client.query(
        `UPDATE searchad_daily_risk_capacity
         SET reserved_units=reserved_units-$3, updated_at=$4
         WHERE customer_id=$1 AND risk_date=$2::date
         RETURNING *`,
        [reservation.customerId, reservation.riskDate, reservation.units, updatedAt]
      );
      const reservationResult = await client.query(
        `UPDATE searchad_risk_reservations
         SET state='released', updated_at=$2, released_at=$2
         WHERE intent_id=$1
         RETURNING *`,
        [reservation.intentId, updatedAt]
      );
      reservation = riskReservationRow(reservationResult.rows[0]);
      balance = riskCapacityRow(balanceResult.rows[0]);
      return { reservation, balance };
    });
  }
}

export const _internal = {
  runRow,
  objectRow,
  eventRow,
  ownershipRow,
  riskCapacityRow,
  riskReservationRow,
  sameReservation
};
