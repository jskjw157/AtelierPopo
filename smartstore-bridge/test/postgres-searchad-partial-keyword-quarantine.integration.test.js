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
const NOW=Date.parse('2026-09-15T09:00:00Z');
const context={principal:{principalId:'partial-quarantine-admin',role:'admin',customerIds:['1001']}};
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const adgroupFields=['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'];
const keywordFields=['keyword.keyword'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('trusted partial keyword result is quarantined without ownership promotion or replay', {timeout:180_000}, async t=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}

  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const schema=`partial_quarantine_${randomUUID().replaceAll('-','')}`,pools=new Set();
  const originalFetch=globalThis.fetch;let escaped=0;
  globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    try{await Promise.all([...pools].map(pool=>closePostgresPool(pool)));}
    finally{await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await closePostgresPool(admin);}
    assert.equal(escaped,0);
  });

  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped=new URL(url);
  scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);
  scoped.searchParams.set('application_name',schema);
  const pool=createPostgresPool({connectionString:scoped.toString(),sslMode:'disable',logger});pools.add(pool);
  await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});

  const registry=loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
  const config=loadSearchAdConfig({
    NAVER_SEARCHAD_ACCESS_LICENSE:'fixture-license',
    NAVER_SEARCHAD_SECRET_KEY:'fixture-secret',
    NAVER_SEARCHAD_CUSTOMER_ID:'1001',
    ATELIER_SEARCHAD_ALLOW_READS:'true',
    ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY:'true'
  });
  const credentials=new SearchAdCredentialsRegistry(config.topology);
  const identity={specSha:registry.status().specRef,credentialFingerprint:credentialFingerprintForCustomer(credentials,'1001'),upstreamBaseUrl:'https://api.searchad.naver.com'};
  await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");

  async function authority(operation,fields,kind='create'){
    const activationId=randomUUID(),evidenceId=`synthetic-${randomUUID()}`,start=new Date(NOW-1000).toISOString(),end=new Date(NOW+3600000).toISOString();
    await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`,[evidenceId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);
    await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture-authority',$9,$10)`,[activationId,evidenceId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);
    return activationId;
  }

  let rootRemote,groupRemote;
  const calls=[];
  const fetchImpl=async(urlValue,init)=>{
    const u=new URL(urlValue),body=init.body?JSON.parse(init.body):null;
    calls.push(`${init.method} ${u.pathname}`);
    assert.equal(u.origin,'https://api.searchad.naver.com');assert.equal(init.redirect,'error');
    if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};return json(rootRemote);}
    if(init.method==='GET'&&u.pathname===`/ncc/campaigns/${rootRemote?.nccCampaignId}`)return json(rootRemote);
    if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){groupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};return json(groupRemote,201);}
    if(init.method==='GET'&&u.pathname===`/ncc/adgroups/${groupRemote?.nccAdgroupId}`)return json(groupRemote);
    if(init.method==='POST'&&u.pathname==='/ncc/keywords')return json([{nccKeywordId:`kw-partial-${randomUUID()}`,keyword:body[0].keyword}]);
    throw new Error(`Unexpected ${init.method} ${u.pathname}`);
  };
  const args=extra=>({pool,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:300,preflightMaxAgeMs:5000,clock:()=>NOW,fetchImpl,logger,...extra});
  const writer=new PostgresSearchAdWriteRepository({pool});
  const approvals=new SearchAdApprovalService({repository:writer,config:{approvalTtlSeconds:300},clock:()=>NOW});
  const approve=id=>approvals.approve(id,{confirmation:'APPROVE_SEARCHAD_CHANGE',actor:'fixture-approver'});

  const campaign=new CampaignCreateService(args());
  const rootPlan=await campaign.prepare({customerId:'1001',activationId:await authority(OPS.campaign.create,campaignFields)},context);
  const root=await campaign.execute({customerId:'1001',hierarchyRunId:rootPlan.hierarchyRunId,hierarchyObjectId:rootPlan.hierarchyObjectId,planId:rootPlan.planId,executionToken:(await approve(rootPlan.planId)).executionToken},context);
  const adgroup=new AdgroupCreateService(args());
  const groupPlan=await adgroup.prepare({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:root.hierarchyObjectId,activationId:await authority(OPS.adgroup.create,adgroupFields)},context);
  const group=await adgroup.execute({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:root.hierarchyObjectId,hierarchyObjectId:groupPlan.hierarchyObjectId,planId:groupPlan.planId,executionToken:(await approve(groupPlan.planId)).executionToken},context);

  calls.length=0;
  const siblings=new SiblingCreateService(args({keywordTexts:['haar-one','haar-two']}));
  const plan=await siblings.prepareKeywords({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,activationId:await authority(OPS.keyword.create,keywordFields,'batch_create')},context);
  const token=await approve(plan.planId);
  const execution={customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,planId:plan.planId,executionToken:token.executionToken,kind:'keywords'};
  const result=await siblings.execute(execution,context);

  assert.equal(result.state,'manual_review');
  assert.equal(calls.filter(value=>value==='POST /ncc/keywords').length,1);
  assert.equal(calls.filter(value=>value.startsWith('GET /ncc/keywords/')).length,0,'partial results are not ownership-verified');

  const objects=(await pool.query("SELECT hierarchy_object_id,state,remote_id FROM searchad_hierarchy_objects WHERE object_type='keyword' ORDER BY hierarchy_object_id")).rows;
  assert.equal(objects.length,2);
  const quarantined=objects.filter(row=>row.remote_id);
  assert.equal(quarantined.length,1,'the explicitly echoed returned ID must not be lost');
  assert.equal(quarantined[0].state,'manual_review');
  assert.equal(objects.filter(row=>row.state==='owned').length,0);

  const holds=(await pool.query("SELECT hierarchy_object_id,object_type,remote_id,state,parent_hierarchy_object_id FROM searchad_remote_object_ownership WHERE object_type='keyword' ORDER BY ownership_id")).rows;
  assert.equal(holds.length,1);
  assert.equal(holds[0].hierarchy_object_id,quarantined[0].hierarchy_object_id);
  assert.equal(holds[0].remote_id,quarantined[0].remote_id);
  assert.equal(holds[0].state,'manual_review');
  assert.equal(holds[0].parent_hierarchy_object_id,group.hierarchyObjectId);

  await assert.rejects(siblings.execute(execution,context));
  assert.equal(calls.filter(value=>value==='POST /ncc/keywords').length,1,'partial batch must never be blindly resent');
});
