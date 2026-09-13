import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const origin = 'https://api.searchad.naver.com';
const NOW = Date.parse('2026-09-13T01:00:00Z');
const logger = { info() {}, warn() {}, error() {} };
const context = { principal: { principalId: 'cleanup-test-admin', role: 'admin', customerIds: ['1001'] } };
const response = (status, data = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const tables = ['searchad_hierarchy_canary_runs','searchad_hierarchy_objects','searchad_remote_object_ownership',
  'searchad_write_change_plans','searchad_write_approvals','searchad_write_attempts','searchad_hierarchy_events',
  'searchad_risk_reservations','searchad_daily_risk_capacity','searchad_verification_evidence','searchad_activation_grants'];

test('approved single-campaign cleanup composes real creation, approval, PostgreSQL and signed transport', { timeout: 180_000 }, async t => {
  assert.ok(fs.existsSync('src/naver/searchad/lifecycle/campaign-cleanup-service.js'), 'Missing approved campaign cleanup service');
  assert.ok(process.env.TEST_DATABASE_URL, 'Real PostgreSQL is required; do not silently skip');
  const { CampaignCleanupService } = await import('../src/naver/searchad/lifecycle/campaign-cleanup-service.js');
  const admin = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable', logger });
  const originalFetch = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport is forbidden'); };
  t.after(async () => { globalThis.fetch = originalFetch; await closePostgresPool(admin); assert.equal(escaped, 0); });

  async function fixture(st, { deletePatch = {}, capacity = 10 } = {}) {
    const schema = `cleanup_${randomUUID().replaceAll('-', '')}`;
    const pools = new Set(); let created = false; let now = NOW;
    st.after(async () => {
      try { await Promise.all([...pools].map(closePostgresPool)); }
      finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(process.env.TEST_DATABASE_URL); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    const connect = () => { const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger }); pools.add(p); return p; };
    const pool = connect();
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    const registry = loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
    const credentials = new SearchAdCredentialsRegistry({
      principals: [{ principalId: 'fixture-signer', accessLicense: 'fixture-license', secretKey: 'fixture-secret', status: 'active' }],
      customers: [{ customerId: '1001', status: 'active' }], grants: [{ principalId: 'fixture-signer', customerId: '1001', role: 'admin' }]
    });
    const config = { enabled: true, configured: true, baseUrl: origin, allowReads: true, allowActiveCanary: true,
      allowWrites: false, allowCreates: false, allowDeletes: false, allowBatchWrites: false, allowRollbacks: false, allowUnverifiedOperations: false };
    await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES ('1001',false)");
    async function grant(kind, patch = {}) {
      const id = randomUUID(), evidenceId = `fixture-${randomUUID()}`;
      const v = { customerId: '1001', type: 'active_canary', operations: [OPS.campaign[kind]], lifecycle: [kind],
        fields: kind === 'create' ? ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'] : [],
        result: 'verified', expiresAt: new Date(NOW + 600_000).toISOString(), ...patch };
      const common = [v.type,v.customerId,registry.status().specRef,credentialFingerprintForCustomer(credentials,'1001'),origin,
        JSON.stringify(v.operations),JSON.stringify(v.fields),JSON.stringify(v.lifecycle)];
      await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12)`, [evidenceId,...common,v.result,new Date(NOW-1000).toISOString(),v.expiresAt]);
      await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'fixture-approver',$11,$12)`,[id,evidenceId,...common,new Date(NOW-1000).toISOString(),v.expiresAt]);
      return id;
    }
    const createActivationId = await grant('create'); const deleteActivationId = await grant('delete',deletePatch);
    const calls = []; let checked = 0; let remote; let answer = null;
    const fetchImpl = async (url, init) => {
      const u = new URL(url); calls.push({ method: init.method, path: u.pathname });
      assert.equal(u.origin,origin); assert.equal(u.search,''); assert.equal(init.redirect,'error');
      assert.equal(init.headers['X-Customer'],'1001');
      assert.equal(init.headers['X-Signature'],createHmac('sha256',credentials.resolve('1001').secretKey).update(`${init.headers['X-Timestamp']}.${init.method}.${u.pathname}`).digest('base64'));
      if(init.method !== 'POST') { assert.equal(u.pathname,`/ncc/campaigns/${remote.nccCampaignId}`); assert.equal(init.body,undefined); }
      checked++;
      if(answer) return answer(init.method);
      if(init.method==='POST') { remote={...JSON.parse(init.body),customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`}; return response(200,remote); }
      return response(200,remote);
    };
    st.after(() => { assert.equal(checked,calls.length,'Transport assertions must not be swallowed as network outages'); });
    const writer = new PostgresSearchAdWriteRepository({ pool });
    const approvals = new SearchAdApprovalService({ repository: writer, config: { approvalTtlSeconds: 300 }, clock: () => now });
    const creator = new CampaignCreateService({ pool,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:2,dailyCapacityUnits:capacity,clock:()=>now,fetchImpl,logger });
    const cp = await creator.prepare({ customerId:'1001',activationId:createActivationId },context);
    const ca = await approvals.approve(cp.planId,{actor:context.principal.principalId,confirmation:'APPROVE_SEARCHAD_CHANGE'});
    const scope = {customerId:'1001',hierarchyRunId:cp.hierarchyRunId,hierarchyObjectId:cp.hierarchyObjectId};
    assert.equal((await creator.execute({...scope,planId:cp.planId,executionToken:ca.executionToken},context)).state,'owned');
    const creationCallCount = calls.length;
    let deleted = false;
    answer = method => { if(method==='DELETE') {deleted=true;return response(204);} return deleted?response(404,{code:'NOT_FOUND'}):response(200,remote); };
    const make = (p=pool,options={}) => new CampaignCleanupService({pool:p,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:capacity,clock:()=>now,fetchImpl,logger,...options});
    const service=make(); let plan; let approval;
    return { pool,connect,writer,approvals,registry,credentials,config,scope,remote,cp,make,service,deleteActivationId,createActivationId,
      get calls(){return calls.slice(creationCallCount);}, get deletes(){return calls.slice(creationCallCount).filter(x=>x.method==='DELETE').length;},
      set answer(value){answer=value;}, set now(value){now=value;},
      async prepare(){plan=await service.prepare({...scope,activationId:deleteActivationId},context);return plan;},
      async approve(){approval=await approvals.approve(plan.planId,{actor:context.principal.principalId,confirmation:'APPROVE_SEARCHAD_CHANGE'});return approval;},
      get input(){return {...scope,planId:plan.planId,executionToken:approval.executionToken,confirmation:plan.requiredConfirmation,secondConfirmation:plan.requiredSecondConfirmation};},
      get observeInput(){return {...scope,planId:plan.planId};},
      get approval(){return approval;},get plan(){return plan;},
      async snapshot(){const out={};for(const table of tables)out[table]=(await pool.query(`SELECT row_to_json(t) AS r FROM ${table} t ORDER BY row_to_json(t)::text`)).rows;return out;},
      async state(){return {object:(await pool.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_object_id=$1',[scope.hierarchyObjectId])).rows[0],hold:(await pool.query('SELECT * FROM searchad_remote_object_ownership WHERE hierarchy_object_id=$1',[scope.hierarchyObjectId])).rows[0],plan:plan?await writer.getPlan(plan.planId):null,run:(await pool.query('SELECT * FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1',[scope.hierarchyRunId])).rows[0]};}
    };
  }

  await t.test('separate server cleanup plan, approval, signed GET DELETE GET, atomic absence settlement and no PASS', async st => {
    const f=await fixture(st);const p=await f.prepare();assert.equal(f.calls.length,0);assert.equal(p.remoteId,f.remote.nccCampaignId);
    assert.equal(p.requiredSecondConfirmation,`searchad:1001:campaign:${f.remote.nccCampaignId}`);assert.notEqual(p.planId,f.cp.planId);
    await f.approve();const r=await f.service.execute(f.input,context);assert.equal(r.state,'deleted');
    assert.deepEqual(f.calls.map(x=>x.method),['GET','DELETE','GET']);const s=await f.state();
    assert.equal(s.object.state,'deleted');assert.equal(s.hold.state,'deleted');assert.equal(s.plan.status,'applied');assert.equal(s.run.status,'cleanup_pending');assert.equal(s.run.completed_at,null);
    assert.equal((await f.pool.query('SELECT SUM(consumed_units)::int AS n FROM searchad_daily_risk_capacity')).rows[0].n,3);
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_verification_evidence')).rows[0].n,2);
    assert.ok((await f.writer.getApproval(f.approval.approvalId)).used_at);
    assert.equal(f.config.allowDeletes,false);
    const before=await f.snapshot();assert.equal((await f.make(f.connect()).reconcile(f.observeInput,context)).state,'deleted');assert.deepEqual(await f.snapshot(),before);
    await assert.rejects(()=>f.make(f.connect()).execute(f.input,context));assert.equal(f.deletes,1);
  });
  await t.test('default OFF and exact caller scope reject without new persistence or I/O',async st=>{
    const f=await fixture(st);const before=await f.snapshot();
    for(const enabled of [false,undefined])await assert.rejects(()=>f.make(f.pool,{enabled}).prepare({...f.scope,activationId:f.deleteActivationId},context));
    for(const extra of [{remoteId:'victim'},{body:{}},{riskUnits:0},{customerId:'2002'},{hierarchyObjectId:'bad'}])await assert.rejects(()=>f.service.prepare({...f.scope,activationId:f.deleteActivationId,...extra},context));
    for(const principal of [null,{...context.principal,role:'reader'},{...context.principal,customerIds:[]}])await assert.rejects(()=>f.service.prepare({...f.scope,activationId:f.deleteActivationId},{principal}));
    assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  for(const [label,patch] of [['create scope',{operations:[OPS.campaign.create],lifecycle:['create']}],['passive',{type:'passive_capability'}],['failed',{result:'failed'}],['foreign',{customerId:'2002'}],['expired',{expiresAt:new Date(NOW-1).toISOString()}],['mutable fields',{fields:['campaign.dailyBudget']}]] ){
    await t.test(`delete authority rejects ${label}`,async st=>{const f=await fixture(st,{deletePatch:patch});const before=await f.snapshot();await assert.rejects(()=>f.prepare());assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);});
  }
  await t.test('missing approval, wrong token and both destructive confirmations fail before GET or consumption',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();const before=await f.snapshot();
    for(const patch of [{executionToken:'x'.repeat(43)},{planId:f.cp.planId},{confirmation:'yes'},{secondConfirmation:'victim'},{remoteId:f.remote.nccCampaignId}])await assert.rejects(()=>f.service.execute({...f.input,...patch},context));
    assert.equal(f.calls.length,0);assert.deepEqual(await f.snapshot(),before);
  });
  for(const [label,reply] of [['active',f=>response(200,{...f.remote,userLock:false})],['wrong ID',f=>response(200,{...f.remote,nccCampaignId:'victim'})],['wrong Customer',f=>response(200,{...f.remote,customerId:'2002'})],['wrong type',f=>response(200,{...f.remote,campaignTp:'SHOPPING'})],['missing',()=>response(404)],['outage',()=>response(503)]] ){
    await t.test(`pre-delete GET ${label} preserves approval and risk`,async st=>{const f=await fixture(st);await f.prepare();await f.approve();f.answer=()=>reply(f);const before=await f.snapshot();await assert.rejects(()=>f.service.execute(f.input,context));assert.equal(f.deletes,0);assert.deepEqual(await f.snapshot(),before);});
  }
  await t.test('children and substituted stored ID cannot acquire cleanup permission',async st=>{
    const f=await fixture(st);await f.pool.query("UPDATE searchad_hierarchy_objects SET remote_id='substitute' WHERE hierarchy_object_id=$1",[f.scope.hierarchyObjectId]);
    await f.pool.query("UPDATE searchad_remote_object_ownership SET remote_id='substitute' WHERE hierarchy_object_id=$1",[f.scope.hierarchyObjectId]);await assert.rejects(()=>f.prepare());assert.equal(f.calls.length,0);
  });
  await t.test('cross-Customer child added during preflight blocks DELETE and preserves unused token',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();f.answer=async()=>{
      await f.pool.query(`INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at) VALUES($1,$2,'2002','adgroup',$3,$4,$5,$6,'planned',now(),now())`,[randomUUID(),f.scope.hierarchyRunId,f.scope.hierarchyObjectId,OPS.adgroup.create,OPS.adgroup.read,OPS.adgroup.delete]);return response(200,f.remote);};
    await assert.rejects(()=>f.service.execute(f.input,context));assert.equal(f.deletes,0);assert.equal((await f.writer.getApproval(f.approval.approvalId)).used_at,null);
  });
  for(const table of ['searchad_risk_reservations','searchad_hierarchy_objects','searchad_remote_object_ownership','searchad_hierarchy_events','searchad_write_attempts']){
    await t.test(`dispatch failure at ${table} rolls back token, risk and pending states`,async st=>{
      const f=await fixture(st);await f.prepare();await f.approve();const before=await f.snapshot();
      await f.pool.query("CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$");
      await f.pool.query(`CREATE TRIGGER reject_cleanup BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_cleanup()`);
      await assert.rejects(()=>f.service.execute(f.input,context));assert.equal(f.deletes,0);assert.deepEqual(await f.snapshot(),before);
      await f.pool.query(`DROP TRIGGER reject_cleanup ON ${table}`);assert.equal((await f.service.execute(f.input,context)).state,'deleted');
    });
  }
  await t.test('two independent pools cannot send the same cleanup twice',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();const r=await Promise.allSettled([f.service.execute(f.input,context),f.make(f.connect()).execute(f.input,context)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.deletes,1);
  });
  await t.test('DELETE success without absence remains unknown and recovers read-only with writes OFF and account suspended',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();f.answer=m=>m==='DELETE'?response(204):response(200,f.remote);
    assert.equal((await f.service.execute(f.input,context)).state,'delete_unknown');await assert.rejects(()=>f.make(f.connect()).execute(f.input,context));
    f.config.allowActiveCanary=false;await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");f.answer=()=>response(404);
    assert.equal((await f.make(f.connect()).reconcile(f.observeInput,context)).state,'deleted');assert.equal(f.deletes,1);assert.equal((await f.state()).plan.status,'applied');
  });
  for(const code of [302,429,503]){
    await t.test(`DELETE ${code} does not retry or follow redirects; only GET confirms absence`,async st=>{const f=await fixture(st);await f.prepare();await f.approve();let post=false;f.answer=m=>{if(m==='DELETE'){post=true;return response(code);}return post?response(404):response(200,f.remote);};assert.equal((await f.service.execute(f.input,context)).state,'deleted');assert.equal(f.deletes,1);});
  }
  await t.test('post-delete read outage retains ID and hold for a later read-only recovery',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();let post=false;f.answer=m=>{if(m==='DELETE'){post=true;throw new Error('fixture-secret');}return post?response(503):response(200,f.remote);};
    assert.equal((await f.service.execute(f.input,context)).state,'delete_unknown');const s=await f.state();assert.equal(s.object.remote_id,f.remote.nccCampaignId);assert.equal(s.hold.remote_id,f.remote.nccCampaignId);
    assert.equal(JSON.stringify(await f.snapshot()).includes('fixture-secret'),false);f.answer=()=>response(404);assert.equal((await f.make(f.connect()).reconcile(f.observeInput,context)).state,'deleted');assert.equal(f.deletes,1);
  });
  for(const change of ['suspend','expire','rotate','gate']){
    await t.test(`${change} during preflight blocks before approval consumption`,async st=>{
      const f=await fixture(st);await f.prepare();await f.approve();f.answer=async()=>{if(change==='suspend')await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");if(change==='expire')f.now=NOW+400_000;if(change==='gate')f.config.allowActiveCanary=false;if(change==='rotate')f.credentials.principals.get('fixture-signer').secretKey='rotated';return response(200,f.remote);};
      await assert.rejects(()=>f.service.execute(f.input,context));assert.equal(f.deletes,0);assert.equal((await f.writer.getApproval(f.approval.approvalId)).used_at,null);
    });
  }

  function interceptedPool(pool, afterQuery, beforeQuery = async () => {}) {
    return {query:pool.query.bind(pool),async connect(){const c=await pool.connect();return {
      async query(sql,values){await beforeQuery(sql,values,c);const r=await c.query(sql,values);await afterQuery(sql,values,c);return r;},
      release:discard=>c.release(discard)
    };}};
  }
  await t.test('cleanup plan expiring during its audit transaction rolls back rather than returning an expired plan',async st=>{
    const f=await fixture(st);const before=await f.snapshot();
    const pool=interceptedPool(f.pool,async(sql,values)=>{if(String(sql).includes('INSERT INTO searchad_hierarchy_events')&&values?.includes('cleanup_plan'))f.now=NOW+360_000;});
    await assert.rejects(()=>f.make(pool).prepare({...f.scope,activationId:f.deleteActivationId},context));
    assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  await t.test('unapproved cleanup and a new plan for the same target are rejected without side effects',async st=>{
    const f=await fixture(st);const p=await f.prepare();const before=await f.snapshot();
    await assert.rejects(()=>f.service.execute({...f.scope,planId:p.planId,executionToken:'x'.repeat(43),confirmation:p.requiredConfirmation,secondConfirmation:p.requiredSecondConfirmation},context));
    await assert.rejects(()=>f.prepare());assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  await t.test('exhausted established shared capacity preserves the cleanup token',async st=>{
    const f=await fixture(st,{capacity:2});await f.prepare();await f.approve();const before=await f.snapshot();
    await assert.rejects(()=>f.service.execute(f.input,context));assert.deepEqual(await f.snapshot(),before);assert.equal(f.deletes,0);
  });
  await t.test('old stopped observation cannot be used after its bounded freshness interval',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();const before=await f.snapshot();f.answer=()=>{f.now=NOW+6000;return response(200,f.remote);};
    await assert.rejects(()=>f.service.execute(f.input,context));assert.deepEqual(await f.snapshot(),before);assert.equal(f.deletes,0);
  });
  await t.test('a changed persisted delete descriptor during preflight cannot be dispatched',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();f.answer=async()=>{await f.pool.query("UPDATE searchad_write_change_plans SET mutation_json='{}' WHERE plan_id=$1",[f.plan.planId]);return response(200,f.remote);};
    await assert.rejects(()=>f.service.execute(f.input,context));assert.equal(f.deletes,0);assert.equal((await f.writer.getApproval(f.approval.approvalId)).used_at,null);
  });
  for(const mode of ['before','after']){
    await t.test(`lost dispatch COMMIT ${mode} acknowledgement cannot return DELETE permission`,async st=>{
      const f=await fixture(st);await f.prepare();await f.approve();let claiming=false;
      const pool=interceptedPool(f.pool,async(sql,values)=>{if(String(sql).includes('INSERT INTO searchad_hierarchy_events')&&values?.includes('cleanup_dispatch_intent'))claiming=true;},
        async(sql,values,c)=>{if(String(sql)==='COMMIT'&&claiming){claiming=false;if(mode==='after')await c.query(sql,values);throw new Error('fixture-secret lost COMMIT');}});
      await assert.rejects(()=>f.make(pool).execute(f.input,context),e=>e.code==='SEARCHAD_CAMPAIGN_CLEANUP_COMMIT_UNKNOWN');assert.equal(f.deletes,0);
      if(mode==='after'){assert.ok((await f.writer.getApproval(f.approval.approvalId)).used_at);await assert.rejects(()=>f.make(f.connect()).execute(f.input,context));}
    });
  }
  for(const change of ['gate','credential']){
    await t.test(`${change} after acknowledged dispatch commit prevents DELETE without recycling consumed risk`,async st=>{
      const f=await fixture(st);await f.prepare();await f.approve();let claiming=false;
      const pool=interceptedPool(f.pool,async(sql,values)=>{
        if(String(sql).includes('INSERT INTO searchad_hierarchy_events')&&values?.includes('cleanup_dispatch_intent'))claiming=true;
        if(sql==='COMMIT'&&claiming){claiming=false;if(change==='gate')f.config.allowActiveCanary=false;else f.credentials.principals.get('fixture-signer').secretKey='rotated';}
      });
      await f.make(pool).execute(f.input,context).catch(e=>assert.match(e.code,/CONTEXT/));assert.equal(f.deletes,0);assert.ok((await f.writer.getApproval(f.approval.approvalId)).used_at);
      assert.equal((await f.pool.query("SELECT SUM(units)::int AS n FROM searchad_risk_reservations WHERE state='consumed'")).rows[0].n,3);
    });
  }
  await t.test('observation audit failure rolls back object, hold and applied cleanup plan together',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();
    await f.pool.query("CREATE FUNCTION reject_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='cleanup_observation' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END; $$");
    await f.pool.query('CREATE TRIGGER reject_observation BEFORE INSERT ON searchad_hierarchy_events FOR EACH ROW EXECUTE FUNCTION reject_observation()');
    await assert.rejects(()=>f.service.execute(f.input,context));const s=await f.state();assert.equal(s.object.state,'delete_pending');assert.equal(s.hold.state,'delete_unknown');assert.equal(s.plan.status,'unknown_outcome');
    await f.pool.query('DROP TRIGGER reject_observation ON searchad_hierarchy_events');assert.equal((await f.make(f.connect()).reconcile(f.observeInput,context)).state,'deleted');assert.equal(f.deletes,1);
  });
  await t.test('ownership change during absence GET cannot be overwritten by stale settlement',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();let post=false;
    f.answer=async m=>{if(m==='DELETE'){post=true;return response(204);}if(!post)return response(200,f.remote);
      await f.pool.query("UPDATE searchad_remote_object_ownership SET state='manual_review' WHERE hierarchy_object_id=$1",[f.scope.hierarchyObjectId]);return response(404);};
    await assert.rejects(()=>f.service.execute(f.input,context));assert.equal((await f.state()).hold.state,'manual_review');assert.equal((await f.state()).object.state,'delete_pending');assert.equal(f.deletes,1);
  });
  await t.test('malformed post-delete GET requires manual review, not an applied cleanup',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();let post=false;f.answer=m=>{if(m==='DELETE'){post=true;return response(204);}return response(200,post?{}:f.remote);};
    assert.equal((await f.service.execute(f.input,context)).state,'manual_review');assert.equal((await f.state()).plan.status,'manual_review');assert.equal(f.deletes,1);await assert.rejects(()=>f.service.execute(f.input,context));
  });
  await t.test('approval expiration after an actual capacity row-lock wait rolls back the claim',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();const before=await f.snapshot();const lock=await f.connect().connect();
    let execution;let locked=true;
    try {
      await lock.query('BEGIN');await lock.query("SELECT * FROM searchad_daily_risk_capacity WHERE customer_id='1001' FOR UPDATE");
      execution=f.make(f.connect()).execute(f.input,context).then(value=>({value}),error=>({error}));
      let waiting=false;const deadline=Date.now()+5000;
      while(Date.now()<deadline){
        waiting=(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM searchad_daily_risk_capacity%'")).rowCount>0;
        if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'cleanup must actually wait for the held PostgreSQL capacity row');f.now=NOW+400_000;
      await lock.query('ROLLBACK');locked=false;const result=await execution;assert.match(result.error?.code??'',/EXPIRED/);
      assert.equal(f.deletes,0);assert.deepEqual(await f.snapshot(),before);
    } finally {if(locked)await lock.query('ROLLBACK');lock.release();if(execution)await execution;}
  });
  await t.test('send-result audit failure retains the durable intent and permits GET-only recovery',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();
    await f.pool.query("CREATE FUNCTION reject_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='cleanup_result' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END; $$");
    await f.pool.query('CREATE TRIGGER reject_result BEFORE INSERT ON searchad_hierarchy_events FOR EACH ROW EXECUTE FUNCTION reject_result()');
    await assert.rejects(()=>f.service.execute(f.input,context));assert.equal(f.deletes,1);assert.equal((await f.state()).object.state,'delete_pending');
    assert.ok((await f.writer.getApproval(f.approval.approvalId)).used_at);await assert.rejects(()=>f.make(f.connect()).execute(f.input,context));
    assert.equal((await f.make(f.connect()).reconcile(f.observeInput,context)).state,'deleted');assert.equal(f.deletes,1);
  });
  await t.test('caller scope and actor edits during pool acquisition cannot replace the copied request',async st=>{
    const f=await fixture(st);await f.prepare();await f.approve();const input=f.input,ctx=structuredClone(context);let changed=false;
    const wrapped={query:f.pool.query.bind(f.pool),async connect(){if(!changed){changed=true;input.customerId='2002';input.secondConfirmation='victim';ctx.principal.principalId='forged';}return f.pool.connect();}};
    assert.equal((await f.make(wrapped).execute(input,ctx)).state,'deleted');assert.equal(f.deletes,1);
    const e=(await f.pool.query("SELECT details_json FROM searchad_hierarchy_events WHERE phase='cleanup_dispatch_intent'")).rows[0];assert.equal(e.details_json.actorPrincipalId,context.principal.principalId);
  });
});
