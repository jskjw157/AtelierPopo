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

const CUSTOMER='1001',ORIGIN='https://api.searchad.naver.com';
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const logger={info(){},warn(){},error(){}};

test('public leaf cleanup exposes only keyword/creative targets and preserves GET-only recovery', {timeout:240_000}, async t=>{
  const databaseUrl=process.env.TEST_DATABASE_URL;
  if(!databaseUrl){assert.notEqual(process.env.CI,'true','CI requires real PostgreSQL');return t.skip('TEST_DATABASE_URL is required');}
  const adminPool=createPostgresPool({connectionString:databaseUrl,sslMode:'disable',logger});
  t.after(()=>closePostgresPool(adminPool));

  for(const kind of ['keywords','creative']){
    await t.test(kind,async st=>{
      const type=kind==='keywords'?'keyword':'creative';
      const schema=`hierarchy_leaf_cleanup_${kind}_${randomUUID().replaceAll('-','')}`;
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),`haar-leaf-cleanup-${kind}-`));
      const nativeFetch=globalThis.fetch,savedEnv=new Map();
      const keys={generic:`leaf-${kind}-generic-`.repeat(4),reader:`leaf-${kind}-reader-`.repeat(4),admin:`leaf-${kind}-admin-`.repeat(4)};
      let pool,current,env,createdSchema=false,forbiddenCalls=0,rootBody=null,adgroupBody=null,keywordRow=null,creativeRow=null,deleted=false,hideAbsenceOnce=false;
      const calls=[];
      const setEnv=(key,value)=>{if(!savedEnv.has(key))savedEnv.set(key,process.env[key]);process.env[key]=value;};
      const scopedUrl=()=>{const u=new URL(databaseUrl);u.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);return u.toString();};
      const call=async(role,method,route,body)=>{
        const token=keys[role],response=await nativeFetch(`http://127.0.0.1:${current.api.server.address().port}${route}`,{
          method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
          ...(body===undefined?{}:{body:JSON.stringify(body)})
        });
        return {status:response.status,body:await response.json()};
      };
      const json=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
      const upstream=async(url,init)=>{
        const u=new URL(url),headers=new Headers(init.headers);calls.push(`${init.method} ${u.pathname}`);
        if(u.origin!==ORIGIN){forbiddenCalls++;throw new Error('Unexpected origin');}
        assert.equal(headers.get('X-Customer'),CUSTOMER);assert.ok(headers.get('X-Signature'));assert.equal(init.redirect,'error');
        if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){rootBody=JSON.parse(init.body);return json({...rootBody,customerId:Number(CUSTOMER),nccCampaignId:`cmp-leaf-${kind}`});}
        if(init.method==='GET'&&u.pathname===`/ncc/campaigns/cmp-leaf-${kind}`)return json({customerId:Number(CUSTOMER),nccCampaignId:`cmp-leaf-${kind}`,campaignTp:'WEB_SITE',name:rootBody?.name,userLock:true,dailyBudget:1000});
        if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){adgroupBody=JSON.parse(init.body);return json({...adgroupBody,customerId:Number(CUSTOMER),nccAdgroupId:`grp-leaf-${kind}`});}
        if(init.method==='GET'&&u.pathname===`/ncc/adgroups/grp-leaf-${kind}`)return json({...adgroupBody,customerId:Number(CUSTOMER),nccAdgroupId:`grp-leaf-${kind}`});
        if(init.method==='POST'&&u.pathname==='/ncc/keywords'){
          const body=JSON.parse(init.body);keywordRow={...body[0],customerId:Number(CUSTOMER),nccAdgroupId:'grp-leaf-keywords',nccKeywordId:'kw-leaf-1'};return json([keywordRow]);
        }
        if(init.method==='POST'&&u.pathname==='/ncc/ads'){creativeRow={...JSON.parse(init.body),customerId:Number(CUSTOMER),nccAdId:'ad-leaf-1'};return json(creativeRow);}
        const leafId=kind==='keywords'?'kw-leaf-1':'ad-leaf-1',leafPath=kind==='keywords'?'/ncc/keywords/':'/ncc/ads/';
        if(init.method==='GET'&&u.pathname===`${leafPath}${leafId}`){
          if(deleted){
            if(hideAbsenceOnce){hideAbsenceOnce=false;throw new Error('synthetic read unavailable after delete');}
            return json({code:'NOT_FOUND'},404);
          }
          return json(kind==='keywords'?keywordRow:creativeRow);
        }
        if(init.method==='DELETE'&&u.pathname===`${leafPath}${leafId}`){deleted=true;if(kind==='keywords')hideAbsenceOnce=true;return json({accepted:true});}
        forbiddenCalls++;throw new Error(`Unexpected upstream ${init.method} ${u.pathname}`);
      };
      async function start(){const app=await bootstrapV05(path.join(dir,'config.json'),{env,fetchImpl:upstream});const api=createHttpApiV05({app,env,logger});await api.listen({host:'127.0.0.1',port:0});current={app,api};return current;}
      async function activation(operationKey,fieldScope,lifecycleKind){
        const runtime=current.app.searchAdActivationRuntime,evidenceId=randomUUID(),now=Date.now();
        await runtime.repository.createEvidence({evidenceId,evidenceType:'active_canary',customerId:CUSTOMER,specSha:current.app.searchAdRegistry.status().specRef,
          credentialFingerprint:credentialFingerprintForCustomer(current.app.searchAdCredentials,CUSTOMER),upstreamBaseUrl:ORIGIN,operationKeys:[operationKey],fieldScope,lifecycleKinds:[lifecycleKind],
          result:'verified',sourceRunId:`synthetic-leaf-${kind}`,details:{fixtureOnly:true},createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString()});
        const created=await call('admin','POST','/api/v1/searchad/activations',{evidenceId});assert.equal(created.status,201,JSON.stringify(created));return created.body.activationId;
      }
      st.after(async()=>{try{await current?.api.close();}catch{}globalThis.fetch=nativeFetch;for(const [k,v] of savedEnv){if(v===undefined)delete process.env[k];else process.env[k]=v;}if(pool)await closePostgresPool(pool);if(createdSchema)await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);fs.rmSync(dir,{recursive:true,force:true});});

      await adminPool.query(`CREATE SCHEMA "${schema}"`);createdSchema=true;
      pool=createPostgresPool({connectionString:scopedUrl(),sslMode:'disable',logger});await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
      const catalogRoot=path.join(dir,'catalog');fs.mkdirSync(catalogRoot);fs.writeFileSync(path.join(catalogRoot,'catalog_manifest.json'),JSON.stringify({source:'leaf-cleanup-fixture',total_products:0,total_completed:0,products:{}}));
      const templateFile=path.join(dir,'template.json');fs.writeFileSync(templateFile,'{}');const raw=JSON.parse(fs.readFileSync('config/atelier-popo.example.json','utf8'));
      fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({...raw,catalogRoot,templateFile,workDir:dir,databasePath:path.join(dir,'ledger.sqlite')}));
      for(const [name,value] of Object.entries({NAVER_CLIENT_ID:`leaf-${kind}-commerce`,NAVER_CLIENT_SECRET:`leaf-${kind}-commerce-secret`,NAVER_ALLOW_WRITES:'false',ATELIER_WORK_DIR:dir,ATELIER_DATABASE_PATH:path.join(dir,'ledger.sqlite'),ATELIER_CATALOG_ROOT:catalogRoot,ATELIER_TEMPLATE_FILE:templateFile}))setEnv(name,value);
      globalThis.fetch=async()=>{forbiddenCalls++;throw new Error('Uninjected real external fetch');};
      env={ATELIER_API_KEY:keys.generic,ATELIER_SEARCHAD_READER_API_KEY:keys.reader,ATELIER_SEARCHAD_READER_CUSTOMERS:CUSTOMER,ATELIER_SEARCHAD_READER_PRINCIPAL_ID:`leaf-${kind}-reader`,
        ATELIER_SEARCHAD_ADMIN_API_KEY:keys.admin,ATELIER_SEARCHAD_ADMIN_CUSTOMERS:CUSTOMER,ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID:`leaf-${kind}-admin`,
        NAVER_SEARCHAD_ACCESS_LICENSE:`leaf-${kind}-license`,NAVER_SEARCHAD_SECRET_KEY:`leaf-${kind}-secret`,NAVER_SEARCHAD_CUSTOMER_ID:CUSTOMER,DATABASE_URL:scopedUrl(),ATELIER_POSTGRES_SSL_MODE:'disable',
        ATELIER_CATALOG_PROVIDER:'local',ATELIER_HTTP_ALLOW_WRITES:'true',ATELIER_WRITE_RATE_LIMIT_PER_MINUTE:'1000',ATELIER_SEARCHAD_MAX_RETRIES:'0',ATELIER_SEARCHAD_WRITE_STORAGE:'postgres',
        ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED:'true',ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS:'true',ATELIER_SEARCHAD_ALLOW_READS:'true',ATELIER_SEARCHAD_ALLOW_WRITES:'false',
        ATELIER_SEARCHAD_ALLOW_CREATES:'false',ATELIER_SEARCHAD_ALLOW_BATCH_WRITES:'false',ATELIER_SEARCHAD_ALLOW_ROLLBACK:'false',ATELIER_SEARCHAD_ALLOW_DELETES:'false',
        ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY:'true',ATELIER_SEARCHAD_ACTIVATION_MODE:'canary',ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW:'1000',ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW:'100',
        ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW:'2000',ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW:'500',ATELIER_SEARCHAD_CANARY_STATS_SINCE:'2026-09-01',ATELIER_SEARCHAD_CANARY_STATS_UNTIL:'2026-09-02'};

      await start();
      assert.equal(current.app.searchAdHierarchyRuntime?.status().scope.leafCleanup,true,'runtime must expose leaf-only cleanup');

      const rootActivation=await activation(OPS.campaign.create,campaignFields,'create');
      const root=await call('admin','POST','/api/v1/searchad/hierarchy/campaigns/prepare',{customerId:CUSTOMER,activationId:rootActivation});
      const rootApproval=await call('admin','POST',`/api/v1/searchad/changes/${root.body.planId}/approve`,{confirmation:'APPROVE_SEARCHAD_CHANGE'});
      assert.equal((await call('admin','POST',`/api/v1/searchad/hierarchy/campaigns/${root.body.hierarchyRunId}/${root.body.hierarchyObjectId}/${root.body.planId}/execute`,{customerId:CUSTOMER,executionToken:rootApproval.body.executionToken})).status,200);

      const groupActivation=await activation(OPS.adgroup.create,ADGROUP_CREATE_FIELDS,'create');
      const group=await call('admin','POST','/api/v1/searchad/hierarchy/adgroups/prepare',{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,parentObjectId:root.body.hierarchyObjectId,activationId:groupActivation});
      const groupApproval=await call('admin','POST',`/api/v1/searchad/changes/${group.body.planId}/approve`,{confirmation:'APPROVE_SEARCHAD_CHANGE'});
      assert.equal((await call('admin','POST',`/api/v1/searchad/hierarchy/adgroups/${group.body.hierarchyRunId}/${group.body.parentObjectId}/${group.body.hierarchyObjectId}/${group.body.planId}/execute`,{customerId:CUSTOMER,executionToken:groupApproval.body.executionToken})).status,200);

      const siblingActivation=await activation(kind==='keywords'?OPS.keyword.create:OPS.creative.create,kind==='keywords'?KEYWORD_FIELDS:CREATIVE_FIELDS,kind==='keywords'?'batch_create':'create');
      const routeKind=kind==='keywords'?'keywords':'creatives';
      const sibling=await call('admin','POST',`/api/v1/searchad/hierarchy/${routeKind}/prepare`,{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,parentObjectId:group.body.hierarchyObjectId,activationId:siblingActivation});
      const siblingApproval=await call('admin','POST',`/api/v1/searchad/changes/${sibling.body.planId}/approve`,{confirmation:'APPROVE_SEARCHAD_CHANGE'});
      const siblingExec=await call('admin','POST',`/api/v1/searchad/hierarchy/${routeKind}/${sibling.body.hierarchyRunId}/${sibling.body.parentObjectId}/${sibling.body.planId}/execute`,{customerId:CUSTOMER,executionToken:siblingApproval.body.executionToken});
      assert.equal(siblingExec.status,200,JSON.stringify(siblingExec));assert.equal(siblingExec.body.state,'owned');
      const leafId=sibling.body.objectIds[0];

      const deleteActivation=await activation(OPS[type].delete,[],'delete');
      const deletesBefore=calls.filter(x=>x.startsWith('DELETE ')).length;
      const parentDenied=await call('admin','POST','/api/v1/searchad/hierarchy/leaves/cleanup/prepare',{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,hierarchyObjectId:group.body.hierarchyObjectId,activationId:deleteActivation});
      assert.notEqual(parentDenied.status,201,'public leaf cleanup must reject an adgroup target');
      assert.equal(calls.filter(x=>x.startsWith('DELETE ')).length,deletesBefore);

      const readerDenied=await call('reader','POST','/api/v1/searchad/hierarchy/leaves/cleanup/prepare',{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,hierarchyObjectId:leafId,activationId:deleteActivation});
      assert.equal(readerDenied.status,403);

      const prepared=await call('admin','POST','/api/v1/searchad/hierarchy/leaves/cleanup/prepare',{customerId:CUSTOMER,hierarchyRunId:root.body.hierarchyRunId,hierarchyObjectId:leafId,activationId:deleteActivation});
      assert.equal(prepared.status,201,JSON.stringify(prepared));assert.equal(prepared.body.objectType,type);
      const deletesAfterPrepare=calls.filter(x=>x.startsWith('DELETE ')).length;assert.equal(deletesAfterPrepare,deletesBefore,'cleanup prepare stays local-only');

      await current.api.close();current=null;await start();
      const approved=await call('admin','POST',`/api/v1/searchad/changes/${prepared.body.planId}/approve`,{confirmation:'APPROVE_SEARCHAD_CHANGE'});
      const executeRoute=`/api/v1/searchad/hierarchy/leaves/cleanup/${root.body.hierarchyRunId}/${leafId}/${prepared.body.planId}/execute`;
      const executed=await call('admin','POST',executeRoute,{customerId:CUSTOMER,executionToken:approved.body.executionToken,confirmation:prepared.body.requiredConfirmation,secondConfirmation:prepared.body.requiredSecondConfirmation});
      assert.equal(executed.status,200,JSON.stringify(executed));
      assert.equal(calls.filter(x=>x.startsWith('DELETE ')).length,deletesBefore+1,'leaf delete is sent at most once');

      if(kind==='keywords'){
        assert.equal(executed.body.state,'delete_unknown','synthetic post-delete read outage must not be guessed as absent');
        await current.api.close();current=null;await start();
        const beforeReconcileDeletes=calls.filter(x=>x.startsWith('DELETE ')).length;
        const reconciled=await call('admin','POST',`/api/v1/searchad/hierarchy/leaves/cleanup/${root.body.hierarchyRunId}/${leafId}/${prepared.body.planId}/reconcile`,{customerId:CUSTOMER});
        assert.equal(reconciled.status,200,JSON.stringify(reconciled));assert.equal(reconciled.body.state,'deleted');
        assert.equal(calls.filter(x=>x.startsWith('DELETE ')).length,beforeReconcileDeletes,'reconcile must remain GET-only');
      }else assert.equal(executed.body.state,'deleted');

      const parentDeletes=calls.filter(x=>x.includes('/ncc/adgroups/')&&x.startsWith('DELETE ')).length+calls.filter(x=>x.includes('/ncc/campaigns/')&&x.startsWith('DELETE ')).length;
      assert.equal(parentDeletes,0,'public leaf cleanup never deletes parent objects');
      assert.equal(forbiddenCalls,0);
    });
  }
});
