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
const NOW=Date.parse('2026-09-13T10:00:00Z');
const context={principal:{principalId:'extended-cleanup-admin',role:'admin',customerIds:['1001']}};
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const adgroupFields=['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'];
const keywordFields=['keyword.keyword'];
const json=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

async function loadCleanupService(){
  try{return (await import('../src/naver/searchad/lifecycle/extended-child-cleanup-service.js')).ExtendedChildCleanupService;}
  catch{return null;}
}

test('verified keyword leaves must be cleaned before their adgroup and campaign', {timeout:180_000}, async t=>{
  const Service=await loadCleanupService();
  assert.equal(typeof Service,'function','missing ExtendedChildCleanupService');
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}
  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const originalFetch=globalThis.fetch;let escaped=0;globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  const schema=`extended_cleanup_${randomUUID().replaceAll('-','')}`,pools=new Set();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    try{
      await Promise.all([...pools].map(pool=>closePostgresPool(pool)));
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await closePostgresPool(admin);
    }
    assert.equal(escaped,0);
  });
  const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);scoped.searchParams.set('application_name',schema);
  const connect=()=>{const p=createPostgresPool({connectionString:scoped.toString(),sslMode:'disable',logger});pools.add(p);return p;};
  const pool=connect();await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
  const registry=loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
  const config=loadSearchAdConfig({NAVER_SEARCHAD_ACCESS_LICENSE:'fixture-license',NAVER_SEARCHAD_SECRET_KEY:'fixture-secret',NAVER_SEARCHAD_CUSTOMER_ID:'1001',ATELIER_SEARCHAD_ALLOW_READS:'true',ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY:'true'});
  const credentials=new SearchAdCredentialsRegistry(config.topology);
  const identity={specSha:registry.status().specRef,credentialFingerprint:credentialFingerprintForCustomer(credentials,'1001'),upstreamBaseUrl:'https://api.searchad.naver.com'};
  await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
  let time=NOW;const calls=[],gone=new Set();let rootRemote,groupRemote,keywordRemote=[];
  const authority=async(operation,fields,kind)=>{const activationId=randomUUID(),evidenceId=`synthetic-${randomUUID()}`,start=new Date(time-1000).toISOString(),end=new Date(time+3600000).toISOString();
    await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`,[evidenceId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);
    await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture-authority',$9,$10)`,[activationId,evidenceId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);return activationId;};
  const fetchImpl=async(urlValue,init)=>{const u=new URL(urlValue),body=init.body?JSON.parse(init.body):null;calls.push(`${init.method} ${u.pathname}`);assert.equal(u.origin,'https://api.searchad.naver.com');assert.equal(init.redirect,'error');
    if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};return json(rootRemote);}
    if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){groupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};return json(groupRemote,201);}
    if(init.method==='POST'&&u.pathname==='/ncc/keywords'){keywordRemote=body.map((item,index)=>({customerId:'1001',nccAdgroupId:groupRemote.nccAdgroupId,nccKeywordId:`kw-${index+1}-${randomUUID()}`,keyword:item.keyword}));return json(keywordRemote.map(({customerId,nccAdgroupId,...row})=>row));}
    const campaignPath=`/ncc/campaigns/${rootRemote?.nccCampaignId}`,groupPath=`/ncc/adgroups/${groupRemote?.nccAdgroupId}`;
    if(u.pathname===campaignPath||u.pathname===groupPath||u.pathname.startsWith('/ncc/keywords/')){
      const id=u.pathname.split('/').at(-1),key=u.pathname===campaignPath?'campaign':u.pathname===groupPath?'adgroup':id;
      if(init.method==='DELETE'){gone.add(key);return json(null,204);}
      if(init.method==='GET'){
        if(gone.has(key))return json({code:'NOT_FOUND'},404);
        if(key==='campaign')return json(rootRemote);
        if(key==='adgroup')return json(groupRemote);
        const row=keywordRemote.find(item=>item.nccKeywordId===id);return row?json(row):json({code:'NOT_FOUND'},404);
      }
    }
    throw new Error(`Unexpected ${init.method} ${u.pathname}`);
  };
  const args=extra=>({pool,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:300,preflightMaxAgeMs:5000,clock:()=>time,fetchImpl,logger,...extra});
  const writer=new PostgresSearchAdWriteRepository({pool}),approval=new SearchAdApprovalService({repository:writer,config:{approvalTtlSeconds:300},clock:()=>time});
  const approve=id=>approval.approve(id,{confirmation:'APPROVE_SEARCHAD_CHANGE',actor:'fixture-approver'});

  const campaign=new CampaignCreateService(args());const rootPlan=await campaign.prepare({customerId:'1001',activationId:await authority(OPS.campaign.create,campaignFields,'create')},context);const root=await campaign.execute({customerId:'1001',hierarchyRunId:rootPlan.hierarchyRunId,hierarchyObjectId:rootPlan.hierarchyObjectId,planId:rootPlan.planId,executionToken:(await approve(rootPlan.planId)).executionToken},context);
  const adgroup=new AdgroupCreateService(args());const groupPlan=await adgroup.prepare({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:root.hierarchyObjectId,activationId:await authority(OPS.adgroup.create,adgroupFields,'create')},context);const group=await adgroup.execute({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:root.hierarchyObjectId,hierarchyObjectId:groupPlan.hierarchyObjectId,planId:groupPlan.planId,executionToken:(await approve(groupPlan.planId)).executionToken},context);
  const sibling=new SiblingCreateService(args({keywordTexts:['haar-one','haar-two']}));const siblingPlan=await sibling.prepareKeywords({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,activationId:await authority(OPS.keyword.create,keywordFields,'batch_create')},context);const siblingResult=await sibling.execute({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,planId:siblingPlan.planId,executionToken:(await approve(siblingPlan.planId)).executionToken,kind:'keywords'},context);assert.equal(siblingResult.state,'owned');
  const leaves=(await pool.query("SELECT hierarchy_object_id,remote_id FROM searchad_hierarchy_objects WHERE object_type='keyword' ORDER BY hierarchy_object_id")).rows;assert.equal(leaves.length,2);
  calls.length=0;

  const cleanup=new Service(args({pool:connect()}));
  const scope=id=>({customerId:'1001',hierarchyRunId:root.hierarchyRunId,hierarchyObjectId:id});
  const prepare=async(id,type)=>cleanup.prepare({...scope(id),activationId:await authority(OPS[type].delete,[],'delete')},context);
  const execute=async(plan,id)=>{const token=await approve(plan.planId);return cleanup.execute({...scope(id),planId:plan.planId,executionToken:token.executionToken,confirmation:plan.requiredConfirmation,secondConfirmation:plan.requiredSecondConfirmation},context);};

  await assert.rejects(prepare(group.hierarchyObjectId,'adgroup'));
  assert.equal(calls.length,0,'parent planning must fail locally while a leaf is owned');
  for(let index=0;index<leaves.length;index+=1){
    const leaf=leaves[index],plan=await prepare(leaf.hierarchy_object_id,'keyword');
    assert.equal((await execute(plan,leaf.hierarchy_object_id)).state,'deleted');
    assert.equal(calls.filter(call=>call===`DELETE /ncc/keywords/${leaf.remote_id}`).length,1);
    if(index===0)await assert.rejects(prepare(group.hierarchyObjectId,'adgroup'));
  }
  const groupDelete=await prepare(group.hierarchyObjectId,'adgroup');assert.equal((await execute(groupDelete,group.hierarchyObjectId)).state,'deleted');
  const rootDelete=await prepare(root.hierarchyObjectId,'campaign');assert.equal((await execute(rootDelete,root.hierarchyObjectId)).state,'deleted');
  const deletes=calls.filter(call=>call.startsWith('DELETE '));
  assert.deepEqual(deletes.slice(0,2).sort(),leaves.map(row=>`DELETE /ncc/keywords/${row.remote_id}`).sort());
  assert.equal(deletes.at(-2),`DELETE /ncc/adgroups/${groupRemote.nccAdgroupId}`);
  assert.equal(deletes.at(-1),`DELETE /ncc/campaigns/${rootRemote.nccCampaignId}`);
});
