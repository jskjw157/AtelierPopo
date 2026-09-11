import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdActivationRepository } from '../src/naver/searchad/activation/postgres-repository.js';

const migrationsDir = path.resolve('migrations/postgres');

test('PostgreSQL SearchAd activation control is immutable, idempotent and restart-safe', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `activation-${randomUUID()}`;
  const evidenceId = `evidence-${randomUUID()}`;
  const activationId = randomUUID();
  try {
    const first = await runPostgresMigrations({ pool, migrationsDir });
    assert.equal(first.currentVersion, '0009');
    const second = await runPostgresMigrations({ pool, migrationsDir });
    assert.deepEqual(second.applied, []);

    const repo = new PostgresSearchAdActivationRepository({ pool });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);

    await repo.createEvidence({
      evidenceId,
      evidenceType: 'passive_capability',
      customerId,
      specSha: 'spec-activation',
      credentialFingerprint: 'credential-activation',
      upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: ['campaign.update'],
      fieldScope: ['campaign.dailyBudget'],
      lifecycleKinds: ['create'],
      result: 'verified',
      details: { probeOperations: [{ operationKey: 'campaign.list', supported: true, requestId: 'request-safe' }] },
      createdByPrincipalId: 'operator-activation',
      sourceRequestId: 'http-request-activation',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    await repo.createActivation({
      activationId,
      evidenceId,
      evidenceType: 'passive_capability',
      customerId,
      specSha: 'spec-activation',
      credentialFingerprint: 'credential-activation',
      upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: ['campaign.update'],
      fieldScope: ['campaign.dailyBudget'],
      lifecycleKinds: ['create'],
      activatedByPrincipalId: 'admin-activation',
      activatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    await repo.setAccountSuspended({
      customerId,
      suspended: true,
      actorPrincipalId: 'admin-activation',
      requestId: 'suspend-request',
      createdAt: now.toISOString()
    });

    const restarted = new PostgresSearchAdActivationRepository({ pool });
    const evidence = await restarted.getEvidence(evidenceId);
    assert.equal(evidence.customerId, customerId);
    assert.deepEqual(evidence.lifecycleKinds, ['create']);
    assert.deepEqual(evidence.details.probeOperations, [{ operationKey: 'campaign.list', supported: true, requestId: 'request-safe' }]);
    assert.equal(evidence.createdByPrincipalId, 'operator-activation');
    assert.equal(evidence.sourceRequestId, 'http-request-activation');

    const activation = await restarted.getActivationByEvidence(evidenceId);
    assert.equal(activation.activationId, activationId);
    assert.equal(activation.activatedByPrincipalId, 'admin-activation');
    assert.deepEqual(activation.operationKeys, ['campaign.update']);
    assert.deepEqual(activation.lifecycleKinds, ['create']);

    const account = await restarted.getAccount(customerId);
    assert.equal(account.suspended, true);

    const eventResult = await pool.query(
      'SELECT customer_id, action, actor_principal_id, request_id FROM searchad_account_state_events WHERE customer_id=$1',
      [customerId]
    );
    assert.deepEqual(eventResult.rows, [{
      customer_id: customerId,
      action: 'suspend',
      actor_principal_id: 'admin-activation',
      request_id: 'suspend-request'
    }]);

    await assert.rejects(
      () => pool.query("UPDATE searchad_verification_evidence SET result='failed' WHERE evidence_id=$1", [evidenceId]),
      { code: 'P0001' }
    );
    await assert.rejects(
      () => pool.query("UPDATE searchad_activation_grants SET customer_id='other' WHERE activation_id=$1", [activationId]),
      { code: 'P0001' }
    );
    await assert.rejects(
      () => pool.query('DELETE FROM searchad_account_state_events WHERE customer_id=$1', [customerId]),
      { code: 'P0001' }
    );

    await assert.rejects(
      () => repo.createActivation({
        activationId: randomUUID(),
        evidenceId,
        evidenceType: 'passive_capability',
        customerId,
        specSha: 'spec-activation',
        credentialFingerprint: 'credential-activation',
        upstreamBaseUrl: 'https://api.searchad.naver.com',
        operationKeys: ['campaign.update'],
        fieldScope: ['campaign.dailyBudget'],
        lifecycleKinds: ['create'],
        activatedByPrincipalId: 'admin-activation',
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      }),
      error => error?.code === '23505'
    );
  } finally {
    await closePostgresPool(pool);
  }
});

test('PostgreSQL lifecycle activation lookup requires exact Customer operation kind and active-canary evidence', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `lifecycle-activation-${randomUUID()}`;
  const operationKey = 'fixture.lifecycle.create';
  const activeEvidenceId = `active-evidence-${randomUUID()}`;
  const passiveEvidenceId = `passive-evidence-${randomUUID()}`;
  const activeActivationId = randomUUID();
  const passiveActivationId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 86_400_000);
  try {
    await runPostgresMigrations({ pool, migrationsDir });
    const repo = new PostgresSearchAdActivationRepository({ pool });

    for (const [evidenceId, evidenceType] of [
      [activeEvidenceId, 'active_canary'],
      [passiveEvidenceId, 'passive_capability']
    ]) {
      await repo.createEvidence({
        evidenceId,
        evidenceType,
        customerId,
        specSha: 'spec-lifecycle',
        credentialFingerprint: 'credential-lifecycle',
        upstreamBaseUrl: 'https://api.searchad.naver.com',
        operationKeys: [operationKey],
        fieldScope: [],
        lifecycleKinds: ['create'],
        result: 'verified',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      });
    }

    await repo.createActivation({
      activationId: activeActivationId,
      evidenceId: activeEvidenceId,
      evidenceType: 'active_canary',
      customerId,
      specSha: 'spec-lifecycle',
      credentialFingerprint: 'credential-lifecycle',
      upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: [operationKey],
      fieldScope: [],
      lifecycleKinds: ['create'],
      activatedByPrincipalId: 'admin-lifecycle',
      activatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    await repo.createActivation({
      activationId: passiveActivationId,
      evidenceId: passiveEvidenceId,
      evidenceType: 'passive_capability',
      customerId,
      specSha: 'spec-lifecycle',
      credentialFingerprint: 'credential-lifecycle',
      upstreamBaseUrl: 'https://api.searchad.naver.com',
      operationKeys: [operationKey],
      fieldScope: [],
      lifecycleKinds: ['create'],
      activatedByPrincipalId: 'admin-lifecycle',
      activatedAt: new Date(now.getTime() + 1_000).toISOString(),
      expiresAt: expiresAt.toISOString()
    });

    const exact = await repo.findUsableLifecycleActivation({
      customerId,
      operationKey,
      lifecycleKind: 'create',
      now
    });
    assert.equal(exact.activationId, activeActivationId);
    assert.equal(exact.evidenceType, 'active_canary');

    assert.equal(await repo.findUsableLifecycleActivation({
      customerId,
      operationKey,
      lifecycleKind: 'delete',
      now
    }), null);
    assert.equal(await repo.findUsableLifecycleActivation({
      customerId,
      operationKey: 'fixture.lifecycle.other',
      lifecycleKind: 'create',
      now
    }), null);
    assert.equal(await repo.findUsableLifecycleActivation({
      customerId: `other-${customerId}`,
      operationKey,
      lifecycleKind: 'create',
      now
    }), null);
  } finally {
    await closePostgresPool(pool);
  }
});
