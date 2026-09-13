import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdLifecycleRepository as Storage } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { SearchAdLifecycleRiskService } from '../src/naver/searchad/lifecycle/risk-service.js';
import { PostgresSearchAdWriteRepository as WriteStorage } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { createHierarchyCampaignRecipe } from '../src/naver/searchad/lifecycle/recipe-campaign.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';

const logger = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-09-12T07:00:00Z');
const registryFile = path.resolve('specs/naver-searchad/current.json');
const identity = { specSha: loadSearchAdSpecRegistry(registryFile).status().specRef, credentialFingerprint: 'synthetic-fingerprint', upstreamBaseUrl: 'https://dispatch-fixture.invalid' };
const fields = ['campaign.campaignTp', 'campaign.name', 'campaign.userLock', 'campaign.dailyBudget'];
const context = { principal: { principalId: 'fixture-admin', role: 'admin', customerIds: ['1001'] } };
const tables = ['searchad_hierarchy_canary_runs', 'searchad_hierarchy_objects', 'searchad_hierarchy_events',
  'searchad_remote_object_ownership', 'searchad_write_change_plans', 'searchad_write_approvals',
  'searchad_write_attempts', 'searchad_risk_reservations', 'searchad_daily_risk_capacity'];

// Real PostgreSQL, migrations, approval service and risk accounting. Explicit
// synthetic evidence and planned records: NOT production authorization or I/O.
test('campaign dispatch transaction: approval, consumed risk and durable intent commit together', { timeout: 180_000 }, async t => {
  assert.ok(fs.existsSync(path.resolve('src/naver/searchad/lifecycle/postgres-campaign-dispatch-repository.js')),
    'Missing campaign dispatch transaction coordinator');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    assert.notEqual(process.env.CI, 'true', 'CI requires real PostgreSQL');
    return t.skip('Local PostgreSQL is not configured');
  }
  const { PostgresCampaignDispatchRepository: Coordinator } = await import('../src/naver/searchad/lifecycle/postgres-campaign-dispatch-repository.js');
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  let escaped = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { escaped++; throw new Error('No external transport in dispatch transaction tests'); };
  t.after(async () => { globalThis.fetch = originalFetch; await closePostgresPool(admin); assert.equal(escaped, 0); });

  async function fixture(st, { grantPatch = {}, evidencePatch = {}, now = NOW } = {}) {
    const schema = `dispatch_${randomUUID().replaceAll('-', '')}`;
    const pools = new Set(); let created = false; let clock = now;
    st.after(async () => {
      try { await Promise.all([...pools].map(p => closePostgresPool(p))); }
      finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    scoped.searchParams.set('application_name', schema);
    function connect() {
      const pool = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger });
      pools.add(pool); return pool;
    }
    const pool = connect(); const storage = new Storage({ pool }); const writer = new WriteStorage({ pool });
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    const createdAt = new Date(now - 1000).toISOString(); const expiresAt = new Date(now + 60000).toISOString();
    const evidenceId = `synthetic-${randomUUID()}`; const activationId = randomUUID();
    await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES ('1001',false)");
    const evidence = { customerId: '1001', type: 'active_canary', ...identity, operations: [OPS.campaign.create], fields,
      lifecycle: ['create'], result: 'verified', createdAt, expiresAt, ...evidencePatch };
    await pool.query(`INSERT INTO searchad_verification_evidence
      (evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,
       operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`,
      [evidenceId,evidence.type,evidence.customerId,evidence.specSha,evidence.credentialFingerprint,evidence.upstreamBaseUrl,
        JSON.stringify(evidence.operations),JSON.stringify(evidence.fields),JSON.stringify(evidence.lifecycle),evidence.result,evidence.createdAt,evidence.expiresAt]);
    const grant = { customerId: '1001', type: 'active_canary', ...identity, operations: [OPS.campaign.create], fields,
      lifecycle: ['create'], createdAt, expiresAt, ...grantPatch };
    await pool.query(`INSERT INTO searchad_activation_grants
      (activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,
       operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'fixture-approver',$11,$12)`,
      [activationId,evidenceId,grant.type,grant.customerId,grant.specSha,grant.credentialFingerprint,grant.upstreamBaseUrl,
        JSON.stringify(grant.operations),JSON.stringify(grant.fields),JSON.stringify(grant.lifecycle),grant.createdAt,grant.expiresAt]);
    const run = await storage.createRun({ hierarchyRunId: randomUUID(), customerId: '1001', recipeId: 'hierarchy_stopped_web_site_campaign_v1',
      status: 'preflight_verified', startedByPrincipalId: context.principal.principalId, ...identity, activationId, startedAt: createdAt });
    const object = await storage.createObject({ hierarchyObjectId: randomUUID(), hierarchyRunId: run.hierarchyRunId, customerId: '1001',
      objectType: 'campaign', parentObjectId: null, createOperationKey: OPS.campaign.create, readOperationKey: OPS.campaign.read,
      deleteOperationKey: OPS.campaign.delete, state: 'planned', createdAt, updatedAt: createdAt });
    const descriptor = createHierarchyCampaignRecipe({ dailyBudget: 1000 }).createCampaign({ customerId: '1001', hierarchyRunId: run.hierarchyRunId });
    const plan = await writer.createPlan({ plan_id: randomUUID(), customer_id: '1001', mutation_operation_key: OPS.campaign.create,
      mutation_json: descriptor, read_json: {}, before_json: {}, before_hash: contentHash({}), expected_after_json: descriptor.body,
      rollback_json: null, reason: 'Synthetic transaction fixture only', status: 'planned', created_by: 'fixture-operator',
      created_at: createdAt, expires_at: expiresAt });
    const approvals = new SearchAdApprovalService({ repository: writer, config: { approvalTtlSeconds: 60 }, clock: () => clock });
    const approval = await approvals.approve(plan.plan_id, { actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE' });
    const input = { customerId: '1001', hierarchyRunId: run.hierarchyRunId, hierarchyObjectId: object.hierarchyObjectId,
      planId: plan.plan_id, executionToken: approval.executionToken };
    const registry = loadSearchAdSpecRegistry(registryFile);
    const make = (p = pool, options = {}) => new Coordinator({ pool: p, registry, enabled: true, dailyBudget: 1000, riskUnits: 2,
      dailyCapacityUnits: 5, contextResolver: () => identity, clock: () => clock, ...options });
    const risk = p => new SearchAdLifecycleRiskService({ repository: new Storage({ pool: p }), dailyCapacityUnits: 5,
      riskPolicy: { [OPS.campaign.create]: { lifecycleKind: 'create', units: 4 } }, clock: () => clock });
    return { schema, pool, storage, writer, approvals, registry, run, object, plan, approval, input, descriptor, make, connect,
      set clock(value) { clock = value; },
      claim(p = pool, options = {}) { return make(p, options).claim(input, context); },
      reserveOther(p = pool) { return risk(p).reserve({ customerId: '1001', intentId: `legacy-fixture-${randomUUID()}`,
        operationKey: OPS.campaign.create, lifecycleKind: 'create', ownerKind: 'active_canary', ownerRunId: 'synthetic-legacy-run' }); },
      async snapshot() {
        const result = {};
        for (const table of tables) result[table] = (await pool.query(`SELECT row_to_json(t) AS r FROM ${table} t ORDER BY row_to_json(t)::text`)).rows;
        return result;
      }
    };
  }

  await t.test('successful local claim commits token, risk, pending records and immutable audit; reconnect rejects replay', async st => {
    const f = await fixture(st); const result = await f.claim();
    assert.equal(result.dispatchCommitted, true); assert.equal(result.remoteDispatched, false);
    assert.deepEqual(result.descriptor, f.descriptor);
    assert.ok((await f.writer.getApproval(f.approval.approvalId)).used_at);
    assert.equal((await f.writer.getPlan(f.plan.plan_id)).status, 'unknown_outcome');
    assert.equal((await f.storage.getRun(f.run.hierarchyRunId)).status, 'unknown_outcome');
    const object = await f.storage.getObject(f.object.hierarchyObjectId);
    assert.equal(object.state, 'dispatching'); assert.equal(object.remoteId, null);
    const reservation = await f.storage.getRiskReservation(result.intentId);
    assert.equal(reservation.state, 'consumed'); assert.equal(reservation.units, 2);
    const balance = await f.storage.getDailyRiskCapacity('1001', '2026-09-12');
    assert.equal(balance.consumedUnits, 2); assert.equal(balance.reservedUnits, 0);
    const events = await f.storage.listEvents(f.run.hierarchyRunId, '1001');
    assert.equal(events.length, 1); assert.equal(events[0].phase, 'dispatch_intent');
    assert.equal(events[0].details.planId, f.plan.plan_id);
    assert.equal(events[0].details.requestFingerprint, contentHash(f.descriptor));
    assert.equal(events[0].details.actorPrincipalId, context.principal.principalId);
    assert.equal(JSON.stringify(events).includes(f.approval.executionToken), false);
    assert.equal((await f.writer.listAttempts(f.plan.plan_id)).length, 1);
    assert.equal((await f.pool.query('SELECT * FROM searchad_remote_object_ownership')).rowCount, 0);
    const before = await f.snapshot(); await assert.rejects(() => f.claim(f.connect()));
    assert.deepEqual(await f.snapshot(), before);
    await assert.rejects(() => f.approvals.approve(f.plan.plan_id, { actor: 'fixture-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE' }));
    await assert.rejects(() => f.pool.query("UPDATE searchad_hierarchy_events SET status='tampered'"));
  });

  await t.test('two independent pools attempting the same approved plan have one committed winner', async st => {
    const f = await fixture(st);
    const results = await Promise.allSettled([f.claim(), f.claim(f.connect())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await f.storage.listEvents(f.run.hierarchyRunId, '1001')).length, 1);
    assert.equal((await f.storage.getDailyRiskCapacity('1001', '2026-09-12')).consumedUnits, 2);
  });

  for (const table of ['searchad_risk_reservations', 'searchad_hierarchy_objects', 'searchad_write_attempts', 'searchad_hierarchy_events']) {
    await t.test(`failure at ${table} rolls back earlier writes and preserves the usable approval`, async st => {
      const f = await fixture(st); const before = await f.snapshot();
      await f.pool.query("CREATE FUNCTION reject_dispatch_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END; $$");
      await f.pool.query(`CREATE TRIGGER reject_dispatch_write BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_dispatch_write()`);
      await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
      await f.pool.query(`DROP TRIGGER reject_dispatch_write ON ${table}`);
      assert.equal((await f.claim()).dispatchCommitted, true);
    });
  }

  await t.test('existing reservations consume shared capacity; exhaustion leaves every dispatch record unchanged', async st => {
    const f = await fixture(st); await f.reserveOther(); const before = await f.snapshot();
    await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('legacy risk reservation versus new dispatch cannot jointly exceed daily capacity', async st => {
    const f = await fixture(st);
    const results = await Promise.allSettled([f.claim(), f.reserveOther(f.connect())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const b = await f.storage.getDailyRiskCapacity('1001', '2026-09-12');
    assert.ok(b.reservedUnits + b.consumedUnits <= b.capacityUnits);
  });
  await t.test('disabled component, wrong roles, foreign Customer, extra fields and invalid token fail without side effects', async st => {
    const f = await fixture(st); const before = await f.snapshot();
    await assert.rejects(() => f.claim(f.pool, { enabled: false }));
    for (const principal of [null, {}, { ...context.principal, role: 'reader' }, { ...context.principal, role: 'executor' }, { ...context.principal, customerIds: [] }]) {
      await assert.rejects(() => f.make().claim(f.input, { principal }));
    }
    for (const patch of [{ remoteId: 'victim' }, { riskUnits: 0 }, { customerId: '2002' }, { executionToken: 'wrong' }, { planId: 'invalid' }]) {
      await assert.rejects(() => f.make().claim({ ...f.input, ...patch }, context));
    }
    assert.deepEqual(await f.snapshot(), before);
  });

  for (const [name, sql] of [
    ['foreign object Customer', "UPDATE searchad_hierarchy_objects SET customer_id='2002'"],
    ['wrong object type', "UPDATE searchad_hierarchy_objects SET object_type='adgroup'"],
    ['wrong operation', "UPDATE searchad_hierarchy_objects SET create_operation_key='wrong'"],
    ['existing remote ID', "UPDATE searchad_hierarchy_objects SET remote_id='victim'"],
    ['unresolved run', "UPDATE searchad_hierarchy_canary_runs SET status='manual_review'"],
    ['unknown object outcome', "UPDATE searchad_hierarchy_objects SET state='create_unknown'"],
    ['foreign plan Customer', "UPDATE searchad_write_change_plans SET customer_id='2002'"],
    ['used approval', "UPDATE searchad_write_approvals SET used_at=created_at"]
  ]) {
    await t.test(`${name} blocks the local dispatch transaction`, async st => {
      const f = await fixture(st); await f.pool.query(sql); const before = await f.snapshot();
      await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
    });
  }
  await t.test('stored approved descriptor must equal the rebuilt stopped server recipe exactly', async st => {
    const f = await fixture(st);
    for (const descriptor of [{ ...f.descriptor, body: { ...f.descriptor.body, userLock: false } },
      { ...f.descriptor, pathParams: { campaignId: 'victim' } },
      { ...f.descriptor, body: { ...f.descriptor.body, dailyBudget: 100000 } }]) {
      await f.pool.query('UPDATE searchad_write_change_plans SET mutation_json=$1::jsonb', [JSON.stringify(descriptor)]);
      const before = await f.snapshot(); await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
    }
  });
  await t.test('suspension or changed current identity cannot consume the approval', async st => {
    const f = await fixture(st); const before = await f.snapshot();
    await f.pool.query('UPDATE searchad_canary_accounts SET suspended=true');
    await assert.rejects(() => f.claim()); await f.pool.query('UPDATE searchad_canary_accounts SET suspended=false');
    for (const key of Object.keys(identity)) {
      await assert.rejects(() => f.claim(f.pool, { contextResolver: () => ({ ...identity, [key]: 'changed' }) }));
    }
    assert.deepEqual(await f.snapshot(), before);
  });
  for (const [name, options] of [
    ['update-only grant', { grantPatch: { lifecycle: [] } }],
    ['different operation grant', { grantPatch: { operations: [OPS.campaign.delete] } }],
    ['expired grant', { grantPatch: { expiresAt: new Date(NOW - 1).toISOString() } }],
    ['incomplete field grant', { grantPatch: { fields: ['userLock'] } }],
    ['Passive evidence', { evidencePatch: { type: 'passive_capability' } }],
    ['failed evidence', { evidencePatch: { result: 'failed' } }],
    ['no create lifecycle evidence', { evidencePatch: { lifecycle: [] } }],
    ['foreign evidence Customer', { evidencePatch: { customerId: '2002' } }]
  ]) {
    await t.test(`${name} cannot authorize a campaign claim`, async st => {
      const f = await fixture(st, options); const before = await f.snapshot();
      await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
    });
  }
  await t.test('approval expiration is checked after a real row-lock wait, not just at entry', async st => {
    const f = await fixture(st); const before = await f.snapshot(); const blocker = await f.pool.connect();
    let rejected;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT * FROM searchad_write_change_plans FOR UPDATE');
      const pending = f.claim(f.connect()); rejected = assert.rejects(pending);
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const r = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [f.schema]);
        if (r.rowCount) { waiting = true; break; } await delay(10);
      }
      assert.equal(waiting, true); f.clock = NOW + 120000;
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    await rejected; assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('lost COMMIT acknowledgement returns no success and a new connection cannot reclaim the committed intent', async st => {
    const f = await fixture(st); let discarded = false;
    const wrapped = { query: f.pool.query.bind(f.pool), async connect() {
      const client = await f.pool.connect();
      return { async query(sql, params) {
        const result = await client.query(sql, params);
        if (sql === 'COMMIT') throw new Error('simulated lost commit acknowledgement');
        return result;
      }, release(destroy) { discarded = destroy === true; client.release(destroy); } };
    } };
    await assert.rejects(() => f.claim(wrapped), { code: 'SEARCHAD_HIERARCHY_DISPATCH_COMMIT_UNKNOWN' });
    assert.equal(discarded, true);
    assert.ok((await f.writer.getApproval(f.approval.approvalId)).used_at);
    assert.equal((await f.storage.listEvents(f.run.hierarchyRunId, '1001')).length, 1);
    const before = await f.snapshot(); await assert.rejects(() => f.claim(f.connect()));
    assert.deepEqual(await f.snapshot(), before);
  });

  await t.test('missing or changed manifest operation cannot commit a campaign intent', async st => {
    const f = await fixture(st); const before = await f.snapshot();
    assert.throws(() => f.make(f.pool, { registry: null }));
    const op = f.registry.get(OPS.campaign.create); const original = { ...op };
    for (const patch of [{ runtimeAllowlisted: false }, { tier: 'C' }, { state: 'internal_quarantined' },
      { method: 'DELETE' }, { path: '/victim' }, { sideEffect: false }]) {
      Object.assign(op, original, patch);
      await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
    }
    Object.assign(op, original);
    f.registry.manifest.specRef = 'changed-spec';
    await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('server limits and resolver contracts are strict; omitted gate is OFF before acquiring a connection', async st => {
    const f = await fixture(st); let connections = 0;
    const pool = { query() {}, connect() { connections++; throw new Error('must not connect'); } };
    await assert.rejects(() => f.make(pool, { enabled: undefined }).claim(f.input, context), { code: 'SEARCHAD_HIERARCHY_DISPATCH_DISABLED' });
    assert.equal(connections, 0);
    for (const options of [{ enabled: 'true' }, { dailyBudget: '1000' }, { dailyBudget: -1 }, { riskUnits: 0 },
      { riskUnits: 6 }, { dailyCapacityUnits: Infinity }, { contextResolver: null }]) assert.throws(() => f.make(f.pool, options));
    const before = await f.snapshot();
    await assert.rejects(() => f.claim(f.pool, { contextResolver: async () => identity }));
    assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('caller edits during connection acquisition do not alter scope, token or authenticated actor', async st => {
    const f = await fixture(st); const input = { ...f.input }; const ctx = structuredClone(context);
    const wrapped = { query: f.pool.query.bind(f.pool), async connect() {
      input.customerId = '2002'; input.hierarchyRunId = randomUUID(); input.executionToken = 'changed';
      ctx.principal.principalId = 'forged'; ctx.principal.customerIds = ['2002'];
      return f.pool.connect();
    } };
    const result = await f.make(wrapped).claim(input, ctx);
    assert.equal(result.descriptor.customerId, '1001');
    assert.equal((await f.storage.listEvents(f.run.hierarchyRunId))[0].details.actorPrincipalId, 'fixture-admin');
  });
  await t.test('post-write identity change aborts the entire transaction before COMMIT', async st => {
    const f = await fixture(st); const before = await f.snapshot(); let count = 0;
    await assert.rejects(() => f.claim(f.pool, { contextResolver: () => ++count >= 3 ? { ...identity, specSha: 'changed' } : identity }));
    assert.equal(count, 3); assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('pre-existing risk intent cannot be rebound even when released', async st => {
    const f = await fixture(st); const intentId = `hierarchy:campaign:create:${f.plan.plan_id}`;
    await f.storage.reserveRisk({ intentId, customerId: '1001', riskDate: '2026-09-12', units: 2, capacityUnits: 5,
      operationKey: OPS.campaign.create, lifecycleKind: 'create', ownerKind: 'hierarchy_canary', ownerRunId: f.run.hierarchyRunId,
      createdAt: new Date(NOW).toISOString() });
    for (const released of [false, true]) {
      if (released) await f.storage.releaseRisk({ intentId, updatedAt: new Date(NOW).toISOString() });
      const before = await f.snapshot(); await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
    }
  });
  await t.test('an established capacity is never silently raised by a new coordinator', async st => {
    const f = await fixture(st); await f.reserveOther(); const before = await f.snapshot();
    await assert.rejects(() => f.claim(f.pool, { dailyCapacityUnits: 50 }));
    assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('already consumed risk cannot be recycled after a local claim', async st => {
    const f = await fixture(st); const result = await f.claim(); const before = await f.snapshot();
    await assert.rejects(() => f.storage.releaseRisk({ intentId: result.intentId, updatedAt: new Date(NOW).toISOString() }));
    assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('an extra child, stale ownership or previous immutable intent blocks a fresh campaign claim', async st => {
    const f = await fixture(st);
    const child = await f.storage.createObject({ hierarchyObjectId: randomUUID(), hierarchyRunId: f.run.hierarchyRunId,
      customerId: '1001', objectType: 'adgroup', parentObjectId: f.object.hierarchyObjectId,
      createOperationKey: OPS.adgroup.create, readOperationKey: OPS.adgroup.read, deleteOperationKey: OPS.adgroup.delete,
      state: 'planned', createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() });
    let before = await f.snapshot(); await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
    await f.pool.query('DELETE FROM searchad_hierarchy_objects WHERE hierarchy_object_id=$1', [child.hierarchyObjectId]);
    const hold = await f.storage.holdOwnership({ ownershipId: randomUUID(), customerId: '1001', objectType: 'campaign', remoteId: 'synthetic-victim',
      ownerKind: 'hierarchy_canary', ownerRunId: f.run.hierarchyRunId, hierarchyObjectId: f.object.hierarchyObjectId,
      createdOperationKey: OPS.campaign.create, state: 'manual_review', createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() });
    before = await f.snapshot(); await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
    await f.pool.query('DELETE FROM searchad_remote_object_ownership WHERE ownership_id=$1', [hold.ownershipId]);
    await f.storage.addEvent({ eventId: randomUUID(), customerId: '1001', hierarchyRunId: f.run.hierarchyRunId,
      hierarchyObjectId: f.object.hierarchyObjectId, phase: 'dispatch_intent', status: 'synthetic_prior', createdAt: new Date(NOW).toISOString() });
    before = await f.snapshot(); await assert.rejects(() => f.claim()); assert.deepEqual(await f.snapshot(), before);
  });

  await t.test('UTC rollover during a balance row-lock wait rolls back instead of charging yesterday', async st => {
    const midnight = Date.parse('2026-09-12T23:59:59.500Z'); const f = await fixture(st, { now: midnight });
    await f.pool.query("INSERT INTO searchad_daily_risk_capacity VALUES('1001','2026-09-12',5,0,0,$1)", [new Date(midnight)]);
    const before = await f.snapshot(); const blocker = await f.pool.connect(); let rejected;
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT * FROM searchad_daily_risk_capacity FOR UPDATE');
      rejected = assert.rejects(f.claim(f.connect()), { code: 'SEARCHAD_HIERARCHY_DISPATCH_DAY_CHANGED' });
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        if ((await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [f.schema])).rowCount) { waiting = true; break; }
        await delay(10);
      }
      assert.equal(waiting, true); f.clock = midnight + 1000;
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    await rejected; assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('COMMIT send failure also returns unknown and discards the uncommitted connection', async st => {
    const f = await fixture(st); const before = await f.snapshot(); let discarded = false;
    const pool = { query: f.pool.query.bind(f.pool), async connect() {
      const client = await f.pool.connect();
      return { async query(sql, params) {
        if (sql === 'COMMIT') throw new Error('synthetic commit send failure');
        return client.query(sql, params);
      }, release(destroy) { discarded = destroy === true; client.release(destroy); } };
    } };
    await assert.rejects(() => f.claim(pool), { code: 'SEARCHAD_HIERARCHY_DISPATCH_COMMIT_UNKNOWN' });
    assert.equal(discarded, true); assert.deepEqual(await f.snapshot(), before);
  });
  await t.test('connection failure is bounded and cannot return database secrets or a dispatch receipt', async st => {
    const f = await fixture(st); const before = await f.snapshot();
    const pool = { query() {}, async connect() { throw new Error('database-secret-marker'); } };
    await assert.rejects(() => f.claim(pool), error => error.code === 'SEARCHAD_HIERARCHY_DISPATCH_TRANSACTION_FAILED' && !error.message.includes('secret-marker'));
    assert.deepEqual(await f.snapshot(), before);
  });
});
