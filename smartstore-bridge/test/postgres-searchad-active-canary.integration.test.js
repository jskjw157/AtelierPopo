import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresActiveCanaryRepository } from '../src/naver/searchad/canary/postgres-repository.js';

const migrationsDir = path.resolve('migrations/postgres');

test('PostgreSQL Active Canary schema is idempotent, immutable where required, and restart-safe', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  try {
    const first = await runPostgresMigrations({ pool, migrationsDir });
    assert.equal(first.currentVersion, '0009');
    const second = await runPostgresMigrations({ pool, migrationsDir });
    assert.deepEqual(second.applied, []);

    const repo = new PostgresActiveCanaryRepository({ pool });
    await repo.upsertAccount({ customerId: 'pg-customer', suspended: false });
    await repo.createEvidence({
      evidenceId: 'passive-pg', evidenceType: 'passive_capability', customerId: 'pg-customer',
      specSha: 'spec-pg', credentialFingerprint: 'cred-pg', upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: ['campaign.create'], fieldScope: ['campaign.userLock'], result: 'verified',
      sourceRunId: 'probe-pg', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString()
    });
    const evidence = await repo.getEvidence('passive-pg');
    assert.equal(evidence.customerId, 'pg-customer');

    const runId = randomUUID();
    await repo.createRun({
      canaryRunId: runId, customerId: 'pg-customer', passiveEvidenceId: 'passive-pg', recipeId: 'fixture',
      status: 'preflight_verified', startedByPrincipalId: 'admin-pg', specSha: 'spec-pg',
      credentialFingerprint: 'cred-pg', upstreamBaseUrl: 'https://api.searchad.naver.com',
      verifiedOperationScope: { operationKeys: ['campaign.create'], fieldScope: ['campaign.userLock'] },
      startedAt: new Date().toISOString()
    });
    await assert.rejects(() => repo.createRun({
      canaryRunId: randomUUID(), customerId: 'pg-customer', passiveEvidenceId: 'passive-pg', recipeId: 'fixture',
      status: 'preflight_verified', startedByPrincipalId: 'admin-pg', specSha: 'spec-pg',
      credentialFingerprint: 'cred-pg', upstreamBaseUrl: 'https://api.searchad.naver.com',
      verifiedOperationScope: {}, startedAt: new Date().toISOString()
    }), error => error?.code === '23505');

    await repo.updateRun(runId, { remoteId: 'cmp-pg-returned', status: 'campaign_verified_off' });
    await repo.addObject({ canaryRunId: runId, customerId: 'pg-customer', objectType: 'campaign', remoteId: 'cmp-pg-returned', cleanupStatus: 'pending', createdAt: new Date().toISOString() });
    await repo.updateObject(runId, 'cmp-pg-returned', { cleanupStatus: 'deleted_verified', cleanedAt: new Date().toISOString() });
    await repo.addEvent({ eventId: randomUUID(), canaryRunId: runId, customerId: 'pg-customer', phase: 'campaign_create', status: 'remote_accepted', operationKey: 'campaign.create', createdAt: new Date().toISOString() });

    const restarted = new PostgresActiveCanaryRepository({ pool });
    const recovered = await restarted.getRun(runId);
    assert.equal(recovered.remoteId, 'cmp-pg-returned');
    const objects = await restarted.listObjects(runId);
    assert.equal(objects[0].cleanupStatus, 'deleted_verified');

    await assert.rejects(() => pool.query("UPDATE searchad_verification_evidence SET result='failed' WHERE evidence_id='passive-pg'"), { code: 'P0001' });
    await assert.rejects(() => pool.query('DELETE FROM searchad_canary_events WHERE canary_run_id=$1', [runId]), { code: 'P0001' });
  } finally {
    await closePostgresPool(pool);
  }
});
