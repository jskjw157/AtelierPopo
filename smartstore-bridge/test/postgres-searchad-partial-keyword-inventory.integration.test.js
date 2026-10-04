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
import { PartialKeywordInventoryService } from '../src/naver/searchad/lifecycle/partial-keyword-inventory-service.js';
import { PostgresPartialKeywordInventoryRepository } from '../src/naver/searchad/lifecycle/postgres-partial-keyword-inventory-repository.js';
import { PARTIAL_KEYWORD_INVENTORY_OPERATION } from '../src/naver/searchad/lifecycle/partial-keyword-inventory-contract.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';

const logger={info(){},warn(){},error(){}};
const NOW=Date.parse('2026-09-15T13:30:00Z');
const context={principal:{principalId:'partial-inventory-admin',role:'admin',customerIds:['1001']}};
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const adgroupFields=['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'];
const keywordFields=['keyword.keyword'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

function inventoryEnvelope(adgroupRemoteId,items){
  return {
    operation:{operationKey:PARTIAL_KEYWORD_INVENTORY_OPERATION,sideEffect:false},
    upstream:{status:200},
    data:items.map(item=>({customerId:'1001',nccAdgroupId:adgroupRemoteId,...item}))
  };
}

test('partial keyword remote inventory persists only read-only fail-closed observations', {timeout:180_000}, async t=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}

  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const schema=`partial_inventory_${randomUUID().replaceAll('-','')}`,pools=new Set();
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

  let rootRemote,groupRemote,partialRemote;
  const createCalls=[];
  const fetchImpl=async(urlValue,init)=>{
    const u=new URL(urlValue),body=init.body?JSON.parse(init.body):null;
    createCalls.push(`${init.method} ${u.pathname}`);
    assert.equal(u.origin,'https://api.searchad.naver.com');assert.equal(init.redirect,'error');
    if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};return json(rootRemote);}
    if(init.method==='GET'&&u.pathname===`/ncc/campaigns/${rootRemote?.nccCampaignId}`)return json(rootRemote);
    if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){groupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};return json(groupRemote,201);}
    if(init.method==='GET'&&u.pathname===`/ncc/adgroups/${groupRemote?.nccAdgroupId}`)return json(groupRemote);
    if(init.method==='POST'&&u.pathname==='/ncc/keywords'){
      partialRemote=`kw-partial-${randomUUID()}`;
      return json([{nccKeywordId:partialRemote,keyword:body[0].keyword}]);
    }
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
  const siblings=new SiblingCreateService(args({keywordTexts:['haar-one','haar-two']}));
  const siblingPlan=await siblings.prepareKeywords({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,activationId:await authority(OPS.keyword.create,keywordFields,'batch_create')},context);
  const siblingResult=await siblings.execute({customerId:'1001',hierarchyRunId:root.hierarchyRunId,parentObjectId:group.hierarchyObjectId,planId:siblingPlan.planId,executionToken:(await approve(siblingPlan.planId)).executionToken,kind:'keywords'},context);
  assert.equal(siblingResult.state,'manual_review');

  const unresolved=(await pool.query("SELECT hierarchy_object_id,state,remote_id FROM searchad_hierarchy_objects WHERE object_type='keyword' AND remote_id IS NULL")).rows;
  assert.equal(unresolved.length,1);assert.equal(unresolved[0].state,'manual_review');
  const runRow=(await pool.query('SELECT status FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1',[root.hierarchyRunId])).rows[0];
  assert.equal(runRow.status,'manual_review');

  async function localState(){
    const run=(await pool.query('SELECT hierarchy_run_id,status,completed_at FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1',[root.hierarchyRunId])).rows;
    const objects=(await pool.query('SELECT hierarchy_object_id,object_type,parent_object_id,remote_id,state,deleted_at,updated_at FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 ORDER BY hierarchy_object_id',[root.hierarchyRunId])).rows;
    const holds=(await pool.query('SELECT ownership_id,hierarchy_object_id,object_type,remote_id,state,parent_hierarchy_object_id,updated_at FROM searchad_remote_object_ownership WHERE owner_run_id=$1 ORDER BY ownership_id',[root.hierarchyRunId])).rows;
    const plans=(await pool.query('SELECT plan_id,status,applied_at,applied_after_hash FROM searchad_write_change_plans WHERE customer_id=$1 ORDER BY plan_id',['1001'])).rows;
    const risks=(await pool.query('SELECT count(*)::int AS count FROM searchad_risk_reservations WHERE owner_run_id=$1',[root.hierarchyRunId])).rows[0].count;
    const attempts=(await pool.query('SELECT count(*)::int AS count FROM searchad_write_attempts')).rows[0].count;
    return {run,objects,holds,plans,risks,attempts};
  }

  const repository=new PostgresPartialKeywordInventoryRepository({pool,dailyBudget:1000});
  const scope={customerId:'1001',hierarchyRunId:root.hierarchyRunId,adgroupObjectId:group.hierarchyObjectId};
  const makeService=(read,contextResolver=async()=>identity)=>new PartialKeywordInventoryService({repository,remote:{read},contextResolver,clock:()=>NOW});
  const baseline=await localState();

  await t.test('rejects caller target overrides before any remote read',async()=>{
    let reads=0;
    const service=makeService(async()=>{reads++;return inventoryEnvelope(groupRemote.nccAdgroupId,[]);});
    await assert.rejects(service.inventory({...scope,remoteId:'victim'},context),error=>error?.code==='SEARCHAD_PARTIAL_KEYWORD_INVENTORY_INPUT_INVALID');
    assert.equal(reads,0);
    assert.deepEqual(await localState(),baseline);
  });

  await t.test('requires Admin with explicit Customer access before any remote read',async()=>{
    let reads=0;
    const service=makeService(async()=>{reads++;return inventoryEnvelope(groupRemote.nccAdgroupId,[]);});
    await assert.rejects(service.inventory(scope,{principal:{principalId:'reader',role:'reader',customerIds:['1001']}}),error=>error?.code==='SEARCHAD_PARTIAL_KEYWORD_INVENTORY_FORBIDDEN');
    assert.equal(reads,0);
    assert.deepEqual(await localState(),baseline);
  });

  await t.test('records descendant presence without mapping a plausible remote keyword onto the unreturned local object',async()=>{
    const orphan=`kw-orphan-${randomUUID()}`,descriptors=[];
    const service=makeService(async descriptor=>{
      descriptors.push(structuredClone(descriptor));
      return inventoryEnvelope(groupRemote.nccAdgroupId,[
        {nccKeywordId:partialRemote,keyword:'haar-one'},
        {nccKeywordId:orphan,keyword:'haar-two'}
      ]);
    });
    const result=await service.inventory(scope,context);
    assert.deepEqual(descriptors,[{operationKey:PARTIAL_KEYWORD_INVENTORY_OPERATION,customerId:'1001',query:{nccAdgroupId:groupRemote.nccAdgroupId,recordSize:1000}}]);
    assert.deepEqual(result,{hierarchyRunId:root.hierarchyRunId,adgroupObjectId:group.hierarchyObjectId,kind:'present_remote_descendants',count:2,remoteIds:[partialRemote,orphan],completeAbsence:false,changed:false});
    assert.deepEqual(await localState(),baseline,'inventory may add an immutable event only; it must not mutate lifecycle state');
    const unknown=(await pool.query('SELECT remote_id,state FROM searchad_hierarchy_objects WHERE hierarchy_object_id=$1',[unresolved[0].hierarchy_object_id])).rows[0];
    assert.deepEqual(unknown,{remote_id:null,state:'manual_review'},'matching keyword text must not create positional/name-based ownership');
    const unknownHold=(await pool.query('SELECT count(*)::int AS count FROM searchad_remote_object_ownership WHERE hierarchy_object_id=$1',[unresolved[0].hierarchy_object_id])).rows[0];
    assert.equal(unknownHold.count,0);
    const event=(await pool.query("SELECT phase,status,operation_key,lifecycle_kind,details_json FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='partial_keyword_inventory' AND status='observed_present_remote_descendants'",[root.hierarchyRunId])).rows[0];
    assert.equal(event.phase,'partial_keyword_inventory');assert.equal(event.operation_key,PARTIAL_KEYWORD_INVENTORY_OPERATION);assert.equal(event.lifecycle_kind,null);
    assert.deepEqual(event.details_json,{readOnly:true,observation:'present_remote_descendants',count:2,completeAbsence:false,remoteIdsHash:contentHash([orphan,partialRemote].sort()),localMapping:false});
    assert.equal(JSON.stringify(event.details_json).includes(orphan),false,'raw discovered IDs are not persisted as ownership-looking audit payload');
    assert.equal(Object.hasOwn(result,'matchedLocalObjectId'),false);assert.equal(Object.hasOwn(result,'keywordMapping'),false);
  });

  await t.test('records an empty partial list as empty_unproven, never complete absence',async()=>{
    const service=makeService(async()=>inventoryEnvelope(groupRemote.nccAdgroupId,[]));
    const result=await service.inventory(scope,context);
    assert.deepEqual(result,{hierarchyRunId:root.hierarchyRunId,adgroupObjectId:group.hierarchyObjectId,kind:'empty_unproven',count:0,remoteIds:[],completeAbsence:false,changed:false});
    assert.deepEqual(await localState(),baseline);
    const event=(await pool.query("SELECT details_json FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='partial_keyword_inventory' AND status='observed_empty_unproven'",[root.hierarchyRunId])).rows[0];
    assert.deepEqual(event.details_json,{readOnly:true,observation:'empty_unproven',count:0,completeAbsence:false,remoteIdsHash:contentHash([]),localMapping:false});
    assert.equal((await pool.query('SELECT status FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1',[root.hierarchyRunId])).rows[0].status,'manual_review');
  });

  await t.test('sanitizes a remote read outage into unresolved without changing the graph',async()=>{
    const service=makeService(async()=>{throw new Error('fixture-secret-upstream-body');});
    const result=await service.inventory(scope,context);
    assert.deepEqual(result,{hierarchyRunId:root.hierarchyRunId,adgroupObjectId:group.hierarchyObjectId,kind:'unresolved',count:0,remoteIds:[],completeAbsence:false,changed:false});
    assert.deepEqual(await localState(),baseline);
    const event=(await pool.query("SELECT details_json FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='partial_keyword_inventory' AND status='observed_unresolved' ORDER BY event_id DESC LIMIT 1",[root.hierarchyRunId])).rows[0];
    assert.deepEqual(event.details_json,{readOnly:true,observation:'unresolved',count:0,completeAbsence:false,remoteIdsHash:contentHash([]),localMapping:false});
    assert.equal(JSON.stringify(event.details_json).includes('fixture-secret'),false);
  });

  await t.test('revalidates current SearchAd identity after the remote read before recording',async()=>{
    const before=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='partial_keyword_inventory'",[root.hierarchyRunId])).rows[0].count;
    let resolutions=0;
    const resolver=async()=>resolutions++===0?identity:{...identity,credentialFingerprint:'rotated'};
    const service=makeService(async()=>inventoryEnvelope(groupRemote.nccAdgroupId,[]),resolver);
    await assert.rejects(service.inventory(scope,context),error=>error?.code==='SEARCHAD_PARTIAL_KEYWORD_INVENTORY_CONTEXT_MISMATCH');
    const after=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='partial_keyword_inventory'",[root.hierarchyRunId])).rows[0].count;
    assert.equal(after,before);assert.deepEqual(await localState(),baseline);
  });

  await t.test('rejects a stale graph changed while the remote list read is in flight',async()=>{
    const before=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='partial_keyword_inventory'",[root.hierarchyRunId])).rows[0].count;
    const service=makeService(async()=>{
      await pool.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) VALUES($1,$2,$3,'1001','fixture_inventory_drift','changed',$4,NULL,'{}'::jsonb,$5)`,[randomUUID(),root.hierarchyRunId,group.hierarchyObjectId,PARTIAL_KEYWORD_INVENTORY_OPERATION,new Date(NOW).toISOString()]);
      return inventoryEnvelope(groupRemote.nccAdgroupId,[]);
    });
    await assert.rejects(service.inventory(scope,context),error=>error?.code==='SEARCHAD_PARTIAL_KEYWORD_INVENTORY_STALE');
    const after=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='partial_keyword_inventory'",[root.hierarchyRunId])).rows[0].count;
    assert.equal(after,before);assert.deepEqual(await localState(),baseline);
  });
});
