import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdLifecycleRepository } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { DescendantInventoryService } from '../src/naver/searchad/lifecycle/descendant-inventory-service.js';
import { PostgresDescendantInventoryRepository } from '../src/naver/searchad/lifecycle/postgres-descendant-inventory-repository.js';
import {
  DESCENDANT_INVENTORY_OPERATIONS,
  DESCENDANT_INVENTORY_PAGE_SIZE
} from '../src/naver/searchad/lifecycle/descendant-inventory-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';

const logger={info(){},warn(){},error(){}};
const NOW=Date.parse('2026-09-19T00:00:00Z');
const identity={
  specSha:'fixture-spec-sha',
  credentialFingerprint:'fixture-credential-fingerprint',
  upstreamBaseUrl:'https://api.searchad.naver.com'
};
const context={principal:{principalId:'descendant-inventory-admin',role:'admin',customerIds:['1001']}};

function envelope(operationKey,data){
  return {operation:{operationKey,sideEffect:false},upstream:{status:200},data};
}

test('unmanaged descendant inventory persists immutable read-only observations only', {timeout:180_000}, async t=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}

  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const schema=`descendant_inventory_${randomUUID().replaceAll('-','')}`,pools=new Set();
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

  const lifecycle=new PostgresSearchAdLifecycleRepository({pool});
  const runId=randomUUID(),campaignObjectId=randomUUID(),adgroupObjectId=randomUUID();
  const campaignRemoteId='cmp-owned-1',adgroupRemoteId='grp-owned-1',at=new Date(NOW).toISOString();

  await lifecycle.createRun({
    hierarchyRunId:runId,customerId:'1001',recipeId:'fixture-descendant-inventory',
    status:'cleanup_pending',startedByPrincipalId:'fixture-owner',
    ...identity,activationId:null,startedAt:at,completedAt:null,lastError:null
  });
  await lifecycle.createObject({
    hierarchyObjectId:campaignObjectId,hierarchyRunId:runId,customerId:'1001',
    objectType:'campaign',parentObjectId:null,
    createOperationKey:OPS.campaign.create,readOperationKey:OPS.campaign.read,deleteOperationKey:OPS.campaign.delete,
    remoteId:campaignRemoteId,state:'owned',createdAt:at,updatedAt:at,deletedAt:null
  });
  await lifecycle.createObject({
    hierarchyObjectId:adgroupObjectId,hierarchyRunId:runId,customerId:'1001',
    objectType:'adgroup',parentObjectId:campaignObjectId,
    createOperationKey:OPS.adgroup.create,readOperationKey:OPS.adgroup.read,deleteOperationKey:OPS.adgroup.delete,
    remoteId:adgroupRemoteId,state:'owned',createdAt:at,updatedAt:at,deletedAt:null
  });
  await lifecycle.holdOwnership({
    ownershipId:randomUUID(),customerId:'1001',objectType:'campaign',remoteId:campaignRemoteId,
    ownerKind:'hierarchy_canary',ownerRunId:runId,hierarchyObjectId:campaignObjectId,
    parentHierarchyObjectId:null,createdOperationKey:OPS.campaign.create,state:'owned',createdAt:at,updatedAt:at
  });
  await lifecycle.holdOwnership({
    ownershipId:randomUUID(),customerId:'1001',objectType:'adgroup',remoteId:adgroupRemoteId,
    ownerKind:'hierarchy_canary',ownerRunId:runId,hierarchyObjectId:adgroupObjectId,
    parentHierarchyObjectId:campaignObjectId,createdOperationKey:OPS.adgroup.create,state:'owned',createdAt:at,updatedAt:at
  });

  async function localState(){
    const run=(await pool.query('SELECT hierarchy_run_id,status,completed_at,last_error_json FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1',[runId])).rows;
    const objects=(await pool.query('SELECT hierarchy_object_id,object_type,parent_object_id,remote_id,state,deleted_at,updated_at FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 ORDER BY hierarchy_object_id',[runId])).rows;
    const holds=(await pool.query('SELECT ownership_id,hierarchy_object_id,object_type,remote_id,state,parent_hierarchy_object_id,updated_at FROM searchad_remote_object_ownership WHERE owner_run_id=$1 ORDER BY ownership_id',[runId])).rows;
    const plans=(await pool.query('SELECT plan_id,status,applied_at,applied_after_hash FROM searchad_write_change_plans WHERE customer_id=$1 ORDER BY plan_id',['1001'])).rows;
    const risks=(await pool.query('SELECT count(*)::int AS count FROM searchad_risk_reservations WHERE owner_run_id=$1',[runId])).rows[0].count;
    const attempts=(await pool.query('SELECT count(*)::int AS count FROM searchad_write_attempts')).rows[0].count;
    return {run,objects,holds,plans,risks,attempts};
  }

  const repository=new PostgresDescendantInventoryRepository({pool});
  const makeService=(read,contextResolver=async()=>identity)=>new DescendantInventoryService({
    repository,remote:{read},contextResolver,clock:()=>NOW
  });
  const baseline=await localState();

  const cases=[
    {
      parentObjectId:campaignObjectId,parentType:'campaign',parentRemoteId:campaignRemoteId,childType:'adgroup',
      operationKey:DESCENDANT_INVENTORY_OPERATIONS.campaignAdgroup,
      query:{nccCampaignId:campaignRemoteId,recordSize:DESCENDANT_INVENTORY_PAGE_SIZE},
      remoteIds:['grp-known','grp-unmanaged'],
      rows:[
        {customerId:'1001',nccCampaignId:campaignRemoteId,nccAdgroupId:'grp-known'},
        {customerId:'1001',nccCampaignId:campaignRemoteId,nccAdgroupId:'grp-unmanaged'}
      ]
    },
    {
      parentObjectId:adgroupObjectId,parentType:'adgroup',parentRemoteId:adgroupRemoteId,childType:'keyword',
      operationKey:DESCENDANT_INVENTORY_OPERATIONS.adgroupKeyword,
      query:{nccAdgroupId:adgroupRemoteId,recordSize:DESCENDANT_INVENTORY_PAGE_SIZE},
      remoteIds:['kw-known','kw-unmanaged'],
      rows:[
        {customerId:'1001',nccAdgroupId:adgroupRemoteId,nccKeywordId:'kw-known',keyword:'haar-one'},
        {customerId:'1001',nccAdgroupId:adgroupRemoteId,nccKeywordId:'kw-unmanaged',keyword:'external-keyword'}
      ]
    },
    {
      parentObjectId:adgroupObjectId,parentType:'adgroup',parentRemoteId:adgroupRemoteId,childType:'creative',
      operationKey:DESCENDANT_INVENTORY_OPERATIONS.adgroupCreative,
      query:{nccAdgroupId:adgroupRemoteId},
      remoteIds:['ad-known','ad-unmanaged'],
      rows:[
        {customerId:'1001',nccAdgroupId:adgroupRemoteId,nccAdId:'ad-known',type:'TEXT_45'},
        {customerId:'1001',nccAdgroupId:adgroupRemoteId,nccAdId:'ad-unmanaged',type:'TEXT_45'}
      ]
    }
  ];

  await t.test('rejects caller target overrides before any remote read',async()=>{
    let reads=0;
    const service=makeService(async()=>{reads++;return envelope(cases[0].operationKey,[]);});
    await assert.rejects(
      service.inventory({customerId:'1001',hierarchyRunId:runId,parentObjectId:campaignObjectId,childType:'adgroup',parentRemoteId:'victim'},context),
      error=>error?.code==='SEARCHAD_DESCENDANT_INVENTORY_INPUT_INVALID'
    );
    assert.equal(reads,0);assert.deepEqual(await localState(),baseline);
  });

  await t.test('requires Admin with explicit Customer access before any remote read',async()=>{
    let reads=0;
    const service=makeService(async()=>{reads++;return envelope(cases[0].operationKey,[]);});
    await assert.rejects(
      service.inventory({customerId:'1001',hierarchyRunId:runId,parentObjectId:campaignObjectId,childType:'adgroup'},{principal:{principalId:'reader',role:'reader',customerIds:['1001']}}),
      error=>error?.code==='SEARCHAD_DESCENDANT_INVENTORY_FORBIDDEN'
    );
    assert.equal(reads,0);assert.deepEqual(await localState(),baseline);
  });

  await t.test('records presence for campaign adgroups, adgroup keywords, and adgroup creatives without mapping or cleanup authority',async()=>{
    for(const item of cases){
      const descriptors=[];
      const service=makeService(async descriptor=>{descriptors.push(structuredClone(descriptor));return envelope(item.operationKey,item.rows);});
      const result=await service.inventory({
        customerId:'1001',hierarchyRunId:runId,parentObjectId:item.parentObjectId,childType:item.childType
      },context);
      assert.deepEqual(descriptors,[{operationKey:item.operationKey,customerId:'1001',query:item.query}]);
      assert.deepEqual(result,{
        hierarchyRunId:runId,parentObjectId:item.parentObjectId,parentType:item.parentType,childType:item.childType,
        kind:'present_remote_descendants',count:2,remoteIds:item.remoteIds,completeAbsence:false,changed:false
      });
      assert.equal(Object.hasOwn(result,'cleanupAuthority'),false);
      assert.equal(Object.hasOwn(result,'matchedLocalObjectId'),false);

      const event=(await pool.query(
        "SELECT phase,status,operation_key,lifecycle_kind,details_json FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND hierarchy_object_id=$2 AND phase='descendant_inventory' AND operation_key=$3 ORDER BY created_at DESC,event_id DESC LIMIT 1",
        [runId,item.parentObjectId,item.operationKey]
      )).rows[0];
      assert.equal(event.phase,'descendant_inventory');
      assert.equal(event.status,'observed_present_remote_descendants');
      assert.equal(event.operation_key,item.operationKey);assert.equal(event.lifecycle_kind,null);
      assert.deepEqual(event.details_json,{
        readOnly:true,parentType:item.parentType,childType:item.childType,observation:'present_remote_descendants',
        count:2,completeAbsence:false,remoteIdsHash:contentHash([...item.remoteIds].sort()),
        localMapping:false,cleanupAuthority:false
      });
      for(const remoteId of item.remoteIds)assert.equal(JSON.stringify(event.details_json).includes(remoteId),false);
      assert.deepEqual(await localState(),baseline,'inventory may append immutable events only');
    }
  });

  await t.test('records empty lists as empty_unproven and never complete absence for all three relations',async()=>{
    for(const item of cases){
      const service=makeService(async()=>envelope(item.operationKey,[]));
      const result=await service.inventory({
        customerId:'1001',hierarchyRunId:runId,parentObjectId:item.parentObjectId,childType:item.childType
      },context);
      assert.equal(result.kind,'empty_unproven');assert.equal(result.count,0);
      assert.deepEqual(result.remoteIds,[]);assert.equal(result.completeAbsence,false);assert.equal(result.changed,false);
      const event=(await pool.query(
        "SELECT details_json FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND hierarchy_object_id=$2 AND phase='descendant_inventory' AND status='observed_empty_unproven' AND operation_key=$3 ORDER BY created_at DESC,event_id DESC LIMIT 1",
        [runId,item.parentObjectId,item.operationKey]
      )).rows[0];
      assert.deepEqual(event.details_json,{
        readOnly:true,parentType:item.parentType,childType:item.childType,observation:'empty_unproven',
        count:0,completeAbsence:false,remoteIdsHash:contentHash([]),localMapping:false,cleanupAuthority:false
      });
      assert.deepEqual(await localState(),baseline);
    }
  });

  await t.test('sanitizes remote read failure into unresolved without lifecycle mutation',async()=>{
    const item=cases[1];
    const service=makeService(async()=>{throw new Error('fixture-secret-upstream-body');});
    const result=await service.inventory({customerId:'1001',hierarchyRunId:runId,parentObjectId:item.parentObjectId,childType:item.childType},context);
    assert.equal(result.kind,'unresolved');assert.equal(result.completeAbsence,false);assert.equal(result.changed,false);
    const event=(await pool.query(
      "SELECT details_json FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND hierarchy_object_id=$2 AND phase='descendant_inventory' AND status='observed_unresolved' ORDER BY created_at DESC,event_id DESC LIMIT 1",
      [runId,item.parentObjectId]
    )).rows[0];
    assert.equal(JSON.stringify(event.details_json).includes('fixture-secret'),false);
    assert.deepEqual(await localState(),baseline);
  });

  await t.test('revalidates current SearchAd identity after remote read before recording',async()=>{
    const item=cases[2];
    const before=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='descendant_inventory'",[runId])).rows[0].count;
    let resolutions=0;
    const resolver=async()=>resolutions++===0?identity:{...identity,credentialFingerprint:'rotated'};
    const service=makeService(async()=>envelope(item.operationKey,[]),resolver);
    await assert.rejects(
      service.inventory({customerId:'1001',hierarchyRunId:runId,parentObjectId:item.parentObjectId,childType:item.childType},context),
      error=>error?.code==='SEARCHAD_DESCENDANT_INVENTORY_CONTEXT_MISMATCH'
    );
    const after=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='descendant_inventory'",[runId])).rows[0].count;
    assert.equal(after,before);assert.deepEqual(await localState(),baseline);
  });

  await t.test('rejects stale graph or audit drift that occurs during remote inventory read',async()=>{
    const item=cases[0];
    const before=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='descendant_inventory'",[runId])).rows[0].count;
    const service=makeService(async()=>{
      await pool.query(
        "INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) VALUES($1,$2,$3,'1001','fixture_inventory_drift','changed',$4,NULL,'{}'::jsonb,$5)",
        [randomUUID(),runId,campaignObjectId,item.operationKey,at]
      );
      return envelope(item.operationKey,[]);
    });
    await assert.rejects(
      service.inventory({customerId:'1001',hierarchyRunId:runId,parentObjectId:item.parentObjectId,childType:item.childType},context),
      error=>error?.code==='SEARCHAD_DESCENDANT_INVENTORY_STALE'
    );
    const after=(await pool.query("SELECT count(*)::int AS count FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='descendant_inventory'",[runId])).rows[0].count;
    assert.equal(after,before);assert.deepEqual(await localState(),baseline);
  });
});
