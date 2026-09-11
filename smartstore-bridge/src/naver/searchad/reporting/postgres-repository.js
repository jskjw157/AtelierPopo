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
  return value == null ? null : String(value);
}

function observationRow(row) {
  if (!row) return null;
  return {
    observationId: row.observation_id,
    customerId: row.customer_id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    operationKey: row.operation_key,
    specSha: row.spec_sha,
    credentialFingerprint: row.credential_fingerprint,
    upstreamBaseUrl: row.upstream_base_url,
    sinceDate: dateOnly(row.since_date),
    untilDate: dateOnly(row.until_date),
    fields: cloneJson(row.fields_json || []),
    timeIncrement: row.time_increment,
    breakdown: row.breakdown,
    rawResponse: cloneJson(row.raw_response_json),
    rawResponseSha256: row.raw_response_sha256,
    salesAmtKrw: row.sales_amt_krw == null ? null : Number(row.sales_amt_krw),
    vatBasis: row.vat_basis,
    cycleBaseTm: row.cycle_base_tm,
    observedAt: iso(row.observed_at),
    sourceRequestId: row.source_request_id,
    validity: row.validity
  };
}

function intentRow(row) {
  if (!row) return null;
  return {
    reportIntentId: row.report_intent_id,
    customerId: row.customer_id,
    reportKind: row.report_kind,
    intentKey: row.intent_key,
    operationKey: row.operation_key,
    request: cloneJson(row.request_json),
    requestSha256: row.request_sha256,
    status: row.status,
    returnedJobId: row.returned_job_id,
    persistedDownloadUrl: row.persisted_download_url,
    createdByPrincipalId: row.created_by_principal_id,
    requestId: row.request_id,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastError: cloneJson(row.last_error_json)
  };
}

function eventRow(row) {
  if (!row) return null;
  return {
    eventId: row.event_id,
    reportIntentId: row.report_intent_id,
    customerId: row.customer_id,
    phase: row.phase,
    status: row.status,
    operationKey: row.operation_key,
    requestId: row.request_id,
    details: cloneJson(row.details_json || {}),
    error: cloneJson(row.error_json),
    createdAt: iso(row.created_at)
  };
}

function blobRow(row, { includeBytes = false } = {}) {
  if (!row) return null;
  return {
    sha256: row.blob_sha256,
    ...(includeBytes ? { contentBytes: row.content_bytes } : {}),
    byteLength: Number(row.byte_length),
    contentType: row.content_type,
    createdAt: iso(row.created_at)
  };
}

function schemaRow(row) {
  if (!row) return null;
  return {
    schemaSha256: row.schema_sha256,
    reportKind: row.report_kind,
    reportType: row.report_type,
    orderedColumns: cloneJson(row.ordered_columns_json || []),
    semanticMapping: cloneJson(row.semantic_mapping_json || {}),
    state: row.state,
    quarantineReason: row.quarantine_reason,
    createdAt: iso(row.created_at),
    reviewedAt: iso(row.reviewed_at),
    reviewedByPrincipalId: row.reviewed_by_principal_id
  };
}

function evidenceRow(row) {
  if (!row) return null;
  return {
    evidenceId: row.evidence_id,
    customerId: row.customer_id,
    entityId: row.entity_id,
    statDate: dateOnly(row.stat_date),
    d1ObservationId: row.d1_observation_id,
    d2ObservationId: row.d2_observation_id,
    d3ObservationId: row.d3_observation_id,
    salesAmtKrw: Number(row.sales_amt_krw),
    vatBasis: row.vat_basis,
    stabilizedByPolicy: Boolean(row.stabilized_by_policy),
    stabilizationPolicy: row.stabilization_policy,
    sourceSpecSha: row.source_spec_sha,
    credentialFingerprint: row.credential_fingerprint,
    upstreamBaseUrl: row.upstream_base_url,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at)
  };
}

function intentConflict(existing, input) {
  return new SearchAdWriteError(
    'SEARCHAD_REPORT_INTENT_CONFLICT',
    'The report intent key already exists with a different request.',
    {
      customerId: String(input.customerId),
      reportKind: String(input.reportKind),
      intentKey: String(input.intentKey),
      existingReportIntentId: existing?.reportIntentId || null
    },
    409
  );
}

const INTENT_PATCH_COLUMNS = Object.freeze({
  status: 'status',
  returnedJobId: 'returned_job_id',
  persistedDownloadUrl: 'persisted_download_url',
  updatedAt: 'updated_at',
  lastError: 'last_error_json'
});

const SCHEMA_PATCH_COLUMNS = Object.freeze({
  state: 'state',
  semanticMapping: 'semantic_mapping_json',
  quarantineReason: 'quarantine_reason',
  reviewedAt: 'reviewed_at',
  reviewedByPrincipalId: 'reviewed_by_principal_id'
});

function patchValue(key, value) {
  if (key === 'lastError' || key === 'semanticMapping') return value == null ? null : JSON.stringify(value);
  return value;
}

function patchCast(key) {
  return key === 'lastError' || key === 'semanticMapping' ? '::jsonb' : '';
}

async function patchById(pool, { table, idColumn, id, customerId = null, patch, allowed, mapper }) {
  const entries = Object.entries(patch || {}).filter(([key]) => allowed[key]);
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
  const sets = entries.map(([key, value]) => {
    values.push(patchValue(key, value));
    return `${allowed[key]}=$${values.length}${patchCast(key)}`;
  });
  let where = `${idColumn}=$1`;
  if (customerId != null) {
    values.push(String(customerId));
    where += ` AND customer_id=$${values.length}`;
  }
  const result = await pool.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where} RETURNING *`,
    values
  );
  return mapper(result.rows[0]);
}

export class PostgresSearchAdReportingRepository {
  constructor({ pool } = {}) {
    if (!pool?.query) throw new TypeError('PostgreSQL pool is required');
    this.pool = pool;
  }

  async createObservation(row = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_stats_observations (
         observation_id, customer_id, entity_id, entity_type, operation_key,
         spec_sha, credential_fingerprint, upstream_base_url, since_date, until_date,
         fields_json, time_increment, breakdown, raw_response_json, raw_response_sha256,
         sales_amt_krw, vat_basis, cycle_base_tm, observed_at, source_request_id, validity
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11::jsonb,$12,$13,$14::jsonb,$15,
         $16,$17,$18,$19,$20,$21
       ) RETURNING *`,
      [
        row.observationId,
        String(row.customerId),
        String(row.entityId),
        row.entityType == null ? null : String(row.entityType),
        String(row.operationKey),
        String(row.specSha),
        String(row.credentialFingerprint),
        String(row.upstreamBaseUrl),
        dateOnly(row.sinceDate),
        dateOnly(row.untilDate),
        JSON.stringify(row.fields || []),
        String(row.timeIncrement || 'allDays'),
        row.breakdown == null ? null : String(row.breakdown),
        JSON.stringify(row.rawResponse ?? {}),
        String(row.rawResponseSha256),
        row.salesAmtKrw == null ? null : Number(row.salesAmtKrw),
        String(row.vatBasis || 'VAT_INCLUDED'),
        row.cycleBaseTm == null ? null : String(row.cycleBaseTm),
        row.observedAt,
        row.sourceRequestId || null,
        String(row.validity)
      ]
    );
    return observationRow(result.rows[0]);
  }

  async getObservation(observationId, customerId = null) {
    const values = [observationId];
    let where = 'observation_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(`SELECT * FROM searchad_stats_observations WHERE ${where}`, values);
    return observationRow(result.rows[0]);
  }

  async listObservations({ customerIds = [], entityId = null, validity = null, limit = 100 } = {}) {
    const ids = [...new Set((customerIds || []).map(String).filter(Boolean))];
    if (!ids.length) return [];
    const values = [ids];
    const where = ['customer_id = ANY($1::text[])'];
    if (entityId != null) {
      values.push(String(entityId));
      where.push(`entity_id=$${values.length}`);
    }
    if (validity != null) {
      values.push(String(validity));
      where.push(`validity=$${values.length}`);
    }
    values.push(Math.max(1, Math.min(1000, Number(limit) || 100)));
    const result = await this.pool.query(
      `SELECT * FROM searchad_stats_observations
       WHERE ${where.join(' AND ')}
       ORDER BY observed_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows.map(observationRow);
  }

  async createOrGetReportIntent(row = {}) {
    const inserted = await this.pool.query(
      `INSERT INTO searchad_report_intents (
         report_intent_id, customer_id, report_kind, intent_key, operation_key,
         request_json, request_sha256, status, returned_job_id, persisted_download_url,
         created_by_principal_id, request_id, created_at, updated_at, last_error_json
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       ON CONFLICT (customer_id, report_kind, intent_key) DO NOTHING
       RETURNING *`,
      [
        row.reportIntentId,
        String(row.customerId),
        String(row.reportKind),
        String(row.intentKey),
        String(row.operationKey),
        JSON.stringify(row.request ?? {}),
        String(row.requestSha256),
        String(row.status),
        row.returnedJobId || null,
        row.persistedDownloadUrl || null,
        String(row.createdByPrincipalId),
        row.requestId || null,
        row.createdAt,
        row.updatedAt,
        row.lastError == null ? null : JSON.stringify(row.lastError)
      ]
    );
    if (inserted.rows[0]) return intentRow(inserted.rows[0]);
    const existing = await this.findReportIntentByKey(row.customerId, row.reportKind, row.intentKey);
    if (!existing
      || existing.requestSha256 !== String(row.requestSha256)
      || existing.operationKey !== String(row.operationKey)) {
      throw intentConflict(existing, row);
    }
    return existing;
  }

  async getReportIntent(reportIntentId, customerId = null) {
    const values = [reportIntentId];
    let where = 'report_intent_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(`SELECT * FROM searchad_report_intents WHERE ${where}`, values);
    return intentRow(result.rows[0]);
  }

  async findReportIntentByKey(customerId, reportKind, intentKey) {
    const result = await this.pool.query(
      `SELECT * FROM searchad_report_intents
       WHERE customer_id=$1 AND report_kind=$2 AND intent_key=$3`,
      [String(customerId), String(reportKind), String(intentKey)]
    );
    return intentRow(result.rows[0]);
  }

  async claimReportDispatch(reportIntentId, customerId, updatedAt) {
    const result = await this.pool.query(
      `UPDATE searchad_report_intents
       SET status='dispatching', updated_at=$3
       WHERE report_intent_id=$1 AND customer_id=$2 AND status='planned'
       RETURNING *`,
      [reportIntentId, String(customerId), updatedAt]
    );
    if (result.rows[0]) {
      return { claimed: true, intent: intentRow(result.rows[0]) };
    }
    return {
      claimed: false,
      intent: await this.getReportIntent(reportIntentId, customerId)
    };
  }

  async updateReportIntent(reportIntentId, patch = {}, customerId = null) {
    return patchById(this.pool, {
      table: 'searchad_report_intents',
      idColumn: 'report_intent_id',
      id: reportIntentId,
      customerId,
      patch,
      allowed: INTENT_PATCH_COLUMNS,
      mapper: intentRow
    });
  }

  async appendReportEvent(row = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_report_events (
         event_id, report_intent_id, customer_id, phase, status, operation_key,
         request_id, details_json, error_json, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
       RETURNING *`,
      [
        row.eventId,
        row.reportIntentId,
        String(row.customerId),
        String(row.phase),
        String(row.status),
        row.operationKey || null,
        row.requestId || null,
        JSON.stringify(row.details || {}),
        row.error == null ? null : JSON.stringify(row.error),
        row.createdAt
      ]
    );
    return eventRow(result.rows[0]);
  }

  async listReportEvents(reportIntentId, customerId = null) {
    const values = [reportIntentId];
    let where = 'report_intent_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(
      `SELECT * FROM searchad_report_events WHERE ${where} ORDER BY created_at ASC, event_id ASC`,
      values
    );
    return result.rows.map(eventRow);
  }

  async putBlob({ sha256, contentBytes, byteLength, contentType, createdAt } = {}) {
    const bytes = Buffer.isBuffer(contentBytes) ? contentBytes : Buffer.from(contentBytes || []);
    const inserted = await this.pool.query(
      `INSERT INTO searchad_report_blobs(blob_sha256, content_bytes, byte_length, content_type, created_at)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT (blob_sha256) DO NOTHING
       RETURNING *`,
      [String(sha256), bytes, Number(byteLength), String(contentType), createdAt]
    );
    if (inserted.rows[0]) return blobRow(inserted.rows[0]);
    const existing = await this.pool.query('SELECT * FROM searchad_report_blobs WHERE blob_sha256=$1', [String(sha256)]);
    const mapped = blobRow(existing.rows[0]);
    if (!mapped || mapped.byteLength !== Number(byteLength)) {
      throw new SearchAdWriteError(
        'SEARCHAD_REPORT_BLOB_CONFLICT',
        'A report blob SHA already exists with conflicting metadata.',
        { sha256: String(sha256) },
        409
      );
    }
    return mapped;
  }

  async getBlobMetadata(sha256) {
    const result = await this.pool.query(
      'SELECT blob_sha256, byte_length, content_type, created_at FROM searchad_report_blobs WHERE blob_sha256=$1',
      [String(sha256)]
    );
    return blobRow(result.rows[0]);
  }

  async getBlob(sha256) {
    const result = await this.pool.query('SELECT * FROM searchad_report_blobs WHERE blob_sha256=$1', [String(sha256)]);
    return blobRow(result.rows[0], { includeBytes: true });
  }

  async linkJobBlob(row = {}) {
    const inserted = await this.pool.query(
      `INSERT INTO searchad_report_job_blobs(
         job_blob_id, report_intent_id, customer_id, returned_job_id,
         blob_sha256, schema_sha256, downloaded_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (report_intent_id, blob_sha256) DO NOTHING
       RETURNING *`,
      [
        row.jobBlobId,
        row.reportIntentId,
        String(row.customerId),
        String(row.returnedJobId),
        String(row.blobSha256),
        row.schemaSha256 || null,
        row.downloadedAt
      ]
    );
    if (inserted.rows[0]) return {
      jobBlobId: inserted.rows[0].job_blob_id,
      reportIntentId: inserted.rows[0].report_intent_id,
      customerId: inserted.rows[0].customer_id,
      returnedJobId: inserted.rows[0].returned_job_id,
      blobSha256: inserted.rows[0].blob_sha256,
      schemaSha256: inserted.rows[0].schema_sha256,
      downloadedAt: iso(inserted.rows[0].downloaded_at)
    };
    const existing = await this.pool.query(
      `SELECT * FROM searchad_report_job_blobs WHERE report_intent_id=$1 AND blob_sha256=$2`,
      [row.reportIntentId, String(row.blobSha256)]
    );
    const value = existing.rows[0];
    return value ? {
      jobBlobId: value.job_blob_id,
      reportIntentId: value.report_intent_id,
      customerId: value.customer_id,
      returnedJobId: value.returned_job_id,
      blobSha256: value.blob_sha256,
      schemaSha256: value.schema_sha256,
      downloadedAt: iso(value.downloaded_at)
    } : null;
  }

  async getSchema(schemaSha256) {
    const result = await this.pool.query('SELECT * FROM searchad_report_schemas WHERE schema_sha256=$1', [String(schemaSha256)]);
    return schemaRow(result.rows[0]);
  }

  async putSchema(row = {}) {
    const inserted = await this.pool.query(
      `INSERT INTO searchad_report_schemas(
         schema_sha256, report_kind, report_type, ordered_columns_json,
         semantic_mapping_json, state, quarantine_reason, created_at,
         reviewed_at, reviewed_by_principal_id
       ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10)
       ON CONFLICT (schema_sha256) DO NOTHING
       RETURNING *`,
      [
        String(row.schemaSha256),
        String(row.reportKind),
        String(row.reportType),
        JSON.stringify(row.orderedColumns || []),
        JSON.stringify(row.semanticMapping || {}),
        String(row.state),
        row.quarantineReason || null,
        row.createdAt,
        row.reviewedAt || null,
        row.reviewedByPrincipalId || null
      ]
    );
    if (inserted.rows[0]) return schemaRow(inserted.rows[0]);
    return this.getSchema(row.schemaSha256);
  }

  async updateSchemaReview(schemaSha256, patch = {}) {
    return patchById(this.pool, {
      table: 'searchad_report_schemas',
      idColumn: 'schema_sha256',
      id: String(schemaSha256),
      patch,
      allowed: SCHEMA_PATCH_COLUMNS,
      mapper: schemaRow
    });
  }

  async createStabilizedEvidence(row = {}) {
    const result = await this.pool.query(
      `INSERT INTO searchad_stabilized_spend_evidence(
         evidence_id, customer_id, entity_id, stat_date,
         d1_observation_id, d2_observation_id, d3_observation_id,
         sales_amt_krw, vat_basis, stabilized_by_policy, stabilization_policy,
         source_spec_sha, credential_fingerprint, upstream_base_url, created_at, expires_at
       ) VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        row.evidenceId,
        String(row.customerId),
        String(row.entityId),
        dateOnly(row.statDate),
        row.d1ObservationId || null,
        row.d2ObservationId || null,
        row.d3ObservationId,
        Number(row.salesAmtKrw),
        String(row.vatBasis || 'VAT_INCLUDED'),
        Boolean(row.stabilizedByPolicy),
        String(row.stabilizationPolicy || 'D3'),
        String(row.sourceSpecSha),
        String(row.credentialFingerprint),
        String(row.upstreamBaseUrl),
        row.createdAt,
        row.expiresAt
      ]
    );
    return evidenceRow(result.rows[0]);
  }

  async getStabilizedEvidence(evidenceId, customerId = null) {
    const values = [evidenceId];
    let where = 'evidence_id=$1';
    if (customerId != null) {
      values.push(String(customerId));
      where += ` AND customer_id=$${values.length}`;
    }
    const result = await this.pool.query(`SELECT * FROM searchad_stabilized_spend_evidence WHERE ${where}`, values);
    return evidenceRow(result.rows[0]);
  }

  async findLatestStabilizedEvidence({ customerId, entityId, statDate } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM searchad_stabilized_spend_evidence
       WHERE customer_id=$1 AND entity_id=$2 AND stat_date=$3::date
       ORDER BY created_at DESC, evidence_id DESC
       LIMIT 1`,
      [String(customerId), String(entityId), dateOnly(statDate)]
    );
    return evidenceRow(result.rows[0]);
  }
}
