import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { PostgresCampaignDispatchRepository } from '../src/naver/searchad/lifecycle/postgres-campaign-dispatch-repository.js';
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
const confirmation = 'RETIRE_EXPIRED_UNUSED_CAMPAIGN_PLAN';
const code = suffix => error => error?.code === `SEARCHAD_CAMPAIGN_PLAN_RETIREMENT_${suffix}`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function loadFeature(file) {
  try { return await import(file); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(file.split('/').at(-1))) return {}; throw error; }
}

test('expired never-dispatched campaign plans retire atomically and require explicit fresh planning and approval', { timeout: 180_000 }, async t => {
  const { CampaignPlanRetirementService: Service } = await loadFeature('../src/naver/searchad/lifecycle/campaign-plan-retirement-service.js');
  const { PostgresCampaignPlanRetirementRepository: Repository } = await loadFeature('../src/naver/searchad/lifecycle/postgres-campaign-plan-retirement-repository.js');
  assert.equal(typeof Service, 'function', 'CampaignPlanRetirementService must be implemented');
  assert.equal(typeof Repository, 'function', 'PostgresCampaignPlanRetirementRepository must be implemented');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { assert.notEqual(process.env.CI, 'true', 'CI requires PostgreSQL'); return t.skip('Local PostgreSQL not configured'); }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const pools = new Set(), schemas = [];
  const originalFetch = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    try { await Promise.all([...pools].map(pool => closePostgresPool(pool))); }
    finally { try { for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await closePostgresPool(admin); } }
    assert.equal(escaped, 0);
  });
  const registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
  const config = loadSearchAdConfig({ NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret', NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_SEARCHAD_ALLOW_READS: 'true', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true' });
  const credentials = new SearchAdCredentialsRegistry(config.topology);
  const identity = { specSha: registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(credentials, '1001'), upstreamBaseUrl: 'https://api.searchad.naver.com' };

  async function fixture({ approved = false } = {}) {
    const schema = `plan_retirement_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`); schemas.push(schema);
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    const makePool = () => { const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger }); pools.add(p); return p; };
    const pool = makePool();
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    let now = NOW, current = identity;
    const activationId = randomUUID(), evidenceId = `fixture-${randomUUID()}`;
    const start = new Date(NOW - 1000).toISOString(), end = new Date(NOW + 3_600_000).toISOString();
    const fields = ['campaign.campaignTp', 'campaign.name', 'campaign.userLock', 'campaign.dailyBudget'];
    await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,'["create"]','verified',$7,$8)`, [evidenceId, identity.specSha, identity.credentialFingerprint, identity.upstreamBaseUrl, JSON.stringify([OPS.campaign.create]), JSON.stringify(fields), start, end]);
    await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,'["create"]','fixture',$8,$9)`, [activationId, evidenceId, identity.specSha, identity.credentialFingerprint, identity.upstreamBaseUrl, JSON.stringify([OPS.campaign.create]), JSON.stringify(fields), start, end]);
    const calls = [], remote = new Map();
    const fetchImpl = async (value, init) => {
      const u = new URL(value); assert.equal(u.origin, identity.upstreamBaseUrl); assert.equal(init.redirect, 'error');
      calls.push(`${init.method} ${u.pathname}`);
      if (init.method === 'POST' && u.pathname === '/ncc/campaigns') {
        const row = { customerId: '1001', nccCampaignId: `cmp-${randomUUID()}`, ...JSON.parse(init.body) };
        remote.set(row.nccCampaignId, row); return json(row);
      }
      if (init.method === 'GET' && remote.has(u.pathname.split('/').at(-1))) return json(remote.get(u.pathname.split('/').at(-1)));
      throw new Error('Unexpected fixture transport');
    };
    const args = { pool, registry, credentialsRegistry: credentials, config, enabled: true, dailyBudget: 1000, riskUnits: 1, dailyCapacityUnits: 1000, planTtlSeconds: 60, clock: () => now, fetchImpl, logger };
    const creator = new CampaignCreateService(args);
    const approvals = new SearchAdApprovalService({ repository: new PostgresSearchAdWriteRepository({ pool }), config: { approvalTtlSeconds: 300 }, clock: () => now });
    const approve = id => approvals.approve(id, { confirmation: 'APPROVE_SEARCHAD_CHANGE', actor: 'fixture-approver' });
    const plan = await creator.prepare({ customerId: '1001', activationId }, context);
    const approval = approved ? await approve(plan.planId) : null;
    const scope = { customerId: '1001', hierarchyRunId: plan.hierarchyRunId, hierarchyObjectId: plan.hierarchyObjectId, planId: plan.planId, confirmation };
    const service = (p = pool) => new Service({ repository: new Repository({ pool: p, dailyBudget: 1000, current: () => current, clock: () => now }), enabled: true });
    const rows = async table => (await pool.query(`SELECT to_jsonb(t) AS data FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.data);
    const tables = ['searchad_hierarchy_canary_runs', 'searchad_hierarchy_objects', 'searchad_hierarchy_events', 'searchad_write_change_plans', 'searchad_write_approvals', 'searchad_write_attempts', 'searchad_write_locks', 'searchad_remote_object_ownership', 'searchad_risk_reservations', 'searchad_daily_risk_capacity', 'searchad_verification_evidence', 'searchad_activation_grants'];
    const state = async () => {
      const snapshot = {};
      // These snapshots are not a concurrency exercise. Avoid opening a full
      // pool per retained fixture; independent-pool race tests remain below.
      for (const table of tables) snapshot[table] = await rows(table);
      return snapshot;
    };
    const executeInput = (p = plan, a = approval) => ({ customerId: '1001', hierarchyRunId: p.hierarchyRunId, hierarchyObjectId: p.hierarchyObjectId, planId: p.planId, executionToken: a?.executionToken || 'A'.repeat(43) });
    return { pool, makePool, args, creator, approve, approval, plan, scope, service, rows, state, calls, executeInput, activationId, setNow: n => { now = n; }, expire: () => { now = Date.parse(plan.expiresAt); }, rotate: () => { current = { ...identity, credentialFingerprint: 'rotated' }; } };
  }
  function intercepted(pool, hook) {
    return { query: pool.query.bind(pool), connect: async () => { const c = await pool.connect(); return { release: c.release.bind(c), query: async (sql, values) => hook(c, sql, values) }; } };
  }

  await t.test('retires only the old unapproved plan/run, preserves object and audit, and permits separate fresh prepare', async () => {
    const f = await fixture(); f.expire(); const before = await f.state();
    await assert.rejects(f.creator.prepare({ customerId: '1001', activationId: f.activationId }, context));
    const result = await f.service().retire(f.scope, context);
    assert.deepEqual(result, { customerId: '1001', hierarchyRunId: f.plan.hierarchyRunId, hierarchyObjectId: f.plan.hierarchyObjectId, planId: f.plan.planId, planStatus: 'expired', runStatus: 'failed', changed: true, remoteDispatched: false, replacementCreated: false, requiresNewApproval: true });
    const after = await f.state();
    for (const table of ['searchad_hierarchy_objects', 'searchad_write_approvals', 'searchad_write_locks', 'searchad_remote_object_ownership', 'searchad_risk_reservations', 'searchad_daily_risk_capacity', 'searchad_verification_evidence', 'searchad_activation_grants']) assert.deepEqual(after[table], before[table]);
    assert.equal(after.searchad_hierarchy_canary_runs[0].status, 'failed');
    assert.equal(after.searchad_write_change_plans[0].status, 'expired');
    assert.equal(after.searchad_hierarchy_objects[0].remote_id, null);
    assert.equal(after.searchad_hierarchy_events.length, 2); assert.equal(after.searchad_write_attempts.length, 2);
    assert.ok(after.searchad_hierarchy_events.some(e => e.event_id === before.searchad_hierarchy_events[0].event_id));
    const event = after.searchad_hierarchy_events.find(e => e.phase === 'campaign_plan_retired');
    assert.equal(event.status, 'expired_unused'); assert.equal(event.lifecycle_kind, null);
    assert.equal(event.details_json.actorPrincipalId, context.principal.principalId);
    assert.equal(event.details_json.remoteDispatched, false);
    const replacement = await f.creator.prepare({ customerId: '1001', activationId: f.activationId }, context);
    assert.notEqual(replacement.planId, f.plan.planId); assert.notEqual(replacement.hierarchyRunId, f.plan.hierarchyRunId);
    assert.equal(replacement.state, 'planned'); assert.equal((await f.rows('searchad_write_approvals')).length, 0);
    await assert.rejects(f.approve(f.plan.planId)); await assert.rejects(f.creator.execute(f.executeInput(), context));
    assert.deepEqual(f.calls, []);
  });
  await t.test('unexpired old approval is retained but cannot authorize a newly prepared replacement', async () => {
    const f = await fixture({ approved: true }); const old = await f.rows('searchad_write_approvals'); f.expire();
    await f.service().retire(f.scope, context); assert.deepEqual(await f.rows('searchad_write_approvals'), old);
    const replacement = await f.creator.prepare({ customerId: '1001', activationId: f.activationId }, context);
    await assert.rejects(f.creator.execute(f.executeInput(replacement, f.approval), context)); assert.deepEqual(f.calls, []);
    const newApproval = await f.approve(replacement.planId);
    await assert.rejects(f.creator.execute(f.executeInput(replacement, f.approval), context)); assert.deepEqual(f.calls, []);
    assert.notEqual(newApproval.executionToken, f.approval.executionToken);
    assert.equal((await f.creator.execute(f.executeInput(replacement, newApproval), context)).state, 'owned');
    assert.equal(f.calls.filter(c => c.startsWith('POST ')).length, 1);
    assert.equal((await f.rows('searchad_hierarchy_canary_runs')).find(r => r.hierarchy_run_id === f.plan.hierarchyRunId).status, 'failed');
  });
  await t.test('a plan already marked expired by the existing approval service can close its unused run', async () => {
    const f = await fixture(); f.expire(); await assert.rejects(f.approve(f.plan.planId));
    assert.equal((await f.rows('searchad_write_change_plans'))[0].status, 'expired');
    assert.equal((await f.service().retire(f.scope, context)).changed, true); assert.deepEqual(f.calls, []);
  });
  await t.test('one millisecond before plan expiry is rejected without changing any row', async () => {
    const f = await fixture(); f.setNow(Date.parse(f.plan.expiresAt) - 1); const before = await f.state();
    await assert.rejects(f.service().retire(f.scope, context), code('NOT_EXPIRED')); assert.deepEqual(await f.state(), before);
    f.expire(); assert.equal((await f.service().retire(f.scope, context)).changed, true);
  });
  await t.test('default OFF, exact confirmation, caller overrides, and role/Customer checks occur before repository work', async () => {
    const f = await fixture(); let calls = 0; const repository = { retire: async () => { calls++; } };
    await assert.rejects(new Service({ repository }).retire(f.scope, context), code('DISABLED'));
    const enabled = new Service({ repository, enabled: true });
    for (const extra of [{ remoteId: 'victim' }, { actorPrincipalId: 'forged' }, { expiresAt: '2000-01-01' }, { executionToken: 'A'.repeat(43) }, { confirmation: 'APPROVE_SEARCHAD_CHANGE' }]) await assert.rejects(enabled.retire({ ...f.scope, ...extra }, context), code('INPUT_INVALID'));
    for (const principal of [{ ...context.principal, role: 'reader' }, { ...context.principal, customerIds: ['1002'] }]) await assert.rejects(enabled.retire(f.scope, { principal }), code('FORBIDDEN'));
    assert.equal(calls, 0);
  });
  await t.test('wrong local run/object/plan or Customer cannot retire another scope', async () => {
    const f = await fixture(); f.expire(); const before = await f.state();
    for (const key of ['hierarchyRunId', 'hierarchyObjectId', 'planId']) await assert.rejects(f.service().retire({ ...f.scope, [key]: randomUUID() }, context), code('NOT_FOUND'));
    await assert.rejects(f.service().retire({ ...f.scope, customerId: '1002' }, { principal: { ...context.principal, customerIds: ['1002'] } }), code('NOT_FOUND'));
    assert.deepEqual(await f.state(), before);
  });
  const invalid = [
    ['returned remote ID', "UPDATE searchad_hierarchy_objects SET remote_id='returned-id'", 'NOT_UNUSED'],
    ['dispatching object', "UPDATE searchad_hierarchy_objects SET state='dispatching'", 'NOT_UNUSED'],
    ['unknown run', "UPDATE searchad_hierarchy_canary_runs SET status='unknown_outcome'", 'NOT_UNUSED'],
    ['unknown plan', "UPDATE searchad_write_change_plans SET status='unknown_outcome'", 'NOT_UNUSED'],
    ['used approval', 'UPDATE searchad_write_approvals SET used_at=created_at', 'PRIOR_WORK'],
    ['tampered descriptor hash', "UPDATE searchad_write_change_plans SET before_hash=repeat('b',64)", 'PROVENANCE'],
    ['non-planning attempt', "INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,created_at) SELECT gen_random_uuid(),plan_id,'transport_intent','attempt_once',created_at FROM searchad_write_change_plans", 'PRIOR_WORK'],
    ['execution lock', "INSERT INTO searchad_write_locks(plan_id,purpose,acquired_at) SELECT plan_id,'execute',created_at FROM searchad_write_change_plans", 'PRIOR_WORK']
  ];
  for (const [name, sql, suffix] of invalid) await t.test(`${name} prevents retirement with no additional writes`, async () => {
    const f = await fixture({ approved: true }); f.expire(); await f.pool.query(sql); const before = await f.state();
    await assert.rejects(f.service().retire(f.scope, context), code(suffix)); assert.deepEqual(await f.state(), before); assert.deepEqual(f.calls, []);
  });
  await t.test('a released risk intent is still prior work and is never recycled', async () => {
    const f = await fixture(); f.expire();
    await f.pool.query("INSERT INTO searchad_daily_risk_capacity VALUES('1001','2026-09-20',1000,0,0,$1)", [new Date(NOW)]);
    await f.pool.query("INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,released_at) VALUES($1,$2,'1001','2026-09-20',$3,'create',1,'released','hierarchy_canary',$4,$5,$5,$5)", [randomUUID(), `hierarchy:campaign:create:${f.plan.planId}`, OPS.campaign.create, f.plan.hierarchyRunId, new Date(NOW)]);
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), code('PRIOR_WORK')); assert.deepEqual(await f.state(), before);
  });
  await t.test('an external-Customer child linked to the root is not hidden by Customer filters', async () => {
    const f = await fixture(); f.expire();
    await f.pool.query("INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at) VALUES($1,$2,'1002','adgroup',$3,$4,$5,$6,'planned',$7,$7)", [randomUUID(), f.plan.hierarchyRunId, f.plan.hierarchyObjectId, OPS.adgroup.create, OPS.adgroup.read, OPS.adgroup.delete, new Date(NOW)]);
    const before = await f.state(); await assert.rejects(f.service().retire(f.scope, context), code('PRIOR_WORK')); assert.deepEqual(await f.state(), before);
  });
  await t.test('a committed dispatch without transport is never mistaken for an unused plan', async () => {
    const f = await fixture({ approved: true });
    const dispatch = new PostgresCampaignDispatchRepository({ ...f.args, contextResolver: () => identity });
    await dispatch.claim(f.executeInput(), context); f.expire(); const before = await f.state();
    await assert.rejects(f.service().retire(f.scope, context), code('NOT_UNUSED')); assert.deepEqual(await f.state(), before); assert.deepEqual(f.calls, []);
  });
  for (const table of ['searchad_hierarchy_events', 'searchad_write_attempts']) await t.test(`failure writing ${table} rolls the entire local retirement back`, async () => {
    const f = await fixture(); f.expire(); const before = await f.state();
    await f.pool.query("CREATE FUNCTION reject_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='campaign_plan_retired' THEN RAISE EXCEPTION 'SECRET fixture'; END IF; RETURN NEW; END $$");
    await f.pool.query(`CREATE TRIGGER reject_retirement BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_retirement()`);
    await assert.rejects(f.service().retire(f.scope, context), e => code('STORE_FAILED')(e) && !JSON.stringify(e).includes('SECRET'));
    assert.deepEqual(await f.state(), before);
  });
  for (const drift of ['identity', 'clock']) await t.test(`${drift} drift during final audit rejects and rolls back retirement`, async () => {
    const f = await fixture(); f.expire(); const before = await f.state();
    const wrapped = intercepted(f.pool, async (c, sql, values) => { const r = await c.query(sql, values); if (/^INSERT INTO searchad_hierarchy_events/.test(sql.trim())) { if (drift === 'identity') f.rotate(); else f.setNow(NOW); } return r; });
    await assert.rejects(f.service(wrapped).retire(f.scope, context), code(drift === 'identity' ? 'CONTEXT_MISMATCH' : 'CLOCK_CHANGED'));
    assert.deepEqual(await f.state(), before);
  });
  await t.test('concurrent independent repositories and reconstruction append only one retirement', async () => {
    const f = await fixture(); f.expire();
    const results = await Promise.all([f.service().retire(f.scope, context), f.service(f.makePool()).retire(f.scope, context)]);
    assert.deepEqual(results.map(r => r.changed).sort(), [false, true]);
    assert.equal((await f.service(f.makePool()).retire(f.scope, context)).changed, false);
    assert.equal((await f.rows('searchad_hierarchy_events')).filter(e => e.phase === 'campaign_plan_retired').length, 1);
    assert.equal((await f.rows('searchad_write_attempts')).filter(e => e.phase === 'campaign_plan_retired').length, 1);
  });
  await t.test('lost COMMIT acknowledgement returns no success; a later local read proves an already committed retirement', async () => {
    const f = await fixture(); f.expire(); let discarded = false;
    const wrapped = { query: f.pool.query.bind(f.pool), connect: async () => { const c = await f.pool.connect(); return { release: destroy => { discarded = destroy; c.release(destroy); }, query: async (sql, values) => { const r = await c.query(sql, values); if (sql === 'COMMIT') throw new Error('SECRET lost ACK'); return r; } }; } };
    await assert.rejects(f.service(wrapped).retire(f.scope, context), e => code('COMMIT_UNKNOWN')(e) && !JSON.stringify(e).includes('SECRET'));
    assert.equal(discarded, true);
    assert.equal((await f.service().retire(f.scope, context)).changed, false);
    assert.equal((await f.rows('searchad_hierarchy_events')).filter(e => e.phase === 'campaign_plan_retired').length, 1); assert.deepEqual(f.calls, []);
  });
  await t.test('suspension does not require a remote write to retire, and still blocks fresh creation', async () => {
    const f = await fixture(); f.expire(); await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
    assert.equal((await f.service().retire(f.scope, context)).changed, true);
    await assert.rejects(f.creator.prepare({ customerId: '1001', activationId: f.activationId }, context)); assert.deepEqual(f.calls, []);
  });
});
