import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { SiblingCreateService } from '../src/naver/searchad/lifecycle/sibling-create-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const logger={info(){},warn(){},error(){}};
const NOW=Date.parse('2026-09-13T04:00:00Z');
const context={principal:{principalId:'sibling-admin',role:'admin',customerIds:['1001']}};
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const adgroupFields=['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'];
const keywordFields=['keyword.keyword'];
const creativeFields=['creative.nccAdgroupId','creative.type','creative.headline','creative.description'];
const json=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('keyword batch and TEXT_45 creative are bounded siblings below the verified stopped adgroup', {timeout:180_000}, async t=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}
  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const originalFetch=globalThis.fetch;let escaped=0;globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  t.after(async()=>{globalThis.fetch=originalFetch;await closePostgresPool(admin);assert.equal(escaped,0);});

  async function fixture(st,{keywordMode='exact'}={}){
    const schema=`sibling_${randomUUID().replaceAll('-','')}`;const pools=new Set();const f={time:NOW,calls:[],keywordMode};
    await admin.query(`CREATE SCHEMA "${schema}"`);
    st.after(async()=>{try{await Promise.all([...pools].map(p=>closePostgresPool(p)));}finally{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}});
    const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);scoped.searchParams.set('application_name',schema);
    f.connect=()=>{const p=createPostgresPool({connectionString:scoped.toString(),sslMode:'disable',logger});pools.add(p);return p;};f.pool=f.connect();
    await runPostgresMigrations({pool:f.pool,migrationsDir:path.resolve('migrations/postgres'),logger});
    f.registry=loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
    f.config=loadSearchAdConfig({NAVER_SEARCHAD_ACCESS_LICENSE:'fixture-license',NAVER_SEARCHAD_SECRET_KEY:'fixture-secret',NAVER_SEARCHAD_CUSTOMER_ID:'1001',ATELIER_SEARCHAD_ALLOW_READS:'true',ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY:'true'});
    f.credentials=new SearchAdCredentialsRegistry(f.config.topology);f.identity={specSha:f.registry.status().specRef,credentialFingerprint:credentialFingerprintForCustomer(f.credentials,'1001'),upstreamBaseUrl:'https://api.searchad.naver.com'};
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    f.authority=async(operation,fields,kind='create')=>{const activationId=randomUUID(),evidenceId=`synthetic-${randomUUID()}`,start=new Date(f.time-1000).toISOString(),end=new Date(f.time+3600000).toISOString();
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`,[evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture-authority',$9,$10)`,[activationId,evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);return activationId;};
    f.fetchImpl=async(urlValue,init)=>{const u=new URL(urlValue),body=init.body?JSON.parse(init.body):null;f.calls.push(`${init.method} ${u.pathname}`);
      assert.equal(u.origin,'https://api.searchad.naver.com');assert.equal(init.redirect,'error');
      if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){f.rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};return json(f.rootRemote);}
      if(init.method==='GET'&&u.pathname===`/ncc/campaigns/${f.rootRemote.nccCampaignId}`)return json(f.rootRemote);
      if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){f.adgroupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};return json(f.adgroupRemote,201);}
      if(init.method==='GET'&&u.pathname===`/ncc/adgroups/${f.adgroupRemote.nccAdgroupId}`)return json(f.adgroupRemote);
      if(init.method==='POST'&&u.pathname==='/ncc/keywords'){
        const exact=body.map((item,index)=>({nccKeywordId:`kw-${index+1}-${randomUUID()}`,keyword:item.keyword}));
        if(f.keywordMode==='partial')return json(exact.slice(0,1));
        if(f.keywordMode==='duplicate')return json([{...exact[0]},{...exact[1],nccKeywordId:exact[0].nccKeywordId}]);
        f.keywordRemote=exact;return json(exact);
      }
      if(init.method==='GET'&&u.pathname.startsWith('/ncc/keywords/')){const id=u.pathname.split('/').at(-1);const row=f.keywordRemote?.find(v=>v.nccKeywordId===id);return row?json({customerId:'1001',nccAdgroupId:f.adgroupRemote.nccAdgroupId,...row}):json({code:'NOT_FOUND'},404);}
      if(init.method==='POST'&&u.pathname==='/ncc/ads'){f.creativeRemote={customerId:'1001',nccAdId:`ad-${randomUUID()}`,...body};return json(f.creativeRemote,201);}
      if(init.method==='GET'&&u.pathname===`/ncc/ads/${f.creativeRemote?.nccAdId}`)return json(f.creativeRemote);
      throw new Error(`Unexpected ${init.method} ${u.pathname}`);
    };
    f.args=extra=>({pool:f.pool,registry:f.registry,credentialsRegistry:f.credentials,config:f.config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:300,preflightMaxAgeMs:5000,clock:()=>f.time,fetchImpl:f.fetchImpl,logger,...extra});
    f.writer=new PostgresSearchAdWriteRepository({pool:f.pool});f.approval=new SearchAdApprovalService({repository:f.writer,config:{approvalTtlSeconds:300},clock:()=>f.time});f.approve=id=>f.approval.approve(id,{confirmation:'APPROVE_SEARCHAD_CHANGE',actor:'fixture-approver'});
    const campaign=new CampaignCreateService(f.args());const rootPlan=await campaign.prepare({customerId:'1001',activationId:await f.authority(OPS.campaign.create,campaignFields)},context);const rootToken=await f.approve(rootPlan.planId);f.root=await campaign.execute({customerId:'1001',hierarchyRunId:rootPlan.hierarchyRunId,hierarchyObjectId:rootPlan.hierarchyObjectId,planId:rootPlan.planId,executionToken:rootToken.executionToken},context);
    const adgroup=new AdgroupCreateService(f.args());const groupPlan=await adgroup.prepare({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,activationId:await f.authority(OPS.adgroup.create,adgroupFields)},context);const groupToken=await f.approve(groupPlan.planId);f.group=await adgroup.execute({customerId:'1001',hierarchyRunId:groupPlan.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,hierarchyObjectId:groupPlan.hierarchyObjectId,planId:groupPlan.planId,executionToken:groupToken.executionToken},context);assert.equal(f.group.state,'owned');
    f.calls.length=0;f.service=new SiblingCreateService(f.args({keywordTexts:['haar-one','haar-two']}));return f;
  }

  async function approveExecute(f,plan,kind){const token=await f.approve(plan.planId);return f.service.execute({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:plan.planId,executionToken:token.executionToken,kind},context);}

  await t.test('exact keyword batch stores two owned sibling IDs only after per-ID GET verification',async st=>{const f=await fixture(st);const plan=await f.service.prepareKeywords({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,activationId:await f.authority(OPS.keyword.create,keywordFields,'batch_create')},context);const result=await approveExecute(f,plan,'keywords');assert.equal(result.state,'owned');assert.equal(f.calls.filter(v=>v==='POST /ncc/keywords').length,1);assert.equal(f.calls.filter(v=>v.startsWith('GET /ncc/keywords/')).length,2);const rows=(await f.pool.query("SELECT object_type,state,remote_id,parent_object_id FROM searchad_hierarchy_objects WHERE object_type='keyword' ORDER BY hierarchy_object_id")).rows;assert.equal(rows.length,2);assert.ok(rows.every(v=>v.state==='owned'&&v.remote_id&&v.parent_object_id===f.group.hierarchyObjectId));});

  await t.test('complete own batch does not exclude an unrelated claimed sibling and consumed authority cannot replay',async st=>{
    const {createCircuitGuard}=await import('../src/naver/searchad/circuit/service.js');
    const f=await fixture(st),circuit=createCircuitGuard({pool:f.pool,clock:()=>f.time});
    f.service=new SiblingCreateService(f.args({keywordTexts:['haar-one','haar-two'],circuitGuard:circuit}));
    const plan=await f.service.prepareKeywords({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,activationId:await f.authority(OPS.keyword.create,keywordFields,'batch_create')},context);
    const token=await f.approve(plan.planId);
    const input={customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:plan.planId,executionToken:token.executionToken,kind:'keywords'};
    await assert.rejects(f.service.execute({...input,ownedObjectIds:plan.objectIds},context),{code:'SEARCHAD_SIBLING_INPUT_INVALID'});
    const riskBefore=(await f.pool.query('SELECT sum(consumed_units)::int AS n FROM searchad_daily_risk_capacity')).rows[0].n;
    const prepare=circuit.prepareDispatch.bind(circuit),authorize=circuit.assertDispatchAllowed.bind(circuit);
    let denied=false;
    circuit.prepareDispatch=async dispatch=>{
      await prepare(dispatch);
      const client=await f.pool.connect();
      try{
        await client.query('BEGIN');await client.query("SELECT customer_id FROM searchad_canary_accounts WHERE customer_id='1001' FOR UPDATE");
        await client.query("INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at) SELECT $1,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,'dispatching',created_at,updated_at FROM searchad_hierarchy_objects WHERE hierarchy_object_id=$2",[randomUUID(),plan.objectIds[0]]);
        await client.query('COMMIT');
      }finally{await client.query('ROLLBACK');client.release();}
    };
    circuit.assertDispatchAllowed=async(...args)=>{try{return await authorize(...args);}catch(error){denied=error.details?.reasons?.includes('UNRESOLVED_MUTATION');throw error;}};
    // The competitor also invalidates the immutable capture graph; it must not
    // convert the denied send into a retry permit or refund the consumed claim.
    await assert.rejects(f.service.execute(input,context));
    assert.equal(denied,true,'actual final Circuit check must see the unrelated sibling');
    assert.equal(f.calls.filter(v=>v==='POST /ncc/keywords').length,0);
    assert.ok((await f.pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1',[plan.planId])).rows[0].used_at);
    const consumed=(await f.pool.query('SELECT sum(consumed_units)::int AS n FROM searchad_daily_risk_capacity')).rows[0].n;
    assert.equal(consumed,riskBefore+1);
    const restarted=new SiblingCreateService(f.args({keywordTexts:['haar-one','haar-two']}));
    await assert.rejects(restarted.execute(input,context));
    assert.equal((await f.pool.query('SELECT sum(consumed_units)::int AS n FROM searchad_daily_risk_capacity')).rows[0].n,consumed);
    assert.equal(f.calls.filter(v=>v==='POST /ncc/keywords').length,0);
  });

  for(const mode of ['partial','duplicate'])await t.test(`${mode} keyword batch never promotes ownership and is not resent`,async st=>{const f=await fixture(st,{keywordMode:mode});const plan=await f.service.prepareKeywords({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,activationId:await f.authority(OPS.keyword.create,keywordFields,'batch_create')},context);const first=await approveExecute(f,plan,'keywords');assert.notEqual(first.state,'owned');assert.equal(f.calls.filter(v=>v==='POST /ncc/keywords').length,1);await assert.rejects(approveExecute(f,plan,'keywords'));assert.equal(f.calls.filter(v=>v==='POST /ncc/keywords').length,1);const owned=(await f.pool.query("SELECT count(*)::int AS n FROM searchad_hierarchy_objects WHERE object_type='keyword' AND state='owned'")).rows[0].n;assert.equal(owned,0);});

  await t.test('TEXT_45 creative is a sibling under the same verified adgroup and uses one POST plus GET',async st=>{const f=await fixture(st);const plan=await f.service.prepareCreative({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,activationId:await f.authority(OPS.creative.create,creativeFields,'create')},context);const result=await approveExecute(f,plan,'creative');assert.equal(result.state,'owned');assert.equal(f.calls.filter(v=>v==='POST /ncc/ads').length,1);assert.equal(f.calls.filter(v=>v.startsWith('GET /ncc/ads/')).length,1);const row=(await f.pool.query("SELECT object_type,state,parent_object_id FROM searchad_hierarchy_objects WHERE object_type='creative'")).rows[0];assert.deepEqual([row.object_type,row.state,row.parent_object_id],['creative','owned',f.group.hierarchyObjectId]);});
});
