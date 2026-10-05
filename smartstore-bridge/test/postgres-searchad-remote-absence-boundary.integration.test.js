import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresActiveCanaryRepository } from '../src/naver/searchad/canary/postgres-repository.js';
import { PostgresSearchAdLifecycleRepository } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { DescendantInventoryService } from '../src/naver/searchad/lifecycle/descendant-inventory-service.js';
import { PostgresDescendantInventoryRepository } from '../src/naver/searchad/lifecycle/postgres-descendant-inventory-repository.js';
import { hasUnprovenInventory } from '../src/naver/searchad/lifecycle/inventory-cleanup-fence.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const logger = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-09-20T00:00:00Z');
const identity = { specSha: 'fixture-absence-spec', credentialFingerprint: 'fixture-absence-credentials', upstreamBaseUrl: 'https://api.searchad.naver.com' };
const context = { principal: { principalId: 'absence-test-admin', role: 'admin', customerIds: ['1001'] } };
const envelope = (descriptor, data) => ({ operation: { operationKey: descriptor.operationKey, sideEffect: false }, upstream: { status: 200 }, data });

// Counterexamples use a synthetic external writer, not claims about Naver's
// actual ordering or timing. Persistence, scan and veto are production code.
// No approval/evidence issuer or destructive adapter is constructed here.
test('remote-only changes cannot turn inventory observations into parent deletion authority', { timeout: 180_000 }, async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    assert.notEqual(process.env.CI, 'true', 'CI requires PostgreSQL');
    return t.skip('Local PostgreSQL not configured');
  }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const schema = `remote_absence_${randomUUID().replaceAll('-', '')}`;
  let pool, escaped = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    try { if (pool) await closePostgresPool(pool); }
    finally {
      try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await closePostgresPool(admin); }
    }
    assert.equal(escaped, 0);
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
  pool = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger });
  await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
  await new PostgresActiveCanaryRepository({ pool }).upsertAccount({ customerId: '1001', suspended: true });
  const storage = new PostgresSearchAdLifecycleRepository({ pool });
  const runId = randomUUID(), rootId = randomUUID(), groupId = randomUUID();
  const at = new Date(NOW).toISOString();
  await storage.createRun({ hierarchyRunId: runId, customerId: '1001', recipeId: 'fixture-absence', status: 'cleanup_pending', startedByPrincipalId: 'fixture', ...identity, startedAt: at });
  for (const [id, type, parent, remoteId] of [[rootId, 'campaign', null, 'cmp-1'], [groupId, 'adgroup', rootId, 'grp-1']]) {
    await storage.createObject({ hierarchyObjectId: id, hierarchyRunId: runId, customerId: '1001', objectType: type, parentObjectId: parent, createOperationKey: OPS[type].create, readOperationKey: OPS[type].read, deleteOperationKey: OPS[type].delete, remoteId, state: 'owned', createdAt: at, updatedAt: at });
    await storage.holdOwnership({ ownershipId: randomUUID(), customerId: '1001', objectType: type, remoteId, ownerKind: 'hierarchy_canary', ownerRunId: runId, hierarchyObjectId: id, parentHierarchyObjectId: parent, createdOperationKey: OPS[type].create, state: 'owned', createdAt: at, updatedAt: at });
  }
  const repository = new PostgresDescendantInventoryRepository({ pool });
  const events = async () => (await pool.query("SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='descendant_inventory' ORDER BY event_id", [runId])).rows;
  async function state() {
    const result = {};
    for (const table of ['searchad_hierarchy_canary_runs', 'searchad_hierarchy_objects', 'searchad_remote_object_ownership', 'searchad_write_change_plans', 'searchad_write_approvals', 'searchad_risk_reservations', 'searchad_daily_risk_capacity', 'searchad_write_attempts']) {
      result[table] = (await pool.query(`SELECT to_jsonb(t) AS doc, t.xmin::text AS row_version FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return result;
  }
  async function observe(childType, read) {
    const parentObjectId = childType === 'adgroup' ? rootId : groupId;
    const before = await state(), previous = new Set((await events()).map(row => row.event_id));
    const service = new DescendantInventoryService({ repository, remote: { read }, contextResolver: async () => identity, clock: () => NOW });
    const result = await service.scan({ customerId: '1001', hierarchyRunId: runId, parentObjectId, childType }, context);
    const added = (await events()).filter(row => !previous.has(row.event_id));
    assert.equal(added.length, 1);
    assert.deepEqual(await state(), before, 'external changes did not change local lifecycle rows or row versions');
    const audit = added[0];
    assert.equal(result.completeAbsence, false);
    assert.equal(result.scan.snapshotConsistency, 'unproven');
    assert.equal(audit.details_json.completeAbsence, false);
    assert.equal(audit.details_json.cleanupAuthority, false);
    assert.equal(audit.details_json.localMapping, false);
    assert.equal(audit.lifecycle_kind, null);
    assert.equal(Object.hasOwn(audit.details_json, 'remoteIds'), false);
    assert.equal(JSON.stringify(audit).includes('baseSearchId'), false);
    const objects = (await pool.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1', [runId])).rows;
    // Use ONLY this new observation: previous scenarios cannot hide a regression.
    for (const target of objects.filter(row => row.hierarchy_object_id === parentObjectId || row.hierarchy_object_id === rootId)) {
      assert.equal(hasUnprovenInventory({ target, objects, events: [audit] }), true, 'REMOTE_ABSENCE_PARENT_VETO');
    }
    return { result, audit };
  }

  for (const childType of ['adgroup', 'keyword', 'creative']) {
    await t.test(`${childType}: a child created after an empty response snapshot remains outside local drift detection`, async () => {
      const remoteRows = [], calls = [];
      const idKey = { adgroup: 'nccAdgroupId', keyword: 'nccKeywordId', creative: 'nccAdId' }[childType];
      const parentKey = childType === 'adgroup' ? 'nccCampaignId' : 'nccAdgroupId';
      const { result, audit } = await observe(childType, async descriptor => {
        calls.push(descriptor);
        const response = envelope(descriptor, structuredClone(remoteRows));
        // Model a separate writer after the server has captured the response.
        remoteRows.push({ customerId: '1001', [parentKey]: descriptor.query[parentKey], [idKey]: `external-late-${childType}` });
        return response;
      });
      assert.equal(remoteRows.length, 1, 'the external child exists when observation completes');
      assert.equal(calls.length, 1);
      assert.equal(result.kind, 'empty_unproven');
      assert.deepEqual(result.remoteIds, []);
      assert.equal(result.scan.termination, childType === 'creative' ? 'single_response_observed' : 'empty_page_observed');
      assert.equal(JSON.stringify(audit).includes(`external-late-${childType}`), false);
    });
  }

  await t.test('two matching empty scans and matching hashes are not a fence against a subsequent external writer', async () => {
    const remoteRows = [];
    const first = await observe('keyword', async descriptor => envelope(descriptor, []));
    const second = await observe('keyword', async descriptor => {
      const response = envelope(descriptor, structuredClone(remoteRows));
      remoteRows.push({ customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: 'external-after-second-scan' });
      return response;
    });
    assert.notEqual(first.audit.event_id, second.audit.event_id);
    assert.equal(first.audit.details_json.remoteIdsHash, second.audit.details_json.remoteIdsHash);
    assert.equal(first.result.kind, 'empty_unproven');
    assert.equal(second.result.kind, 'empty_unproven');
    assert.equal(remoteRows.length, 1);
  });

  await t.test('an external insertion behind the cursor can be unseen even when traversal reaches an empty page', async () => {
    // Explicit ranks belong to this test backend, NOT a claim of lexicographic
    // or monotonic Naver IDs. NEXT excludes the supplied cursor in this model.
    const rows = [{ rank: 2, id: 'opaque-existing' }], calls = [];
    const { result, audit } = await observe('keyword', async descriptor => {
      calls.push(descriptor);
      const cursor = descriptor.query.baseSearchId;
      const rank = cursor == null ? -Infinity : rows.find(row => row.id === cursor)?.rank;
      assert.notEqual(rank, undefined);
      const response = envelope(descriptor, rows.filter(row => row.rank > rank).map(row => ({ customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: row.id })));
      if (calls.length === 1) rows.push({ rank: 1, id: 'external-behind-cursor' });
      return response;
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].query.baseSearchId, 'opaque-existing');
    assert.equal(calls[1].query.selector, 'NEXT');
    assert.equal(rows.length, 2);
    assert.deepEqual(result.remoteIds, ['opaque-existing']);
    assert.equal(result.kind, 'present_remote_descendants');
    assert.equal(result.scan.termination, 'empty_page_observed');
    assert.equal(audit.details_json.count, 1);
    assert.equal(JSON.stringify(audit).includes('external-behind-cursor'), false);
  });
});
