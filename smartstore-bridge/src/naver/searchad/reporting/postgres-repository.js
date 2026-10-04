import { validateStatsInput, reportingError, strictDecimal, validateIdentity, cycleTimestamp } from './contracts.js';
function iso(value) { return value instanceof Date ? value.toISOString() : value; }
function map(row) {
  if (!row) return null;
  return { observationId: row.observation_id, customerId: row.customer_id, entityType: row.entity_type, entityId: row.entity_id, since: iso(row.since_kst)?.slice(0, 10), until: iso(row.until_kst)?.slice(0, 10), specSha: row.spec_sha, credentialFingerprint: row.credential_fingerprint, upstreamBaseUrl: row.upstream_base_url, observedAt: iso(row.observed_at), sourceRequestId: row.source_request_id, collectionRequestId: row.collection_request_id, collectedByPrincipalId: row.collected_by_principal_id, responseSha: row.response_sha, cycleBaseTm: row.cycle_base_tm, cycleAt: iso(row.cycle_at), quality: row.quality, rangeBasis: row.range_basis, entityTypeBasis: row.entity_type_basis, missingMetrics: row.missing_metrics_json, metrics: { spendGrossKrw: row.spend_gross_krw, impressions: row.impressions, clicks: row.clicks, conversions: row.conversions, conversionAmountKrw: row.conversion_amount_krw, currency: row.currency, spendBasis: row.spend_basis } };
}
export class PostgresReportingRepository {
  constructor({ pool, clock = Date.now }) { Object.assign(this, { pool, clock }); }
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
