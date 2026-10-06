import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { ActiveCanaryGatewayRemoteAdapter } from '../src/naver/searchad/canary/remote-adapter.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { PostgresSearchAdLifecycleRepository as Storage } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { SearchAdLifecycleRiskService } from '../src/naver/searchad/lifecycle/risk-service.js';
import { HierarchyReconcileService } from '../src/naver/searchad/lifecycle/hierarchy-reconcile-service.js';
import { PostgresHierarchyReconcileRepository } from '../src/naver/searchad/lifecycle/postgres-hierarchy-reconcile-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const origin = 'https://api.searchad.naver.com';
const instant = '2026-09-12T06:00:00.000Z';
const logger = { info() {}, warn() {}, error() {} };
const principal = { principalId: 'fixture-reconcile-admin', role: 'admin', customerIds: ['1001'] };
const idKeys = { campaign: 'nccCampaignId', adgroup: 'nccAdgroupId', keyword: 'nccKeywordId', creative: 'nccAdId' };
const paths = { campaign: 'campaigns', adgroup: 'adgroups', keyword: 'keywords', creative: 'ads' };
const response = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'x-request-id': 'fixture-sensitive-request-id' }
});

// Compose the REAL PG repository, reconciliation service, existing adapter,
// pinned manifest, credentials, signing client and Gateway. Only fetchImpl is
// simulated. Stored IDs are synthetic fixtures, NOT observed create evidence.
// This does not wire application HTTP, start a Canary, or execute any mutation.
test('B2b reconciliation composes real signed Gateway and PostgreSQL with all mutation gates OFF', { timeout: 180_000 }, async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    assert.notEqual(process.env.CI, 'true', 'CI must supply TEST_DATABASE_URL; real PG coverage cannot silently skip');
    return t.skip('Local PostgreSQL is not configured');
  }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const originalFetch = globalThis.fetch;
  let escapedCalls = 0;
  globalThis.fetch = async () => { escapedCalls += 1; throw new Error('External network forbidden'); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    try { await closePostgresPool(admin); }
    finally { assert.equal(escapedCalls, 0, 'No external HTTP request may escape fetchImpl'); }
  });

  async function fixture(st, type = 'creative', state = 'delete_pending') {
    const schema = `reconcile_gateway_${randomUUID().replaceAll('-', '')}`;
    const pools = new Set(); let created = false;
    st.after(async () => {
      try { await Promise.all([...pools].map(p => closePostgresPool(p))); }
      finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    const connect = () => {
      const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger });
      pools.add(p); return p;
    };
    let pool = connect(); let storage = new Storage({ pool });
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    assert.equal((await pool.query('SELECT current_schema() AS value')).rows[0].value, schema);
    const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
    const credentials = new SearchAdCredentialsRegistry({
      principals: [{ principalId: 'fixture-signer', accessLicense: 'fixture-sensitive-license', secretKey: 'fixture-sensitive-secret', status: 'active' }],
      customers: [{ customerId: '1001', status: 'active' }],
      grants: [{ principalId: 'fixture-signer', customerId: '1001', role: 'admin' }]
    });
    const config = { enabled: true, configured: true, baseUrl: origin, allowReads: true,
      allowWrites: false, allowCreates: false, allowDeletes: false, allowBatchWrites: false,
      allowRollbacks: false, allowActiveCanary: false, allowUnverifiedOperations: false, automationMode: 'observe' };
    const calls = []; let signedCalls = 0;
    let answer = () => response(404, { code: 'FIXTURE_NOT_FOUND', message: 'fixture-sensitive-upstream-body' });
    let target;
    const fetchImpl = async (url, init) => {
      const u = new URL(url);
      calls.push({ method: init.method, path: u.pathname, query: u.search, customer: init.headers['X-Customer'] });
      assert.equal(u.origin, origin);
      assert.equal(init.method, 'GET', 'Reconciliation must never reach a mutation transport');
      assert.equal(u.pathname, `/ncc/${paths[type]}/${target.remoteId}`);
      assert.equal(u.search, '');
      assert.equal(init.body, undefined);
      assert.equal(init.headers['X-Customer'], '1001');
      assert.equal(init.headers['X-API-KEY'], 'fixture-sensitive-license');
      const timestamp = init.headers['X-Timestamp'];
      assert.match(timestamp, /^\d{10,17}$/);
      const expected = createHmac('sha256', credentials.resolve('1001').secretKey)
        .update(`${timestamp}.GET.${u.pathname}`, 'utf8').digest('base64');
      assert.equal(init.headers['X-Signature'], expected, 'The actual signing path must run');
      signedCalls += 1;
      return answer();
    };
    const client = new NaverSearchAdClient({ baseUrl: origin, credentialsRegistry: credentials, fetchImpl, maxRetries: 0, logger });
    const gateway = new SearchAdOperationGateway({ client, config, registry, credentialsRegistry: credentials, logger });
    const contextResolver = async customerId => ({ specSha: registry.status().specRef,
      credentialFingerprint: credentialFingerprintForCustomer(credentials, customerId), upstreamBaseUrl: config.baseUrl });
    const run = await storage.createRun({ hierarchyRunId: randomUUID(), customerId: '1001', recipeId: 'synthetic-gateway-reconcile',
      status: 'unknown_outcome', startedByPrincipalId: principal.principalId,
      ...await contextResolver('1001'), startedAt: instant });
    const chainTypes = type === 'campaign' ? ['campaign'] : type === 'adgroup' ? ['campaign', 'adgroup'] : ['campaign', 'adgroup', type];
    const objects = []; const holds = [];
    for (const objectType of chainTypes) {
      const object = await storage.createObject({ hierarchyObjectId: randomUUID(), hierarchyRunId: run.hierarchyRunId,
        customerId: '1001', objectType, parentObjectId: objects.at(-1)?.hierarchyObjectId ?? null,
        createOperationKey: OPS[objectType].create, readOperationKey: OPS[objectType].read, deleteOperationKey: OPS[objectType].delete,
        remoteId: `synthetic-${objectType}-${randomUUID()}`, state: objectType === type ? state : 'owned', createdAt: instant, updatedAt: instant });
      objects.push(object);
      holds.push(await storage.holdOwnership({ ownershipId: randomUUID(), customerId: '1001', objectType,
        remoteId: object.remoteId, ownerKind: 'hierarchy_canary', ownerRunId: run.hierarchyRunId,
        hierarchyObjectId: object.hierarchyObjectId, parentHierarchyObjectId: object.parentObjectId,
        createdOperationKey: object.createOperationKey, state: 'owned', createdAt: instant, updatedAt: instant }));
    }
    target = objects.at(-1);
    // A suspended account and consumed risk are existing local fixtures. A GET
    // observation must neither lift suspension nor recycle that consumed risk.
    await pool.query('INSERT INTO searchad_canary_accounts(customer_id,suspended,updated_at) VALUES($1,true,$2)',
      ['1001', instant]);
    const risk = new SearchAdLifecycleRiskService({ repository: storage, dailyCapacityUnits: 5,
      riskPolicy: { [OPS[type].delete]: { lifecycleKind: 'delete', units: 1 } }, clock: () => Date.parse(instant) });
    const intentId = `fixture-risk-${randomUUID()}`;
    await risk.reserve({ customerId: '1001', intentId, operationKey: OPS[type].delete, lifecycleKind: 'delete', ownerKind: 'hierarchy_canary', ownerRunId: run.hierarchyRunId });
    await risk.consume({ intentId });
    const initialRisk = await storage.getRiskReservation(intentId);
    const initialBalance = await storage.getDailyRiskCapacity('1001', '2026-09-12');
    const input = { customerId: '1001', hierarchyRunId: run.hierarchyRunId, hierarchyObjectId: target.hierarchyObjectId };
    const service = () => new HierarchyReconcileService({ repository: new PostgresHierarchyReconcileRepository({ pool }),
      remote: new ActiveCanaryGatewayRemoteAdapter({ gateway }), contextResolver, clock: () => Date.parse(instant) });
    const f = { input, target, run, objects, holds, config, calls, credentials, gateway,
      get storage() { return storage; }, get pool() { return pool; },
      set answer(fn) { answer = fn; },
      execute: (patch = {}, context = { principal }) => service().reconcile({ ...input, ...patch }, context),
      events: () => storage.listEvents(run.hierarchyRunId, '1001'),
      async restart() { await closePostgresPool(pool); pools.delete(pool); pool = connect(); storage = new Storage({ pool }); },
      present() {
        const data = { customerId: 1001, [idKeys[type]]: target.remoteId, note: 'fixture-sensitive-upstream-body' };
        if (objects.length > 1) data[idKeys[objects.at(-2).objectType]] = objects.at(-2).remoteId;
        if (type === 'campaign') data.campaignTp = 'WEB_SITE';
        if (type === 'creative') data.type = 'TEXT_45';
        return data;
      }
    };
    f.unchangedAuthority = async () => {
      assert.deepEqual(await storage.getRiskReservation(intentId), initialRisk);
      assert.deepEqual(await storage.getDailyRiskCapacity('1001', '2026-09-12'), initialBalance);
      assert.equal((await pool.query('SELECT suspended FROM searchad_canary_accounts WHERE customer_id=$1', ['1001'])).rows[0].suspended, true);
      for (const table of ['searchad_write_approvals', 'searchad_activation_grants', 'searchad_verification_evidence']) {
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
      }
      for (const key of ['allowWrites', 'allowCreates', 'allowDeletes', 'allowBatchWrites', 'allowRollbacks', 'allowActiveCanary', 'allowUnverifiedOperations']) assert.equal(config[key], false);
      assert.equal(JSON.stringify(await f.events()).includes('fixture-sensitive-'), false);
      assert.ok(calls.every(call => call.method === 'GET'));
      assert.equal(signedCalls, calls.length, 'Transport assertions cannot be swallowed as simulated outages');
    };
    return f;
  }

  for (const type of Object.keys(idKeys)) {
    await t.test(`${type}: typed upstream404 settles once through exact signed GET; reconnect never replays it`, async st => {
      const f = await fixture(st, type);
      assert.equal((await f.execute()).state, 'deleted');
      assert.equal(f.calls.length, 1);
      assert.equal((await f.events()).length, 1);
      assert.equal((await f.storage.getOwnership({ customerId: '1001', objectType: type, remoteId: f.target.remoteId })).state, 'deleted');
      await f.restart();
      assert.equal((await f.execute()).kind, 'not_pending');
      assert.equal(f.calls.length, 1);
      assert.notEqual((await f.storage.getRun(f.run.hierarchyRunId, '1001')).status, 'passed');
      await f.unchangedAuthority();
    });
  }
  await t.test('real successful response preserves an unresolved delete; later404 settles without DELETE', async st => {
    const f = await fixture(st);
    f.answer = () => response(200, f.present());
    assert.equal((await f.execute()).state, 'delete_unknown');
    f.answer = () => response(404, { code: 'FIXTURE_NOT_FOUND' });
    assert.equal((await f.execute()).state, 'deleted');
    assert.equal(f.calls.length, 2); await f.unchangedAuthority();
  });
  for (const [label, patch] of [['Customer', { customerId: 2002 }], ['parent', { nccAdgroupId: 'foreign-parent' }],
    ['returned ID', { nccAdId: 'foreign-object' }], ['type', { type: 'NOT_TEXT_45' }]]) {
    await t.test(`real200 with wrong ${label} is manual review, never absence or new ownership`, async st => {
      const f = await fixture(st);
      f.answer = () => response(200, { ...f.present(), ...patch });
      assert.equal((await f.execute()).state, 'manual_review');
      assert.equal((await f.storage.getObject(f.target.hierarchyObjectId, '1001')).remoteId, f.target.remoteId);
      assert.equal(f.calls.length, 1); await f.unchangedAuthority();
    });
  }
  for (const status of [401, 503]) {
    await t.test(`real upstream${status} preserves pending state rather than fabricating absence`, async st => {
      const f = await fixture(st);
      f.answer = () => response(status, { code: 'FIXTURE_FAILURE', message: 'fixture-sensitive-upstream-body' });
      const result = await f.execute(); assert.equal(result.kind, 'unavailable'); assert.equal(result.state, 'delete_pending');
      assert.equal(f.calls.length, 1); await f.unchangedAuthority();
    });
  }
  await t.test('local read gate failure makes no transport call and cannot masquerade as upstream404', async st => {
    const f = await fixture(st); f.config.allowReads = false;
    assert.equal((await f.execute()).kind, 'unavailable');
    assert.equal(f.calls.length, 0);
    assert.equal((await f.storage.getObject(f.target.hierarchyObjectId, '1001')).state, 'delete_pending');
    await f.unchangedAuthority();
  });
  await t.test('credential rotation before or during GET rejects settlement without state or event changes', async st => {
    const f = await fixture(st);
    const signer = f.credentials.principals.get('fixture-signer');
    signer.secretKey = 'rotated-fixture-secret';
    await assert.rejects(() => f.execute(), { code: 'SEARCHAD_HIERARCHY_RECONCILE_CONTEXT_MISMATCH' });
    assert.equal(f.calls.length, 0);
    signer.secretKey = 'fixture-sensitive-secret';
    f.answer = () => { signer.secretKey = 'rotated-fixture-secret'; return response(404, { code: 'FIXTURE_NOT_FOUND' }); };
    await assert.rejects(() => f.execute(), { code: 'SEARCHAD_HIERARCHY_RECONCILE_CONTEXT_MISMATCH' });
    assert.equal(f.calls.length, 1); assert.equal((await f.events()).length, 0);
    assert.equal((await f.storage.getObject(f.target.hierarchyObjectId, '1001')).state, 'delete_pending');
    await f.unchangedAuthority();
  });
  await t.test('role, foreign Customer and caller remote-ID injection are denied before signed transport', async st => {
    const f = await fixture(st);
    await assert.rejects(() => f.execute({}, { principal: { ...principal, role: 'reader' } }), { status: 403 });
    await assert.rejects(() => f.execute({ customerId: '2002' }, { principal: { ...principal, customerIds: ['2002'] } }), { status: 404 });
    await assert.rejects(() => f.execute({ remoteId: 'victim' }), { status: 400 });
    assert.equal(f.calls.length, 0); assert.equal((await f.events()).length, 0);
    await f.unchangedAuthority();
  });
  await t.test('malformed200 and read transport outage are not deletion evidence', async st => {
    const f = await fixture(st);
    f.answer = () => { throw new TypeError('fixture-sensitive-transport-failure'); };
    assert.equal((await f.execute()).state, 'delete_pending');
    f.answer = () => response(200, []);
    assert.equal((await f.execute()).state, 'manual_review');
    assert.equal(f.calls.length, 2); await f.unchangedAuthority();
  });
});
