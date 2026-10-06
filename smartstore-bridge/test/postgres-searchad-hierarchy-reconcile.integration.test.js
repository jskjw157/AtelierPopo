import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdLifecycleRepository as Storage } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { SearchAdLifecycleRiskService } from '../src/naver/searchad/lifecycle/risk-service.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { searchAdErrorFromResponse } from '../src/naver/searchad/errors.js';

const logger = { info() {}, warn() {}, error() {} };
const now = '2026-09-12T05:30:00.000Z';
const current = { specSha: 'synthetic-spec', credentialFingerprint: 'synthetic-credential', upstreamBaseUrl: 'https://reconcile-fixture.invalid' };
const principal = { principalId: 'fixture-admin', role: 'admin', customerIds: ['1001'] };
const absent = () => searchAdErrorFromResponse({ response: { status: 404, statusText: 'Not Found' }, data: {}, requestId: 'fixture-404' });
const unavailable = () => searchAdErrorFromResponse({ response: { status: 503, statusText: 'Unavailable' }, data: { message: 'secret-error-text' }, requestId: 'secret-request-id' });

// Real PG and real reconcile code; synthetic stored IDs and controlled read
// adapter responses only. No Naver call, real Canary or application restart.
test('B2b hierarchy reconcile: actual PostgreSQL state transitions, stale reads and no mutation replay', { timeout: 180_000 }, async t => {
  for (const file of ['hierarchy-reconcile-service.js', 'postgres-hierarchy-reconcile-repository.js']) {
    assert.ok(fs.existsSync(path.resolve('src/naver/searchad/lifecycle', file)), `B2b requires missing ${file}`);
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    assert.notEqual(process.env.CI, 'true', 'CI must supply TEST_DATABASE_URL; never silently skip PostgreSQL');
    return t.skip('Local PostgreSQL is not configured');
  }
  const { HierarchyReconcileService: Service } = await import('../src/naver/searchad/lifecycle/hierarchy-reconcile-service.js');
  const { PostgresHierarchyReconcileRepository: ReconcileRepository } = await import('../src/naver/searchad/lifecycle/postgres-hierarchy-reconcile-repository.js');
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const originalFetch = globalThis.fetch; let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls += 1; throw new Error('External HTTP forbidden in this PG test'); };
  t.after(async () => { globalThis.fetch = originalFetch; await closePostgresPool(admin); assert.equal(externalCalls, 0); });

  async function fixture(st, state = 'delete_pending', { account = true } = {}) {
    const schema = `reconcile_${randomUUID().replaceAll('-', '')}`;
    const pools = new Set(); let created = false;
    st.after(async () => {
      try { await Promise.all([...pools].map(p => closePostgresPool(p))); }
      finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    function connect() {
      const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger });
      pools.add(p); return p;
    }
    let pool = connect(); let storage = new Storage({ pool });
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    if (account) await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',true)");
    const run = await storage.createRun({ hierarchyRunId: randomUUID(), customerId: '1001', recipeId: 'synthetic-reconcile-only',
      status: 'unknown_outcome', startedByPrincipalId: principal.principalId, ...current, startedAt: now });
    const objects = []; const holds = [];
    for (const objectType of ['campaign', 'adgroup', 'creative']) {
      const i = objects.length;
      const object = await storage.createObject({ hierarchyObjectId: randomUUID(), hierarchyRunId: run.hierarchyRunId, customerId: '1001', objectType,
        parentObjectId: i ? objects[i - 1].hierarchyObjectId : null, createOperationKey: OPS[objectType].create,
        readOperationKey: OPS[objectType].read, deleteOperationKey: OPS[objectType].delete,
        remoteId: `synthetic-${objectType}`, state: i === 2 ? state : 'owned', createdAt: now, updatedAt: now });
      objects.push(object);
      holds.push(await storage.holdOwnership({ ownershipId: randomUUID(), customerId: '1001', objectType, remoteId: object.remoteId,
        ownerKind: 'hierarchy_canary', ownerRunId: run.hierarchyRunId, hierarchyObjectId: object.hierarchyObjectId,
        parentHierarchyObjectId: object.parentObjectId, createdOperationKey: object.createOperationKey, state: 'owned', createdAt: now, updatedAt: now }));
    }
    const target = objects.at(-1);
    const risk = new SearchAdLifecycleRiskService({ repository: storage, dailyCapacityUnits: 5,
      riskPolicy: { [OPS.creative.delete]: { lifecycleKind: 'delete', units: 1 } }, clock: () => Date.parse(now) });
    const intentId = `synthetic-risk-${randomUUID()}`;
    await risk.reserve({ customerId: '1001', intentId, operationKey: OPS.creative.delete, lifecycleKind: 'delete', ownerKind: 'hierarchy_canary', ownerRunId: run.hierarchyRunId });
    await risk.consume({ intentId });
    const initialRisk = await storage.getRiskReservation(intentId);
    const initialBalance = await storage.getDailyRiskCapacity('1001', '2026-09-12');
    const input = { customerId: '1001', hierarchyRunId: run.hierarchyRunId, hierarchyObjectId: target.hierarchyObjectId };
    let response = async () => { throw absent(); };
    const reads = [];
    const remote = { async read(d) { reads.push(structuredClone(d)); return response(d); } };
    Object.defineProperty(remote, 'mutate', { get() { throw new Error('Read-only service acquired a mutation method'); } });
    const service = p => new Service({ repository: new ReconcileRepository({ pool: p }), remote, contextResolver: async () => current, clock: () => Date.parse(now) });
    return { run, target, objects, holds, input, reads, connect, get pool() { return pool; }, get storage() { return storage; },
      set response(fn) { response = fn; }, async execute() { return service(pool).reconcile(input, { principal }); },
      service,
      async restart() { await closePostgresPool(pool); pools.delete(pool); pool = connect(); storage = new Storage({ pool }); },
      async events() { return storage.listEvents(run.hierarchyRunId, '1001'); },
      async unchangedRisk() {
        assert.deepEqual(await storage.getRiskReservation(intentId), initialRisk);
        assert.deepEqual(await storage.getDailyRiskCapacity('1001', '2026-09-12'), initialBalance);
      },
      present() { return { operation: { operationKey: OPS.creative.read, sideEffect: false }, upstream: { status: 200, headers: { authorization: 'secret-header' } },
        data: { customerId: 1001, nccAdId: target.remoteId, nccAdgroupId: objects[1].remoteId, type: 'TEXT_45', extra: 'secret-body' } }; }
    };
  }

  await t.test('legacy missing-account graph remains readable but cannot settle until a real account is locked',async st=>{
    const f=await fixture(st,'delete_pending',{account:false});
    const repository=new ReconcileRepository({pool:f.pool});
    assert.ok(await repository.loadSnapshot(f.input));
    await assert.rejects(f.execute(),{code:'SEARCHAD_SOURCE_ACCOUNT_REQUIRED'});
    assert.equal(f.reads.length,1);assert.equal((await f.events()).length,0);
    assert.equal((await f.storage.getObject(f.target.hierarchyObjectId,'1001')).state,'delete_pending');
    await f.unchangedRisk();
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',true)");
    assert.equal((await f.execute()).state,'deleted');
    assert.equal((await f.pool.query("SELECT suspended FROM searchad_canary_accounts WHERE customer_id='1001'")).rows[0].suspended,true);
    await f.unchangedRisk();
  });

  await t.test('delete_pending is settled only by explicit upstream 404; ownership and one sanitized event commit together', async st => {
    const f = await fixture(st);
    const result = await f.execute(); assert.equal(result.state, 'deleted'); assert.equal(result.changed, true);
    assert.equal((await f.storage.getObject(f.target.hierarchyObjectId, '1001')).state, 'deleted');
    assert.equal((await f.storage.getOwnership({ customerId: '1001', objectType: 'creative', remoteId: f.target.remoteId })).state, 'deleted');
    assert.equal((await f.events()).length, 1);
    assert.deepEqual(f.reads, [{ operationKey: OPS.creative.read, customerId: '1001', pathParams: { adId: f.target.remoteId } }]);
    assert.notEqual((await f.storage.getRun(f.run.hierarchyRunId, '1001')).status, 'passed');
    await f.unchangedRisk();
    const repeat = await f.execute(); assert.equal(repeat.changed, false);
    assert.equal(f.reads.length, 1); assert.equal((await f.events()).length, 1);
  });

  await t.test('read outage preserves delete_pending and reconnect can settle it without resending delete', async st => {
    const f = await fixture(st); f.response = async () => { throw unavailable(); };
    assert.equal((await f.execute()).state, 'delete_pending');
    await f.restart(); f.response = async () => { throw absent(); };
    assert.equal((await f.execute()).state, 'deleted'); assert.equal(f.reads.length, 2);
    assert.equal(JSON.stringify(await f.events()).includes('secret-'), false);
    await f.unchangedRisk();
  });

  await t.test('a present object becomes delete_unknown, never owned/retryable; subsequent GET 404 settles it', async st => {
    const f = await fixture(st); f.response = async () => f.present();
    assert.equal((await f.execute()).state, 'delete_unknown');
    assert.equal((await f.storage.getOwnership({ customerId: '1001', objectType: 'creative', remoteId: f.target.remoteId })).state, 'delete_unknown');
    f.response = async () => { throw absent(); };
    assert.equal((await f.execute()).state, 'deleted'); await f.unchangedRisk();
  });

  await t.test('wrong Customer and mismatched persisted ownership or parent are denied before any upstream read', async st => {
    const f = await fixture(st); const s = f.service(f.pool);
    await assert.rejects(() => s.reconcile({ ...f.input, customerId: '2002' }, { principal: { ...principal, customerIds: ['2002'] } }), { status: 404 });
    await f.pool.query('UPDATE searchad_remote_object_ownership SET owner_run_id=$1 WHERE ownership_id=$2', ['foreign', f.holds[2].ownershipId]);
    await assert.rejects(() => f.execute()); assert.equal(f.reads.length, 0);
    await f.pool.query('UPDATE searchad_remote_object_ownership SET owner_run_id=$1 WHERE ownership_id=$2', [f.run.hierarchyRunId, f.holds[2].ownershipId]);
    await f.pool.query('UPDATE searchad_hierarchy_objects SET parent_object_id=$1 WHERE hierarchy_object_id=$2', [f.objects[0].hierarchyObjectId, f.target.hierarchyObjectId]);
    await assert.rejects(() => f.execute()); assert.equal(f.reads.length, 0); assert.equal((await f.events()).length, 0);
  });

  await t.test('parent deletion cannot be settled while a live child remains', async st => {
    const f = await fixture(st);
    await f.storage.updateObject(f.objects[1].hierarchyObjectId, { state: 'delete_pending' }, '1001');
    const input = { ...f.input, hierarchyObjectId: f.objects[1].hierarchyObjectId };
    await assert.rejects(() => f.service(f.pool).reconcile(input, { principal }));
    assert.equal((await f.storage.getObject(f.objects[1].hierarchyObjectId, '1001')).state, 'delete_pending');
    assert.equal((await f.events()).length, 0);
  });

  await t.test('two independent connections cannot commit the same stale observation twice', async st => {
    const f = await fixture(st); let entered = 0; let release;
    const ready = new Promise(resolve => { release = resolve; });
    f.response = async () => { if (++entered === 2) release(); await ready; throw absent(); };
    const results = await Promise.allSettled([f.service(f.pool).reconcile(f.input, { principal }), f.service(f.connect()).reconcile(f.input, { principal })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SEARCHAD_HIERARCHY_RECONCILE_STALE');
    assert.equal((await f.events()).length, 1); await f.unchangedRisk();
  });

  await t.test('ownership changes while GET is in flight invalidate its result without overwriting the new state', async st => {
    const f = await fixture(st);
    f.response = async () => { await f.storage.updateOwnership(f.holds[2].ownershipId, { state: 'manual_review' }, '1001'); throw absent(); };
    await assert.rejects(() => f.execute(), { code: 'SEARCHAD_HIERARCHY_RECONCILE_STALE' });
    assert.equal((await f.storage.getObject(f.target.hierarchyObjectId, '1001')).state, 'delete_pending');
    assert.equal((await f.events()).length, 0); await f.unchangedRisk();
  });

  await t.test('a new child added during the GET invalidates the observation instead of completing its parent', async st => {
    const f = await fixture(st);
    // Deliberately insert a malformed local child through the old raw repository.
    // The new reconciliation must detect graph changes, not trust this fixture.
    const leafId = f.target.hierarchyObjectId;
    f.response = async () => {
      await f.storage.createObject({ hierarchyObjectId: randomUUID(), hierarchyRunId: f.run.hierarchyRunId, customerId: '1001', objectType: 'keyword',
        parentObjectId: leafId, createOperationKey: OPS.keyword.create, readOperationKey: OPS.keyword.read, deleteOperationKey: OPS.keyword.delete,
        state: 'create_unknown', createdAt: now, updatedAt: now });
      throw absent();
    };
    await assert.rejects(() => f.execute(), { code: 'SEARCHAD_HIERARCHY_RECONCILE_STALE' });
    assert.equal((await f.storage.getObject(leafId, '1001')).state, 'delete_pending');
    assert.equal((await f.events()).length, 0);
  });

  await t.test('audit insertion failure rolls back object, ownership and run updates as one transaction', async st => {
    const f = await fixture(st); const beforeRun = await f.storage.getRun(f.run.hierarchyRunId, '1001');
    await f.pool.query("CREATE FUNCTION fixture_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$");
    await f.pool.query('CREATE TRIGGER fixture_reject_event BEFORE INSERT ON searchad_hierarchy_events FOR EACH ROW EXECUTE FUNCTION fixture_reject_event()');
    await assert.rejects(() => f.execute());
    assert.deepEqual(await f.storage.getObject(f.target.hierarchyObjectId, '1001'), f.target);
    assert.equal((await f.storage.getOwnership({ customerId: '1001', objectType: 'creative', remoteId: f.target.remoteId })).state, 'owned');
    assert.deepEqual(await f.storage.getRun(f.run.hierarchyRunId, '1001'), beforeRun);
    assert.equal((await f.events()).length, 0); await f.unchangedRisk();
  });

  await t.test('no returned ID requires manual review without searching, making up ownership or releasing consumed risk', async st => {
    const f = await fixture(st, 'create_unknown');
    await f.storage.updateObject(f.target.hierarchyObjectId, { remoteId: null }, '1001');
    await f.pool.query('DELETE FROM searchad_remote_object_ownership WHERE ownership_id=$1', [f.holds[2].ownershipId]);
    assert.equal((await f.execute()).state, 'manual_review'); assert.equal(f.reads.length, 0);
    assert.equal((await f.storage.getObject(f.target.hierarchyObjectId, '1001')).remoteId, null);
    assert.equal((await f.storage.listOwnershipByRun({ ownerKind: 'hierarchy_canary', ownerRunId: f.run.hierarchyRunId, customerId: '1001' })).length, 2);
    await f.unchangedRisk();
  });

  await t.test('malformed success or wrong parent response becomes manual review and cannot authorize a delete', async st => {
    const f = await fixture(st); f.response = async () => { const r = f.present(); r.data.nccAdgroupId = 'wrong-parent'; return r; };
    assert.equal((await f.execute()).state, 'manual_review');
    assert.equal((await f.storage.getRun(f.run.hierarchyRunId, '1001')).status, 'manual_review');
    assert.equal(JSON.stringify(await f.events()).includes('secret-'), false); await f.unchangedRisk();
  });

  await t.test('create_unknown with a stored ID is not promoted to owned or deleted solely by a GET result', async st => {
    const f = await fixture(st, 'create_unknown'); f.response = async () => f.present();
    assert.equal((await f.execute()).state, 'manual_review');
    f.response = async () => { throw absent(); };
    assert.equal((await f.execute()).state, 'manual_review'); await f.unchangedRisk();
  });

  await t.test('local 404s remain unavailable and manufactured repository snapshots cannot settle records', async st => {
    const f = await fixture(st); f.response = async () => { throw Object.assign(new Error('secret-local'), { status: 404 }); };
    assert.equal((await f.execute()).state, 'delete_pending');
    const repo = new ReconcileRepository({ pool: f.pool });
    await assert.rejects(() => repo.recordObservation({ run: f.run, objects: f.objects, ownerships: f.holds, targetId: f.target.hierarchyObjectId }, { kind: 'absent', observedAt: now }));
    assert.equal((await f.storage.getObject(f.target.hierarchyObjectId, '1001')).state, 'delete_pending'); await f.unchangedRisk();
  });
});
