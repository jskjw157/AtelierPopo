import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresActiveCanaryRepository } from '../src/naver/searchad/canary/postgres-repository.js';
import { PostgresSearchAdLifecycleRepository } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { DescendantInventoryService } from '../src/naver/searchad/lifecycle/descendant-inventory-service.js';
import { PostgresDescendantInventoryRepository } from '../src/naver/searchad/lifecycle/postgres-descendant-inventory-repository.js';
import { DESCENDANT_INVENTORY_OPERATIONS as LIST } from '../src/naver/searchad/lifecycle/descendant-inventory-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { hasUnprovenInventory } from '../src/naver/searchad/lifecycle/inventory-cleanup-fence.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';

const logger={info(){},warn(){},error(){}};
const NOW=Date.parse('2026-09-20T00:00:00Z');
const identity={specSha:'fixture-scan-spec',credentialFingerprint:'fixture-scan-credentials',upstreamBaseUrl:'https://api.searchad.naver.com'};
const context={principal:{principalId:'scan-admin',role:'admin',customerIds:['1001']}};
const envelope=(operationKey,data)=>({operation:{operationKey,sideEffect:false},upstream:{status:200},data});

// Storage fixtures are synthetic, not lifecycle evidence. The PostgreSQL
// migrations, repository, service, classifier and veto are real code.
test('bounded descendant scan persists one non-authorizing observation across pages', {timeout:180_000}, async t=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}
  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const schema=`descendant_scan_${randomUUID().replaceAll('-','')}`;
  let pool,escaped=0;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  t.after(async()=>{
    globalThis.fetch=originalFetch;
    try{if(pool)await closePostgresPool(pool);}
    finally{await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await closePostgresPool(admin);}
    assert.equal(escaped,0);
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);
  pool=createPostgresPool({connectionString:scoped.toString(),sslMode:'disable',logger});
  await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
  await new PostgresActiveCanaryRepository({pool}).upsertAccount({customerId:'1001',suspended:true});
  const storage=new PostgresSearchAdLifecycleRepository({pool});
  const runId=randomUUID(),campaignId=randomUUID(),groupId=randomUUID(),at=new Date(NOW).toISOString();
  await storage.createRun({hierarchyRunId:runId,customerId:'1001',recipeId:'fixture-scan',status:'cleanup_pending',startedByPrincipalId:'fixture',...identity,startedAt:at});
  for(const [id,type,parent,remoteId] of [[campaignId,'campaign',null,'cmp-1'],[groupId,'adgroup',campaignId,'grp-1']]){
    await storage.createObject({hierarchyObjectId:id,hierarchyRunId:runId,customerId:'1001',objectType:type,parentObjectId:parent,createOperationKey:OPS[type].create,readOperationKey:OPS[type].read,deleteOperationKey:OPS[type].delete,remoteId,state:'owned',createdAt:at,updatedAt:at});
    await storage.holdOwnership({ownershipId:randomUUID(),customerId:'1001',objectType:type,remoteId,ownerKind:'hierarchy_canary',ownerRunId:runId,hierarchyObjectId:id,parentHierarchyObjectId:parent,createdOperationKey:OPS[type].create,state:'owned',createdAt:at,updatedAt:at});
  }
  const repository=new PostgresDescendantInventoryRepository({pool});
  const make=(read,resolver=async()=>identity)=>new DescendantInventoryService({repository,remote:{read},contextResolver:resolver,clock:()=>NOW});
  const scope={customerId:'1001',hierarchyRunId:runId,parentObjectId:groupId,childType:'keyword'};
  const kw=id=>({customerId:'1001',nccAdgroupId:'grp-1',nccKeywordId:id});
  const events=async()=>(await pool.query("SELECT * FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND phase='descendant_inventory' ORDER BY event_id",[runId])).rows;
  async function state(){
    const result={};
    for(const table of ['searchad_hierarchy_canary_runs','searchad_hierarchy_objects','searchad_remote_object_ownership','searchad_write_change_plans','searchad_write_approvals','searchad_risk_reservations','searchad_daily_risk_capacity','searchad_write_attempts']){
      result[table]=(await pool.query(`SELECT to_jsonb(t) AS doc FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return result;
  }
  const baseline=await state();
  async function singleEvent(before){
    const previous=new Set(before.map(e=>e.event_id)),added=(await events()).filter(e=>!previous.has(e.event_id));
    assert.equal(added.length,1);assert.deepEqual(await state(),baseline);return added[0];
  }

  await t.test('scans 1001 keyword IDs over three pages with one hash-only audit event',async()=>{
    const before=await events(),calls=[],ids=Array.from({length:1001},(_,i)=>`kw-${i}`);
    const pages=[ids.slice(0,1000).map(kw),[kw(ids[1000])],[]];
    const result=await make(async d=>{calls.push(d);return envelope(LIST.adgroupKeyword,pages.shift());}).scan(scope,context);
    assert.equal(calls.length,3);assert.equal(calls[1].query.baseSearchId,'kw-999');assert.equal(calls[2].query.baseSearchId,'kw-1000');
    assert.equal(calls[2].query.selector,'NEXT');assert.deepEqual(result.remoteIds,ids);
    assert.equal(result.kind,'present_remote_descendants');assert.equal(result.completeAbsence,false);assert.equal(result.changed,false);
    assert.deepEqual(result.scan,{requests:3,acceptedPages:3,termination:'empty_page_observed',snapshotConsistency:'unproven'});
    const event=await singleEvent(before);
    assert.equal(event.operation_key,LIST.adgroupKeyword);assert.equal(event.lifecycle_kind,null);
    assert.deepEqual(event.details_json,{readOnly:true,parentType:'adgroup',childType:'keyword',observation:'present_remote_descendants',count:1001,completeAbsence:false,remoteIdsHash:contentHash([...ids].sort()),localMapping:false,cleanupAuthority:false,scan:result.scan});
    assert.equal(JSON.stringify(event).includes('kw-999'),false);assert.equal(JSON.stringify(event).includes('baseSearchId'),false);
  });

  await t.test('campaign and creative scans retain relation-specific request shapes',async()=>{
    for(const [input,operationKey,row,key] of [
      [{...scope,parentObjectId:campaignId,childType:'adgroup'},LIST.campaignAdgroup,{customerId:'1001',nccCampaignId:'cmp-1',nccAdgroupId:'grp-child'},'grp-child'],
      [{...scope,childType:'creative'},LIST.adgroupCreative,{customerId:'1001',nccAdgroupId:'grp-1',nccAdId:'ad-child'},'ad-child']
    ]){
      const before=await events(),calls=[];
      const result=await make(async d=>{calls.push(d);return envelope(operationKey,calls.length===1?[row]:[]);}).scan(input,context);
      assert.deepEqual(result.remoteIds,[key]);assert.equal(result.completeAbsence,false);
      assert.equal(calls.length,input.childType==='creative'?1:2);
      if(input.childType==='creative')assert.deepEqual(calls[0].query,{nccAdgroupId:'grp-1'});
      else assert.equal(calls[1].query.baseSearchId,'grp-child');
      assert.equal((await singleEvent(before)).operation_key,operationKey);
    }
  });

  await t.test('empty scan cannot clear the existing subtree cleanup veto',async()=>{
    const before=await events();
    const result=await make(async()=>envelope(LIST.adgroupKeyword,[])).scan(scope,context);
    assert.equal(result.kind,'empty_unproven');assert.equal(result.completeAbsence,false);
    const event=await singleEvent(before);
    const objects=(await pool.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1',[runId])).rows;
    for(const target of objects)assert.equal(hasUnprovenInventory({target,objects,events:[event]}),true);
  });

  await t.test('later read outage persists prior presence, not a misleading empty result',async()=>{
    const before=await events();let reads=0;
    const result=await make(async()=>{if(++reads===2)throw new Error('SECRET raw upstream');return envelope(LIST.adgroupKeyword,[kw('kw-safe')]);}).scan(scope,context);
    assert.equal(reads,2);assert.deepEqual(result.remoteIds,['kw-safe']);assert.equal(result.scan.termination,'read_unavailable');
    const event=await singleEvent(before);assert.equal(event.details_json.observation,'present_remote_descendants');
    assert.equal(JSON.stringify(event).includes('SECRET'),false);
  });

  await t.test('scan rejects cursor overrides and unauthorized Customer before remote I/O',async()=>{
    const before=await events();let reads=0;const service=make(async()=>{reads++;return envelope(LIST.adgroupKeyword,[]);});
    await assert.rejects(service.scan({...scope,baseSearchId:'victim'},context),e=>e.code==='SEARCHAD_DESCENDANT_INVENTORY_INPUT_INVALID');
    await assert.rejects(service.scan(scope,{principal:{principalId:'wrong',role:'admin',customerIds:['1002']}}),e=>e.code==='SEARCHAD_DESCENDANT_INVENTORY_FORBIDDEN');
    assert.equal(reads,0);assert.deepEqual(await events(),before);assert.deepEqual(await state(),baseline);
  });

  await t.test('identity rotation on a later page prevents the entire observation commit',async()=>{
    const before=await events();let checks=0,reads=0;
    const service=make(async()=>envelope(LIST.adgroupKeyword,[kw(`kw-rotation-${++reads}`)]),async()=>++checks===4?{...identity,credentialFingerprint:'rotated'}:identity);
    await assert.rejects(service.scan(scope,context),e=>e.code==='SEARCHAD_DESCENDANT_INVENTORY_CONTEXT_MISMATCH');
    assert.equal(reads,2);assert.deepEqual(await events(),before);assert.deepEqual(await state(),baseline);
  });

  await t.test('an audit change on a later page rejects the original whole-scan snapshot',async()=>{
    const before=await events();let reads=0;
    const service=make(async()=>{
      if(++reads===1)return envelope(LIST.adgroupKeyword,[kw('kw-before-drift')]);
      await storage.addEvent({eventId:randomUUID(),hierarchyRunId:runId,hierarchyObjectId:groupId,customerId:'1001',phase:'fixture_scan_drift',status:'changed',details:{},createdAt:at});
      return envelope(LIST.adgroupKeyword,[]);
    });
    await assert.rejects(service.scan(scope,context),e=>e.code==='SEARCHAD_DESCENDANT_INVENTORY_STALE');
    assert.deepEqual(await events(),before);assert.deepEqual(await state(),baseline);
  });

  await t.test('repository rejects forged or inconsistent scan metadata without an event',async()=>{
    const before=await events(),snapshot=await repository.loadSnapshot(scope);
    const scan={requests:1,acceptedPages:1,termination:'empty_page_observed',snapshotConsistency:'unproven'};
    const observation={kind:'empty_unproven',count:0,remoteIds:[],completeAbsence:false,observedAt:at,scan};
    for(const invalid of [
      {...observation,completeAbsence:true}, {...observation,scan:{...scan,completeAbsence:true}},
      {...observation,scan:{...scan,snapshotConsistency:'proven'}}, {...observation,scan:{...scan,requests:11}},
      {...observation,scan:{...scan,baseSearchId:'raw-cursor'}},
      {...observation,scan:{requests:1,acceptedPages:0,termination:'read_unavailable',snapshotConsistency:'unproven'}},
      {...observation,kind:'unresolved'}
    ])await assert.rejects(repository.recordObservation(snapshot,invalid),e=>e.code==='SEARCHAD_DESCENDANT_INVENTORY_OBSERVATION_INVALID');
    assert.deepEqual(await events(),before);assert.deepEqual(await state(),baseline);
  });

  await t.test('one issued snapshot cannot append the same scan observation twice',async()=>{
    const before=await events(),snapshot=await repository.loadSnapshot(scope);
    const observation={kind:'empty_unproven',count:0,remoteIds:[],completeAbsence:false,observedAt:at,scan:{requests:1,acceptedPages:1,termination:'empty_page_observed',snapshotConsistency:'unproven'}};
    await repository.recordObservation(snapshot,observation);
    await assert.rejects(repository.recordObservation(snapshot,observation),e=>e.code==='SEARCHAD_DESCENDANT_INVENTORY_STALE');
    await singleEvent(before);
  });

  await t.test('legacy inventory remains a single-page response without scan metadata',async()=>{
    const before=await events();let reads=0;
    const result=await make(async()=>{reads++;return envelope(LIST.adgroupKeyword,[kw('kw-legacy')]);}).inventory(scope,context);
    assert.equal(reads,1);assert.equal(Object.hasOwn(result,'scan'),false);
    assert.equal(Object.hasOwn((await singleEvent(before)).details_json,'scan'),false);
  });
});
