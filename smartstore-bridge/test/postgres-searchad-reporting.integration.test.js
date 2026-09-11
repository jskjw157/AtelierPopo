import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdReportingRepository } from '../src/naver/searchad/reporting/postgres-repository.js';

const migrationsDir = path.resolve('migrations/postgres');
const TABLES = [
  'searchad_report_blobs',
  'searchad_report_events',
  'searchad_report_intents',
  'searchad_report_job_blobs',
  'searchad_report_schemas',
  'searchad_stabilized_spend_evidence',
  'searchad_stats_observations'
].sort();

function sha(value) { return createHash('sha256').update(value).digest('hex'); }

test('PostgreSQL reporting schema 0010 is additive, repeat-idempotent and immutable where evidence must be immutable', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `report-${randomUUID()}`;
  const observationId = randomUUID();
  const evidenceId = randomUUID();
  const now = '2026-09-11T07:30:00.000Z';
  try {
    const first = await runPostgresMigrations({ pool, migrationsDir });
    assert.equal(first.currentVersion, '0010');
    assert.ok(first.applied.includes('0010_searchad_reporting_evidence.sql'));
    const second = await runPostgresMigrations({ pool, migrationsDir });
    assert.deepEqual(second.applied, []);
    assert.equal(second.currentVersion, '0010');

    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [TABLES]);
    assert.deepEqual(tables.rows.map(row => row.table_name), TABLES);

    const repo = new PostgresSearchAdReportingRepository({ pool });
    const observation = await repo.createObservation({
      observationId,
      customerId,
      entityId: 'cmp-100',
      entityType: 'campaign',
      operationKey: 'report.stats.single',
      specSha: 'spec-10',
      credentialFingerprint: 'cred-10',
      upstreamBaseUrl: 'https://api.searchad.naver.com',
      sinceDate: '2026-09-08',
      untilDate: '2026-09-08',
      fields: ['salesAmt'],
      timeIncrement: 'allDays',
      breakdown: null,
      rawResponse: { summaryStatResponse: { data: [{ id: 'cmp-100', salesAmt: 0 }], cycleBaseTm: '202609090100' } },
      rawResponseSha256: sha('observation-10'),
      salesAmtKrw: 0,
      vatBasis: 'VAT_INCLUDED',
      cycleBaseTm: '202609090100',
      observedAt: now,
      sourceRequestId: 'req-10',
      validity: 'valid'
    });
    assert.equal(observation.salesAmtKrw, 0);
    assert.equal(observation.vatBasis, 'VAT_INCLUDED');
    assert.equal((await repo.getObservation(observationId, customerId)).customerId, customerId);
    assert.equal(await repo.getObservation(observationId, `other-${customerId}`), null);

    await assert.rejects(
      () => pool.query('UPDATE searchad_stats_observations SET validity=\'stale\' WHERE observation_id=$1', [observationId]),
      { code: 'P0001' }
    );
    await assert.rejects(
      () => pool.query('DELETE FROM searchad_stats_observations WHERE observation_id=$1', [observationId]),
      { code: 'P0001' }
    );

    const evidence = await repo.createStabilizedEvidence({
      evidenceId,
      customerId,
      entityId: 'cmp-100',
      statDate: '2026-09-08',
      d1ObservationId: observationId,
      d2ObservationId: null,
      d3ObservationId: observationId,
      salesAmtKrw: 0,
      vatBasis: 'VAT_INCLUDED',
      stabilizedByPolicy: true,
      stabilizationPolicy: 'D3',
      sourceSpecSha: 'spec-10',
      credentialFingerprint: 'cred-10',
      upstreamBaseUrl: 'https://api.searchad.naver.com',
      createdAt: now,
      expiresAt: '2026-10-11T07:30:00.000Z'
    });
    assert.equal(evidence.stabilizedByPolicy, true);
    assert.equal(evidence.salesAmtKrw, 0);
    assert.equal(await repo.getStabilizedEvidence(evidenceId, `other-${customerId}`), null);
    await assert.rejects(
      () => pool.query('DELETE FROM searchad_stabilized_spend_evidence WHERE evidence_id=$1', [evidenceId]),
      { code: 'P0001' }
    );
  } finally {
    await closePostgresPool(pool);
  }
});

test('report intent is idempotent by Customer/kind/intentKey and protects conflicting request hashes', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `intent-${randomUUID()}`;
  try {
    await runPostgresMigrations({ pool, migrationsDir });
    const repo = new PostgresSearchAdReportingRepository({ pool });
    const base = {
      reportIntentId: randomUUID(), customerId, reportKind: 'stat', intentKey: 'daily-ad-detail-20260908',
      operationKey: 'report.stat.create', request: { reportTp: 'AD_DETAIL' }, requestSha256: sha('same-request'),
      status: 'planned', createdByPrincipalId: 'operator-10', requestId: 'req-intent',
      createdAt: '2026-09-11T07:31:00.000Z', updatedAt: '2026-09-11T07:31:00.000Z'
    };
    const first = await repo.createOrGetReportIntent(base);
    const second = await repo.createOrGetReportIntent({ ...base, reportIntentId: randomUUID() });
    assert.equal(second.reportIntentId, first.reportIntentId);
    await assert.rejects(
      () => repo.createOrGetReportIntent({ ...base, reportIntentId: randomUUID(), requestSha256: sha('different-request') }),
      error => error?.code === 'SEARCHAD_REPORT_INTENT_CONFLICT' && error?.status === 409
    );
    assert.equal((await repo.findReportIntentByKey(customerId, 'stat', base.intentKey)).reportIntentId, first.reportIntentId);
    assert.equal(await repo.getReportIntent(first.reportIntentId, `other-${customerId}`), null);
  } finally {
    await closePostgresPool(pool);
  }
});

test('report blobs are content-addressed and deduplicated by SHA-256', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  try {
    await runPostgresMigrations({ pool, migrationsDir });
    const repo = new PostgresSearchAdReportingRepository({ pool });
    const bytes = Buffer.from('header\nvalue\n', 'utf8');
    const digest = sha(bytes);
    const first = await repo.putBlob({ sha256: digest, contentBytes: bytes, byteLength: bytes.length, contentType: 'text/csv', createdAt: '2026-09-11T07:32:00.000Z' });
    const second = await repo.putBlob({ sha256: digest, contentBytes: bytes, byteLength: bytes.length, contentType: 'text/csv', createdAt: '2026-09-11T07:33:00.000Z' });
    assert.equal(first.sha256, digest);
    assert.equal(second.sha256, digest);
    const count = await pool.query('SELECT count(*)::int AS count FROM searchad_report_blobs WHERE blob_sha256=$1', [digest]);
    assert.equal(count.rows[0].count, 1);
    const metadata = await repo.getBlobMetadata(digest);
    assert.equal(metadata.byteLength, bytes.length);
    assert.equal(metadata.contentBytes, undefined);
  } finally {
    await closePostgresPool(pool);
  }
});
