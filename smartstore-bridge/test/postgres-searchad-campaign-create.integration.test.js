import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { PostgresSearchAdWriteRepository as Writer } from '../src/naver/searchad/write/postgres-repository.js';
import { PostgresSearchAdLifecycleRepository as Storage } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const now = Date.parse('2026-09-13T00:00:00Z');
const logger = { info() {}, warn() {}, error() {} };
const origin = 'https://api.searchad.naver.com';
const context = { principal: { principalId: 'fixture-admin', role: 'admin', customerIds: ['1001'] } };
const fields = ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];

// Actual PG, existing approval/dispatch coordinator, real registry/credentials/
// Gateway/signing client. Only fetch responses and immutable evidence are fixtures.
test('bounded campaign prepare and single create transport with real PostgreSQL', { timeout: 180000 }, async t => {
  assert.ok(fs.existsSync(path.resolve('src/naver/searchad/lifecycle/campaign-create-service.js')), 'Missing bounded campaign create service');
  const { CampaignCreateService } = await import('../src/naver/searchad/lifecycle/campaign-create-service.js');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { assert.notEqual(process.env.CI,'true','CI requires real PostgreSQL'); return t.skip('Local PostgreSQL unavailable'); }
  const admin = createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const saved = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('Uninjected external transport'); };
  t.after(async () => { globalThis.fetch=saved; await closePostgresPool(admin); assert.equal(escaped,0); });

  async function fixture(st, { invalidScope = false } = {}) {
    const schema = `create_${randomUUID().replaceAll('-','')}`;
    const pools = new Set(); let created=false; let time=now;
    st.after(async () => { try { await Promise.all([...pools].map(closePostgresPool)); } finally { if(created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } });
    await admin.query(`CREATE SCHEMA "${schema}"`); created=true;
    const scoped=new URL(url); scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);
    function connect() { const p=createPostgresPool({connectionString:scoped.toString(),sslMode:'disable',logger}); pools.add(p); return p; }
    const pool=connect(); await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
    const registry=loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
    const credentials=new SearchAdCredentialsRegistry({principals:[{principalId:'fixture-api',accessLicense:'fixture-key',secretKey:'fixture-secret',status:'active'}],customers:[{customerId:'1001',status:'active'}],grants:[{principalId:'fixture-api',customerId:'1001',role:'admin'}]});
    const identity={specSha:registry.status().specRef,credentialFingerprint:credentialFingerprintForCustomer(credentials,'1001'),upstreamBaseUrl:origin};
    const activationId=randomUUID(), evidenceId=`synthetic-${randomUUID()}`;
    const scope=invalidScope?[]:fields;
    await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at)
      VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,'["create"]','verified',$7,$8)`,[evidenceId,identity.specSha,identity.credentialFingerprint,origin,JSON.stringify([OPS.campaign.create]),JSON.stringify(scope),new Date(now-1000),new Date(now+600000)]);
    await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at)
      VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,'["create"]','fixture-approver',$8,$9)`,[activationId,evidenceId,identity.specSha,identity.credentialFingerprint,origin,JSON.stringify([OPS.campaign.create]),JSON.stringify(scope),new Date(now-1000),new Date(now+600000)]);
    const config={enabled:true,configured:true,baseUrl:origin,allowReads:true,allowWrites:false,allowCreates:false,allowDeletes:false,allowBatchWrites:false,allowRollbacks:false,allowUnverifiedOperations:false,allowActiveCanary:true,automationMode:'observe'};
    const calls=[]; let assertions=0; let remote=null;
    let responder=async (u,init) => {
      if(init.method==='POST') { remote={...JSON.parse(init.body),customerId:1001,nccCampaignId:`cmp-${randomUUID()}`}; return new Response(JSON.stringify(remote),{status:200,headers:{'content-type':'application/json'}}); }
      assert.equal(init.method,'GET'); return new Response(JSON.stringify(remote),{status:200,headers:{'content-type':'application/json'}});
    };
    const fetchImpl=async(u,init) => {
      calls.push({url:String(u),method:init.method,body:init.body?JSON.parse(init.body):null});
      try {
        const address=new URL(u); assert.equal(address.origin,origin); assert.equal(address.search,''); assert.equal(init.redirect,'error');
        assert.equal(init.headers['X-Customer'],'1001'); assert.equal(init.headers['X-API-KEY'],'fixture-key');
        const secret=credentials.resolve('1001').secretKey;
        assert.equal(init.headers['X-Signature'],createHmac('sha256',secret).update(`${init.headers['X-Timestamp']}.${init.method}.${address.pathname}`).digest('base64'));
        if(init.method==='POST') assert.equal(address.pathname,'/ncc/campaigns');
        else { assert.equal(init.method,'GET'); assert.equal(address.pathname,`/ncc/campaigns/${remote.nccCampaignId}`); }
      } catch(e) { assertions++; throw e; }
      try { return await responder(u,init); } catch(e) { if(e?.code==='ERR_ASSERTION') assertions++; throw e; }
    };
    st.after(()=>{assert.equal(assertions,0,'Transport assertions must not be swallowed as outages');});
    const normal=responder;
    const make=(p=pool,options={})=>new CampaignCreateService({pool:p,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:2,dailyCapacityUnits:5,planTtlSeconds:300,clock:()=>time,fetchImpl,logger,...options});
    const writer=new Writer({pool}),storage=new Storage({pool});
    const prepare=()=>make().prepare({customerId:'1001',activationId},context);
    const approve=async p=>new SearchAdApprovalService({repository:writer,config:{approvalTtlSeconds:300},clock:()=>time}).approve(p.planId,{actor:'fixture-approver',confirmation:'APPROVE_SEARCHAD_CHANGE'});
    return {pool,make,connect,config,credentials,registry,identity,writer,storage,activationId,calls,prepare,approve,normal,
      set time(value){time=value;},get remote(){return remote;},set remote(value){remote=value;},set responder(value){responder=value;},
      async approved(){const p=await prepare(); const a=await approve(p); return {...p,executionToken:a.executionToken};},
      input(p){return {customerId:'1001',hierarchyRunId:p.hierarchyRunId,hierarchyObjectId:p.hierarchyObjectId,planId:p.planId,executionToken:p.executionToken};},
      async counts(){const out={};for(const table of ['searchad_hierarchy_canary_runs','searchad_hierarchy_objects','searchad_write_change_plans','searchad_write_approvals','searchad_risk_reservations','searchad_remote_object_ownership'])out[table]=Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);return out;}
    };
  }

  await t.test('server prepare is atomic, stopped, unapproved and compatible with the existing approval service',async st=>{
    const f=await fixture(st); const p=await f.prepare(); const plan=await f.writer.getPlan(p.planId);
    assert.equal(plan.status,'planned'); assert.equal(plan.created_by,context.principal.principalId);
    assert.deepEqual(plan.mutation_json.body,{campaignTp:'WEB_SITE',name:`HAAR_HIERARCHY_${p.hierarchyRunId}`,userLock:true,dailyBudget:1000});
    assert.deepEqual(plan.read_json,{}); assert.equal(plan.rollback_json,null); assert.equal(f.calls.length,0);
    const n=await f.counts();assert.equal(n.searchad_write_approvals,0);assert.equal(n.searchad_risk_reservations,0);assert.equal(n.searchad_remote_object_ownership,0);
    const a=await f.approve(p);assert.equal(a.oneTime,true);assert.equal((await f.writer.getPlan(p.planId)).status,'approved');
  });

  await t.test('prepare approve execute uses exactly one signed POST then GET and retains ownership without Canary PASS',async st=>{
    const f=await fixture(st); const p=await f.approved(); const r=await f.make().execute(f.input(p),context);
    assert.equal(r.state,'owned');assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
    const o=await f.storage.getObject(p.hierarchyObjectId,'1001');assert.equal(o.remoteId,f.remote.nccCampaignId);assert.equal(o.state,'owned');
    assert.equal((await f.writer.getPlan(p.planId)).status,'applied');assert.equal((await f.storage.getRun(p.hierarchyRunId,'1001')).status,'cleanup_pending');
    assert.equal((await f.storage.getOwnership({customerId:'1001',objectType:'campaign',remoteId:o.remoteId})).state,'owned');
    assert.equal((await f.storage.getDailyRiskCapacity('1001','2026-09-13')).consumedUnits,2);
    await assert.rejects(()=>f.make(f.connect()).execute(f.input(p),context));assert.equal(f.calls.length,2);
    for(const key of ['allowWrites','allowCreates','allowDeletes','allowBatchWrites','allowRollbacks'])assert.equal(f.config[key],false);
  });

  for(const enabled of [false,undefined])await t.test(`disabled service (${enabled}) cannot prepare or execute`,async st=>{
    const f=await fixture(st),before=await f.counts();
    await assert.rejects(()=>f.make(f.pool,{enabled}).prepare({customerId:'1001',activationId:f.activationId},context));
    await assert.rejects(()=>f.make(f.pool,{enabled}).execute({},context));assert.deepEqual(await f.counts(),before);assert.equal(f.calls.length,0);
  });
  await t.test('strict prepare scope rejects roles, foreign activations and all caller execution overrides',async st=>{
    const f=await fixture(st),before=await f.counts(),base={customerId:'1001',activationId:f.activationId};
    for(const principal of [undefined,{...context.principal,role:'reader'},{...context.principal,customerIds:['2002']},{...context.principal,principalId:'  forged '}])await assert.rejects(()=>f.make().prepare(base,{principal}));
    for(const key of ['remoteId','dailyBudget','createdBy','body','executionToken','evidence'])await assert.rejects(()=>f.make().prepare({...base,[key]:'injected'},context));
    await assert.rejects(()=>f.make().prepare({...base,activationId:randomUUID()},context));
    assert.deepEqual(await f.counts(),before);assert.equal(f.calls.length,0);
  });
  await t.test('old update-only field scope cannot produce a creation plan',async st=>{
    const f=await fixture(st,{invalidScope:true}),before=await f.counts();await assert.rejects(()=>f.prepare());assert.deepEqual(await f.counts(),before);
  });
  await t.test('prepare audit failure rolls back the run, object, plan and hierarchy event together',async st=>{
    const f=await fixture(st),before=await f.counts();
    await f.pool.query("CREATE FUNCTION reject_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$");
    await f.pool.query('CREATE TRIGGER reject_plan BEFORE INSERT ON searchad_write_attempts FOR EACH ROW EXECUTE FUNCTION reject_plan()');
    await assert.rejects(()=>f.prepare());assert.deepEqual(await f.counts(),before);assert.equal((await f.pool.query('SELECT * FROM searchad_hierarchy_events')).rowCount,0);
  });
  await t.test('concurrent prepares cannot establish two unresolved runs for one Customer',async st=>{
    const f=await fixture(st),input={customerId:'1001',activationId:f.activationId};
    const results=await Promise.allSettled([f.make().prepare(input,context),f.make(f.connect()).prepare(input,context)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.counts()).searchad_write_change_plans,1);assert.equal(f.calls.length,0);
  });
  await t.test('unapproved plan, invalid token and wrong execution principal cannot consume risk or send',async st=>{
    const f=await fixture(st),p=await f.prepare();const input=f.input({...p,executionToken:'a'.repeat(43)});
    await assert.rejects(()=>f.make().execute(input,context));const a=await f.approve(p);
    await assert.rejects(()=>f.make().execute(input,context));
    await assert.rejects(()=>f.make().execute({...input,executionToken:a.executionToken},{principal:{...context.principal,role:'reader'}}));
    assert.equal((await f.writer.getApproval(a.approvalId)).used_at,null);assert.equal((await f.counts()).searchad_risk_reservations,0);assert.equal(f.calls.length,0);
  });

  for(const key of ['allowActiveCanary','allowReads'])await t.test(`${key} OFF blocks before approval consumption`,async st=>{
    const f=await fixture(st),p=await f.approved();f.config[key]=false;
    await assert.rejects(()=>f.make().execute(f.input(p),context));assert.equal((await f.counts()).searchad_risk_reservations,0);assert.equal(f.calls.length,0);
    assert.equal((await f.pool.query('SELECT used_at FROM searchad_write_approvals')).rows[0].used_at,null);
  });
  await t.test('two independent service/pool executions and later reconstruction never send the same create twice',async st=>{
    const f=await fixture(st),p=await f.approved();const input=f.input(p);
    const r=await Promise.allSettled([f.make().execute(input,context),f.make(f.connect()).execute(input,context)]);
    assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.deepEqual(f.calls.map(x=>x.method),['POST','GET']);
    await assert.rejects(()=>f.make(f.connect()).execute(input,context));assert.equal(f.calls.length,2);
  });
  for(const status of [429,503,302,204])await t.test(`POST ${status} never retries or invents an owned campaign`,async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async()=>new Response(status===204?null:JSON.stringify({code:'fixture',message:'secret-upstream-error'}),{status,headers:{'content-type':'application/json'}});
    const r=await f.make().execute(f.input(p),context);assert.ok(['create_unknown','manual_review'].includes(r.state));
    assert.deepEqual(f.calls.map(c=>c.method),['POST']);assert.equal((await f.counts()).searchad_remote_object_ownership,0);
    await assert.rejects(()=>f.make().execute(f.input(p),context));assert.equal(f.calls.length,1);assert.equal((await f.storage.getDailyRiskCapacity('1001','2026-09-13')).consumedUnits,2);
  });
  await t.test('POST transport outage is unresolved and never blindly replayed',async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async()=>{throw new Error('secret-network-error');};
    assert.equal((await f.make().execute(f.input(p),context)).state,'create_unknown');await assert.rejects(()=>f.make().execute(f.input(p),context));assert.equal(f.calls.length,1);
  });
  for(const [label,patch] of [['wrong Customer',{customerId:2002}],['wrong type',{campaignTp:'SHOPPING'}],['active campaign',{userLock:false}],['wrong name',{name:'unrelated'}],['budget coercion',{dailyBudget:'1000'}],['missing ID',{nccCampaignId:null}],['unsafe ID',{nccCampaignId:'../../other'}],['child-shaped response',{nccAdgroupId:'unrelated'}]])await t.test(`POST ${label} cannot establish ownership or trigger verification on a guessed target`,async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async(u,i)=>{const resp=await f.normal(u,i);const d=await resp.json();return new Response(JSON.stringify({...d,...patch}),{headers:{'content-type':'application/json'}});};
    assert.equal((await f.make().execute(f.input(p),context)).state,'manual_review');assert.equal(f.calls.length,1);assert.equal((await f.counts()).searchad_remote_object_ownership,0);assert.equal((await f.storage.getObject(p.hierarchyObjectId)).remoteId,null);
  });
  await t.test('ID and ownership are committed before GET; a GET outage preserves them across a new pool',async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async(u,i)=>{
      if(i.method==='POST')return f.normal(u,i);
      const o=await f.storage.getObject(p.hierarchyObjectId);assert.equal(o.remoteId,f.remote.nccCampaignId);assert.equal((await f.counts()).searchad_remote_object_ownership,1);
      return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
    };
    const r=await f.make().execute(f.input(p),context);assert.equal(r.state,'create_unknown');const store=new Storage({pool:f.connect()});assert.equal((await store.getObject(p.hierarchyObjectId)).remoteId,f.remote.nccCampaignId);
    await assert.rejects(()=>f.make(f.connect()).execute(f.input(p),context));assert.deepEqual(f.calls.map(x=>x.method),['POST','GET']);
  });
  for(const [label,patch] of [['ID',{nccCampaignId:'other'}],['Customer',{customerId:2002}],['stopped flag',{userLock:false}]])await t.test(`GET changed ${label} cannot promote ownership or replace the create-returned ID`,async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async(u,i)=>{const r=await f.normal(u,i);return i.method==='POST'?r:new Response(JSON.stringify({...await r.json(),...patch}),{headers:{'content-type':'application/json'}});};
    const r=await f.make().execute(f.input(p),context);assert.equal(r.state,'manual_review');assert.equal(r.remoteId,f.remote.nccCampaignId);assert.equal((await f.writer.getPlan(p.planId)).status,'manual_review');assert.equal((await f.storage.getOwnership({customerId:'1001',objectType:'campaign',remoteId:r.remoteId})).state,'manual_review');
  });
  for(const table of ['searchad_remote_object_ownership','searchad_hierarchy_events','searchad_write_attempts'])await t.test(`capture failure at ${table} cannot leave half-recorded returned ID/ownership`,async st=>{
    const f=await fixture(st),p=await f.approved();
    const condition=table==='searchad_remote_object_ownership'?'true':"NEW.phase='create_result'";
    await f.pool.query(`CREATE FUNCTION reject_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END; $$`);
    await f.pool.query(`CREATE TRIGGER reject_capture BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_capture()`);
    await assert.rejects(()=>f.make().execute(f.input(p),context));const o=await f.storage.getObject(p.hierarchyObjectId);assert.equal(o.remoteId,null);assert.equal(o.state,'dispatching');assert.equal((await f.counts()).searchad_remote_object_ownership,0);assert.equal(f.calls.length,1);
    await assert.rejects(()=>f.make().execute(f.input(p),context));assert.equal(f.calls.length,1);
  });
  await t.test('ownership collision never overwrites an existing owner after POST',async st=>{
    const f=await fixture(st),p=await f.approved();await f.storage.holdOwnership({ownershipId:randomUUID(),customerId:'1001',objectType:'campaign',remoteId:'existing',ownerKind:'hierarchy_canary',ownerRunId:randomUUID(),createdOperationKey:OPS.campaign.create,state:'owned',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()});
    f.responder=async(u,i)=>{const r=await f.normal(u,i);const d=await r.json();f.remote={...d,nccCampaignId:'existing'};return new Response(JSON.stringify(f.remote),{headers:{'content-type':'application/json'}});};
    await assert.rejects(()=>f.make().execute(f.input(p),context));assert.equal((await f.counts()).searchad_remote_object_ownership,1);assert.equal((await f.storage.getObject(p.hierarchyObjectId)).remoteId,null);assert.equal(f.calls.length,1);
  });
  await t.test('an ownership change while GET is in flight invalidates settlement instead of overwriting it',async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async(u,i)=>{if(i.method==='GET')await f.pool.query("UPDATE searchad_remote_object_ownership SET state='delete_unknown'");return f.normal(u,i);};
    await assert.rejects(()=>f.make().execute(f.input(p),context),{code:'SEARCHAD_CAMPAIGN_CREATE_STALE'});assert.equal((await f.storage.getObject(p.hierarchyObjectId)).state,'create_unknown');assert.equal((await f.pool.query('SELECT state FROM searchad_remote_object_ownership')).rows[0].state,'delete_unknown');
  });
  function commitHook(pool,hook){let commits=0;return {query:pool.query.bind(pool),async connect(){const c=await pool.connect();return{async query(text,values){if(text==='COMMIT')return hook(++commits,()=>c.query(text,values));return c.query(text,values);},release:c.release.bind(c)};}};}
  for(const change of ['suspend','credential','gate','expire'])await t.test(`${change} after token/risk commit prevents a later POST`,async st=>{
    const f=await fixture(st),p=await f.approved();const pool=commitHook(f.pool,async(n,commit)=>{const r=await commit();if(n===1){if(change==='suspend')await f.pool.query('UPDATE searchad_canary_accounts SET suspended=true');if(change==='credential')f.credentials.resolve('1001');if(change==='credential')f.credentials.principals.get('fixture-api').secretKey='rotated';if(change==='gate')f.config.allowActiveCanary=false;if(change==='expire')f.time=now+301000;}return r;});
    await assert.rejects(()=>f.make(pool).execute(f.input(p),context));assert.equal(f.calls.length,0);assert.equal((await f.storage.getDailyRiskCapacity('1001','2026-09-13')).consumedUnits,2);await assert.rejects(()=>f.make().execute(f.input(p),context));
  });
  for(const mode of ['before','after'])await t.test(`handoff COMMIT ${mode}-ack failure never yields a POST permission`,async st=>{
    const f=await fixture(st),p=await f.approved();const pool=commitHook(f.pool,async(n,commit)=>{if(n===2){if(mode==='after')await commit();throw new Error('lost commit acknowledgement');}return commit();});
    await assert.rejects(()=>f.make(pool).execute(f.input(p),context),{code:'SEARCHAD_CAMPAIGN_CREATE_COMMIT_UNKNOWN'});assert.equal(f.calls.length,0);await assert.rejects(()=>f.make().execute(f.input(p),context));assert.equal(f.calls.length,0);
    assert.equal((await f.pool.query("SELECT * FROM searchad_hierarchy_events WHERE phase='transport_intent'")).rowCount,mode==='after'?1:0);
  });
  await t.test('rotation after POST records the returned ID but performs no new GET or ownership promotion',async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async(u,i)=>{const r=await f.normal(u,i);f.credentials.principals.get('fixture-api').secretKey='rotated';return r;};
    const r=await f.make().execute(f.input(p),context);assert.equal(r.state,'manual_review');assert.equal(r.remoteId,f.remote.nccCampaignId);assert.deepEqual(f.calls.map(c=>c.method),['POST']);
  });
  await t.test('response metadata and errors never leak into bounded audit/plan output',async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async(u,i)=>{const r=await f.normal(u,i);return new Response(JSON.stringify({...await r.json(),secret:'secret-body',token:p.executionToken}),{headers:{'content-type':'application/json','x-request-id':'secret-request-id'}});};
    const r=await f.make().execute(f.input(p),context);assert.equal(r.state,'owned');const text=JSON.stringify([r,await f.writer.getPlan(p.planId),await f.writer.listAttempts(p.planId),await f.storage.listEvents(p.hierarchyRunId,'1001')]);assert.equal(text.includes('secret-'),false);assert.equal(text.includes(p.executionToken),false);
  });
  await t.test('risk-date rebinding after dispatch commit is rejected before POST',async st=>{
    const f=await fixture(st),p=await f.approved();const pool=commitHook(f.pool,async(n,commit)=>{const r=await commit();if(n===1){await f.pool.query("INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at) VALUES('1001','2026-09-12',5,0,0,now())");await f.pool.query("UPDATE searchad_risk_reservations SET risk_date='2026-09-12'");}return r;});
    await assert.rejects(()=>f.make(pool).execute(f.input(p),context));assert.equal(f.calls.length,0);
  });

  await t.test('credential rotation during GET preserves the ID and blocks ownership promotion',async st=>{
    const f=await fixture(st),p=await f.approved();f.responder=async(u,i)=>{const r=await f.normal(u,i);if(i.method==='GET')f.credentials.principals.get('fixture-api').secretKey='rotated-during-read';return r;};
    const r=await f.make().execute(f.input(p),context);assert.equal(r.state,'manual_review');assert.equal(r.remoteId,f.remote.nccCampaignId);assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
  });
  for(const change of ['credential','gate'])await t.test(`${change} after handoff acknowledgement is checked synchronously before POST`,async st=>{
    const f=await fixture(st),p=await f.approved();const pool=commitHook(f.pool,async(n,commit)=>{const r=await commit();if(n===2){if(change==='credential')f.credentials.principals.get('fixture-api').secretKey='rotated';else f.config.allowActiveCanary=false;}return r;});
    const r=await f.make(pool).execute(f.input(p),context);assert.equal(r.state,'create_unknown');assert.equal(f.calls.length,0);assert.equal((await f.writer.getPlan(p.planId)).status,'unknown_outcome');
  });
  await t.test('mutating caller input during an awaited connection cannot replace the server-copied scope or actor',async st=>{
    const f=await fixture(st),p=await f.approved(),input=f.input(p),ctx=structuredClone(context);let changed=false;
    const pool={query:f.pool.query.bind(f.pool),async connect(){if(!changed){changed=true;input.customerId='2002';input.executionToken='forged';ctx.principal.role='reader';}return f.pool.connect();}};
    const r=await f.make(pool).execute(input,ctx);assert.equal(r.state,'owned');assert.equal(r.customerId,'1001');assert.equal(f.calls[0].body.userLock,true);
  });

});
