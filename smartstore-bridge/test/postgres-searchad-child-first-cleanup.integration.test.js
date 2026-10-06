import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const logger = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-09-13T07:00:00Z');
const context = { principal: { principalId: 'cleanup-admin', role: 'admin', customerIds: ['1001'] } };
const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'fixture-request' } });
const rejected = error => typeof error?.code === 'string' && error.code.startsWith('SEARCHAD_');

// Actual producer -> approval -> PostgreSQL -> signing Gateway; only upstream
// responses and activation/evidence rows are fixtures. No remote network permitted.
test('approved two-node child-first cleanup with durable proofs and no blind delete replay', { timeout: 180_000 }, async t => {
  assert.ok(fs.existsSync('src/naver/searchad/lifecycle/child-first-cleanup-service.js'), 'Missing approved child-first cleanup implementation');
  const { ChildFirstCleanupService } = await import('../src/naver/searchad/lifecycle/child-first-cleanup-service.js');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { assert.notEqual(process.env.CI, 'true'); return t.skip('Local PostgreSQL not configured'); }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const oldFetch = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => { globalThis.fetch = oldFetch; await closePostgresPool(admin); assert.equal(escaped, 0); });

  async function fixture(st, startTime = NOW) {
    const schema = `child_cleanup_${randomUUID().replaceAll('-', '')}`;
    const pools = new Set(); let created = false;
    const f = { schema, time: startTime, calls: [], errors: [], after: null, override: null, plans: {}, inputs: {}, gone: {} };
    st.after(async () => { try { await Promise.all([...pools].map(p => closePostgresPool(p))); } finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } assert.deepEqual(f.errors, []); });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`); scoped.searchParams.set('application_name', schema);
    f.connect = () => { const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger }); pools.add(p); return p; };
    f.pool = f.connect();
    await runPostgresMigrations({ pool: f.pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    f.registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
    f.config = loadSearchAdConfig({ NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret', NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_SEARCHAD_ALLOW_READS: 'true', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true' });
    f.credentials = new SearchAdCredentialsRegistry(f.config.topology);
    f.rotate = () => { f.credentials.principals.get('default').secretKey = 'rotated-fixture'; };
    f.identity = { specSha: f.registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(f.credentials, '1001'), upstreamBaseUrl: 'https://api.searchad.naver.com' };
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    f.authority = async (operation, fields, kind, patch = {}) => {
      const id = randomUUID(), evidenceId = `synthetic-${randomUUID()}`;
      const a = { customer: '1001', type: 'active_canary', result: 'verified', operations: [operation], fields, kinds: [kind], start: new Date(f.time - 1000).toISOString(), end: new Date(f.time + 3600000).toISOString(), ...patch };
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`, [evidenceId,a.type,a.customer,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify(a.operations),JSON.stringify(a.fields),JSON.stringify(a.kinds),a.result,a.start,a.end]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'fixture-authority',$11,$12)`, [id,evidenceId,a.type,a.customer,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify(a.operations),JSON.stringify(a.fields),JSON.stringify(a.kinds),a.start,a.end]);
      return id;
    };
    f.fetchImpl = async (url, init) => {
      const u = new URL(url), headers = new Headers(init.headers), body = init.body ? JSON.parse(init.body) : null;
      const call = { method: init.method, path: u.pathname, body }; f.calls.push(call);
      try {
        assert.equal(u.origin, 'https://api.searchad.naver.com'); assert.equal(u.search, ''); assert.equal(init.redirect, 'error');
        const credential = f.credentials.resolve('1001'); assert.equal(headers.get('X-Customer'), '1001'); assert.equal(headers.get('X-API-KEY'), credential.accessLicense);
        assert.equal(headers.get('X-Signature'), createHmac('sha256', credential.secretKey).update(`${headers.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));
      } catch (e) { f.errors.push(e.message); throw e; }
      if (f.override) { const r = await f.override(call); if (r !== undefined) return r; }
      let response;
      if (init.method === 'POST' && u.pathname === '/ncc/campaigns') { f.remoteRoot = { customerId: '1001', nccCampaignId: `cmp-${randomUUID()}`, ...body }; response = json(f.remoteRoot); }
      else if (init.method === 'POST' && u.pathname === '/ncc/adgroups') { f.remoteChild = { customerId: '1001', nccAdgroupId: `grp-${randomUUID()}`, ...body }; response = json(f.remoteChild); }
      else {
        const kind = u.pathname === `/ncc/campaigns/${f.remoteRoot?.nccCampaignId}` ? 'campaign' : u.pathname === `/ncc/adgroups/${f.remoteChild?.nccAdgroupId}` ? 'adgroup' : null;
        try { assert.ok(kind, `Guessed target ${u.pathname}`); assert.ok(['GET','DELETE'].includes(init.method)); if (init.method === 'DELETE' && kind === 'campaign') assert.equal(f.gone.adgroup, true, 'Parent deleted before child absence'); }
        catch (e) { f.errors.push(e.message); throw e; }
        if (init.method === 'DELETE') { f.gone[kind] = true; response = json(null, 204); }
        else response = f.gone[kind] ? json({ code: 'NOT_FOUND' }, 404) : json(kind === 'campaign' ? f.remoteRoot : f.remoteChild);
      }
      if (f.after) await f.after(call);
      return response;
    };
    f.args = extra => ({ pool: f.pool, registry: f.registry, credentialsRegistry: f.credentials, config: f.config, enabled: true, dailyBudget: 1000, riskUnits: 1, dailyCapacityUnits: 100, clock: () => f.time, fetchImpl: f.fetchImpl, logger, ...extra });
    f.writer = new PostgresSearchAdWriteRepository({ pool: f.pool });
    f.approval = new SearchAdApprovalService({ repository: f.writer, config: { approvalTtlSeconds: 300 }, clock: () => f.time });
    f.approve = id => f.approval.approve(id, { confirmation: 'APPROVE_SEARCHAD_CHANGE', actor: 'fixture-approver' });
    const creator = new CampaignCreateService(f.args());
    const root = await creator.prepare({ customerId: '1001', activationId: await f.authority(OPS.campaign.create, ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'], 'create') }, context);
    f.root = await creator.execute({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, hierarchyObjectId: root.hierarchyObjectId, planId: root.planId, executionToken: (await f.approve(root.planId)).executionToken }, context);
    assert.equal(f.root.state, 'owned');
    const childCreator = new AdgroupCreateService(f.args());
    const child = await childCreator.prepare({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: root.hierarchyObjectId, activationId: await f.authority(OPS.adgroup.create, ['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'], 'create') }, context);
    f.child = await childCreator.execute({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: root.hierarchyObjectId, hierarchyObjectId: child.hierarchyObjectId, planId: child.planId, executionToken: (await f.approve(child.planId)).executionToken }, context);
    assert.equal(f.child.state, 'owned');
    f.ids = { campaign: root.hierarchyObjectId, adgroup: child.hierarchyObjectId };
    f.service = new ChildFirstCleanupService(f.args());
    f.scope = kind => ({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, hierarchyObjectId: f.ids[kind] });
    f.prepare = async (kind = 'adgroup', activationId) => {
      const p = await f.service.prepare({ ...f.scope(kind), activationId: activationId ?? await f.authority(OPS[kind].delete, [], 'delete') }, context); f.plans[kind] = p; return p;
    };
    f.ready = async (kind = 'adgroup') => {
      const p = await f.prepare(kind); const a = await f.approve(p.planId);
      f.inputs[kind] = { ...f.scope(kind), planId: p.planId, executionToken: a.executionToken, confirmation: p.requiredConfirmation, secondConfirmation: p.requiredSecondConfirmation }; return p;
    };
    f.execute = (kind = 'adgroup', service = f.service) => service.execute(f.inputs[kind], context);
    f.reconcile = (kind = 'adgroup', service = f.service) => service.reconcile({ ...f.scope(kind), planId: f.plans[kind].planId }, context);
    f.row = async kind => (await f.pool.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_object_id=$1', [f.ids[kind]])).rows[0];
    f.used = async (kind = 'adgroup') => (await f.pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [f.plans[kind].planId])).rows[0].used_at;
    f.risk = async () => (await f.pool.query('SELECT sum(units)::int AS n FROM searchad_risk_reservations')).rows[0].n;
    f.deletes = kind => f.calls.filter(c => c.method === 'DELETE' && (!kind || c.path.includes(kind === 'campaign' ? '/campaigns/' : '/adgroups/')));
    f.wrap = (hook) => ({ query: (...a) => f.pool.query(...a), connect: async () => { const c = await f.pool.connect(); return { query: async (sql, params) => hook(sql, params, (...a) => c.query(...a)), release: (...a) => c.release(...a) }; } });
    f.calls.length = 0;
    return f;
  }

  await t.test('parent planning is blocked before child deletion, without remote calls', async st => {
    const f = await fixture(st); await assert.rejects(f.prepare('campaign'), rejected); assert.equal(f.calls.length, 0); assert.equal(await f.risk(), 2);
  });
  await t.test('real producer to child deletion to freshly rechecked parent deletion; no evidence or PASS issued', async st => {
    const f = await fixture(st); const evidenceCount = Number((await f.pool.query('SELECT count(*) FROM searchad_verification_evidence')).rows[0].count);
    await f.ready(); assert.equal((await f.writer.getPlan(f.plans.adgroup.planId)).status, 'approved'); assert.equal(f.calls.length, 0);
    assert.equal((await f.execute()).state, 'deleted'); assert.deepEqual(f.calls.map(c => c.method), ['GET','GET','DELETE','GET']);
    assert.equal((await f.row('campaign')).state, 'owned'); assert.ok(await f.used());
    await f.ready('campaign'); f.calls.length = 0;
    assert.equal((await f.execute('campaign')).state, 'deleted'); assert.deepEqual(f.calls.map(c => c.method), ['GET','GET','DELETE','GET']);
    assert.equal(f.calls[0].path, `/ncc/adgroups/${f.remoteChild.nccAdgroupId}`); assert.equal(f.deletes('campaign').length, 1); assert.equal(await f.risk(), 4);
    assert.equal((await f.pool.query('SELECT status FROM searchad_hierarchy_canary_runs')).rows[0].status, 'cleanup_pending');
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM searchad_verification_evidence')).rows[0].count), evidenceCount + 2);
    assert.equal((await f.writer.getPlan(f.plans.campaign.planId)).status, 'applied');
  });
  for (const kind of ['adgroup','campaign']) await t.test(`${kind}: replay never reuses a committed deletion`, async st => {
    const f = await fixture(st); await f.ready(); await f.execute(); if (kind === 'campaign') { await f.ready(kind); await f.execute(kind); }
    const before = f.calls.length; await assert.rejects(f.execute(kind), rejected); assert.equal(f.calls.length, before); assert.equal(f.deletes(kind).length, 1);
    const r = new ChildFirstCleanupService(f.args({ pool: f.connect(), enabled: false })); assert.equal((await f.reconcile(kind,r)).state, 'deleted'); assert.equal(f.calls.length, before);
  });
  for (const role of ['reader','operator','executor']) await t.test(`reject ${role} before database or transport`, async st => {
    const f = await fixture(st); await f.ready(); await assert.rejects(f.service.execute(f.inputs.adgroup, { principal: { ...context.principal, role } }), rejected); assert.equal(await f.used(), null); assert.equal(f.calls.length, 0);
  });
  for (const patch of [{ remoteId: 'victim' }, { url: 'https://evil.invalid/' }, { customerId: '9999' }, { secondConfirmation: 'DELETE' }, { confirmation: 'APPROVE_SEARCHAD_CHANGE' }]) await t.test(`reject caller override ${JSON.stringify(patch)}`, async st => {
    const f = await fixture(st); await f.ready(); await assert.rejects(f.service.execute({ ...f.inputs.adgroup, ...patch }, context), rejected); assert.equal(await f.used(), null); assert.equal(f.calls.length, 0);
  });
  await t.test('default-OFF cannot prepare, but no ordinary write gate is enabled by construction', async st => {
    const f = await fixture(st); const off = new ChildFirstCleanupService(f.args({ enabled: false })); await assert.rejects(off.prepare({ ...f.scope('adgroup'), activationId: randomUUID() },context), rejected);
    for (const key of ['allowWrites','allowCreates','allowDeletes','allowBatchWrites']) assert.equal(f.config[key], false);
  });
  for (const patch of [{ operations: [OPS.campaign.delete] }, { type: 'passive_capability' }, { kinds: ['create'] }, { fields: ['adgroup.name'] }, { end: new Date(NOW).toISOString() }, { result: 'failed' }]) await t.test(`reject insufficient deletion authority ${JSON.stringify(patch)}`, async st => {
    const f = await fixture(st); const id = await f.authority(OPS.adgroup.delete, [], 'delete', patch); await assert.rejects(f.prepare('adgroup',id), rejected); assert.equal(f.calls.length, 0);
  });
  for (const altered of ['id','parent','hold','create_hash','child_deleted_flags']) await t.test(`cannot turn altered ${altered} records into deletion proof`, async st => {
    const f = await fixture(st);
    if (altered === 'id') { await f.pool.query("UPDATE searchad_hierarchy_objects SET remote_id='victim' WHERE hierarchy_object_id=$1",[f.ids.adgroup]); await f.pool.query("UPDATE searchad_remote_object_ownership SET remote_id='victim' WHERE hierarchy_object_id=$1",[f.ids.adgroup]); }
    if (altered === 'parent') await f.pool.query('UPDATE searchad_hierarchy_objects SET parent_object_id=NULL WHERE hierarchy_object_id=$1',[f.ids.adgroup]);
    if (altered === 'hold') await f.pool.query("UPDATE searchad_remote_object_ownership SET owner_kind='active_canary' WHERE hierarchy_object_id=$1",[f.ids.adgroup]);
    if (altered === 'create_hash') await f.pool.query("UPDATE searchad_write_change_plans SET applied_after_hash='fake' WHERE plan_id=$1",[f.child.planId]);
    if (altered === 'child_deleted_flags') { await f.pool.query("UPDATE searchad_hierarchy_objects SET state='deleted',deleted_at=now() WHERE hierarchy_object_id=$1",[f.ids.adgroup]); await f.pool.query("UPDATE searchad_remote_object_ownership SET state='deleted' WHERE hierarchy_object_id=$1",[f.ids.adgroup]); }
    await assert.rejects(f.prepare(altered === 'child_deleted_flags' ? 'campaign' : 'adgroup'), rejected); assert.equal(f.calls.length, 0);
  });
  for (const rootPatch of [{ userLock: false }, { customerId: '9999' }, { dailyBudget: 2 }, { nccCampaignId: 'victim' }]) await t.test(`stopped root preflight required ${JSON.stringify(rootPatch)}`, async st => {
    const f = await fixture(st); await f.ready(); f.override = call => call.path.includes('/campaigns/') ? json({ ...f.remoteRoot, ...rootPatch }) : undefined; await assert.rejects(f.execute(), rejected); assert.equal(await f.used(), null); assert.equal(f.deletes().length, 0);
  });
  for (const status of [401,403,429,500,503]) await t.test(`preflight error ${status} is not authority to delete`, async st => {
    const f = await fixture(st); await f.ready(); f.override = call => call.method === 'GET' ? json({ code: 'BROKEN' },status) : undefined;
    await assert.rejects(f.execute(), rejected); assert.equal(await f.used(), null); assert.equal(f.deletes().length, 0);
  });
  await t.test('child must still be absent before parent dispatch', async st => {
    const f = await fixture(st); await f.ready(); await f.execute(); await f.ready('campaign'); f.gone.adgroup = false;
    await assert.rejects(f.execute('campaign'), rejected); assert.equal(await f.used('campaign'), null); assert.equal(f.deletes('campaign').length, 0);
  });
  for (const mode of ['unavailable','present','mismatch']) await t.test(`post-delete observation ${mode} stays unresolved, GET-only recovery after restart`, async st => {
    const f = await fixture(st); await f.ready(); f.override = call => {
      if (call.method === 'GET' && call.path.includes('/adgroups/') && f.gone.adgroup) return mode === 'unavailable' ? json({code:'OUTAGE'},503) : json({ ...f.remoteChild, ...(mode === 'mismatch' ? { customerId:'9999' } : {}) });
    };
    const r = await f.execute(); assert.notEqual(r.state,'deleted'); assert.equal(f.deletes().length,1); assert.ok(await f.used());
    await assert.rejects(f.prepare('campaign'),rejected); f.override = null; f.config.allowActiveCanary = false;
    await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
    const recovered = new ChildFirstCleanupService(f.args({pool:f.connect(),enabled:false})); f.calls.length = 0;
    assert.equal((await f.reconcile('adgroup',recovered)).state,'deleted'); assert.deepEqual(f.calls.map(c=>c.method),['GET']); assert.equal(await f.risk(),3);
  });
  for (const status of [200,204,404,429,503]) await t.test(`DELETE ${status} is not absence proof without separate GET`, async st => {
    const f = await fixture(st); await f.ready(); f.override = call => call.method === 'DELETE' ? json({code:'RESULT'},status) : undefined;
    assert.equal((await f.execute()).state,'delete_unknown'); assert.equal(f.deletes().length,1); assert.equal(f.calls.at(-1).method,'GET'); await assert.rejects(f.execute(),rejected);
  });
  await t.test('response lost after upstream deletion reconciles without second DELETE', async st => {
    const f = await fixture(st); await f.ready(); f.override = call => { if(call.method==='DELETE'){f.gone.adgroup=true;throw new Error('connection lost');} };
    assert.equal((await f.execute()).state,'deleted'); assert.equal(f.deletes().length,1); assert.equal(await f.risk(),3);
  });
  for (const phase of ['preflight','delete','observation','final_audit']) await t.test(`credential rotation at ${phase} prevents unsafe settlement or sending`, async st => {
    const f=await fixture(st);await f.ready();
    const rotate=()=>{const p=[...f.credentials.principals.values()][0];p.secretKey='fixture-rotated';};
    if(phase==='final_audit') f.service=new ChildFirstCleanupService(f.args({pool:f.wrap(async(sql,args,q)=>{const r=await q(sql,args);if(String(sql).includes('INSERT INTO searchad_hierarchy_events')&&args.includes('tree_cleanup_observation'))rotate();return r;})}));
    else f.after=async call=>{if((phase==='preflight'&&call.method==='GET'&&!f.gone.adgroup)||(phase==='delete'&&call.method==='DELETE')||(phase==='observation'&&call.method==='GET'&&f.gone.adgroup))rotate();};
    await assert.rejects(f.execute(),rejected);assert.notEqual((await f.row('adgroup')).state,'deleted');assert.equal(f.deletes().length,phase==='preflight'?0:1);
    if(phase==='preflight')assert.equal(await f.used(),null);
  });
  await t.test('stale preflight and expired approval do not consume a token', async st=>{
    const f=await fixture(st);await f.ready();f.after=async()=>{f.time+=6000;};await assert.rejects(f.execute(),rejected);assert.equal(await f.used(),null);assert.equal(await f.risk(),2);
  });
  await t.test('revalidation after real capacity row lock waits rejects approval expiration', async st=>{
    const f=await fixture(st);await f.ready();const c=await f.connect().connect();await c.query('BEGIN');await c.query('SELECT * FROM searchad_daily_risk_capacity FOR UPDATE');
    let waitingResolve;const waiting=new Promise(r=>waitingResolve=r);
    const wrapped=f.wrap(async(sql,args,q)=>{if(String(sql).includes('SELECT * FROM searchad_daily_risk_capacity'))waitingResolve();return q(sql,args);});
    const pending=new ChildFirstCleanupService(f.args({pool:wrapped})).execute(f.inputs.adgroup,context);const caught=pending.then(()=>null,e=>e);
    await waiting;f.time+=301000;await c.query('ROLLBACK');c.release();assert.ok(rejected(await caught));assert.equal(await f.used(),null);assert.equal(f.deletes().length,0);
  });
  await t.test('two concurrent executions consume one token and attempt one DELETE', async st=>{
    const f=await fixture(st);await f.ready();const two=new ChildFirstCleanupService(f.args({pool:f.connect()}));const r=await Promise.allSettled([f.execute(),f.execute('adgroup',two)]);
    assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.deletes().length,1);assert.equal(await f.risk(),3);
  });
  for (const match of ['UPDATE searchad_write_approvals SET used_at','UPDATE searchad_daily_risk_capacity SET consumed_units','INSERT INTO searchad_risk_reservations','tree_cleanup_intent']) await t.test(`transaction failure at ${match} rolls back claim without DELETE`,async st=>{
    const f=await fixture(st);await f.ready();let fired=false;const p=f.wrap(async(sql,args,q)=>{if(!fired&&(String(sql).includes(match)||args?.includes(match))){fired=true;throw new Error('injected');}return q(sql,args);});
    await assert.rejects(f.execute('adgroup',new ChildFirstCleanupService(f.args({pool:p}))),rejected);assert.equal(fired,true);assert.equal(await f.used(),null);assert.equal(await f.risk(),2);assert.equal(f.deletes().length,0);
  });
  await t.test('commit acknowledgement loss after durable intent never sends or replays',async st=>{
    const f=await fixture(st);await f.ready();let armed=false,fired=false;const p=f.wrap(async(sql,args,q)=>{if(args?.includes('tree_cleanup_intent'))armed=true;const r=await q(sql,args);if(armed&&sql==='COMMIT'&&!fired){fired=true;throw new Error('ack lost');}return r;});
    await assert.rejects(f.execute('adgroup',new ChildFirstCleanupService(f.args({pool:p}))),rejected);assert.equal(fired,true);assert.ok(await f.used());assert.equal(await f.risk(),3);assert.equal(f.deletes().length,0);await assert.rejects(f.execute(),rejected);
  });
  for (const corruption of ['deleted_at','approval','risk','plan_hash','plan_status']) await t.test(`parent rejects altered durable child cleanup proof: ${corruption}`,async st=>{
    const f=await fixture(st);await f.ready();await f.execute();
    if(corruption==='deleted_at')await f.pool.query("UPDATE searchad_hierarchy_objects SET deleted_at=deleted_at+interval '1 second' WHERE hierarchy_object_id=$1",[f.ids.adgroup]);
    if(corruption==='approval')await f.pool.query('UPDATE searchad_write_approvals SET used_at=NULL WHERE plan_id=$1',[f.plans.adgroup.planId]);
    if(corruption==='risk')await f.pool.query("UPDATE searchad_risk_reservations SET state='released' WHERE intent_id=$1",[`hierarchy:tree:delete:${f.plans.adgroup.planId}`]);
    if(corruption==='plan_hash')await f.pool.query("UPDATE searchad_write_change_plans SET applied_after_hash='fake' WHERE plan_id=$1",[f.plans.adgroup.planId]);
    if(corruption==='plan_status')await f.pool.query("UPDATE searchad_write_change_plans SET status='approved' WHERE plan_id=$1",[f.plans.adgroup.planId]);
    f.calls.length=0;await assert.rejects(f.prepare('campaign'),rejected);assert.equal(f.calls.length,0);
  });
  await t.test('an extra foreign descendant is rejected rather than hidden by Customer filtering',async st=>{
    const f=await fixture(st);await f.pool.query(`INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at)
      VALUES($1,$2,'9999','keyword',$3,$4,$5,$6,'planned',now(),now())`,[randomUUID(),f.root.hierarchyRunId,f.ids.adgroup,OPS.keyword.create,OPS.keyword.read,OPS.keyword.delete]);
    await assert.rejects(f.prepare(),rejected);assert.equal(f.calls.length,0);
  });
  await t.test('account suspension after planning preserves unused approval',async st=>{
    const f=await fixture(st);await f.ready();await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");await assert.rejects(f.execute(),rejected);assert.equal(await f.used(),null);assert.equal(f.calls.length,0);
  });
  await t.test('capacity mismatch does not change a shared policy or consume approval',async st=>{
    const f=await fixture(st);await f.ready();await f.pool.query('UPDATE searchad_daily_risk_capacity SET capacity_units=99');await assert.rejects(f.execute(),rejected);assert.equal(await f.used(),null);assert.equal(await f.risk(),2);assert.equal(f.deletes().length,0);
  });
  await t.test('UTC rollover during preflight cannot consume yesterday capacity',async st=>{
    const f=await fixture(st,Date.parse('2026-09-13T23:59:59Z'));await f.ready();let once=false;f.after=async call=>{if(call.method==='GET'&&!once){once=true;f.time+=6000;}};await assert.rejects(f.execute(),rejected);assert.equal(await f.used(),null);assert.equal(f.deletes().length,0);
  });
  await t.test('failed send-result audit remains recoverable by GET without repeating DELETE',async st=>{
    const f=await fixture(st);await f.ready();let fired=false;const p=f.wrap(async(sql,args,q)=>{if(!fired&&args?.includes('tree_cleanup_result')){fired=true;throw new Error('audit unavailable');}return q(sql,args);});
    await assert.rejects(f.execute('adgroup',new ChildFirstCleanupService(f.args({pool:p}))),rejected);assert.equal(f.deletes().length,1);assert.equal((await f.reconcile()).state,'deleted');assert.equal(f.deletes().length,1);
  });
  await t.test('late post-delete observation cannot be committed as fresh absence',async st=>{
    const f=await fixture(st);await f.ready();f.after=async call=>{if(call.method==='GET'&&f.gone.adgroup)f.time+=30001;};
    await assert.rejects(f.execute(),rejected);assert.notEqual((await f.row('adgroup')).state,'deleted');assert.equal(f.deletes().length,1);
  });
  await t.test('disabled read gate blocks recovery before writing another observation',async st=>{
    const f=await fixture(st);await f.ready();f.override=call=>call.method==='DELETE'?json({},200):undefined;await f.execute();
    const before=Number((await f.pool.query("SELECT count(*) FROM searchad_hierarchy_events WHERE phase='tree_cleanup_observation'")).rows[0].count);
    f.config.allowReads=false;f.calls.length=0;await assert.rejects(f.reconcile(),rejected);
    assert.equal(Number((await f.pool.query("SELECT count(*) FROM searchad_hierarchy_events WHERE phase='tree_cleanup_observation'")).rows[0].count),before);assert.equal(f.calls.length,0);
  });

});
