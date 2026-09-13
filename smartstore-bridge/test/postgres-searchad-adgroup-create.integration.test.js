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
import { CampaignCleanupService } from '../src/naver/searchad/lifecycle/campaign-cleanup-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';

const logger = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-09-13T01:00:00Z');
const context = { principal: { principalId: 'adgroup-admin', role: 'admin', customerIds: ['1001'] } };
const campaignFields = ['campaign.campaignTp', 'campaign.name', 'campaign.userLock', 'campaign.dailyBudget'];
const adgroupFields = ['adgroup.nccCampaignId', 'adgroup.name', 'adgroup.userLock'];
const json = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// Real migrations/PG, parent producer, approvals and signing Gateway. Only the
// upstream responses and active authority records are synthetic test fixtures.
test('bounded adgroup creation under a verified server-created stopped campaign', { timeout: 180_000 }, async t => {
  assert.ok(fs.existsSync('src/naver/searchad/lifecycle/adgroup-create-service.js'), 'Missing bounded adgroup creation service');
  const { AdgroupCreateService } = await import('../src/naver/searchad/lifecycle/adgroup-create-service.js');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { assert.notEqual(process.env.CI, 'true', 'CI requires PostgreSQL'); return t.skip('Local PostgreSQL not configured'); }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const originalFetch = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => { globalThis.fetch = originalFetch; await closePostgresPool(admin); assert.equal(escaped, 0); });

  async function fixture(st, startTime = NOW) {
    const schema = `adgroup_${randomUUID().replaceAll('-', '')}`;
    const pools = new Set(); let created = false;
    const f = { schema, time: startTime, calls: [], transportAssertionErrors: [], after: null, override: null };
    st.after(async () => {
      try { await Promise.all([...pools].map(p => closePostgresPool(p))); }
      finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      assert.deepEqual(f.transportAssertionErrors, []);
    });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`); scoped.searchParams.set('application_name', schema);
    f.connect = () => { const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger }); pools.add(p); return p; };
    f.pool = f.connect();
    await runPostgresMigrations({ pool: f.pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    assert.equal((await f.pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    f.registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
    f.config = loadSearchAdConfig({ NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret', NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_SEARCHAD_ALLOW_READS: 'true', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true' });
    f.credentials = new SearchAdCredentialsRegistry(f.config.topology);
    f.identity = { specSha: f.registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(f.credentials, '1001'), upstreamBaseUrl: 'https://api.searchad.naver.com' };
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    f.authority = async (operation, fields, kind = 'create', patch = {}) => {
      const id = randomUUID(), evidenceId = `synthetic-${randomUUID()}`;
      const a = { customer: '1001', type: 'active_canary', result: 'verified', operations: [operation], fields, kinds: [kind], start: new Date(f.time - 1000).toISOString(), end: new Date(f.time + 3600000).toISOString(), ...patch };
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`, [evidenceId,a.type,a.customer,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify(a.operations),JSON.stringify(a.fields),JSON.stringify(a.kinds),a.result,a.start,a.end]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'fixture-authority',$11,$12)`, [id,evidenceId,a.type,a.customer,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify(a.operations),JSON.stringify(a.fields),JSON.stringify(a.kinds),a.start,a.end]);
      return id;
    };
    f.fetchImpl = async (url, init) => {
      const u = new URL(url), h = new Headers(init.headers), body = init.body ? JSON.parse(init.body) : null;
      const call = { method: init.method, path: u.pathname, body };
      f.calls.push(call);
      try {
        assert.equal(u.origin, 'https://api.searchad.naver.com'); assert.equal(u.search, ''); assert.equal(init.redirect, 'error');
        assert.equal(h.get('X-Customer'), '1001');
        const credential = f.credentials.resolve('1001');
        assert.equal(h.get('X-API-KEY'), credential.accessLicense);
        assert.equal(h.get('X-Signature'), createHmac('sha256', credential.secretKey).update(`${h.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));
        assert.ok(['POST', 'GET', 'DELETE'].includes(init.method));
      } catch (e) { f.transportAssertionErrors.push(e.message); throw e; }
      if (f.override) { const r = await f.override(call); if (r !== undefined) return r; }
      let response;
      if (init.method === 'POST' && u.pathname === '/ncc/campaigns') {
        f.parentRemote = { customerId: '1001', nccCampaignId: `cmp-${randomUUID()}`, ...body }; response = json(f.parentRemote);
      } else if (init.method === 'GET' && u.pathname === `/ncc/campaigns/${f.parentRemote.nccCampaignId}`) response = json(f.parentRemote);
      else if (init.method === 'POST' && u.pathname === '/ncc/adgroups') {
        try { assert.equal(body.nccCampaignId, f.parentRemote.nccCampaignId); assert.equal(body.userLock, true); assert.deepEqual(Object.keys(body).sort(), ['name','nccCampaignId','userLock']); }
        catch (e) { f.transportAssertionErrors.push(e.message); throw e; }
        f.childRemote = { customerId: '1001', nccAdgroupId: `grp-${randomUUID()}`, ...body }; response = json(f.childRemote);
      } else if (init.method === 'GET' && u.pathname === `/ncc/adgroups/${f.childRemote?.nccAdgroupId}`) response = json(f.childRemote);
      else { f.transportAssertionErrors.push(`Unexpected request ${init.method} ${u.pathname}`); throw new Error('Unexpected request'); }
      if (f.after) await f.after(call);
      return response;
    };
    f.args = extra => ({ pool: f.pool, registry: f.registry, credentialsRegistry: f.credentials, config: f.config, enabled: true, dailyBudget: 1000, riskUnits: 1, dailyCapacityUnits: 100, clock: () => f.time, fetchImpl: f.fetchImpl, logger, ...extra });
    f.writer = new PostgresSearchAdWriteRepository({ pool: f.pool });
    f.approval = new SearchAdApprovalService({ repository: f.writer, config: { approvalTtlSeconds: 300 }, clock: () => f.time });
    f.approve = id => f.approval.approve(id, { confirmation: 'APPROVE_SEARCHAD_CHANGE', actor: 'fixture-approver' });
    const creator = new CampaignCreateService(f.args());
    const root = await creator.prepare({ customerId: '1001', activationId: await f.authority(OPS.campaign.create, campaignFields) }, context);
    const approval = await f.approve(root.planId);
    f.rootInput = { customerId: '1001', hierarchyRunId: root.hierarchyRunId, hierarchyObjectId: root.hierarchyObjectId, planId: root.planId, executionToken: approval.executionToken };
    f.root = await creator.execute(f.rootInput, context); assert.equal(f.root.state, 'owned');
    f.calls.length = 0;
    f.activationId = await f.authority(OPS.adgroup.create, adgroupFields);
    f.prepareInput = { customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: root.hierarchyObjectId, activationId: f.activationId };
    f.service = new AdgroupCreateService(f.args());
    f.prepare = () => f.service.prepare(f.prepareInput, context);
    f.ready = async () => { const p = await f.prepare(); f.plan = p; const a = await f.approve(p.planId); f.input = { customerId: '1001', hierarchyRunId: p.hierarchyRunId, parentObjectId: root.hierarchyObjectId, hierarchyObjectId: p.hierarchyObjectId, planId: p.planId, executionToken: a.executionToken }; return p; };
    f.execute = () => f.service.execute(f.input, context);
    f.count = async table => Number((await f.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
    f.used = async () => (await f.pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [f.input.planId])).rows[0].used_at;
    f.child = async () => (await f.pool.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_object_id=$1', [f.plan.hierarchyObjectId])).rows[0];
    return f;
  }

  await t.test('prepare persists an unapproved child bound to the real parent producer without I/O or risk consumption', async st => {
    const f = await fixture(st); const p = await f.prepare(); const plan = await f.writer.getPlan(p.planId);
    assert.equal(p.state, 'planned'); assert.equal(plan.status, 'planned'); assert.equal(plan.mutation_json.operationKey, OPS.adgroup.create);
    assert.equal(plan.mutation_json.body.nccCampaignId, f.root.remoteId); assert.equal(plan.mutation_json.body.userLock, true);
    assert.equal(plan.before_json.parentCreatePlanId, f.root.planId);
    assert.equal(await f.count('searchad_hierarchy_objects'), 2); assert.equal(await f.count('searchad_remote_object_ownership'), 1);
    assert.equal(await f.count('searchad_risk_reservations'), 1); assert.equal(await f.count('searchad_write_approvals'), 1); assert.equal(f.calls.length, 0);
  });
  await t.test('separate approval executes signed parent GET then exactly one POST then child GET and retains parent-linked ownership', async st => {
    const f = await fixture(st); await f.ready(); const r = await f.execute();
    assert.equal(r.state, 'owned'); assert.equal(r.remoteId, f.childRemote.nccAdgroupId);
    assert.deepEqual(f.calls.map(c => `${c.method} ${c.path}`), [`GET /ncc/campaigns/${f.root.remoteId}`, 'POST /ncc/adgroups', `GET /ncc/adgroups/${r.remoteId}`]);
    const child = await f.child(); assert.equal(child.parent_object_id, f.root.hierarchyObjectId); assert.equal(child.state, 'owned');
    const hold = (await f.pool.query('SELECT * FROM searchad_remote_object_ownership WHERE hierarchy_object_id=$1', [child.hierarchy_object_id])).rows[0];
    assert.equal(hold.parent_hierarchy_object_id, f.root.hierarchyObjectId); assert.equal(hold.remote_id, r.remoteId); assert.equal(hold.state, 'owned');
    const p = await f.writer.getPlan(f.input.planId); assert.equal(p.status, 'applied'); assert.equal(p.applied_after_hash, contentHash(p.applied_after_json));
    assert.equal((await f.pool.query('SELECT status FROM searchad_hierarchy_canary_runs')).rows[0].status, 'cleanup_pending');
    assert.equal(await f.count('searchad_verification_evidence'), 2); assert.equal(await f.count('searchad_risk_reservations'), 2);
    assert.notEqual(await f.used(), null); await assert.rejects(f.execute()); assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  });
  const posted = f => f.calls.filter(c => c.method === 'POST').length;
  const childRead = call => call.method === 'GET' && call.path.startsWith('/ncc/adgroups/');
  const parentRead = call => call.method === 'GET' && call.path.startsWith('/ncc/campaigns/');
  const childPost = call => call.method === 'POST' && call.path === '/ncc/adgroups';
  const rotate = f => { for (const p of f.credentials.principals.values()) p.secretKey += '-rotated'; };
  async function unused(f) { assert.equal(await f.used(), null); assert.equal(await f.count('searchad_risk_reservations'), 1); assert.equal(posted(f), 0); }
  function wrappedPool(f, hook) {
    return { query: (...args) => f.pool.query(...args), connect: async () => {
      const c = await f.pool.connect(); const state = {};
      return { query: async (sql, args) => hook(sql,args,state,() => c.query(sql,args)), release: discard => c.release(discard) };
    } };
  }
  async function cleanup(f) {
    const service = new CampaignCleanupService(f.args());
    const input = {customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:f.root.hierarchyObjectId,activationId:await f.authority(OPS.campaign.delete,[],'delete')};
    return { service, input };
  }
  for (const enabled of [false,undefined]) await t.test(`default/explicit OFF (${enabled}) rejects before persistence`, async st => {
    const f=await fixture(st); const service=new AdgroupCreateService(f.args({enabled}));
    await assert.rejects(service.prepare(f.prepareInput,context),e=>e.code.endsWith('DISABLED'));
    assert.equal(await f.count('searchad_hierarchy_objects'),1);assert.equal(f.calls.length,0);
  });
  await t.test('strict roles, Customer, local identifiers, and overrides are rejected', async st=>{
    const f=await fixture(st);
    for(const role of ['reader','executor','operator']) await assert.rejects(f.service.prepare(f.prepareInput,{principal:{...context.principal,role}}));
    for(const patch of [{customerId:'1002'},{parentObjectId:'remote-id'},{remoteId:'injected'},{body:{}},{url:'https://attacker.invalid'},{activationId:randomUUID()}]) await assert.rejects(f.service.prepare({...f.prepareInput,...patch},context));
    await f.ready();for(const patch of [{executionToken:'X'.repeat(43)},{remoteId:'injected'},{planId:randomUUID()}])await assert.rejects(f.service.execute({...f.input,...patch},context));
    await unused(f);assert.equal(f.calls.length,0);
  });
  for(const [name,patch] of [
    ['campaign operation',{operations:[OPS.campaign.create]}],['update lifecycle',{kinds:['delete']}],['incomplete field scope',{fields:['adgroup.name']}],
    ['passive evidence',{type:'passive_capability'}],['failed evidence',{result:'failed'}],['foreign Customer',{customer:'1002'}],['expired evidence',{end:new Date(NOW-1).toISOString()}]
  ])await t.test(`${name} cannot authorize adgroup creation`,async st=>{
    const f=await fixture(st); const id=await f.authority(OPS.adgroup.create,adgroupFields,'create',patch);
    await assert.rejects(f.service.prepare({...f.prepareInput,activationId:id},context));assert.equal(await f.count('searchad_hierarchy_objects'),1);assert.equal(f.calls.length,0);
  });
  await t.test('concurrent independent prepares have one winner and one child',async st=>{
    const f=await fixture(st), other=new AdgroupCreateService(f.args({pool:f.connect()}));
    const results=await Promise.allSettled([f.prepare(),other.prepare(f.prepareInput,context)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await f.count('searchad_hierarchy_objects'),2);assert.equal(f.calls.length,0);
  });
  for(const order of ['cleanup-first','child-first','concurrent'])await t.test(`actual cleanup planning and child planning exclude each other: ${order}`,async st=>{
    const f=await fixture(st),c=await cleanup(f);
    if(order==='cleanup-first'){await c.service.prepare(c.input,context);await assert.rejects(f.prepare());}
    else if(order==='child-first'){await f.prepare();await assert.rejects(c.service.prepare(c.input,context));}
    else {const results=await Promise.allSettled([f.prepare(),c.service.prepare(c.input,context)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);}
    assert.equal(f.calls.length,0);assert.equal(await f.count('searchad_risk_reservations'),1);
  });
  await t.test('even jointly substituted parent object/hold IDs cannot replace creation provenance',async st=>{
    const f=await fixture(st);await f.ready();
    await f.pool.query("UPDATE searchad_hierarchy_objects SET remote_id='substituted' WHERE hierarchy_object_id=$1",[f.root.hierarchyObjectId]);
    await f.pool.query("UPDATE searchad_remote_object_ownership SET remote_id='substituted' WHERE hierarchy_object_id=$1",[f.root.hierarchyObjectId]);
    await assert.rejects(f.execute());await unused(f);assert.equal(f.calls.length,0);
  });
  await t.test('a malformed foreign-Customer child on the same parent is not hidden by filters',async st=>{
    const f=await fixture(st);
    await f.pool.query(`INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at)
      VALUES($1,$2,'foreign','adgroup',$3,$4,$5,$6,'planned',now(),now())`,[randomUUID(),f.root.hierarchyRunId,f.root.hierarchyObjectId,OPS.adgroup.create,OPS.adgroup.read,OPS.adgroup.delete]);
    await assert.rejects(f.prepare());assert.equal(f.calls.length,0);
  });
  for(const [name,patch] of [['active',{userLock:false}],['Customer',{customerId:'1002'}],['ID',{nccCampaignId:'wrong'}],['type',{campaignTp:'SHOPPING'}],['name',{name:'wrong'}],['budget',{dailyBudget:999}]])await t.test(`preflight rejects wrong parent ${name} before consuming approval`,async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>parentRead(c)?json({...f.parentRemote,...patch}):undefined;
    await assert.rejects(f.execute());await unused(f);assert.equal(f.calls.length,1);
  });
  for(const status of [404,503])await t.test(`parent GET ${status} leaves token reusable without any POST`,async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>parentRead(c)?json({error:'unavailable'},status):undefined;
    await assert.rejects(f.execute());await unused(f);f.override=null;assert.equal((await f.execute()).state,'owned');assert.equal(posted(f),1);
  });
  for(const kind of ['ownership','credential','suspended','gate','freshness'])await t.test(`parent preflight ${kind} drift blocks POST and consumption`,async st=>{
    const f=await fixture(st);await f.ready();f.after=async c=>{if(!parentRead(c))return;
      if(kind==='ownership')await f.pool.query("UPDATE searchad_remote_object_ownership SET state='manual_review' WHERE hierarchy_object_id=$1",[f.root.hierarchyObjectId]);
      if(kind==='credential')rotate(f);if(kind==='suspended')await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
      if(kind==='gate')f.config.allowActiveCanary=false;if(kind==='freshness')f.time+=5000;
    };await assert.rejects(f.execute());await unused(f);
  });
  await t.test('independent executions both preflight but only one consumes and sends, including reconstruction replay',async st=>{
    const f=await fixture(st);await f.ready();let reads=0,release;const both=new Promise(r=>release=r);
    f.after=async c=>{if(parentRead(c)){if(++reads===2)release();await both;}};
    const other=new AdgroupCreateService(f.args({pool:f.connect()}));const results=await Promise.allSettled([f.execute(),other.execute(f.input,context)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(posted(f),1);assert.equal(await f.count('searchad_risk_reservations'),2);
    f.after=null;await assert.rejects(new AdgroupCreateService(f.args({pool:f.connect()})).execute(f.input,context));assert.equal(posted(f),1);
  });
  for(const capacity of [1,99])await t.test(`established capacity ${capacity} is not silently increased`,async st=>{
    const f=await fixture(st);await f.ready();await f.pool.query('UPDATE searchad_daily_risk_capacity SET capacity_units=$1',[capacity]);
    await assert.rejects(f.execute());await unused(f);
  });
  for(const table of ['searchad_risk_reservations','searchad_hierarchy_objects','searchad_hierarchy_events','searchad_write_attempts'])await t.test(`claim failure at ${table} rolls back token, risk and child together`,async st=>{
    const f=await fixture(st);await f.ready();const condition=table==='searchad_risk_reservations'?`NEW.operation_key='${OPS.adgroup.create}'`:table==='searchad_hierarchy_objects'?"NEW.object_type='adgroup' AND NEW.state='dispatching'":"NEW.phase='adgroup_dispatch_intent'";
    await f.pool.query(`CREATE FUNCTION reject_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fixture-secret'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_claim BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_claim()`);
    await assert.rejects(f.execute(),e=>e.code.endsWith('STORE_FAILED')&&!JSON.stringify(e).includes('fixture-secret'));await unused(f);
    assert.equal((await f.child()).state,'planned');assert.equal((await f.writer.getPlan(f.input.planId)).status,'approved');
    await f.pool.query(`DROP TRIGGER reject_claim ON ${table}`);assert.equal((await f.execute()).state,'owned');
  });
  await t.test('prepare audit failure rolls back the new child and plan',async st=>{
    const f=await fixture(st);await f.pool.query(`CREATE FUNCTION reject_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='adgroup_plan' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_plan BEFORE INSERT ON searchad_write_attempts FOR EACH ROW EXECUTE FUNCTION reject_plan()`);
    await assert.rejects(f.prepare());assert.equal(await f.count('searchad_hierarchy_objects'),1);assert.equal(await f.count('searchad_write_change_plans'),1);assert.equal(f.calls.length,0);
  });
  for(const status of [429,503,302,204])await t.test(`POST ${status} never retries or invents a returned child`,async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>childPost(c)?json({},status):undefined;
    const result=await f.execute();assert.ok(['create_unknown','manual_review'].includes(result.state));assert.equal(result.remoteId,null);
    assert.equal(posted(f),1);assert.equal(f.calls.filter(childRead).length,0);await assert.rejects(f.execute());assert.equal(posted(f),1);
  });
  await t.test('POST transport outage is unknown and never blindly replayed',async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>{if(childPost(c))throw new Error('upstream-secret');};
    const r=await f.execute();assert.equal(r.state,'create_unknown');assert.equal(r.remoteId,null);await assert.rejects(f.execute());assert.equal(posted(f),1);
  });
  for(const [name,patch] of [['parent',{nccCampaignId:'other'}],['Customer',{customerId:'1002'}],['stopped',{userLock:false}],['name',{name:'other'}],['missing ID',{nccAdgroupId:undefined}],['unsafe ID',{nccAdgroupId:'../evil'}],['mixed type',{nccKeywordId:'kw'}]])await t.test(`POST wrong ${name} never becomes owned or triggers guessed GET`,async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>childPost(c)?json({customerId:'1001',nccAdgroupId:'candidate',...c.body,...patch}):undefined;
    const r=await f.execute();assert.equal(r.state,'manual_review');assert.equal(r.remoteId,null);assert.equal(await f.count('searchad_remote_object_ownership'),1);assert.equal(f.calls.filter(childRead).length,0);assert.equal(posted(f),1);
  });
  await t.test('documented HTTP201 create response binds the exact returned ID',async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>{if(childPost(c)){f.childRemote={customerId:'1001',nccAdgroupId:'created-201',...c.body};return json(f.childRemote,201);}};
    assert.equal((await f.execute()).state,'owned');assert.equal(posted(f),1);
  });
  await t.test('returned ID and parent-linked manual hold are durably committed before the child GET',async st=>{
    const f=await fixture(st);await f.ready();let checked=0;
    f.override=async c=>{if(childRead(c)){const child=await f.child();const h=(await f.connect().query('SELECT * FROM searchad_remote_object_ownership WHERE hierarchy_object_id=$1',[child.hierarchy_object_id])).rows[0];assert.equal(child.remote_id,f.childRemote.nccAdgroupId);assert.equal(child.state,'create_unknown');assert.equal(h.state,'manual_review');assert.equal(h.parent_hierarchy_object_id,f.root.hierarchyObjectId);checked++;}};
    assert.equal((await f.execute()).state,'owned');assert.equal(checked,1);
  });
  for(const [name,patch] of [['parent',{nccCampaignId:'other'}],['ID',{nccAdgroupId:'other'}],['Customer',{customerId:'1002'}],['stopped',{userLock:false}]])await t.test(`child GET wrong ${name} retains original ID without promoting ownership`,async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>childRead(c)?json({...f.childRemote,...patch}):undefined;
    const r=await f.execute();assert.equal(r.state,'manual_review');assert.equal(r.remoteId,f.childRemote.nccAdgroupId);assert.equal((await f.child()).remote_id,r.remoteId);await assert.rejects(f.execute());assert.equal(posted(f),1);
  });
  await t.test('child GET outage retains ID across service/pool reconstruction without POST replay',async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>childRead(c)?json({},503):undefined;const r=await f.execute();assert.equal(r.state,'create_unknown');assert.equal(r.remoteId,f.childRemote.nccAdgroupId);
    await assert.rejects(new AdgroupCreateService(f.args({pool:f.connect()})).execute(f.input,context));assert.equal(posted(f),1);
  });
  for(const table of ['searchad_remote_object_ownership','searchad_hierarchy_events'])await t.test(`capture failure at ${table} cannot leave a half-written ID/hold`,async st=>{
    const f=await fixture(st);await f.ready();const condition=table==='searchad_remote_object_ownership'?"NEW.object_type='adgroup'":"NEW.phase='adgroup_create_result'";
    await f.pool.query(`CREATE FUNCTION reject_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_capture BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_capture()`);
    await assert.rejects(f.execute());assert.equal((await f.child()).remote_id,null);assert.equal(await f.count('searchad_remote_object_ownership'),1);assert.notEqual(await f.used(),null);await assert.rejects(f.execute());assert.equal(posted(f),1);
  });
  await t.test('ownership drift during verification invalidates stale settlement',async st=>{
    const f=await fixture(st);await f.ready();f.after=async c=>{if(childRead(c))await f.pool.query("UPDATE searchad_remote_object_ownership SET state='delete_unknown' WHERE hierarchy_object_id=$1",[f.plan.hierarchyObjectId]);};
    await assert.rejects(f.execute());assert.equal((await f.child()).state,'create_unknown');assert.equal(posted(f),1);
  });
  for(const where of ['POST','GET'])await t.test(`credential rotation during ${where} preserves returned ID without owned promotion`,async st=>{
    const f=await fixture(st);await f.ready();f.after=c=>{if(where==='POST'?childPost(c):childRead(c))rotate(f);};
    const r=await f.execute();assert.equal(r.state,'manual_review');assert.equal(r.remoteId,f.childRemote.nccAdgroupId);assert.equal(posted(f),1);if(where==='POST')assert.equal(f.calls.filter(childRead).length,0);
  });
  for(const mode of ['before-ack','after-ack'])await t.test(`claim COMMIT ${mode} failure never yields a POST permission`,async st=>{
    const f=await fixture(st);await f.ready();let injected=0;
    const pool=wrappedPool(f,async(sql,args,state,run)=>{if(sql.startsWith('INSERT INTO searchad_hierarchy_events')&&args.includes('adgroup_dispatch_intent'))state.claim=true;
      if(sql==='COMMIT'&&state.claim){injected++;if(mode==='after-ack')await run();throw new Error('connection-secret');}return run();});
    const service=new AdgroupCreateService(f.args({pool}));await assert.rejects(service.execute(f.input,context),e=>e.code.endsWith('COMMIT_UNKNOWN'));assert.equal(injected,1);assert.equal(posted(f),0);
    if(mode==='after-ack'){assert.notEqual(await f.used(),null);await assert.rejects(f.execute());}else await unused(f);
  });
  for(const kind of ['gate','credential','expiry'])await t.test(`post-COMMIT ${kind} change prevents send without recycling consumed risk`,async st=>{
    const f=await fixture(st);await f.ready();let changed=0;
    const pool=wrappedPool(f,async(sql,args,state,run)=>{if(sql.startsWith('INSERT INTO searchad_hierarchy_events')&&args.includes('adgroup_dispatch_intent'))state.claim=true;const r=await run();if(sql==='COMMIT'&&state.claim){changed++;if(kind==='gate')f.config.allowActiveCanary=false;if(kind==='credential')rotate(f);if(kind==='expiry')f.time+=5000;}return r;});
    const r=await new AdgroupCreateService(f.args({pool})).execute(f.input,context);assert.equal(changed,1);assert.equal(r.state,'create_unknown');assert.equal(posted(f),0);assert.notEqual(await f.used(),null);assert.equal(await f.count('searchad_risk_reservations'),2);await assert.rejects(f.execute());
  });
  await t.test('prepare snapshots caller scope before its first awaited connection',async st=>{
    const f=await fixture(st);const input=structuredClone(f.prepareInput),ctx=structuredClone(context);let connects=0;
    const pool={query:(...args)=>f.pool.query(...args),connect:async()=>{connects++;input.customerId='1002';ctx.principal.principalId='injected';return f.pool.connect();}};
    const p=await new AdgroupCreateService(f.args({pool})).prepare(input,ctx);assert.equal(connects,1);const saved=await f.writer.getPlan(p.planId);assert.equal(saved.customer_id,'1001');assert.equal(saved.created_by,'adgroup-admin');
  });
  await t.test('untrusted upstream metadata is absent from result and bounded audit records',async st=>{
    const f=await fixture(st);await f.ready();f.override=c=>{if(childPost(c)){f.childRemote={customerId:'1001',nccAdgroupId:'redacted-result',...c.body};return json({...f.childRemote,secret:'upstream-secret',token:f.input.executionToken});}};
    const r=await f.execute();const rows=(await f.pool.query('SELECT details_json,error_json FROM searchad_hierarchy_events')).rows;const plan=await f.writer.getPlan(f.input.planId);const text=JSON.stringify([r,rows,plan]);assert.equal(text.includes('upstream-secret'),false);assert.equal(text.includes(f.input.executionToken),false);assert.equal(r.state,'owned');
  });

  for(const kind of ['freshness','approval expiry','UTC rollover'])await t.test(`real capacity row-lock wait rechecks ${kind}`,async st=>{
    const f=await fixture(st,kind==='UTC rollover'?Date.parse('2026-09-13T23:59:59Z'):NOW);await f.ready();
    const blocker=await f.connect().connect();await blocker.query('BEGIN');await blocker.query('SELECT * FROM searchad_daily_risk_capacity FOR UPDATE');
    let reached;const waiting=new Promise(r=>reached=r);
    const pool=wrappedPool(f,async(sql,args,state,run)=>{if(sql.startsWith('INSERT INTO searchad_daily_risk_capacity'))reached();return run();});
    const service=new AdgroupCreateService(f.args({pool}));const outcome=service.execute(f.input,context).then(value=>({value}),error=>({error}));
    try {
      await waiting;let observed=false;
      for(let i=0;i<100;i++){const q=await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[f.schema]);if(q.rowCount){observed=true;break;}await new Promise(r=>setTimeout(r,10));}
      assert.equal(observed,true,'Actual PostgreSQL lock wait must be observed');
      f.time+=kind==='freshness'?5000:kind==='UTC rollover'?2000:300001;await blocker.query('COMMIT');
    } finally {await blocker.query('ROLLBACK');blocker.release();}
    const r=await outcome;assert.ok(r.error);await unused(f);assert.equal((await f.child()).state,'planned');
  });
  await t.test('returned-ID collision never takes over another owner',async st=>{
    const f=await fixture(st);await f.ready();
    await f.pool.query(`INSERT INTO searchad_remote_object_ownership(ownership_id,customer_id,object_type,remote_id,owner_kind,owner_run_id,created_operation_key,state,created_at,updated_at)
      VALUES($1,'1001','adgroup','collision','active_canary','different-run',$2,'owned',now(),now())`,[randomUUID(),OPS.adgroup.create]);
    f.override=c=>childPost(c)?json({customerId:'1001',nccAdgroupId:'collision',...c.body}):undefined;
    await assert.rejects(f.execute());assert.equal((await f.child()).remote_id,null);assert.equal((await f.pool.query("SELECT owner_run_id FROM searchad_remote_object_ownership WHERE remote_id='collision'")).rows[0].owner_run_id,'different-run');assert.equal(posted(f),1);assert.equal(f.calls.filter(childRead).length,0);
  });
  await t.test('terminal application does not enable ordinary create/delete gates or issue Canary PASS',async st=>{
    const f=await fixture(st);await f.ready();const before={creates:f.config.allowCreates,deletes:f.config.allowDeletes,writes:f.config.allowWrites};await f.execute();
    assert.deepEqual({creates:f.config.allowCreates,deletes:f.config.allowDeletes,writes:f.config.allowWrites},before);assert.equal(await f.count('searchad_verification_evidence'),2);assert.equal(await f.count('searchad_activation_grants'),2);
    const c=await cleanup(f);await assert.rejects(c.service.prepare(c.input,context));assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
  });
  await t.test('planning authority expiry during audit rolls back the child',async st=>{
    const f=await fixture(st);const pool=wrappedPool(f,async(sql,args,state,run)=>{const r=await run();if(sql.startsWith('INSERT INTO searchad_write_attempts')&&args.includes('adgroup_plan'))f.time+=3600001;return r;});
    await assert.rejects(new AdgroupCreateService(f.args({pool})).prepare(f.prepareInput,context));assert.equal(await f.count('searchad_hierarchy_objects'),1);assert.equal(await f.count('searchad_write_change_plans'),1);
  });
  for(const mode of ['before-ack','after-ack'])await t.test(`capture COMMIT ${mode} loss cannot replay a sent POST`,async st=>{
    const f=await fixture(st);await f.ready();let injected=0;
    const pool=wrappedPool(f,async(sql,args,state,run)=>{if(sql.startsWith('INSERT INTO searchad_hierarchy_events')&&args.includes('adgroup_create_result'))state.capture=true;
      if(sql==='COMMIT'&&state.capture){injected++;if(mode==='after-ack')await run();throw new Error('lost capture acknowledgement');}return run();});
    await assert.rejects(new AdgroupCreateService(f.args({pool})).execute(f.input,context));assert.equal(injected,1);assert.equal(posted(f),1);assert.equal(f.calls.filter(childRead).length,0);
    assert.equal((await f.child()).remote_id,mode==='after-ack'?f.childRemote.nccAdgroupId:null);await assert.rejects(f.execute());assert.equal(posted(f),1);
  });
  await t.test('credential rotation during final verification audit rolls back owned promotion',async st=>{
    const f=await fixture(st);await f.ready();let rotated=0;
    const pool=wrappedPool(f,async(sql,args,state,run)=>{const r=await run();if(sql.startsWith('INSERT INTO searchad_write_attempts')&&args.includes('adgroup_create_verification')){rotate(f);rotated++;}return r;});
    await assert.rejects(new AdgroupCreateService(f.args({pool})).execute(f.input,context),e=>e.code.endsWith('CONTEXT'));assert.equal(rotated,1);assert.equal((await f.child()).state,'create_unknown');assert.equal((await f.writer.getPlan(f.input.planId)).status,'unknown_outcome');assert.equal(posted(f),1);
  });

});
