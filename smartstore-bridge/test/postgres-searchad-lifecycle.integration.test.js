import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdLifecycleRepository } from '../src/naver/searchad/lifecycle/postgres-repository.js';

const migrationsDir = path.resolve('migrations/postgres');

const LIFECYCLE_TABLES = [
  'searchad_daily_risk_capacity',
  'searchad_hierarchy_canary_runs',
  'searchad_hierarchy_events',
  'searchad_hierarchy_objects',
  'searchad_remote_object_ownership',
  'searchad_risk_reservations'
];

test('PostgreSQL lifecycle schema 0009 is additive, idempotent, scoped and audit-safe', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `lifecycle-${randomUUID()}`;
  const evidenceId = `evidence-${randomUUID()}`;
  const activationId = randomUUID();
  const runId = randomUUID();
  const eventId = randomUUID();
  try {
    const first = await runPostgresMigrations({ pool, migrationsDir });
    assert.equal(first.currentVersion, '0010');
    const second = await runPostgresMigrations({ pool, migrationsDir });
    assert.deepEqual(second.applied, []);
    assert.equal(second.currentVersion, '0010');

    const tables = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name = ANY($1::text[])
      ORDER BY table_name
    `, [LIFECYCLE_TABLES]);
    assert.deepEqual(tables.rows.map(row => row.table_name), LIFECYCLE_TABLES);

    const lifecycleColumns = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema=current_schema()
        AND table_name IN ('searchad_verification_evidence','searchad_activation_grants')
        AND column_name='lifecycle_kinds_json'
      ORDER BY table_name
    `);
    assert.deepEqual(lifecycleColumns.rows, [
      { table_name: 'searchad_activation_grants', column_name: 'lifecycle_kinds_json' },
      { table_name: 'searchad_verification_evidence', column_name: 'lifecycle_kinds_json' }
    ]);

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 3_600_000).toISOString();
    await pool.query(`INSERT INTO searchad_verification_evidence(
      evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,
      operation_keys_json,field_scope_json,result,created_at,expires_at
    ) VALUES($1,'active_canary',$2,'spec-9','cred-9','https://api.searchad.naver.com',$3,'[]','verified',$4,$5)`,
    [evidenceId, customerId, JSON.stringify(['fixture.lifecycle.create']), now, expires]);

    const evidenceScope = await pool.query(
      'SELECT lifecycle_kinds_json FROM searchad_verification_evidence WHERE evidence_id=$1',
      [evidenceId]
    );
    assert.deepEqual(evidenceScope.rows[0].lifecycle_kinds_json, []);

    await pool.query(`INSERT INTO searchad_activation_grants(
      activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,
      operation_keys_json,field_scope_json,activated_by_principal_id,activated_at,expires_at
    ) VALUES($1,$2,'active_canary',$3,'spec-9','cred-9','https://api.searchad.naver.com',$4,'[]','admin-9',$5,$6)`,
    [activationId, evidenceId, customerId, JSON.stringify(['fixture.lifecycle.create']), now, expires]);
    const grantScope = await pool.query(
      'SELECT lifecycle_kinds_json FROM searchad_activation_grants WHERE activation_id=$1',
      [activationId]
    );
    assert.deepEqual(grantScope.rows[0].lifecycle_kinds_json, []);

    await pool.query(`INSERT INTO searchad_hierarchy_canary_runs(
      hierarchy_run_id,customer_id,recipe_id,status,started_by_principal_id,spec_sha,
      credential_fingerprint,upstream_base_url,started_at
    ) VALUES($1,$2,'hierarchy_v1','created','admin-9','spec-9','cred-9','https://api.searchad.naver.com',$3)`,
    [runId, customerId, now]);

    await pool.query(`INSERT INTO searchad_hierarchy_events(
      event_id,hierarchy_run_id,customer_id,phase,status,lifecycle_kind,created_at
    ) VALUES($1,$2,$3,'preflight','accepted','create',$4)`, [eventId, runId, customerId, now]);

    await assert.rejects(
      () => pool.query("UPDATE searchad_hierarchy_events SET status='changed' WHERE event_id=$1", [eventId]),
      { code: 'P0001' }
    );
    await assert.rejects(
      () => pool.query('DELETE FROM searchad_hierarchy_events WHERE event_id=$1', [eventId]),
      { code: 'P0001' }
    );
  } finally {
    await closePostgresPool(pool);
  }
});

test('hierarchy repository survives restart and enforces Customer-scoped returned-ID ownership', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `repo-${randomUUID()}`;
  const otherCustomerId = `other-${randomUUID()}`;
  const runId = randomUUID();
  const campaignObjectId = randomUUID();
  const adgroupObjectId = randomUUID();
  const ownershipId = randomUUID();
  const now = new Date().toISOString();
  try {
    await runPostgresMigrations({ pool, migrationsDir });
    const repo = new PostgresSearchAdLifecycleRepository({ pool });

    await repo.createRun({
      hierarchyRunId: runId,
      customerId,
      recipeId: 'hierarchy_v1',
      status: 'created',
      startedByPrincipalId: 'admin-repository',
      specSha: 'spec-repository',
      credentialFingerprint: 'cred-repository',
      upstreamBaseUrl: 'https://api.searchad.naver.com',
      startedAt: now
    });

    await repo.createObject({
      hierarchyObjectId: campaignObjectId,
      hierarchyRunId: runId,
      customerId,
      objectType: 'campaign',
      createOperationKey: 'campaign.create',
      readOperationKey: 'campaign.read',
      deleteOperationKey: 'campaign.delete',
      state: 'planned',
      createdAt: now,
      updatedAt: now
    });
    await repo.updateObject(campaignObjectId, {
      remoteId: 'returned-campaign-id',
      state: 'owned',
      updatedAt: now
    });
    await repo.holdOwnership({
      ownershipId,
      customerId,
      objectType: 'campaign',
      remoteId: 'returned-campaign-id',
      ownerKind: 'hierarchy_canary',
      ownerRunId: runId,
      hierarchyObjectId: campaignObjectId,
      createdOperationKey: 'campaign.create',
      state: 'owned',
      createdAt: now,
      updatedAt: now
    });

    await repo.createObject({
      hierarchyObjectId: adgroupObjectId,
      hierarchyRunId: runId,
      customerId,
      objectType: 'adgroup',
      parentObjectId: campaignObjectId,
      createOperationKey: 'adgroup.create',
      readOperationKey: 'adgroup.read',
      deleteOperationKey: 'adgroup.delete',
      state: 'planned',
      createdAt: now,
      updatedAt: now
    });
    await repo.addEvent({
      eventId: randomUUID(),
      hierarchyRunId: runId,
      hierarchyObjectId: campaignObjectId,
      customerId,
      phase: 'campaign_create',
      status: 'remote_accepted',
      operationKey: 'campaign.create',
      lifecycleKind: 'create',
      requestId: 'request-repository',
      details: { safe: true },
      createdAt: now
    });

    const liveChildren = await repo.listLiveChildren(campaignObjectId);
    assert.deepEqual(liveChildren.map(item => item.hierarchyObjectId), [adgroupObjectId]);

    const restarted = new PostgresSearchAdLifecycleRepository({ pool });
    const recoveredRun = await restarted.getRun(runId, customerId);
    assert.equal(recoveredRun.customerId, customerId);
    assert.equal(recoveredRun.status, 'created');

    const recoveredObject = await restarted.getObject(campaignObjectId, customerId);
    assert.equal(recoveredObject.remoteId, 'returned-campaign-id');
    assert.equal(recoveredObject.state, 'owned');

    const ownership = await restarted.getOwnership({
      customerId,
      objectType: 'campaign',
      remoteId: 'returned-campaign-id'
    });
    assert.equal(ownership.ownerRunId, runId);
    assert.equal(ownership.hierarchyObjectId, campaignObjectId);
    assert.equal(await restarted.getOwnership({
      customerId: otherCustomerId,
      objectType: 'campaign',
      remoteId: 'returned-campaign-id'
    }), null);

    const events = await restarted.listEvents(runId, customerId);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].details, { safe: true });

    await assert.rejects(
      () => restarted.holdOwnership({
        ownershipId: randomUUID(),
        customerId,
        objectType: 'campaign',
        remoteId: 'returned-campaign-id',
        ownerKind: 'hierarchy_canary',
        ownerRunId: runId,
        hierarchyObjectId: campaignObjectId,
        createdOperationKey: 'campaign.create',
        state: 'owned',
        createdAt: now,
        updatedAt: now
      }),
      error => error?.code === '23505'
    );
  } finally {
    await closePostgresPool(pool);
  }
});

test('daily risk reservations are atomic, idempotent and Customer/day scoped', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `risk-${randomUUID()}`;
  const otherCustomerId = `risk-other-${randomUUID()}`;
  const riskDate = '2026-09-11';
  const createdAt = '2026-09-11T04:50:00.000Z';
  const repo = new PostgresSearchAdLifecycleRepository({ pool });
  const reservationInput = intentId => ({
    customerId,
    intentId,
    riskDate,
    operationKey: 'campaign.create',
    lifecycleKind: 'create',
    units: 6,
    capacityUnits: 10,
    ownerKind: 'hierarchy_canary',
    ownerRunId: 'risk-run-atomic',
    createdAt
  });
  try {
    await runPostgresMigrations({ pool, migrationsDir });
    const inputs = [reservationInput('risk-intent-a'), reservationInput('risk-intent-b')];
    const settled = await Promise.allSettled(inputs.map(input => repo.reserveRisk(input)));
    const fulfilled = settled.filter(item => item.status === 'fulfilled');
    const rejected = settled.filter(item => item.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason?.code, 'SEARCHAD_RISK_CAPACITY_EXCEEDED');
    assert.equal(rejected[0].reason?.status, 409);

    const winnerIntentId = fulfilled[0].value.reservation.intentId;
    const winnerInput = inputs.find(item => item.intentId === winnerIntentId);
    const balance = await repo.getDailyRiskCapacity(customerId, riskDate);
    assert.deepEqual({
      customerId: balance.customerId,
      riskDate: balance.riskDate,
      capacityUnits: balance.capacityUnits,
      reservedUnits: balance.reservedUnits,
      consumedUnits: balance.consumedUnits
    }, {
      customerId,
      riskDate,
      capacityUnits: 10,
      reservedUnits: 6,
      consumedUnits: 0
    });

    const duplicate = await repo.reserveRisk(winnerInput);
    assert.equal(duplicate.reservation.intentId, winnerIntentId);
    assert.equal(duplicate.reservation.state, 'reserved');
    const afterDuplicate = await repo.getDailyRiskCapacity(customerId, riskDate);
    assert.equal(afterDuplicate.reservedUnits, 6);

    await assert.rejects(
      () => repo.reserveRisk({ ...winnerInput, units: 5 }),
      error => error?.code === 'SEARCHAD_RISK_INTENT_CONFLICT' && error?.status === 409
    );

    const other = await repo.reserveRisk({
      ...reservationInput('risk-other-intent'),
      customerId: otherCustomerId,
      units: 10
    });
    assert.equal(other.reservation.state, 'reserved');
    const otherBalance = await repo.getDailyRiskCapacity(otherCustomerId, riskDate);
    assert.equal(otherBalance.reservedUnits, 10);
  } finally {
    await closePostgresPool(pool);
  }
});

test('risk consume and release transitions preserve consumed capacity and never recycle dispatched risk', async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const pool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable' });
  const customerId = `risk-state-${randomUUID()}`;
  const riskDate = '2026-09-11';
  const repo = new PostgresSearchAdLifecycleRepository({ pool });
  const common = {
    customerId,
    riskDate,
    operationKey: 'campaign.create',
    lifecycleKind: 'create',
    capacityUnits: 10,
    ownerKind: 'hierarchy_canary',
    ownerRunId: 'risk-run-state',
    createdAt: '2026-09-11T05:00:00.000Z'
  };
  try {
    await runPostgresMigrations({ pool, migrationsDir });
    await repo.reserveRisk({ ...common, intentId: 'risk-consume', units: 4 });
    await repo.reserveRisk({ ...common, intentId: 'risk-release', units: 3 });

    const consumed = await repo.consumeRisk({ intentId: 'risk-consume', updatedAt: '2026-09-11T05:01:00.000Z' });
    assert.equal(consumed.reservation.state, 'consumed');
    assert.equal(consumed.balance.reservedUnits, 3);
    assert.equal(consumed.balance.consumedUnits, 4);
    const consumedAgain = await repo.consumeRisk({ intentId: 'risk-consume', updatedAt: '2026-09-11T05:02:00.000Z' });
    assert.equal(consumedAgain.reservation.state, 'consumed');
    assert.equal(consumedAgain.balance.consumedUnits, 4);

    const released = await repo.releaseRisk({ intentId: 'risk-release', updatedAt: '2026-09-11T05:03:00.000Z' });
    assert.equal(released.reservation.state, 'released');
    assert.equal(released.balance.reservedUnits, 0);
    assert.equal(released.balance.consumedUnits, 4);
    const releasedAgain = await repo.releaseRisk({ intentId: 'risk-release', updatedAt: '2026-09-11T05:04:00.000Z' });
    assert.equal(releasedAgain.reservation.state, 'released');
    assert.equal(releasedAgain.balance.consumedUnits, 4);

    await assert.rejects(
      () => repo.releaseRisk({ intentId: 'risk-consume', updatedAt: '2026-09-11T05:05:00.000Z' }),
      error => error?.code === 'SEARCHAD_RISK_STATE_INVALID' && error?.status === 409
    );
    await assert.rejects(
      () => repo.consumeRisk({ intentId: 'risk-release', updatedAt: '2026-09-11T05:06:00.000Z' }),
      error => error?.code === 'SEARCHAD_RISK_STATE_INVALID' && error?.status === 409
    );

    const recovered = await repo.getRiskReservation('risk-consume');
    assert.equal(recovered.state, 'consumed');
    const balance = await repo.getDailyRiskCapacity(customerId, riskDate);
    assert.equal(balance.consumedUnits, 4);
    assert.equal(balance.reservedUnits, 0);
  } finally {
    await closePostgresPool(pool);
  }
});