import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { PostgresSearchAdActivationRepository } from '../src/naver/searchad/activation/postgres-repository.js';
import { SearchAdAccountControlService } from '../src/naver/searchad/activation/account-control-service.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { SiblingCreateService } from '../src/naver/searchad/lifecycle/sibling-create-service.js';
import { CampaignCleanupService } from '../src/naver/searchad/lifecycle/campaign-cleanup-service.js';
import { ChildFirstCleanupService } from '../src/naver/searchad/lifecycle/child-first-cleanup-service.js';
import { ADGROUP_CREATE_FIELDS } from '../src/naver/searchad/lifecycle/adgroup-create-contract.js';
import { KEYWORD_FIELDS, CREATIVE_FIELDS } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const NOW=Date.parse('2026-09-29T14:00:00Z'), ORIGIN='https://api.searchad.naver.com';
const context={principal:{principalId:'fence-admin',role:'admin',customerIds:['1001','1002']}};
const logger={info(){},warn(){},error(){}};
const response=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const code=error=>{assert.match(error.code??'',/^SEARCHAD_/);return true;};

// All suspension operations use the actual account-control service/repository.
// Upstream replies and initial authority rows are explicitly synthetic fixtures.
test('account suspension and lifecycle transport initiation share one PostgreSQL ordering boundary',{timeout:180_000},async t=>{
  assert.ok(process.env.TEST_DATABASE_URL,'Real PostgreSQL required; no silent skip');
  const admin=createPostgresPool({connectionString:process.env.TEST_DATABASE_URL,sslMode:'disable',logger});
  const originalFetch=globalThis.fetch;let escaped=0;
  globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  t.after(async()=>{globalThis.fetch=originalFetch;await closePostgresPool(admin);assert.equal(escaped,0);});
  async function fixture(st){
    const schema=`send_fence_${randomUUID().replaceAll('-','')}`,pools=new Set();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    st.after(async()=>{try{await Promise.all([...pools].map(closePostgresPool));}finally{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}});
    const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);
    const connect=()=>{const p=createPostgresPool({connectionString:url.toString(),sslMode:'disable',logger});pools.add(p);return p;};
    const pool=connect();await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
    await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false),('1002',false)");
    const registry=loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
    const credentials=new SearchAdCredentialsRegistry({principals:[{principalId:'fixture-signer',accessLicense:'fixture-license',secretKey:'fixture-secret',status:'active'}],customers:[{customerId:'1001',status:'active'}],grants:[{principalId:'fixture-signer',customerId:'1001',role:'admin'}]});
    const config={enabled:true,configured:true,baseUrl:ORIGIN,allowReads:true,allowActiveCanary:true,allowWrites:false,allowCreates:false,allowDeletes:false,allowBatchWrites:false,allowRollbacks:false,allowUnverifiedOperations:false};
    const controls=p=>new SearchAdAccountControlService({repository:new PostgresSearchAdActivationRepository({pool:p}),clock:()=>NOW});
    const account=controls(connect()),f={pool,connect,controls,account,config,now:NOW,arm:null,hits:0,calls:[],errors:[],remote:new Map()};
    async function grant(type,kind){
      const id=randomUUID(),evidence=`fixture-${randomUUID()}`;
      const fields=kind==='delete'?[]:type==='campaign'?['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget']:type==='adgroup'?ADGROUP_CREATE_FIELDS:type==='keyword'?KEYWORD_FIELDS:CREATIVE_FIELDS;
      const common=['active_canary','1001',registry.status().specRef,credentialFingerprintForCustomer(credentials,'1001'),ORIGIN,JSON.stringify([OPS[type][kind]]),JSON.stringify(fields),JSON.stringify([type==='keyword'&&kind==='create'?'batch_create':kind])];
      const times=[new Date(NOW-1000).toISOString(),new Date(NOW+3600000).toISOString()];
      await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'verified',$10,$11)`,[evidence,...common,...times]);
      await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'fixture',$11,$12)`,[id,evidence,...common,...times]);return id;
    }
    const fetchImpl=async(url,init)=>{
      const u=new URL(url),headers=new Headers(init.headers);f.calls.push({method:init.method,path:u.pathname});
      try{
        assert.equal(u.origin,ORIGIN);assert.equal(init.redirect,'error');assert.equal(headers.get('X-Customer'),'1001');
        assert.equal(headers.get('X-Signature'),createHmac('sha256',credentials.resolve('1001').secretKey).update(`${headers.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));
        if(init.method==='POST'){
          const body=JSON.parse(init.body),segment=u.pathname.split('/').at(-1),idKey={campaigns:'nccCampaignId',adgroups:'nccAdgroupId',keywords:'nccKeywordId',ads:'nccAdId'}[segment];assert.ok(idKey);
          const make=x=>{const row={...x,customerId:'1001',[idKey]:`remote-${randomUUID()}`};f.remote.set(`${u.pathname}/${row[idKey]}`,row);return row;};
          return response(Array.isArray(body)?body.map(make):make(body));
        }
        if(init.method==='DELETE'){f.remote.delete(u.pathname);return response(null,204);}
        assert.equal(init.method,'GET');return f.remote.has(u.pathname)?response(f.remote.get(u.pathname)):response({},404);
      }catch(e){f.errors.push(e.message);throw e;}
    };
    st.after(()=>assert.deepEqual(f.errors,[],'Transport assertions cannot be swallowed'));
    // Reproduce the exact old gap: real claim COMMIT completes, then the real
    // separate account service commits suspension before execute resumes.
    const hookedPool={query:pool.query.bind(pool),async connect(){const c=await pool.connect();return {release:c.release.bind(c),async query(sql,args){
      let trigger=false;
      if(sql==='COMMIT'&&f.arm){
        const used=(await c.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1',[f.arm.planId])).rows.some(a=>a.used_at!==null);
        const sentIntent=!f.arm.rootCreate||(await c.query("SELECT 1 FROM searchad_write_attempts WHERE plan_id=$1 AND phase='transport_intent'",[f.arm.planId])).rowCount>0;
        trigger=used&&sentIntent;
      }
      const r=await c.query(sql,args);
      if(trigger){f.arm=null;f.hits++;await account.suspend('1001',context);}
      return r;
    }};}};
    const args={pool:hookedPool,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:300,preflightMaxAgeMs:5000,clock:()=>f.now,fetchImpl,logger};
    const approvals=new SearchAdApprovalService({repository:new PostgresSearchAdWriteRepository({pool}),config:{approvalTtlSeconds:300},clock:()=>f.now});
    async function readyCreate(type,parent){
      const service=type==='campaign'?new CampaignCreateService(args):type==='adgroup'?new AdgroupCreateService(args):new SiblingCreateService({...args,keywordTexts:['haar-fence-one','haar-fence-two']});
      const activationId=await grant(type,'create');
      const input=type==='campaign'?{customerId:'1001',activationId}:{customerId:'1001',hierarchyRunId:parent.hierarchyRunId,parentObjectId:parent.hierarchyObjectId,activationId};
      const plan=type==='keyword'?await service.prepareKeywords(input,context):type==='creative'?await service.prepareCreative(input,context):await service.prepare(input,context);
      const approval=await approvals.approve(plan.planId,{actor:'fence-admin',confirmation:'APPROVE_SEARCHAD_CHANGE'});
      const request={customerId:'1001',hierarchyRunId:plan.hierarchyRunId,planId:plan.planId,executionToken:approval.executionToken};
      if(type==='campaign'||type==='adgroup')request.hierarchyObjectId=plan.hierarchyObjectId;
      if(type!=='campaign')request.parentObjectId=parent.hierarchyObjectId;
      if(type==='keyword'||type==='creative')request.kind=type==='keyword'?'keywords':'creative';
      return {service,plan,request,approval};
    }
    async function create(type,parent){const r=await readyCreate(type,parent);const owned=await r.service.execute(r.request,context);assert.equal(owned.state,'owned');return owned;}
    async function target(type,kind){
      if(kind==='create'&&type==='campaign')return readyCreate('campaign');
      const root=await create('campaign');
      let node=root;
      if(type!=='campaign'){
        if(type==='adgroup'&&kind==='create')return readyCreate('adgroup',root);
        const group=await create('adgroup',root);node=group;
        if(type!=='adgroup'){
          if(kind==='create')return readyCreate(type,group);
          const leaf=await create(type,group);node={...leaf,hierarchyObjectId:leaf.hierarchyObjectIds[0]};
        }
      }
      const service=type==='campaign'?new CampaignCleanupService(args):new ChildFirstCleanupService(args);
      const activationId=await grant(type,'delete');
      const input={customerId:'1001',hierarchyRunId:node.hierarchyRunId,hierarchyObjectId:node.hierarchyObjectId};
      const plan=await service.prepare({...input,activationId},context),approval=await approvals.approve(plan.planId,{actor:'fence-admin',confirmation:'APPROVE_SEARCHAD_CHANGE'});
      return {service,plan,approval,request:{...input,planId:plan.planId,executionToken:approval.executionToken,confirmation:plan.requiredConfirmation,secondConfirmation:plan.requiredSecondConfirmation}};
    }
    return Object.assign(f,{target,grant});
  }

  for(const kind of ['create','delete'])for(const type of ['campaign','adgroup','keyword','creative']){
    await t.test(`${type} ${kind}: committed suspension after claim prevents transport, keeps consumed risk, and never replays`,async st=>{
      const f=await fixture(st),r=await f.target(type,kind);f.calls.length=0;
      f.arm={planId:r.plan.planId,rootCreate:type==='campaign'&&kind==='create'};
      await r.service.execute(r.request,context);
      assert.equal(f.hits,1,'The post-COMMIT suspension injection must actually execute');
      assert.equal(f.calls.filter(c=>c.method!=='GET').length,0,'SUSPEND_COMMITTED_BEFORE_TRANSPORT');
      const used=(await f.pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1',[r.plan.planId])).rows;
      assert.equal(used.length,1);assert.notEqual(used[0].used_at,null);
      const risks=(await f.pool.query('SELECT * FROM searchad_risk_reservations WHERE intent_id LIKE $1', [`%:${r.plan.planId}`])).rows;
      assert.equal(risks.length,1);assert.equal(risks[0].state,'consumed');
      if(kind==='delete'){
        f.config.allowActiveCanary=false;
        await r.service.reconcile({customerId:'1001',hierarchyRunId:r.plan.hierarchyRunId,hierarchyObjectId:r.plan.hierarchyObjectId,planId:r.plan.planId},context);
      }
      await f.account.resume('1001',context);await assert.rejects(()=>r.service.execute(r.request,context),code);
      assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
      assert.deepEqual((await f.pool.query('SELECT * FROM searchad_risk_reservations WHERE intent_id LIKE $1',[`%:${r.plan.planId}`])).rows,risks);
    });
  }

  await t.test('send fence real PostgreSQL ordering and fail-closed adapter contract',async st=>{
    const {PostgresAccountSendFence:Fence}=await import('../src/naver/searchad/lifecycle/postgres-account-send-fence.js');
    const f=await fixture(st),url=new URL(`${ORIGIN}/ncc/campaigns`);
    const init=()=>({method:'POST',headers:{'X-Customer':'1001'},body:'{}',signal:new AbortController().signal,redirect:'error'});
    const execute=(fence,request=init(),validate=()=>{})=>fence.run('1001',validate,()=>fence.fetch(url,request));
    await st.test('missing/suspended/cross-Customer/context-free sends are denied; GET recovery does not lock',async()=>{
      let calls=0;const fence=new Fence({pool:f.pool,fetchImpl:async()=>{calls++;return response({});}});
      await assert.rejects(()=>fence.fetch(url,init()),code);
      await assert.rejects(()=>execute(fence,{...init(),headers:{'X-Customer':'1002'}}),code);
      await f.account.suspend('1001',context);await assert.rejects(()=>execute(fence),code);assert.equal(calls,0);
      await fence.fetch(url,{...init(),method:'GET',body:undefined});assert.equal(calls,1);
      await f.pool.query("DELETE FROM searchad_canary_accounts WHERE customer_id='1001'");await assert.rejects(()=>execute(fence),code);
      await f.account.resume('1001',context);
    });
    await st.test('a send-first lock blocks suspension until fetch entry, but never waits for its response',async()=>{
      const locked=deferred(),proceed=deferred(),entered=deferred();let suspendPromise,sendEntered=false,pid;
      const pool={query:f.pool.query.bind(f.pool),async connect(){const c=await f.pool.connect();return {release:c.release.bind(c),async query(sql,args){const r=await c.query(sql,args);if(sql.includes('FOR UPDATE')){locked.resolve();await proceed.promise;}return r;}};}};
      const suspensionPool={query:f.pool.query.bind(f.pool),async connect(){const c=await f.pool.connect();pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return c;}};
      const fence=new Fence({pool,fetchImpl:async()=>{sendEntered=true;entered.resolve();await suspendPromise;return response({delivered:true});}});
      const result=execute(fence);await locked.promise;
      suspendPromise=f.controls(suspensionPool).suspend('1001',context);
      const deadline=Date.now()+5000;let blocking=false;
      while(Date.now()<deadline){if(pid)blocking=(await f.pool.query('SELECT cardinality(pg_blocking_pids($1)) AS n',[pid])).rows[0].n>0;if(blocking)break;await delay(5);}
      try{assert.equal(blocking,true,'real suspension transaction must wait on the held account row');assert.equal(sendEntered,false);}finally{proceed.resolve();}
      await entered.promise;await suspendPromise;assert.equal((await result).status,200);
      await assert.rejects(()=>execute(fence),code);await f.account.resume('1001',context);
    });
    await st.test('lock wait rechecks expiry/gate validator and cancellation before fetch entry',async()=>{
      let calls=0,valid=true;
      const pool={query:f.pool.query.bind(f.pool),async connect(){const c=await f.pool.connect();return {release:c.release.bind(c),async query(sql,args){const r=await c.query(sql,args);if(sql.includes('FOR UPDATE'))valid=false;return r;}};}};
      const fence=new Fence({pool,fetchImpl:async()=>{calls++;return response({});}});
      await assert.rejects(()=>execute(fence,init(),()=>{if(!valid)throw new Error('expired fixture');}));assert.equal(calls,0);
      const abort=new AbortController();abort.abort();await assert.rejects(()=>execute(fence,{...init(),signal:abort.signal}));assert.equal(calls,0);
    });
    await st.test('one scope cannot initiate twice, async validators are rejected, and delayed response failure never retries',async()=>{
      let calls=0;const fence=new Fence({pool:f.pool,fetchImpl:async()=>{calls++;return response({});}});
      await fence.run('1001',()=>{},async()=>{await fence.fetch(url,init());await assert.rejects(()=>fence.fetch(url,init()),code);});assert.equal(calls,1);
      await assert.rejects(()=>execute(fence,init(),async()=>{}),code);assert.equal(calls,1);
      const failed=new Fence({pool:f.pool,fetchImpl:async()=>{calls++;throw new Error('synthetic disconnect');}});
      await assert.rejects(()=>execute(failed));assert.equal(calls,2);
    });
    await st.test('DB failure before initiation denies send; release failure after initiation preserves returned ID',async()=>{
      let calls=0,discarded=false;
      const broken={query:f.pool.query.bind(f.pool),async connect(){throw new Error('SECRET db');}};
      await assert.rejects(()=>execute(new Fence({pool:broken,fetchImpl:async()=>{calls++;}})),e=>code(e)&&!JSON.stringify(e).includes('SECRET'));assert.equal(calls,0);
      const pool={query:f.pool.query.bind(f.pool),async connect(){const c=await f.pool.connect();return {release:destroy=>{discarded=destroy;c.release(destroy);},async query(sql,args){const r=await c.query(sql,args);if(sql==='ROLLBACK')throw new Error('SECRET lost rollback ack');return r;}};}};
      const fence=new Fence({pool,fetchImpl:async()=>{calls++;return response({nccCampaignId:'known-returned-id'});}});
      assert.equal((await (await execute(fence)).json()).nccCampaignId,'known-returned-id');assert.equal(calls,1);assert.equal(discarded,true);
    });
  });
});
