import { randomUUID } from 'node:crypto';
import { contentHash } from '../write/canonical.js';
import { validateReportJobInput } from './job-service.js';
import { validateStatsInput, reportingError, strictDecimal, validateIdentity, cycleTimestamp, utcTimestamp } from './contracts.js';
function iso(value) { return value instanceof Date ? value.toISOString() : value; }
function map(row) {
  if (!row) return null;
  return { observationId: row.observation_id, customerId: row.customer_id, entityType: row.entity_type, entityId: row.entity_id, since: iso(row.since_kst)?.slice(0, 10), until: iso(row.until_kst)?.slice(0, 10), specSha: row.spec_sha, credentialFingerprint: row.credential_fingerprint, upstreamBaseUrl: row.upstream_base_url, observedAt: iso(row.observed_at), sourceRequestId: row.source_request_id, collectionRequestId: row.collection_request_id, collectedByPrincipalId: row.collected_by_principal_id, responseSha: row.response_sha, cycleBaseTm: row.cycle_base_tm, cycleAt: iso(row.cycle_at), quality: row.quality, rangeBasis: row.range_basis, entityTypeBasis: row.entity_type_basis, missingMetrics: row.missing_metrics_json, metrics: { spendGrossKrw: row.spend_gross_krw, impressions: row.impressions, clicks: row.clicks, conversions: row.conversions, conversionAmountKrw: row.conversion_amount_krw, currency: row.currency, spendBasis: row.spend_basis } };
}
function mapJob(row) {
  if (!row) return null;
  return { reportJobId: row.report_job_id, customerId: row.customer_id, kind: row.report_kind, reportType: row.report_type, statDate: iso(row.stat_date)?.slice(0,10) ?? null, fromTime: iso(row.from_time) ?? null, intentKey: row.intent_key, requestHash: row.intent_hash, specSha: row.spec_sha, credentialFingerprint: row.credential_fingerprint, upstreamBaseUrl: row.upstream_base_url, claimId: row.dispatch_claim_id ?? null, remoteJobId: row.remote_job_id ?? null, processingState: row.processing_state, quality: row.quality, reportCreatedAt: iso(row.report_created_at) ?? null, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), lastErrorCode: row.last_error_code ?? null, remoteUpdatedAt: row.metadata_json?.remoteUpdatedAt ?? null, registrationAttemptedAt: row.metadata_json?.registrationAttemptedAt ?? null, registrationAcknowledgedAt: row.metadata_json?.registrationAcknowledgedAt ?? null, registrationInitiatedAt: row.metadata_json?.registrationInitiatedAt ?? null, firstBuiltObservedAt: row.metadata_json?.firstBuiltObservedAt ?? null, generationTimeBasis: row.report_kind === 'master' && row.report_created_at ? 'response_generation_time' : row.metadata_json?.firstBuiltObservedAt && row.metadata_json?.registrationAttemptedAt ? 'derived_window' : 'unavailable' };
}
function jobId(value) { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value); }
export class PostgresReportingRepository {
  #dispatchPermits = new WeakMap();
  constructor({ pool, clock = Date.now }) { Object.assign(this, { pool, clock }); }
  async createReportIntent(intent) {
    const scope = validateReportJobInput({ customerId: intent.customerId, kind: intent.kind, reportType: intent.reportType, intentKey: intent.intentKey, ...(intent.kind === 'stat' ? { statDate: intent.statDate } : intent.fromTime ? { fromTime: intent.fromTime } : {}) });
    const identity = validateIdentity(intent, intent.customerId);
    if (!jobId(intent.reportJobId) || intent.requestHash !== contentHash({ ...scope, ...identity }) || typeof intent.registeredByPrincipalId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(intent.registeredByPrincipalId)) throw reportingError('SEARCHAD_REPORT_INPUT_INVALID');
    const createdAt = utcTimestamp(intent.createdAt);
    try {
      const result = await this.pool.query(`INSERT INTO searchad_report_jobs(report_job_id,customer_id,report_kind,report_type,stat_date,from_time,intent_key,intent_hash,intent_json,spec_sha,credential_fingerprint,upstream_base_url,state,processing_state,quality,registered_by_principal_id,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,'planned','planned','provisional',$13,$14,$14)
        ON CONFLICT(customer_id,report_kind,intent_key) DO NOTHING RETURNING *,stat_date::text AS stat_date`, [intent.reportJobId,scope.customerId,scope.kind,scope.reportType,scope.statDate,scope.fromTime,scope.intentKey,intent.requestHash,JSON.stringify(scope),identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,intent.registeredByPrincipalId,createdAt]);
      if (result.rows.length === 1) {
        const row = mapJob(result.rows[0]);
        const dispatchPermit = Object.freeze(Object.create(null));
        this.#dispatchPermits.set(dispatchPermit, { customerId: row.customerId, reportJobId: row.reportJobId, requestHash: row.requestHash, identity });
        return { ...row, created: true, dispatchPermit };
      }
      const row = mapJob((await this.pool.query('SELECT *,stat_date::text AS stat_date FROM searchad_report_jobs WHERE customer_id=$1 AND report_kind=$2 AND intent_key=$3', [scope.customerId,scope.kind,scope.intentKey])).rows[0]);
      if (!row) throw new Error('intent unavailable');
      if (row.requestHash !== intent.requestHash) throw reportingError('SEARCHAD_REPORT_INTENT_CONFLICT', 409);
      return { ...row, created: false };
    } catch (error) { if (error?.code === 'SEARCHAD_REPORT_INTENT_CONFLICT') throw error; throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  async claimReportDispatch({ customerId, reportJobId, requestHash, identity, dispatchPermit, now }) {
    const binding = dispatchPermit && this.#dispatchPermits.get(dispatchPermit);
    // Consume BEFORE the first await. No persisted row, nonce, retry, or new
    // repository instance can reconstruct a permit, including after DB failure.
    if (dispatchPermit) this.#dispatchPermits.delete(dispatchPermit);
    if (!binding || binding.customerId !== customerId || binding.reportJobId !== reportJobId || binding.requestHash !== requestHash || contentHash(binding.identity) !== contentHash(identity)) return null;
    validateIdentity(identity, customerId);
    const claimId = randomUUID(); let client, commitAttempted = false, discard = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      const result = await client.query(`UPDATE searchad_report_jobs SET dispatch_claim_id=$1,dispatch_claimed_at=$2,processing_state='dispatching',state='dispatching',updated_at=$2
        WHERE customer_id=$3 AND report_job_id=$4 AND intent_hash=$5 AND processing_state='planned' AND dispatch_claim_id IS NULL AND remote_job_id IS NULL AND spec_sha=$6 AND credential_fingerprint=$7 AND upstream_base_url=$8 RETURNING *,stat_date::text AS stat_date`, [claimId,new Date(now).toISOString(),customerId,reportJobId,requestHash,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl]);
      commitAttempted = true;
      await client.query('COMMIT');
      return mapJob(result.rows[0]);
    } catch {
      discard = true;
      if (!commitAttempted && client) { try { await client.query('ROLLBACK'); } catch { /* discard */ } }
      // Discard the uncertain connection before diagnostic writes so its
      // abandoned transaction cannot hold this job's row lock indefinitely.
      if (client) { try { client.release(true); } catch { /* discarded */ } client = null; }
      // Best effort diagnostic quarantine; never the source of the guarantee.
      if (commitAttempted) { try { await this.pool.query(`UPDATE searchad_report_jobs SET processing_state='unknown_outcome',state='unknown_outcome',last_error_code='SEARCHAD_REPORT_CLAIM_UNRESOLVED',updated_at=$1 WHERE customer_id=$2 AND report_job_id=$3 AND intent_hash=$4 AND remote_job_id IS NULL AND (dispatch_claim_id=$5 OR (dispatch_claim_id IS NULL AND processing_state='planned'))`, [new Date(now).toISOString(),customerId,reportJobId,requestHash,claimId]); } catch { /* Existing intents still have no fresh creator authority. */ } }
      throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503);
    } finally { if (client) { try { client.release(discard); } catch { /* claim cannot be reissued */ } } }
  }
  async captureReportRegistration({ customerId, reportJobId, claimId, remoteJobId, reportCreatedAt, remoteUpdatedAt = null, registrationAttemptedAt, registrationInitiatedAt = null, registrationAcknowledgedAt, identity, now }) {
    validateIdentity(identity, customerId);
    if (!jobId(reportJobId) || !jobId(claimId) || typeof remoteJobId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(remoteJobId)) throw reportingError('SEARCHAD_REPORT_INPUT_INVALID');
    const timestamp = reportCreatedAt === null ? null : utcTimestamp(reportCreatedAt);
    const metadata = { remoteUpdatedAt: remoteUpdatedAt === null ? null : utcTimestamp(remoteUpdatedAt), registrationAttemptedAt: utcTimestamp(registrationAttemptedAt), registrationAcknowledgedAt: utcTimestamp(registrationAcknowledgedAt), registrationAttemptBasis: 'local_attempt_start', registrationInitiatedAt: registrationInitiatedAt === null ? null : utcTimestamp(registrationInitiatedAt), registrationInitiationBasis: registrationInitiatedAt === null ? 'unavailable' : 'account_fenced_transport_entry' };
    if (Date.parse(metadata.registrationAcknowledgedAt) < Date.parse(metadata.registrationAttemptedAt) || (registrationInitiatedAt !== null && (Date.parse(metadata.registrationInitiatedAt) < Date.parse(metadata.registrationAttemptedAt) || Date.parse(metadata.registrationInitiatedAt) > Date.parse(metadata.registrationAcknowledgedAt)))) throw reportingError('SEARCHAD_REPORT_INPUT_INVALID');
    try {
      const row = mapJob((await this.pool.query(`UPDATE searchad_report_jobs SET remote_job_id=$1,report_created_at=$2,dispatched_at=$3,processing_state='registered',state='registered',updated_at=$3,metadata_json=metadata_json || $10::jsonb
        WHERE customer_id=$4 AND report_job_id=$5 AND dispatch_claim_id=$6 AND processing_state='dispatching' AND remote_job_id IS NULL AND spec_sha=$7 AND credential_fingerprint=$8 AND upstream_base_url=$9 RETURNING *,stat_date::text AS stat_date`, [remoteJobId,timestamp,new Date(now).toISOString(),customerId,reportJobId,claimId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,JSON.stringify(metadata)])).rows[0]);
      if (!row) throw new Error('capture unavailable');
      return row;
    } catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  async settleReportJob({ customerId, reportJobId, claimId, processingState, quality = null, lastErrorCode = null, remoteUpdatedAt, reportCreatedAt, now }) {
    if (!jobId(reportJobId) || (claimId !== null && !jobId(claimId)) || !['registered','polling','built','unknown_outcome','manual_review','failed'].includes(processingState) || (quality !== null && quality !== 'failed') || (lastErrorCode !== null && !/^SEARCHAD_[A-Z_]{1,100}$/.test(lastErrorCode))) throw reportingError('SEARCHAD_REPORT_INPUT_INVALID');
    const metadata = { ...(remoteUpdatedAt === undefined ? {} : { remoteUpdatedAt: remoteUpdatedAt === null ? null : utcTimestamp(remoteUpdatedAt) }) };
    const generationTime = reportCreatedAt === undefined || reportCreatedAt === null ? null : utcTimestamp(reportCreatedAt);
    try {
      const row = mapJob((await this.pool.query(`UPDATE searchad_report_jobs SET processing_state=CASE WHEN processing_state IN ('ingesting','ingested') THEN processing_state ELSE $1 END,state=CASE WHEN processing_state IN ('ingesting','ingested') THEN state ELSE $1 END,quality=CASE WHEN quality IN ('quarantined','stabilized_by_policy','changed_after_generation') THEN quality ELSE COALESCE($2,quality) END,last_error_code=$3,updated_at=$4,report_created_at=CASE WHEN report_kind='master' THEN COALESCE($9::timestamptz,report_created_at) ELSE NULL END,metadata_json=metadata_json || $8::jsonb || CASE WHEN $1='built' AND NOT (metadata_json ? 'firstBuiltObservedAt') THEN jsonb_build_object('firstBuiltObservedAt',$10::text) ELSE '{}'::jsonb END
        WHERE customer_id=$5 AND report_job_id=$6 AND dispatch_claim_id IS NOT DISTINCT FROM $7::uuid RETURNING *,stat_date::text AS stat_date`, [processingState,quality,lastErrorCode,new Date(now).toISOString(),customerId,reportJobId,claimId,JSON.stringify(metadata),generationTime,new Date(now).toISOString()])).rows[0]);
      if (!row) throw new Error('job unavailable'); return row;
    } catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  async getReportJob({ customerId, reportJobId }) {
    if (typeof customerId !== 'string' || !/^\d{1,30}$/.test(customerId) || !jobId(reportJobId)) return null;
    try { return mapJob((await this.pool.query('SELECT *,stat_date::text AS stat_date FROM searchad_report_jobs WHERE customer_id=$1 AND report_job_id=$2 AND report_kind IS NOT NULL', [customerId,reportJobId])).rows[0]); }
    catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  async appendObservation(observation) {
    validateStatsInput(Object.fromEntries(['customerId', 'entityType', 'entityId', 'since', 'until'].map(key => [key, observation[key]])));
    validateIdentity(observation, observation.customerId);
    if (observation.quality !== 'provisional' || observation.entityTypeBasis !== 'server_request' || !['server_request', 'response_echo'].includes(observation.rangeBasis)) throw reportingError('SEARCHAD_REPORTING_OBSERVATION_INVALID');
    const observedMs = Date.parse(observation.observedAt);
    if (!Number.isFinite(observedMs) || cycleTimestamp(observation.cycleBaseTm, observedMs) !== observation.cycleAt) throw reportingError('SEARCHAD_REPORTING_OBSERVATION_INVALID');
    const metrics = observation.metrics;
    const integerMetrics = ['spendGrossKrw', 'impressions', 'clicks', 'conversions'].map(key => strictDecimal(metrics[key], { integer: true }));
    const conversionAmount = metrics.conversionAmountKrw === null ? null : strictDecimal(metrics.conversionAmountKrw);
    try {
      const { rows } = await this.pool.query(`INSERT INTO searchad_stats_observations (
        observation_id,customer_id,entity_type,entity_id,since_kst,until_kst,spec_sha,credential_fingerprint,upstream_base_url,observed_at,source_request_id,collection_request_id,collected_by_principal_id,response_sha,cycle_base_tm,cycle_at,quality,range_basis,missing_metrics_json,spend_gross_krw,impressions,clicks,conversions,conversion_amount_krw,currency,spend_basis,entity_type_basis
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING *,since_kst::text AS since_kst,until_kst::text AS until_kst`, [observation.observationId, observation.customerId, observation.entityType, observation.entityId, observation.since, observation.until, observation.specSha, observation.credentialFingerprint, observation.upstreamBaseUrl, observation.observedAt, observation.sourceRequestId, observation.collectionRequestId, observation.collectedByPrincipalId, observation.responseSha, observation.cycleBaseTm, observation.cycleAt, observation.quality, observation.rangeBasis, JSON.stringify(observation.missingMetrics), ...integerMetrics, conversionAmount, metrics.currency, metrics.spendBasis, observation.entityTypeBasis]);
      return map(rows[0]);
    } catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  async getObservation({ customerId, observationId }) {
    if (typeof customerId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(observationId || '')) return null;
    try { return map((await this.pool.query('SELECT *,since_kst::text AS since_kst,until_kst::text AS until_kst FROM searchad_stats_observations WHERE customer_id=$1 AND observation_id=$2', [customerId, observationId])).rows[0]); }
    catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  async listObservations({ customerId, entityType, entityId, limit = 100 }) {
    if (typeof customerId !== 'string' || !customerId || !Number.isInteger(limit) || limit < 1 || limit > 100) throw reportingError('SEARCHAD_REPORTING_QUERY_INVALID');
    try { return (await this.pool.query('SELECT *,since_kst::text AS since_kst,until_kst::text AS until_kst FROM searchad_stats_observations WHERE customer_id=$1 AND ($2::text IS NULL OR entity_type=$2) AND ($3::text IS NULL OR entity_id=$3) ORDER BY observed_at DESC,observation_id DESC LIMIT $4', [customerId, entityType ?? null, entityId ?? null, limit])).rows.map(map); }
    catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  // Stats is provisional regardless of age or identity. Task 3 supplies a
  // distinct report-derived trust selector; this table can never satisfy it.
  async findLatestTrustedObservation() { return null; }
}
