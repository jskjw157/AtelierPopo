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
import { ExtendedChildCleanupService } from '../src/naver/searchad/lifecycle/extended-child-cleanup-service.js';
import { CREATIVE_FIELDS } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const logger={info(){},warn(){},error(){}};
const NOW=Date.parse('2026-09-13T10:30:00Z');
const context={principal:{principalId:'extended-creative-admin',role:'admin',customerIds:['1001']}};
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const adgroupFields=['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'];
const json=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('verified TEXT_45 creative must be absent before adgroup and campaign deletion', {timeout:180_000}, async t=>{
  const url=process.env.TEST_DATABASE_URL;if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}
  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger}),schema=`extended_creative_${randomUUID().replaceAll('-','')}`,pools=new Set();
  const originalFetch=globalThis.fetch;let escaped=0;globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  await admin.query(`CREATE SCHEMA "${schema}"`);
  t.after(async()=>{globalThis.fetch=originalFetch;try{await Promise.all([...pools].map(pool=>closePostgresPool(pool)));await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await closePostgresPool(admin);}assert.equal(escaped,0);});
  const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);scoped.searchParams.set('application_name',schema);
  const connect=()=>{const pool=createPostgresPool({connectionString:scoped.toString(),sslMode:'disable',logger});pools.add(pool);return pool;},pool=connect();
  await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
  const registry=loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
  const config=loadSearchAdConfig({NAVER_SEARCHAD_ACCESS_LICENSE:'fixture-license',NAVER_SEARCHAD_SECRET_KEY:'fixture-secret',NAVER_SEARCHAD_CUSTOMER_ID:'1001',ATELIER_SEARCHAD_ALLOW_READS:'true',ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY:'true'});
  const credentials=new SearchAdCredentialsRegistry(config.topology),identity={specSha:registry.status().specRef,credentialFingerprint:credentialFingerprintForCustomer(credentials,'1001'),upstreamBaseUrl:'https://api.searchad.naver.com'};
  await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
  let time=NOW,rootRemote,groupRemote,creativeRemote;const calls=[],gone=new Set();
  const authority=async(operation,fields,kind)=>{const activationId=randomUUID(),evidenceId=`synthetic-${randomUUID()}`,start=new Date(time-1000).toISOString(),end=new Date(time+3600000).toISOString();await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`,[evidenceId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture-authority',$9,$10)`,[activationId,evidenceId,identity.specSha,identity.credentialFingerprint,identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([kind]),start,end]);return activationId;};
  const fetchImpl=async(urlValue,init)=>{const u=new URL(urlValue),body=init.body?JSON.parse(init.body):null;calls.push(`${init.method} ${u.pathname}`);assert.equal(u.origin,'https://api.searchad.naver.com');assert.equal(init.redirect,'error');
    if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};return json(rootRemote);}
    if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){groupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};return json(groupRemote,201);}
    if(init.method==='POST'&&u.pathname==='/ncc/ads'){creativeRemote={customerId:'1001',nccAdId:`ad-${randomUUID()}`,...body};return json(creativeRemote,201);}
    const campaignPath=`/ncc/campaigns/${rootRemote?.nccCampaignId}`,groupPath=`/ncc/adgroups/${groupRemote?.nccAdgroupId}`,creativePath=`/ncc/ads/${creativeRemote?.nccAdId}`;
    if([campaignPath,groupPath,creativePath].includes(u.pathname)){
      const key=u.pathname===campaignPath?'campaign':u.pathname===groupPath?'adgroup':'creative';
      if(init.method==='DELETE'){gone.add(key);return json(null,204);}
      if(init.method==='GET'){if(gone.has(key))return json({code:'NOT_FOUND'},404);return json(key==='campaign'?rootRemote:key==='adgroup'?groupRemote:creativeRemote);}
    }
    throw new Error(`Unexpected ${init.method} ${u.pathname}`);
  };
  const args=extra=>({pool,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:300,preflightMaxAgeMs:5000,clock:()=>time,fetchImpl,logger,...extra});
  const writer=new PostgresSearchAdWriteRepository({pool}),approval=new SearchAdApprovalService({repository:writer,config:{approvalTtlSeconds:300},clock:()=>time}),approve=id=>approval.approve(id,{confirmation:'APPROVE_SEARCHAD_CHANGE',actor:'fixture-approver'});
  const campaign=new CampaignCreateService(args()),rootPlan=await campaign.prepare({customerId:'1001',activationId:await authority(OPS.campaign.create,campaignFields,'create')},context),root=await campaign.execute({customerId:'1001',hierarchyRunId:rootPlan.hierarchyRunId,hierarchyObjectId:rootPlan.hierarchyObjectId,planId:rootPlan.planId,executionToken:(await approve(rootPlan.planId)).executionToken},context);
  const adgroup=new AdgroupCreateService(args()),groupPlan=await adgroup.prepare({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:root.hierarchyObjectId,activationId:await authority(OPS.adgroup.create,adgroupFields,'create')},context),group=await adgroup.execute({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:root.hierarchyObjectId,hierarchyObjectId:groupPlan.hierarchyObjectId,planId:groupPlan.planId,executionToken:(await approve(groupPlan.planId)).executionToken},context);
  const sibling=new SiblingCreateService(args()),creativePlan=await sibling.prepareCreative({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,activationId:await authority(OPS.creative.create,CREATIVE_FIELDS,'create')},context),created=await sibling.execute({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,planId:creativePlan.planId,executionToken:(await approve(creativePlan.planId)).executionToken,kind:'creative'},context);assert.equal(created.state,'owned');
  const leaf=(await pool.query("SELECT hierarchy_object_id,remote_id FROM searchad_hierarchy_objects WHERE object_type='creative'")).rows[0];assert.ok(leaf?.remote_id);calls.length=0;
  const cleanup=new ExtendedChildCleanupService(args({pool:connect()})),scope=id=>({customerId:'1001',hierarchyRunId:root.hierarchyRunId,hierarchyObjectId:id});
  const prepare=async(id,type)=>cleanup.prepare({...scope(id),activationId:await authority(OPS[type].delete,[],'delete')},context),execute=async(plan,id)=>{const token=await approve(plan.planId);return cleanup.execute({...scope(id),planId:plan.planId,executionToken:token.executionToken,confirmation:plan.requiredConfirmation,secondConfirmation:plan.requiredSecondConfirmation},context);};
  await assert.rejects(prepare(group.hierarchyObjectId,'adgroup'));
  const leafPlan=await prepare(leaf.hierarchy_object_id,'creative');assert.equal((await execute(leafPlan,leaf.hierarchy_object_id)).state,'deleted');
  const groupDelete=await prepare(group.hierarchyObjectId,'adgroup');assert.equal((await execute(groupDelete,group.hierarchyObjectId)).state,'deleted');
  const rootDelete=await prepare(root.hierarchyObjectId,'campaign');assert.equal((await execute(rootDelete,root.hierarchyObjectId)).state,'deleted');
  assert.deepEqual(calls.filter(call=>call.startsWith('DELETE ')),[`DELETE /ncc/ads/${creativeRemote.nccAdId}`,`DELETE /ncc/adgroups/${groupRemote.nccAdgroupId}`,`DELETE /ncc/campaigns/${rootRemote.nccCampaignId}`]);
});
