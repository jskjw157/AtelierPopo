import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { CampaignCleanupService } from '../src/naver/searchad/lifecycle/campaign-cleanup-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { PostgresAdgroupCreateRepository } from '../src/naver/searchad/lifecycle/postgres-adgroup-create-repository.js';
import { adgroupScope, ADGROUP_CREATE_FIELDS } from '../src/naver/searchad/lifecycle/adgroup-create-contract.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const logger = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-09-20T00:00:00Z');
const context = { principal: { principalId: 'retirement-admin', role: 'admin', customerIds: ['1001'] } };
const confirmation = 'RETIRE_EXPIRED_UNUSED_ADGROUP_PLAN';
const code = suffix => e => e?.code === `SEARCHAD_ADGROUP_PLAN_RETIREMENT_${suffix}`;
const retirementError = e => e?.code?.startsWith('SEARCHAD_ADGROUP_PLAN_RETIREMENT_');
const json = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
async function feature(file) {
  try { return await import(file); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(file.split('/').at(-1))) return {}; throw e; }
}
function intercepted(pool, hook) {
  return { query: pool.query.bind(pool), connect: async () => {
    const c = await pool.connect();
    return { release: c.release.bind(c), query: (sql, values) => hook(c, sql, values) };
  } };
}

test('expired unused adgroup retirement preserves the live parent and never authorizes replacement or cleanup', { timeout: 180_000 }, async t => {
  const { AdgroupPlanRetirementService: Service } = await feature('../src/naver/searchad/lifecycle/adgroup-plan-retirement-service.js');
  const { PostgresAdgroupPlanRetirementRepository: Repository } = await feature('../src/naver/searchad/lifecycle/postgres-adgroup-plan-retirement-repository.js');
  assert.equal(typeof Service, 'function', 'AdgroupPlanRetirementService must be implemented');
  assert.equal(typeof Repository, 'function', 'PostgresAdgroupPlanRetirementRepository must be implemented');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { assert.notEqual(process.env.CI, 'true', 'CI requires PostgreSQL'); return t.skip('Local PostgreSQL not configured'); }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const originalFetch = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => { globalThis.fetch = originalFetch; await closePostgresPool(admin); assert.equal(escaped, 0); });

  async function fixture(st, { approved = false, planTtlSeconds = 60, approvalTtlSeconds = 300 } = {}) {
    const schema = `adgroup_retirement_${randomUUID().replaceAll('-', '')}`;
    const pools = new Set(); let created = false;
    const f = { now: NOW, calls: [], transportErrors: [], current: null };
    st.after(async () => {
      try { await Promise.all([...pools].map(p => closePostgresPool(p))); }
      finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      assert.deepEqual(f.transportErrors, []);
    });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    f.makePool = () => { const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger }); pools.add(p); return p; };
    f.pool = f.makePool();
    await runPostgresMigrations({ pool: f.pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    assert.equal((await f.pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    const registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
    f.config = loadSearchAdConfig({ NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret', NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_SEARCHAD_ALLOW_READS: 'true', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true' });
    const credentials = new SearchAdCredentialsRegistry(f.config.topology);
    f.identity = { specSha: registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(credentials, '1001'), upstreamBaseUrl: 'https://api.searchad.naver.com' };
    f.current = { ...f.identity };
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    f.authority = async (operation, fields, kind = 'create') => {
      const activationId = randomUUID(), evidenceId = `fixture-${randomUUID()}`;
      const start = new Date(f.now - 1000).toISOString(), end = new Date(f.now + 3600000).toISOString();
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at)
        VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`, [evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at)
        VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture',$9,$10)`, [activationId,evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);
      return activationId;
    };
    const fetchImpl = async (value, init) => {
      const u = new URL(value), headers = new Headers(init.headers);
      f.calls.push(`${init.method} ${u.pathname}`);
      try {
        assert.equal(u.origin, f.identity.upstreamBaseUrl); assert.equal(init.redirect, 'error');
        assert.equal(headers.get('X-Customer'), '1001');
        const credential = credentials.resolve('1001');
        assert.equal(headers.get('X-Signature'), createHmac('sha256', credential.secretKey).update(`${headers.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));
        if (init.method === 'POST' && u.pathname === '/ncc/campaigns') {
          f.parentRemote = { customerId: '1001', nccCampaignId: `cmp-${randomUUID()}`, ...JSON.parse(init.body) }; return json(f.parentRemote);
        }
        if (init.method === 'GET' && u.pathname === `/ncc/campaigns/${f.parentRemote?.nccCampaignId}`) return json(f.parentRemote);
        if (init.method === 'POST' && u.pathname === '/ncc/adgroups') {
          f.childRemote = { customerId: '1001', nccAdgroupId: `grp-${randomUUID()}`, ...JSON.parse(init.body) }; return json(f.childRemote);
        }
        if (init.method === 'GET' && u.pathname === `/ncc/adgroups/${f.childRemote?.nccAdgroupId}`) return json(f.childRemote);
        throw new Error('Unexpected fixture transport');
      } catch (e) { f.transportErrors.push(e.message); throw e; }
    };
    f.args = { pool: f.pool, registry, credentialsRegistry: credentials, config: f.config, enabled: true, dailyBudget: 1000, riskUnits: 1, dailyCapacityUnits: 100, planTtlSeconds, preflightMaxAgeMs: 5000, clock: () => f.now, fetchImpl, logger };
    f.approvals = new SearchAdApprovalService({ repository: new PostgresSearchAdWriteRepository({ pool: f.pool }), config: { approvalTtlSeconds }, clock: () => f.now });
    f.approve = id => f.approvals.approve(id, { confirmation: 'APPROVE_SEARCHAD_CHANGE', actor: 'fixture-approver' });
    const rootCreator = new CampaignCreateService(f.args);
    f.rootActivation = await f.authority(OPS.campaign.create, ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget']);
    const rootPlan = await rootCreator.prepare({ customerId: '1001', activationId: f.rootActivation }, context);
    const rootApproval = await f.approve(rootPlan.planId);
    f.root = await rootCreator.execute({ customerId: '1001', hierarchyRunId: rootPlan.hierarchyRunId, hierarchyObjectId: rootPlan.hierarchyObjectId, planId: rootPlan.planId, executionToken: rootApproval.executionToken }, context);
    assert.equal(f.root.state, 'owned'); f.calls.length = 0; f.now += 1000;
    f.activationId = await f.authority(OPS.adgroup.create, ADGROUP_CREATE_FIELDS);
    f.prepareInput = { customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, parentObjectId: f.root.hierarchyObjectId, activationId: f.activationId };
    f.creator = new AdgroupCreateService(f.args);
    f.plan = await f.creator.prepare(f.prepareInput, context);
    f.approval = approved ? await f.approve(f.plan.planId) : null;
    f.scope = { customerId: '1001', hierarchyRunId: f.plan.hierarchyRunId, parentObjectId: f.root.hierarchyObjectId, hierarchyObjectId: f.plan.hierarchyObjectId, planId: f.plan.planId, confirmation };
    f.executeInput = () => ({ customerId: '1001', hierarchyRunId: f.plan.hierarchyRunId, parentObjectId: f.root.hierarchyObjectId, hierarchyObjectId: f.plan.hierarchyObjectId, planId: f.plan.planId, executionToken: f.approval?.executionToken || 'A'.repeat(43) });
    f.service = (pool = f.pool) => new Service({ repository: new Repository({ pool, dailyBudget: 1000, current: () => f.current, clock: () => f.now }), enabled: true });
    f.expire = () => { f.now = Date.parse(f.plan.expiresAt); };
    f.rows = async table => (await f.pool.query(`SELECT to_jsonb(t) AS data FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.data);
    f.state = async () => {
      const result = {};
      for (const table of ['searchad_canary_accounts','searchad_hierarchy_canary_runs','searchad_hierarchy_objects','searchad_remote_object_ownership','searchad_write_change_plans','searchad_write_approvals','searchad_write_locks','searchad_write_attempts','searchad_hierarchy_events','searchad_risk_reservations','searchad_daily_risk_capacity','searchad_verification_evidence','searchad_activation_grants']) result[table] = await f.rows(table);
      return result;
    };
    f.rootCreator = rootCreator;
    return f;
  }

  await t.test('retires only the child plan and appends non-authorizing audits without ending the parent run', async st => {
    const f = await fixture(st); f.expire(); const before = await f.state();
    const result = await f.service().retire(f.scope, context);
    assert.deepEqual(result, { customerId: '1001', hierarchyRunId: f.plan.hierarchyRunId, parentObjectId: f.root.hierarchyObjectId, hierarchyObjectId: f.plan.hierarchyObjectId, planId: f.plan.planId, planStatus: 'expired', runStatus: 'cleanup_pending', changed: true, targetRemoteDispatched: false, runTerminated: false, replacementCreated: false, requiresNewApproval: true, replanningSupported: false, cleanupAuthority: false });
    const after = await f.state();
    for (const table of Object.keys(before).filter(k => !['searchad_write_change_plans','searchad_write_attempts','searchad_hierarchy_events'].includes(k))) assert.deepEqual(after[table], before[table], table);
    const oldPlan = before.searchad_write_change_plans.find(p => p.plan_id === f.plan.planId);
    assert.deepEqual(after.searchad_write_change_plans.find(p => p.plan_id === f.plan.planId), { ...oldPlan, status: 'expired', last_error_json: { code: 'UNUSED_ADGROUP_PLAN_EXPIRED' } });
    assert.deepEqual(after.searchad_write_change_plans.find(p => p.plan_id === f.root.planId), before.searchad_write_change_plans.find(p => p.plan_id === f.root.planId));
    for (const table of ['searchad_hierarchy_events','searchad_write_attempts']) {
      assert.equal(after[table].length, before[table].length + 1);
      for (const row of before[table]) assert.ok(after[table].some(a => JSON.stringify(a) === JSON.stringify(row)));
    }
    const event = after.searchad_hierarchy_events.find(e => e.phase === 'adgroup_plan_retired');
    assert.equal(event.status, 'expired_unused'); assert.equal(event.lifecycle_kind, null);
    assert.equal(event.details_json.actorPrincipalId, context.principal.principalId);
    assert.equal(event.details_json.targetRemoteDispatched, false); assert.equal(event.details_json.runTerminated, false);
    assert.equal(event.details_json.cleanupAuthority, false); assert.equal(event.details_json.parentObjectId, f.root.hierarchyObjectId);
    assert.equal(after.searchad_risk_reservations.length, 1); assert.equal(after.searchad_risk_reservations[0].state, 'consumed');
    await assert.rejects(f.rootCreator.prepare({ customerId: '1001', activationId: f.rootActivation }, context));
    await assert.rejects(f.creator.prepare(f.prepareInput, context));
    assert.deepEqual(f.calls, []);
  });
  await t.test('retains an unexpired old approval but old approval and execution cannot revive the expired child', async st => {
    const f = await fixture(st, { approved: true }); const old = await f.rows('searchad_write_approvals'); f.expire();
    await f.service().retire(f.scope, context);
    assert.deepEqual(await f.rows('searchad_write_approvals'), old);
    await assert.rejects(f.approve(f.plan.planId)); await assert.rejects(f.creator.execute(f.executeInput(), context));
    assert.deepEqual(f.calls, []);
  });
  await t.test('supports a plan already marked expired by the existing approval service', async st => {
    const f = await fixture(st); f.expire(); await assert.rejects(f.approve(f.plan.planId));
    assert.equal((await f.service().retire(f.scope, context)).changed, true);
  });
  await t.test('approval expiry alone cannot retire an unexpired child plan', async st => {
    const f = await fixture(st, { approved: true, planTtlSeconds: 600, approvalTtlSeconds: 60 }); f.now += 61000;
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), code('NOT_EXPIRED')); assert.deepEqual(await f.state(), before);
  });
  await t.test('the exact plan expiry boundary is enforced after locked reads', async st => {
    const f = await fixture(st); f.now = Date.parse(f.plan.expiresAt) - 1; const before = await f.state();
    await assert.rejects(f.service().retire(f.scope, context), code('NOT_EXPIRED')); assert.deepEqual(await f.state(), before);
    f.expire(); assert.equal((await f.service().retire(f.scope, context)).changed, true);
  });
  await t.test('default OFF, exact confirmation, role and Customer checks precede repository work', async st => {
    const f = await fixture(st); let calls = 0; const repository = { retire: async () => { calls++; } };
    await assert.rejects(new Service({ repository }).retire(f.scope, context), code('DISABLED'));
    assert.throws(() => new Service({ repository, enabled: 'true' }), TypeError);
    const service = new Service({ repository, enabled: true });
    for (const extra of [{ remoteId: 'victim' }, { actorPrincipalId: 'forged' }, { executionToken: 'A'.repeat(43) }, { expiresAt: '2000-01-01' }, { confirmation: 'APPROVE_SEARCHAD_CHANGE' }]) await assert.rejects(service.retire({ ...f.scope, ...extra }, context), code('INPUT_INVALID'));
    for (const principal of [{ ...context.principal, role: 'reader' }, { ...context.principal, customerIds: ['1002'] }]) await assert.rejects(service.retire(f.scope, { principal }), code('FORBIDDEN'));
    assert.equal(calls, 0);
  });
  await t.test('wrong local identifiers and foreign Customer do not select another parent or plan', async st => {
    const f = await fixture(st); f.expire(); const before = await f.state();
    for (const key of ['hierarchyRunId','parentObjectId','hierarchyObjectId','planId']) await assert.rejects(f.service().retire({ ...f.scope, [key]: randomUUID() }, context), code('NOT_FOUND'));
    await assert.rejects(f.service().retire({ ...f.scope, customerId: '1002' }, { principal: { ...context.principal, customerIds: ['1002'] } }), code('NOT_FOUND'));
    assert.deepEqual(await f.state(), before);
  });
  const invalid = [
    ['returned child ID', "UPDATE searchad_hierarchy_objects SET remote_id='returned-child' WHERE hierarchy_object_id=$1", 'object'],
    ['dispatching child', "UPDATE searchad_hierarchy_objects SET state='dispatching' WHERE hierarchy_object_id=$1", 'object'],
    ['unknown live run', "UPDATE searchad_hierarchy_canary_runs SET status='unknown_outcome' WHERE hierarchy_run_id=$1", 'run'],
    ['unknown child plan', "UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1", 'plan'],
    ['used child approval', 'UPDATE searchad_write_approvals SET used_at=created_at WHERE plan_id=$1', 'plan'],
    ['tampered child descriptor hash', "UPDATE searchad_write_change_plans SET before_hash=repeat('b',64) WHERE plan_id=$1", 'plan'],
    ['non-planning child attempt', "INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,created_at) SELECT gen_random_uuid(),plan_id,'transport_intent','attempt_once',created_at FROM searchad_write_change_plans WHERE plan_id=$1", 'plan'],
    ['child execution lock', "INSERT INTO searchad_write_locks(plan_id,purpose,acquired_at) SELECT plan_id,'execute',created_at FROM searchad_write_change_plans WHERE plan_id=$1", 'plan'],
    ['parent ownership no longer owned', "UPDATE searchad_remote_object_ownership SET state='manual_review' WHERE hierarchy_object_id=$1", 'parent']
  ];
  for (const [name, sql, target] of invalid) await t.test(`${name} rejects without changing any row or calling transport`, async st => {
    const f = await fixture(st, { approved: true }); f.expire();
    await f.pool.query(sql, [{ object: f.plan.hierarchyObjectId, run: f.plan.hierarchyRunId, plan: f.plan.planId, parent: f.root.hierarchyObjectId }[target]]);
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), retirementError);
    assert.deepEqual(await f.state(), before); assert.deepEqual(f.calls, []);
  });
  await t.test('a released child risk intent still vetoes retirement while consumed parent risk is preserved', async st => {
    const f = await fixture(st); f.expire();
    await f.pool.query("INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,released_at) VALUES($1,$2,'1001','2026-09-20',$3,'create',1,'released','hierarchy_canary',$4,$5,$5,$5)", [randomUUID(),`hierarchy:adgroup:create:${f.plan.planId}`,OPS.adgroup.create,f.plan.hierarchyRunId,new Date(f.now)]);
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), code('PRIOR_WORK')); assert.deepEqual(await f.state(), before);
  });
  await t.test('a foreign-Customer descendant linked to the selected child cannot be hidden by filters', async st => {
    const f = await fixture(st); f.expire();
    await f.pool.query("INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at) VALUES($1,$2,'1002','keyword',$3,$4,$5,$6,'planned',$7,$7)", [randomUUID(),f.plan.hierarchyRunId,f.plan.hierarchyObjectId,OPS.keyword.create,OPS.keyword.read,OPS.keyword.delete,new Date(f.now)]);
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), code('PRIOR_WORK')); assert.deepEqual(await f.state(), before);
  });
  await t.test('substituting both parent object and hold IDs cannot replace the applied creation snapshot', async st => {
    const f = await fixture(st); f.expire();
    await f.pool.query("UPDATE searchad_hierarchy_objects SET remote_id='substituted-parent' WHERE hierarchy_object_id=$1", [f.root.hierarchyObjectId]);
    await f.pool.query("UPDATE searchad_remote_object_ownership SET remote_id='substituted-parent' WHERE hierarchy_object_id=$1", [f.root.hierarchyObjectId]);
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), code('PARENT_PROVENANCE')); assert.deepEqual(await f.state(), before);
  });
  await t.test('real committed child claim with zero child POST is not unused and cannot be retired', async st => {
    const f = await fixture(st, { approved: true });
    const repository = new PostgresAdgroupCreateRepository({ ...f.args, current: () => f.identity, gate: () => {} });
    const snapshot = await repository.executionSnapshot(adgroupScope(f.executeInput(), context, true));
    await repository.claim(snapshot.ticket, { operation: { operationKey: OPS.campaign.read, sideEffect: false }, upstream: { status: 200 }, data: f.parentRemote });
    f.expire(); const before = await f.state();
    await assert.rejects(f.service().retire(f.scope, context), code('NOT_UNUSED')); assert.deepEqual(await f.state(), before); assert.deepEqual(f.calls, []);
  });
  await t.test('a child already created through the existing service is never retired as unused', async st => {
    const f = await fixture(st, { approved: true }); assert.equal((await f.creator.execute(f.executeInput(), context)).state, 'owned');
    f.calls.length = 0; f.expire(); const before = await f.state();
    await assert.rejects(f.service().retire(f.scope, context), retirementError); assert.deepEqual(await f.state(), before); assert.deepEqual(f.calls, []);
  });
  for (const table of ['searchad_hierarchy_events','searchad_write_attempts']) await t.test(`audit failure at ${table} rolls the target plan back without leaking storage errors`, async st => {
    const f = await fixture(st); f.expire(); const before = await f.state();
    await f.pool.query("CREATE FUNCTION reject_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='adgroup_plan_retired' THEN RAISE EXCEPTION 'SECRET fixture'; END IF; RETURN NEW; END $$");
    await f.pool.query(`CREATE TRIGGER reject_retirement BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_retirement()`);
    await assert.rejects(f.service().retire(f.scope, context), e => code('STORE_FAILED')(e) && !JSON.stringify(e).includes('SECRET'));
    assert.deepEqual(await f.state(), before);
  });
  for (const drift of ['identity','clock']) await t.test(`${drift} drift during final audit aborts the whole retirement`, async st => {
    const f = await fixture(st); f.expire(); const before = await f.state();
    const pool = intercepted(f.pool, async (c, sql, values) => { const r = await c.query(sql, values); if (/^INSERT INTO searchad_write_attempts/.test(sql.trim())) { if (drift === 'identity') f.current = { ...f.identity, credentialFingerprint: 'rotated' }; else f.now = NOW; } return r; });
    await assert.rejects(f.service(pool).retire(f.scope, context), code(drift === 'identity' ? 'CONTEXT_MISMATCH' : 'CLOCK_CHANGED')); assert.deepEqual(await f.state(), before);
  });
  await t.test('caller scope and actor mutation during connection acquisition cannot redirect retirement', async st => {
    const f = await fixture(st); f.expire(); const input = { ...f.scope }, ctx = structuredClone(context);
    const pool = { query: f.pool.query.bind(f.pool), connect: async () => { input.planId = randomUUID(); input.parentObjectId = randomUUID(); ctx.principal.principalId = 'forged'; return f.pool.connect(); } };
    const r = await f.service(pool).retire(input, ctx); assert.equal(r.planId, f.plan.planId);
    const event = (await f.rows('searchad_hierarchy_events')).find(e => e.phase === 'adgroup_plan_retired'); assert.equal(event.details_json.actorPrincipalId, context.principal.principalId);
  });
  await t.test('concurrent independent repositories and reconstruction append one retirement only', async st => {
    const f = await fixture(st); f.expire();
    const results = await Promise.all([f.service().retire(f.scope, context), f.service(f.makePool()).retire(f.scope, context)]);
    assert.deepEqual(results.map(r => r.changed).sort(), [false,true]);
    assert.equal((await f.service(f.makePool()).retire(f.scope, context)).changed, false);
    for (const table of ['searchad_hierarchy_events','searchad_write_attempts']) assert.equal((await f.rows(table)).filter(e => e.phase === 'adgroup_plan_retired').length, 1);
  });
  for (const committed of [false,true]) await t.test(`COMMIT ${committed ? 'acknowledgement' : 'send'} failure never reports success and destroys that connection`, async st => {
    const f = await fixture(st); f.expire(); let discarded = false;
    const pool = { query: f.pool.query.bind(f.pool), connect: async () => { const c = await f.pool.connect(); return { release: destroy => { discarded = destroy; c.release(destroy); }, query: async (sql, values) => { if (sql === 'COMMIT' && !committed) throw new Error('SECRET commit send'); const r = await c.query(sql, values); if (sql === 'COMMIT') throw new Error('SECRET lost ACK'); return r; } }; } };
    await assert.rejects(f.service(pool).retire(f.scope, context), e => code('COMMIT_UNKNOWN')(e) && !JSON.stringify(e).includes('SECRET')); assert.equal(discarded, true);
    assert.equal((await f.service().retire(f.scope, context)).changed, !committed);
    assert.equal((await f.rows('searchad_hierarchy_events')).filter(e => e.phase === 'adgroup_plan_retired').length, 1); assert.deepEqual(f.calls, []);
  });
  await t.test('already-retired flags without their exact reason cannot claim idempotent success', async st => {
    const f = await fixture(st); f.expire(); await f.service().retire(f.scope, context);
    await f.pool.query("UPDATE searchad_write_change_plans SET last_error_json='{}'::jsonb WHERE plan_id=$1", [f.plan.planId]);
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), code('PROVENANCE')); assert.deepEqual(await f.state(), before);
  });
  await t.test('suspension and remote read/write gates do not prevent local retirement or become permissions', async st => {
    const f = await fixture(st); f.expire(); await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
    f.config.allowReads = false; f.config.allowActiveCanary = false;
    const before = await f.state(); assert.equal((await f.service().retire(f.scope, context)).changed, true);
    const after = await f.state(); assert.deepEqual(after.searchad_canary_accounts, before.searchad_canary_accounts);
    assert.deepEqual(after.searchad_risk_reservations, before.searchad_risk_reservations);
    await assert.rejects(f.creator.prepare(f.prepareInput, context)); assert.deepEqual(f.calls, []);
  });
  await t.test('retirement never turns the historical planned child into parent cleanup absence proof', async st => {
    const f = await fixture(st); const activationId = await f.authority(OPS.campaign.delete, [], 'delete'); f.expire();
    await f.service().retire(f.scope, context); const before = await f.state();
    await assert.rejects(new CampaignCleanupService(f.args).prepare({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, hierarchyObjectId: f.root.hierarchyObjectId, activationId }, context));
    assert.deepEqual(await f.state(), before); assert.deepEqual(f.calls, []);
  });
});
