import { generationProof, hasProvenCollectionSlot, isGenerationFresh } from './spend-evidence-service.js';
import { parseReportTsv } from './tsv-parser.js';
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
  async ingestionTransaction({job,identity}, action) {
    validateIdentity(identity,job.customerId); let client;
    try {
      client=await this.pool.connect(); await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`report-circuit:${job.customerId}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`report:${job.customerId}:${job.kind}:${job.reportType}:${job.statDate || ''}`]);
      const locked=mapJob((await client.query('SELECT *,stat_date::text AS stat_date FROM searchad_report_jobs WHERE customer_id=$1 AND report_job_id=$2 FOR UPDATE',[job.customerId,job.reportJobId])).rows[0]);
      if(!locked||contentHash(validateIdentity(locked,job.customerId))!==contentHash(identity)||locked.remoteJobId!==job.remoteJobId||!locked.claimId)throw new Error();
      const result=await action(client,locked);await client.query('COMMIT');return result;
    }catch(error){if(client)try{await client.query('ROLLBACK');}catch{};throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED',503);}
    finally{client?.release();}
  }
  async storeBlob(client,{job,blob,now}) {
    if(!/^[a-f0-9]{64}$/.test(blob.sha256)||blob.key!==`${job.customerId}/${blob.sha256}.tsv`||!Number.isSafeInteger(blob.size)||blob.size<1)throw new Error();
    const result=await client.query(`INSERT INTO searchad_report_blobs(blob_id,customer_id,report_job_id,blob_key,sha256,size_bytes,content_type,created_at,retain_until) VALUES($1,$2,$3,$4,$5,$6,'text/tab-separated-values',$7,$8) ON CONFLICT(customer_id,report_job_id,sha256) DO NOTHING RETURNING blob_id`,[randomUUID(),job.customerId,job.reportJobId,blob.key,blob.sha256,blob.size,new Date(now).toISOString(),blob.retainUntil]);
    return result.rows[0]?.blob_id || (await client.query('SELECT blob_id FROM searchad_report_blobs WHERE customer_id=$1 AND report_job_id=$2 AND sha256=$3',[job.customerId,job.reportJobId,blob.sha256])).rows[0].blob_id;
  }
  async quarantineIngestion(input) {
    return this.ingestionTransaction(input, (client, job) =>
      this.quarantineIngestionInTransaction(client, { ...input, job }),
    );
  }
  async quarantineIngestionInTransaction(client, input) {
    const { job, reasons, now } = input;
    await this.storeBlob(client, input);
    await client.query(
      "UPDATE searchad_report_jobs SET quality='quarantined',metadata_json=metadata_json || $3::jsonb,updated_at=$4 WHERE customer_id=$1 AND report_job_id=$2",
      [
        job.customerId,
        job.reportJobId,
        JSON.stringify({
          quarantineReasons: reasons,
          quarantineAt: new Date(now).toISOString(),
        }),
        new Date(now).toISOString(),
      ],
    );
    await client.query(
      "UPDATE searchad_report_ingestions SET quality='changed_after_generation' WHERE customer_id=$1 AND report_kind=$2 AND report_type=$3 AND stat_date IS NOT DISTINCT FROM $4::date",
      [job.customerId, job.kind, job.reportType, job.statDate],
    );
    return {
      reportJobId: job.reportJobId,
      quality: "quarantined",
      reasons,
      rowCount: 0,
    };
  }
  async commitIngestion(input) {
    return this.ingestionTransaction(input, async (client, job) => {
      const { blob, schema, identity, now } = input;
      const proof = generationProof(
        job,
        Date.parse(input.proof.downloadCompletedAt),
        input.proof.policy,
      );
      if (
        contentHash(proof) !== contentHash(input.proof) ||
        schema.kind !== job.kind ||
        schema.reportType !== job.reportType ||
        schema.statDate !== job.statDate ||
        input.quality !== "provisional"
      )
        throw new Error();
      if (
        job.kind === "stat" &&
        !hasProvenCollectionSlot(proof, job.statDate)
      ) {
        return this.quarantineIngestionInTransaction(client, {
          ...input,
          job,
          reasons: [{ code: "SEARCHAD_REPORT_COLLECTION_SLOT_UNPROVEN" }],
        });
      }
      const parsed = parseReportTsv(
        Buffer.from(
          input.rows
            .map((row) =>
              schema.columns.map((col) => row.data[col.name]).join("\t"),
            )
            .join("\n") + "\n",
        ),
        schema,
        { customerId: job.customerId },
      );
      // Reconstructed TSV has dense lines; preserve verified original physical
      // line numbers while comparing all canonical row content independently.
      const validLineNumbers = input.rows.every(
        (row, index) =>
          Number.isSafeInteger(row.rowNumber) &&
          row.rowNumber > 0 &&
          (index === 0 || row.rowNumber > input.rows[index - 1].rowNumber),
      );
      const validatedRows = parsed.rows.map((row, index) => ({
        ...row,
        rowNumber: input.rows[index]?.rowNumber,
      }));
      if (
        !validLineNumbers ||
        parsed.reasons.length ||
        contentHash(validatedRows) !== contentHash(input.rows)
      )
        throw new Error();
      const blobId = await this.storeBlob(client, { ...input, job });
      const existing = (
        await client.query(
          "SELECT * FROM searchad_report_ingestions WHERE customer_id=$1 AND report_job_id=$2 AND generation_sha=$3 AND parser_version=$4 AND ordered_schema_sha=$5",
          [
            job.customerId,
            job.reportJobId,
            blob.sha256,
            schema.parserVersion,
            schema.orderedSchemaSha,
          ],
        )
      ).rows[0];
      if (existing)
        return {
          ingestionId: existing.ingestion_id,
          reportJobId: job.reportJobId,
          quality: existing.quality,
          rowCount: Number(existing.row_count),
          deduplicated: true,
          generationWindow: existing.provenance_json.generationWindow,
        };
      const history = (
        await client.query(
          "SELECT * FROM searchad_report_ingestions WHERE customer_id=$1 AND report_kind=$2 AND report_type=$3 AND stat_date IS NOT DISTINCT FROM $4::date ORDER BY created_at,ingestion_id",
          [job.customerId, job.kind, job.reportType, job.statDate],
        )
      ).rows;
      const changedJob = history.some(
        (row) =>
          row.report_job_id === job.reportJobId &&
          row.generation_sha !== blob.sha256,
      );
      const overlap = history.some(
        (row) =>
          row.generation_sha !== blob.sha256 &&
          (!row.provenance_json.generationWindow ||
            (Date.parse(proof.lower) <=
              Date.parse(row.provenance_json.generationWindow.upper) &&
              Date.parse(proof.upper) >=
                Date.parse(row.provenance_json.generationWindow.lower))),
      );
      const laterChange = history.some(
        (row) => row.generation_sha !== blob.sha256,
      );
      const quality =
        changedJob || overlap
          ? "quarantined"
          : laterChange
            ? "changed_after_generation"
            : "provisional";
      await client.query(
        `INSERT INTO searchad_report_schema_registry(report_type,schema_version,selection_basis,expected_column_count,ordered_columns_json,parser_version,report_kind,column_mappings_json,ordered_schema_sha,source_provenance_json,supported) VALUES($1,$2,'generation_window',$3,$4::jsonb,$5,$6,'{}',$7,$8::jsonb,true) ON CONFLICT DO NOTHING`,
        [
          schema.reportType,
          schema.schemaVersion,
          schema.columns.length,
          JSON.stringify(schema.columns),
          schema.parserVersion,
          schema.kind,
          schema.orderedSchemaSha,
          JSON.stringify({
            source: schema.source,
            notice: schema.notice,
            vatPolicy: schema.vatPolicy,
          }),
        ],
      );
      const pinned = (
        await client.query(
          "SELECT ordered_schema_sha FROM searchad_report_schema_registry WHERE report_type=$1 AND schema_version=$2",
          [schema.reportType, schema.schemaVersion],
        )
      ).rows[0];
      if (pinned.ordered_schema_sha !== schema.orderedSchemaSha)
        throw new Error();
      const ingestionId = randomUUID();
      const provenance = {
        generationWindow: proof,
        source: schema.source,
        vatPolicy: schema.vatPolicy,
        complete: quality !== "quarantined",
        requiresExplicitEvaluation: true,
      };
      if (laterChange)
        await client.query(
          "UPDATE searchad_report_ingestions SET quality='changed_after_generation' WHERE customer_id=$1 AND report_kind=$2 AND report_type=$3 AND stat_date IS NOT DISTINCT FROM $4::date",
          [job.customerId, job.kind, job.reportType, job.statDate],
        );
      await client.query(
        `INSERT INTO searchad_report_ingestions(ingestion_id,customer_id,report_job_id,blob_id,report_kind,report_type,stat_date,report_created_at,schema_version,ordered_schema_sha,parser_version,generation_sha,spec_sha,credential_fingerprint,upstream_base_url,processing_state,quality,row_count,provenance_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20)`,
        [
          ingestionId,
          job.customerId,
          job.reportJobId,
          blobId,
          job.kind,
          job.reportType,
          job.statDate,
          job.reportCreatedAt,
          schema.schemaVersion,
          schema.orderedSchemaSha,
          schema.parserVersion,
          blob.sha256,
          identity.specSha,
          identity.credentialFingerprint,
          identity.upstreamBaseUrl,
          quality === "quarantined" ? "quarantined" : "ingested",
          quality,
          quality === "quarantined" ? 0 : parsed.rows.length,
          JSON.stringify(provenance),
          new Date(now).toISOString(),
        ],
      );
      if (quality !== "quarantined")
        for (const row of validatedRows) {
          await client.query(
            `INSERT INTO searchad_report_rows_staging(staging_row_id,customer_id,ingestion_id,row_number,natural_key,row_sha,row_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [
              randomUUID(),
              job.customerId,
              ingestionId,
              row.rowNumber,
              row.naturalKey,
              row.rowSha,
              JSON.stringify(row),
            ],
          );
          const common = [
            randomUUID(),
            job.customerId,
            ingestionId,
            row.statDate,
            row.entityType,
            row.entityId,
            row.naturalKey,
            row.rowSha,
          ];
          if (row.table === "daily")
            await client.query(
              `INSERT INTO searchad_daily_metrics(metric_id,customer_id,ingestion_id,stat_date,entity_type,entity_id,natural_key,row_sha,dimensions_json,metrics_json,cost_raw,cost_basis,cost_gross_krw,cost_net_krw,vat_policy_version,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16)`,
              [
                ...common,
                JSON.stringify(row.dimensions),
                JSON.stringify(row.metrics),
                row.costRaw,
                row.costBasis,
                row.costGrossKrw,
                row.costNetKrw,
                row.vatPolicyVersion,
                new Date(now).toISOString(),
              ],
            );
          if (row.table === "conversion")
            await client.query(
              `INSERT INTO searchad_conversion_metrics(conversion_metric_id,customer_id,ingestion_id,stat_date,entity_type,entity_id,natural_key,row_sha,dimensions_json,metrics_json,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
              [
                ...common,
                JSON.stringify(row.dimensions),
                JSON.stringify(row.metrics),
                new Date(now).toISOString(),
              ],
            );
          if (row.table === "term")
            await client.query(
              `INSERT INTO searchad_search_terms(search_term_id,customer_id,ingestion_id,stat_date,entity_type,entity_id,natural_key,row_sha,term_json,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
              [
                ...common,
                JSON.stringify({
                  ...row.data,
                  searchKeywordType: row.searchKeywordType,
                }),
                new Date(now).toISOString(),
              ],
            );
          if (row.table === "master")
            await client.query(
              `INSERT INTO searchad_master_snapshots(master_snapshot_id,customer_id,ingestion_id,entity_type,entity_id,natural_key,row_sha,snapshot_json,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
              [
                common[0],
                job.customerId,
                ingestionId,
                row.entityType,
                row.entityId,
                row.naturalKey,
                row.rowSha,
                JSON.stringify(row.data),
                new Date(now).toISOString(),
              ],
            );
        }
      await client.query(
        "UPDATE searchad_report_jobs SET processing_state='ingested',state='ingested',quality=$3,updated_at=$4 WHERE customer_id=$1 AND report_job_id=$2",
        [job.customerId, job.reportJobId, quality, new Date(now).toISOString()],
      );
      return {
        ingestionId,
        reportJobId: job.reportJobId,
        quality,
        rowCount: quality === "quarantined" ? 0 : parsed.rows.length,
        generationWindow: proof,
      };
    });
  }
  async getIngestionBinding({customerId,reportJobId,sha256,identity}) {
    validateIdentity(identity,customerId);
    const row=(await this.pool.query('SELECT provenance_json FROM searchad_report_ingestions WHERE customer_id=$1 AND report_job_id=$2 AND generation_sha=$3 AND spec_sha=$4 AND credential_fingerprint=$5 AND upstream_base_url=$6 ORDER BY created_at LIMIT 1',[customerId,reportJobId,sha256,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl])).rows[0];
    return row?{proof:row.provenance_json.generationWindow}:null;
  }
  async getArchivedBlob({customerId,reportJobId}) {
    const row=(await this.pool.query('SELECT blob_key FROM searchad_report_blobs WHERE customer_id=$1 AND report_job_id=$2 ORDER BY created_at DESC,blob_id DESC LIMIT 1',[customerId,reportJobId])).rows[0];return row?{key:row.blob_key}:null;
  }
  async selectedIngestions(
    client,
    { customerId, reportType = null, statDate = null, identity = null },
  ) {
    const rows = (
      await client.query(
        "SELECT *,stat_date::text AS stat_date FROM searchad_report_ingestions WHERE customer_id=$1 AND ($2::text IS NULL OR report_type=$2) AND ($3::date IS NULL OR stat_date=$3) ORDER BY created_at,ingestion_id",
        [customerId, reportType, statDate],
      )
    ).rows;
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.report_kind}:${row.report_type}:${row.stat_date || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const selected = [];
    for (const group of groups.values()) {
      const sorted = group.sort(
        (a, b) =>
          Date.parse(b.provenance_json.generationWindow?.lower) -
          Date.parse(a.provenance_json.generationWindow?.lower),
      );
      const latest = sorted[0];
      const proof = latest.provenance_json.generationWindow;
      if (
        latest.report_kind === "stat" &&
        !hasProvenCollectionSlot(proof, latest.stat_date)
      )
        continue;
      if (
        !proof ||
        !latest.provenance_json.complete ||
        latest.processing_state !== "ingested" ||
        (identity &&
          (latest.spec_sha !== identity.specSha ||
            latest.credential_fingerprint !== identity.credentialFingerprint ||
            latest.upstream_base_url !== identity.upstreamBaseUrl))
      )
        continue;
      if (
        group.some(
          (r) =>
            r !== latest &&
            r.generation_sha !== latest.generation_sha &&
            (!r.provenance_json.generationWindow ||
              Date.parse(r.provenance_json.generationWindow.upper) >=
                Date.parse(proof.lower)),
        )
      )
        continue;
      const quarantines = (
        await client.query(
          "SELECT metadata_json FROM searchad_report_jobs WHERE customer_id=$1 AND report_kind=$2 AND report_type=$3 AND stat_date IS NOT DISTINCT FROM $4::date AND metadata_json ? 'quarantineAt'",
          [
            customerId,
            latest.report_kind,
            latest.report_type,
            latest.stat_date,
          ],
        )
      ).rows;
      if (
        quarantines.some(
          (r) =>
            Date.parse(r.metadata_json.quarantineAt) >= Date.parse(proof.lower),
        )
      )
        continue;
      selected.push(latest);
    }
    return selected;
  }
  async listMetrics({customerId,entityType,entityId,identity}) {
    const selected=await this.selectedIngestions(this.pool,{customerId,identity});if(!selected.length)return [];
    return (await this.pool.query('SELECT m.*,i.quality FROM searchad_daily_metrics m JOIN searchad_report_ingestions i USING(customer_id,ingestion_id) WHERE m.customer_id=$1 AND m.ingestion_id=ANY($2::uuid[]) AND ($3::text IS NULL OR entity_type=$3) AND ($4::text IS NULL OR entity_id=$4) ORDER BY stat_date,entity_id,natural_key',[customerId,selected.map(r=>r.ingestion_id),entityType??null,entityId??null])).rows.map(r=>({ingestionId:r.ingestion_id,statDate:iso(r.stat_date)?.slice(0,10),entityType:r.entity_type,entityId:r.entity_id,quality:r.quality,dimensions:r.dimensions_json,metrics:r.metrics_json,costRaw:r.cost_raw,costBasis:r.cost_basis,costGrossKrw:r.cost_gross_krw,costNetKrw:r.cost_net_krw,vatPolicyVersion:r.vat_policy_version}));
  }
  async evaluateGeneration({ job, identity, now }) {
    return this.ingestionTransaction({ job, identity }, async (client) => {
      const selected = await this.selectedIngestions(client, {
        customerId: job.customerId,
        reportType: job.reportType,
        statDate: job.statDate,
        identity,
      });
      const row = selected.find((r) => r.report_job_id === job.reportJobId);
      if (
        !row ||
        row.report_type !== "AD" ||
        !hasProvenCollectionSlot(
          row.provenance_json.generationWindow,
          row.stat_date,
        ) ||
        row.provenance_json.generationWindow.slot < 3 ||
        !row.provenance_json.generationWindow.stableAge
      )
        return { quality: "provisional", evidenceCount: 0 };
      const history = (
        await client.query(
          "SELECT provenance_json FROM searchad_report_ingestions WHERE customer_id=$1 AND report_type=$2 AND stat_date=$3 AND processing_state='ingested' AND spec_sha=$4 AND credential_fingerprint=$5 AND upstream_base_url=$6",
          [
            job.customerId,
            job.reportType,
            job.statDate,
            identity.specSha,
            identity.credentialFingerprint,
            identity.upstreamBaseUrl,
          ],
        )
      ).rows;
      const slots = new Set(
        history
          .filter((r) => r.provenance_json.complete)
          .map((r) => r.provenance_json.generationWindow.slot),
      );
      if (![1, 2, 3].every((slot) => slots.has(slot)))
        return { quality: "provisional", evidenceCount: 0 };
      const metrics = (
        await client.query(
          "SELECT entity_type,entity_id,SUM(cost_raw)::text AS raw,SUM(cost_gross_krw)::text AS gross,COUNT(*) FILTER(WHERE cost_basis <> 'vat_included' OR cost_gross_krw IS NULL OR vat_policy_version <> 'vat-20260330-v1')::int AS invalid FROM searchad_daily_metrics WHERE customer_id=$1 AND ingestion_id=$2 GROUP BY entity_type,entity_id",
          [job.customerId, row.ingestion_id],
        )
      ).rows;
      if (!metrics.length || metrics.some((r) => r.invalid))
        return { quality: "provisional", evidenceCount: 0 };
      for (const metric of metrics)
        await client.query(
          `INSERT INTO searchad_spend_evidence(spend_evidence_id,customer_id,ingestion_id,entity_type,entity_id,stat_date,spec_sha,credential_fingerprint,upstream_base_url,generation_sha,quality,cost_raw,cost_basis,cost_gross_krw,vat_policy_version,policy_provenance_json,observed_at,stabilized_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'stabilized_by_policy',$11,'vat_included',$12,'vat-20260330-v1',$13::jsonb,$14,$15) ON CONFLICT(customer_id,ingestion_id,entity_type,entity_id,stat_date) DO NOTHING`,
          [
            randomUUID(),
            job.customerId,
            row.ingestion_id,
            metric.entity_type,
            metric.entity_id,
            job.statDate,
            identity.specSha,
            identity.credentialFingerprint,
            identity.upstreamBaseUrl,
            row.generation_sha,
            metric.raw,
            metric.gross,
            JSON.stringify({
              ...row.provenance_json,
              stabilityVersion: "d1-d2-d3-v1",
              slots: [1, 2, 3],
              freshnessBasis: "generation_window_lower",
            }),
            row.provenance_json.generationWindow.downloadCompletedAt,
            new Date(now).toISOString(),
          ],
        );
      await client.query(
        "UPDATE searchad_report_ingestions SET quality='stabilized_by_policy' WHERE customer_id=$1 AND ingestion_id=$2",
        [job.customerId, row.ingestion_id],
      );
      await client.query(
        "UPDATE searchad_report_jobs SET quality='stabilized_by_policy' WHERE customer_id=$1 AND report_job_id=$2",
        [job.customerId, job.reportJobId],
      );
      return { quality: "stabilized_by_policy", evidenceCount: metrics.length };
    });
  }
  async selectSpendEvidence({
    customerId,
    entityType,
    entityId,
    identity,
    now,
    maxAgeMs,
    client = this.pool,
  }) {
    validateIdentity(identity, customerId);
    if (
      !Number.isSafeInteger(maxAgeMs) ||
      maxAgeMs < 1 ||
      !Number.isFinite(now)
    )
      return null;
    const selected = await this.selectedIngestions(client, {
      customerId,
      reportType: "AD",
      identity,
    });
    const ids = selected
      .filter(
        (r) =>
          r.quality === "stabilized_by_policy" &&
          isGenerationFresh(r.provenance_json.generationWindow, now, maxAgeMs),
      )
      .map((r) => r.ingestion_id);
    if (!ids.length) return null;
    return (
      (
        await client.query(
          `SELECT e.*,i.provenance_json->'generationWindow'->>'lower' AS generation_lower FROM searchad_spend_evidence e JOIN searchad_report_ingestions i USING(customer_id,ingestion_id)
      WHERE e.customer_id=$1 AND e.ingestion_id=ANY($2::uuid[]) AND e.entity_type=$3 AND e.entity_id=$4 AND e.spec_sha=$5 AND e.credential_fingerprint=$6 AND e.upstream_base_url=$7 AND e.quality='stabilized_by_policy' AND i.quality='stabilized_by_policy' AND i.processing_state='ingested' AND e.stabilized_at <= $8 AND e.observed_at <= $8
      AND (i.provenance_json->'generationWindow'->>'lower')::timestamptz BETWEEN $9 AND $8
      AND (i.provenance_json->'generationWindow'->>'downloadCompletedAt')::timestamptz BETWEEN (i.provenance_json->'generationWindow'->>'lower')::timestamptz AND $8
      AND jsonb_typeof(i.provenance_json->'generationWindow'->'slot')='number'
      AND (i.provenance_json->'generationWindow'->>'slot')::numeric >= 3
      AND (i.provenance_json->'generationWindow'->>'slot')::numeric = floor((i.provenance_json->'generationWindow'->>'slot')::numeric)
      AND NOT EXISTS(SELECT 1 FROM searchad_report_ingestions newer WHERE newer.customer_id=i.customer_id AND newer.report_type=i.report_type AND newer.stat_date=i.stat_date AND newer.ingestion_id<>i.ingestion_id AND (newer.provenance_json->'generationWindow'->>'lower')::timestamptz >= (i.provenance_json->'generationWindow'->>'lower')::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM searchad_report_jobs j WHERE j.customer_id=i.customer_id AND j.report_type=i.report_type AND j.stat_date=i.stat_date AND (j.metadata_json->>'quarantineAt')::timestamptz >= (i.provenance_json->'generationWindow'->>'lower')::timestamptz)
      ORDER BY e.stat_date DESC LIMIT 1`,
          [
            customerId,
            ids,
            entityType,
            entityId,
            identity.specSha,
            identity.credentialFingerprint,
            identity.upstreamBaseUrl,
            new Date(now).toISOString(),
            new Date(now - maxAgeMs).toISOString(),
          ],
        )
      ).rows[0] || null
    );
  }
  async selectAutomationEvidence({customerId,entityType,entityId,identity,now,maxCurrentAgeMs=1800000}) {
    validateIdentity(identity,customerId);
    const stats=map((await this.pool.query(`SELECT *,since_kst::text AS since_kst,until_kst::text AS until_kst FROM searchad_stats_observations
      WHERE customer_id=$1 AND entity_type=$2 AND entity_id=$3 AND spec_sha=$4 AND credential_fingerprint=$5 AND upstream_base_url=$6
      AND observed_at BETWEEN $7 AND $8 AND cycle_at BETWEEN $7 AND $8 ORDER BY observed_at DESC,observation_id DESC LIMIT 1`,[customerId,entityType,entityId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,new Date(now-Math.min(maxCurrentAgeMs,1800000)).toISOString(),new Date(now).toISOString()])).rows[0]);
    const spend=await this.selectSpendEvidence({customerId,entityType,entityId,identity,now,maxAgeMs:86400000});
    return {stats,spend};
  }
  // Stats is provisional regardless of age or identity. Task 3 supplies a
  // distinct report-derived trust selector; this table can never satisfy it.
  async findLatestTrustedObservation() { return null; }
}
