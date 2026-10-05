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
  // CI runs this contract directly and again in the full suite against the same database.
  // Isolate fixtures without deleting immutable evidence or weakening production constraints.
  const fixtureId = randomUUID();
  const customerId = `pg-customer-${fixtureId}`;
  const evidenceId = `passive-pg-${fixtureId}`;
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  try {
    const first = await runPostgresMigrations({ pool, migrationsDir });
    assert.equal(first.currentVersion, '0012');
    const second = await runPostgresMigrations({ pool, migrationsDir });
    assert.deepEqual(second.applied, []);

    const repo = new PostgresActiveCanaryRepository({ pool });
    await repo.upsertAccount({ customerId, suspended: false });
    await repo.createEvidence({
      evidenceId, evidenceType: 'passive_capability', customerId,
      specSha: 'spec-pg', credentialFingerprint: 'cred-pg', upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: ['campaign.create'], fieldScope: ['campaign.userLock'], lifecycleKinds: ['create', 'delete'], result: 'verified',
      sourceRunId: 'probe-pg', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString()
    });
    const evidence = await repo.getEvidence(evidenceId);
    assert.equal(evidence.customerId, customerId);
    assert.deepEqual(evidence.lifecycleKinds, ['create', 'delete']);

    const runId = randomUUID();
    await repo.createRun({
      canaryRunId: runId, customerId, passiveEvidenceId: evidenceId, recipeId: 'fixture',
      status: 'preflight_verified', startedByPrincipalId: 'admin-pg', specSha: 'spec-pg',
      credentialFingerprint: 'cred-pg', upstreamBaseUrl: 'https://api.searchad.naver.com',
      verifiedOperationScope: { operationKeys: ['campaign.create'], fieldScope: ['campaign.userLock'] },
      startedAt: new Date().toISOString()
    });
    await assert.rejects(() => repo.createRun({
      canaryRunId: randomUUID(), customerId, passiveEvidenceId: evidenceId, recipeId: 'fixture',
      status: 'preflight_verified', startedByPrincipalId: 'admin-pg', specSha: 'spec-pg',
      credentialFingerprint: 'cred-pg', upstreamBaseUrl: 'https://api.searchad.naver.com',
      verifiedOperationScope: {}, startedAt: new Date().toISOString()
    }), error => error?.code === '23505');

    await repo.updateRun(runId, { remoteId: 'cmp-pg-returned', status: 'campaign_verified_off' });
    await repo.addObject({ canaryRunId: runId, customerId, objectType: 'campaign', remoteId: 'cmp-pg-returned', cleanupStatus: 'pending', createdAt: new Date().toISOString() });
    await repo.updateObject(runId, 'cmp-pg-returned', { cleanupStatus: 'deleted_verified', cleanedAt: new Date().toISOString() });
    await repo.addEvent({ eventId: randomUUID(), canaryRunId: runId, customerId, phase: 'campaign_create', status: 'remote_accepted', operationKey: 'campaign.create', createdAt: new Date().toISOString() });

    const restarted = new PostgresActiveCanaryRepository({ pool });
    const recovered = await restarted.getRun(runId);
    assert.equal(recovered.remoteId, 'cmp-pg-returned');
    const objects = await restarted.listObjects(runId);
    assert.equal(objects[0].cleanupStatus, 'deleted_verified');

    const intentId = randomUUID();
    await repo.addEvent({ eventId:intentId,canaryRunId:runId,customerId,phase:'budget_update',status:'send_intent',operationKey:'campaign.update',createdAt:new Date().toISOString() });
    const outcome = { eventId:intentId,canaryRunId:runId,customerId,phase:'budget_update',status:'unknown_outcome',operationKey:'campaign.update',createdAt:new Date().toISOString() };
    await assert.rejects(repo.settleMutation(runId,{status:'cleanup_required'},outcome),{code:'23505'});
    assert.equal((await repo.getRun(runId)).status,'campaign_verified_off','Outcome event failure rolls back the primary state transition');
    outcome.eventId = randomUUID();
    await repo.settleMutation(runId,{status:'cleanup_required'},outcome);
    assert.equal((await repo.getRun(runId)).status,'cleanup_required');
    assert.equal((await pool.query('SELECT phase,status FROM searchad_canary_events WHERE event_id=$1',[outcome.eventId])).rows[0].phase,'budget_update');

    await assert.rejects(() => pool.query("UPDATE searchad_verification_evidence SET result='failed' WHERE evidence_id=$1", [evidenceId]), { code: 'P0001' });
    await assert.rejects(() => pool.query('DELETE FROM searchad_canary_events WHERE canary_run_id=$1', [runId]), { code: 'P0001' });
  } finally {
    await closePostgresPool(pool);
  }
});
