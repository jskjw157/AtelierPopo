import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { bootstrapV05 } from '../src/bootstrap-v05.js';
import { createHttpApiV05 } from '../src/http/server-v05.js';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { ADGROUP_CREATE_FIELDS } from '../src/naver/searchad/lifecycle/adgroup-create-contract.js';
import { KEYWORD_FIELDS, CREATIVE_FIELDS } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';

const CUSTOMER='1001', ORIGIN='https://api.searchad.naver.com';
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const logger={info(){},warn(){},error(){}};

test('public hierarchy sibling creation exposes only server-owned keyword/creative recipes with restart-safe one-time execution', { timeout: 240_000 }, async t => {
  const databaseUrl=process.env.TEST_DATABASE_URL;
  if(!databaseUrl){assert.notEqual(process.env.CI,'true','CI requires real PostgreSQL');return t.skip('TEST_DATABASE_URL is required');}
  const adminPool=createPostgresPool({connectionString:databaseUrl,sslMode:'disable',logger});
  t.after(()=>closePostgresPool(adminPool));

  for(const kind of ['keywords','creative']){
    await t.test(kind, async st => {
      const schema=`hierarchy_sibling_http_${kind}_${randomUUID().replaceAll('-','')}`;
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),`haar-hierarchy-sibling-${kind}-`));
      const nativeFetch=globalThis.fetch,savedEnv=new Map();
      const keys={generic:`sibling-${kind}-generic-`.repeat(4),reader:`sibling-${kind}-reader-`.repeat(4),admin:`sibling-${kind}-admin-`.repeat(4)};
      let pool,current,createdSchema=false,forbiddenCalls=0,rootBody=null,adgroupBody=null,keywordRows=[],creativeRow=null;
      const upstreamCalls=[];
      const setEnv=(key,value)=>{if(!savedEnv.has(key))savedEnv.set(key,process.env[key]);process.env[key]=value;};
      const scopedUrl=()=>{const url=new URL(databaseUrl);url.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);return url.toString();};
      const call=async(role,method,route,body)=>{
        const token=keys[role];
        const response=await nativeFetch(`http://127.0.0.1:${current.api.server.address().port}${route}`,{
          method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)})
        });
        return {status:response.status,body:await response.json()};
      };
      const json=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
      const simulatedUpstream=async(url,init)=>{
        const parsed=new URL(url),headers=new Headers(init.headers);
        if(parsed.origin!==ORIGIN){forbiddenCalls++;throw new Error('Unexpected upstream origin');}
        assert.equal(headers.get('X-Customer'),CUSTOMER);assert.ok(headers.get('X-Signature'));assert.equal(init.redirect,'error');
        upstreamCalls.push({method:init.method,pathname:parsed.pathname,query:parsed.search});
        if(init.method==='POST'&&parsed.pathname==='/ncc/campaigns'){
          rootBody=JSON.parse(init.body);return json({...rootBody,customerId:Number(CUSTOMER),nccCampaignId:`cmp-sibling-${kind}`});
        }
        if(init.method==='GET'&&parsed.pathname===`/ncc/campaigns/cmp-sibling-${kind}`){
          return json({customerId:Number(CUSTOMER),nccCampaignId:`cmp-sibling-${kind}`,campaignTp:'WEB_SITE',name:rootBody?.name,userLock:true,dailyBudget:1000});
        }
        if(init.method==='POST'&&parsed.pathname==='/ncc/adgroups'){
          adgroupBody=JSON.parse(init.body);assert.equal(adgroupBody.nccCampaignId,`cmp-sibling-${kind}`);
          return json({...adgroupBody,customerId:Number(CUSTOMER),nccAdgroupId:`grp-sibling-${kind}`});
        }
        if(init.method==='GET'&&parsed.pathname===`/ncc/adgroups/grp-sibling-${kind}`){
          return json({...adgroupBody,customerId:Number(CUSTOMER),nccAdgroupId:`grp-sibling-${kind}`});
        }
        if(init.method==='POST'&&parsed.pathname==='/ncc/keywords'){
          assert.equal(kind,'keywords');assert.equal(parsed.searchParams.get('nccAdgroupId'),'grp-sibling-keywords');
          const body=JSON.parse(init.body);assert.deepEqual(body,[{keyword:'haar-hierarchy-canary'}]);
          keywordRows=body.map((row,index)=>({...row,customerId:Number(CUSTOMER),nccAdgroupId:'grp-sibling-keywords',nccKeywordId:`kw-sibling-${index+1}`}));
          return json(keywordRows);
        }
        if(init.method==='GET'&&parsed.pathname.startsWith('/ncc/keywords/')){
          const id=parsed.pathname.split('/').at(-1),row=keywordRows.find(item=>item.nccKeywordId===id);
          return row?json(row):json({},404);
        }
        if(init.method==='POST'&&parsed.pathname==='/ncc/ads'){
          assert.equal(kind,'creative');const body=JSON.parse(init.body);assert.equal(body.nccAdgroupId,'grp-sibling-creative');assert.equal(body.type,'TEXT_45');
          creativeRow={...body,customerId:Number(CUSTOMER),nccAdId:'ad-sibling-creative'};return json(creativeRow);
        }
        if(init.method==='GET'&&parsed.pathname==='/ncc/ads/ad-sibling-creative')return creativeRow?json(creativeRow):json({},404);
        forbiddenCalls++;throw new Error(`Unexpected upstream request ${init.method} ${parsed.pathname}`);
      };
      async function start(){
        const app=await bootstrapV05(path.join(dir,'config.json'),{env,fetchImpl:simulatedUpstream});
        const api=createHttpApiV05({app,env,logger});await api.listen({host:'127.0.0.1',port:0});current={app,api};return current;
      }
      async function activation(operationKey,fieldScope,lifecycleKind){
        const runtime=current.app.searchAdActivationRuntime,evidenceId=randomUUID(),now=Date.now();
        await runtime.repository.createEvidence({
          evidenceId,evidenceType:'active_canary',customerId:CUSTOMER,specSha:current.app.searchAdRegistry.status().specRef,
          credentialFingerprint:credentialFingerprintForCustomer(current.app.searchAdCredentials,CUSTOMER),upstreamBaseUrl:ORIGIN,
          operationKeys:[operationKey],fieldScope,lifecycleKinds:[lifecycleKind],result:'verified',
          sourceRunId:`synthetic-sibling-${kind}`,details:{fixtureOnly:true},createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString()
        });
        const created=await call('admin','POST','/api/v1/searchad/activations',{evidenceId});
        assert.equal(created.status,201,JSON.stringify(created));return created.body.activationId;
      }
      st.after(async()=>{
        try{await current?.api.close();}catch{}
        globalThis.fetch=nativeFetch;
        for(const [key,value] of savedEnv){if(value===undefined)delete process.env[key];else process.env[key]=value;}
        if(pool)await closePostgresPool(pool);
        if(createdSchema)await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
        fs.rmSync(dir,{recursive:true,force:true});
      });

      await adminPool.query(`CREATE SCHEMA "${schema}"`);createdSchema=true;
      pool=createPostgresPool({connectionString:scopedUrl(),sslMode:'disable',logger});
      await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
      const catalogRoot=path.join(dir,'catalog');fs.mkdirSync(catalogRoot);
      fs.writeFileSync(path.join(catalogRoot,'catalog_manifest.json'),JSON.stringify({source:'sibling-http-fixture',total_products:0,total_completed:0,products:{}}));
      const templateFile=path.join(dir,'template.json');fs.writeFileSync(templateFile,'{}');
      const raw=JSON.parse(fs.readFileSync('config/atelier-popo.example.json','utf8'));
      fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({...raw,catalogRoot,templateFile,workDir:dir,databasePath:path.join(dir,'ledger.sqlite')}));
      for(const [name,value] of Object.entries({
        NAVER_CLIENT_ID:`sibling-${kind}-commerce`,NAVER_CLIENT_SECRET:`sibling-${kind}-commerce-secret`,NAVER_ALLOW_WRITES:'false',
        ATELIER_WORK_DIR:dir,ATELIER_DATABASE_PATH:path.join(dir,'ledger.sqlite'),ATELIER_CATALOG_ROOT:catalogRoot,ATELIER_TEMPLATE_FILE:templateFile
      }))setEnv(name,value);
      globalThis.fetch=async()=>{forbiddenCalls++;throw new Error('Uninjected real external fetch');};
      env={
        ATELIER_API_KEY:keys.generic,ATELIER_SEARCHAD_READER_API_KEY:keys.reader,ATELIER_SEARCHAD_READER_CUSTOMERS:CUSTOMER,ATELIER_SEARCHAD_READER_PRINCIPAL_ID:`sibling-${kind}-reader`,
        ATELIER_SEARCHAD_ADMIN_API_KEY:keys.admin,ATELIER_SEARCHAD_ADMIN_CUSTOMERS:CUSTOMER,ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID:`sibling-${kind}-admin`,
        NAVER_SEARCHAD_ACCESS_LICENSE:`sibling-${kind}-license`,NAVER_SEARCHAD_SECRET_KEY:`sibling-${kind}-secret`,NAVER_SEARCHAD_CUSTOMER_ID:CUSTOMER,
        DATABASE_URL:scopedUrl(),ATELIER_POSTGRES_SSL_MODE:'disable',ATELIER_CATALOG_PROVIDER:'local',ATELIER_HTTP_ALLOW_WRITES:'true',ATELIER_WRITE_RATE_LIMIT_PER_MINUTE:'1000',
        ATELIER_SEARCHAD_MAX_RETRIES:'0',ATELIER_SEARCHAD_WRITE_STORAGE:'postgres',ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED:'true',ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS:'true',
        ATELIER_SEARCHAD_ALLOW_READS:'true',ATELIER_SEARCHAD_ALLOW_WRITES:'false',ATELIER_SEARCHAD_ALLOW_CREATES:'false',ATELIER_SEARCHAD_ALLOW_BATCH_WRITES:'false',
        ATELIER_SEARCHAD_ALLOW_ROLLBACK:'false',ATELIER_SEARCHAD_ALLOW_DELETES:'false',ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY:'true',ATELIER_SEARCHAD_ACTIVATION_MODE:'canary',
        ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW:'1000',ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW:'100',ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW:'2000',
        ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW:'500',ATELIER_SEARCHAD_CANARY_STATS_SINCE:'2026-09-01',ATELIER_SEARCHAD_CANARY_STATS_UNTIL:'2026-09-02'
      };

      await start();
      assert.equal(current.app.searchAdHierarchyRuntime?.status().scope.siblingCreate,true,'public runtime must expose verified sibling creation');

      const rootActivation=await activation(OPS.campaign.create,campaignFields,'create');
      const root=await call('admin','POST','/api/v1/searchad/hierarchy/campaigns/prepare',{customerId:CUSTOMER,activationId:rootActivation});
      assert.equal(root.status,201,JSON.stringify(root));
      const rootApproval=await call('admin','POST',`/api/v1/searchad/changes/${root.body.planId}/approve`,{confirmation:'APPROVE_SEARCHAD_CHANGE'});
      const rootExec=await call('admin','POST',`/api/v1/searchad/hierarchy/campaigns/${root.body.hierarchyRunId}/${root.body.hierarchyObjectId}/${root.body.planId}/execute`,{customerId:CUSTOMER,executionToken:rootApproval.body.executionToken});
      assert.equal(rootExec.status,200,JSON.stringify(rootExec));

      const groupActivation=await activation(OPS.adgroup.create,ADGROUP_CREATE_FIELDS,'create');
      const group=await call('admin','POST','/api/v1/searchad/hierarchy/adgroups/prepare',{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,parentObjectId:root.body.hierarchyObjectId,activationId:groupActivation});
      assert.equal(group.status,201,JSON.stringify(group));
      const groupApproval=await call('admin','POST',`/api/v1/searchad/changes/${group.body.planId}/approve`,{confirmation:'APPROVE_SEARCHAD_CHANGE'});
      const groupExec=await call('admin','POST',`/api/v1/searchad/hierarchy/adgroups/${group.body.hierarchyRunId}/${group.body.parentObjectId}/${group.body.hierarchyObjectId}/${group.body.planId}/execute`,{customerId:CUSTOMER,executionToken:groupApproval.body.executionToken});
      assert.equal(groupExec.status,200,JSON.stringify(groupExec));

      const operationKey=kind==='keywords'?OPS.keyword.create:OPS.creative.create;
      const fieldScope=kind==='keywords'?KEYWORD_FIELDS:CREATIVE_FIELDS;
      const lifecycleKind=kind==='keywords'?'batch_create':'create';
      const siblingActivation=await activation(operationKey,fieldScope,lifecycleKind);
      const routeKind=kind==='keywords'?'keywords':'creatives';
      const beforePrepare=upstreamCalls.length;
      const readerDenied=await call('reader','POST',`/api/v1/searchad/hierarchy/${routeKind}/prepare`,{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,parentObjectId:group.body.hierarchyObjectId,activationId:siblingActivation});
      assert.equal(readerDenied.status,403);
      assert.equal(upstreamCalls.length,beforePrepare);

      const badOverride=await call('admin','POST',`/api/v1/searchad/hierarchy/${routeKind}/prepare`,{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,parentObjectId:group.body.hierarchyObjectId,activationId:siblingActivation,keywordTexts:['caller-value']});
      assert.equal(badOverride.status,400);
      assert.equal(upstreamCalls.length,beforePrepare);

      const prepared=await call('admin','POST',`/api/v1/searchad/hierarchy/${routeKind}/prepare`,{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,parentObjectId:group.body.hierarchyObjectId,activationId:siblingActivation});
      assert.equal(prepared.status,201,JSON.stringify(prepared));assert.equal(prepared.body.parentObjectId,group.body.hierarchyObjectId);assert.equal(prepared.body.kind,kind);
      assert.equal(upstreamCalls.length,beforePrepare,'sibling prepare must remain local-only');

      await current.api.close();current=null;await start();
      assert.equal(current.app.searchAdHierarchyRuntime?.status().scope.siblingCreate,true);
      const approved=await call('admin','POST',`/api/v1/searchad/changes/${prepared.body.planId}/approve`,{confirmation:'APPROVE_SEARCHAD_CHANGE'});
      assert.equal(approved.status,200,JSON.stringify(approved));
      const executeRoute=`/api/v1/searchad/hierarchy/${routeKind}/${prepared.body.hierarchyRunId}/${prepared.body.parentObjectId}/${prepared.body.planId}/execute`;
      const executed=await call('admin','POST',executeRoute,{customerId:CUSTOMER,executionToken:approved.body.executionToken});
      assert.equal(executed.status,200,JSON.stringify(executed));assert.equal(executed.body.kind,kind);assert.equal(executed.body.state,'owned');
      if(kind==='keywords')assert.deepEqual(executed.body.remoteIds,['kw-sibling-1']);else assert.deepEqual(executed.body.remoteIds,['ad-sibling-creative']);

      const postPath=kind==='keywords'?'/ncc/keywords':'/ncc/ads';
      assert.equal(upstreamCalls.filter(item=>item.method==='POST'&&item.pathname===postPath).length,1);
      const replay=await call('admin','POST',executeRoute,{customerId:CUSTOMER,executionToken:approved.body.executionToken});
      assert.notEqual(replay.status,200);assert.equal(upstreamCalls.filter(item=>item.method==='POST'&&item.pathname===postPath).length,1);
      assert.equal(forbiddenCalls,0);
    });
  }
});
