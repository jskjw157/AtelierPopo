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
import { ChildFirstCleanupService } from '../src/naver/searchad/lifecycle/child-first-cleanup-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const logger={info(){},warn(){},error(){}};
const NOW=Date.parse('2026-09-15T10:00:00Z');
const context={principal:{principalId:'partial-cleanup-admin',role:'admin',customerIds:['1001']}};
const campaignFields=['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];
const adgroupFields=['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'];
const keywordFields=['keyword.keyword'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('known partial keyword leaf can be deleted once while unresolved sibling keeps parents blocked', {timeout:180_000}, async t=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}

  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const schema=`partial_cleanup_${randomUUID().replaceAll('-','')}`,pools=new Set();
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

  let rootRemote,groupRemote,partialRemote,partialKeyword;
  let partialDeleted=false;
  const calls=[];
  const fetchImpl=async(urlValue,init)=>{
    const u=new URL(urlValue),body=init.body?JSON.parse(init.body):null;
    calls.push(`${init.method} ${u.pathname}`);
    assert.equal(u.origin,'https://api.searchad.naver.com');assert.equal(init.redirect,'error');
    if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};return json(rootRemote);}
    if(init.method==='GET'&&u.pathname===`/ncc/campaigns/${rootRemote?.nccCampaignId}`)return json(rootRemote);
    if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){groupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};return json(groupRemote,201);}
    if(init.method==='GET'&&u.pathname===`/ncc/adgroups/${groupRemote?.nccAdgroupId}`)return json(groupRemote);
    if(init.method==='POST'&&u.pathname==='/ncc/keywords'){
      partialRemote=`kw-partial-${randomUUID()}`;partialKeyword=body[0].keyword;
      return json([{nccKeywordId:partialRemote,keyword:partialKeyword}]);
    }
    if(init.method==='GET'&&u.pathname===`/ncc/keywords/${partialRemote}`){
      if(partialDeleted)return json({code:'NOT_FOUND'},404);
      return json({customerId:'1001',nccAdgroupId:groupRemote.nccAdgroupId,nccKeywordId:partialRemote,keyword:partialKeyword});
    }
    if(init.method==='DELETE'&&u.pathname===`/ncc/keywords/${partialRemote}`){partialDeleted=true;return json({accepted:true});}
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

  const leaves=(await pool.query("SELECT hierarchy_object_id,state,remote_id FROM searchad_hierarchy_objects WHERE object_type='keyword' ORDER BY hierarchy_object_id")).rows;
  assert.equal(leaves.length,2);
  const known=leaves.find(row=>row.remote_id===partialRemote),unresolved=leaves.find(row=>row.remote_id===null);
  assert.ok(known);assert.ok(unresolved);
  assert.equal(known.state,'manual_review');assert.equal(unresolved.state,'manual_review');

  const cleanup=new ChildFirstCleanupService(args());
  calls.length=0;
  await assert.rejects(
    cleanup.prepare({customerId:'1001',hierarchyRunId:root.hierarchyRunId,hierarchyObjectId:unresolved.hierarchy_object_id,activationId:await authority(OPS.keyword.delete,[],'delete')},context),
    error=>error?.code==='SEARCHAD_CHILD_CLEANUP_STATE'
  );
  assert.equal(calls.length,0,'unreturned partial sibling is never read, guessed, or deleted');

  const tampered='kw-tampered-partial';
  await pool.query('UPDATE searchad_hierarchy_objects SET remote_id=$2 WHERE hierarchy_object_id=$1',[known.hierarchy_object_id,tampered]);
  await pool.query('UPDATE searchad_remote_object_ownership SET remote_id=$2 WHERE hierarchy_object_id=$1',[known.hierarchy_object_id,tampered]);
  await assert.rejects(
    cleanup.prepare({customerId:'1001',hierarchyRunId:root.hierarchyRunId,hierarchyObjectId:known.hierarchy_object_id,activationId:await authority(OPS.keyword.delete,[],'delete')},context),
    error=>error?.code==='SEARCHAD_CHILD_CLEANUP_PROVENANCE'
  );
  assert.equal(calls.length,0,'jointly tampered mutable object and hold cannot replace immutable partial-result provenance');
  await pool.query('UPDATE searchad_hierarchy_objects SET remote_id=$2 WHERE hierarchy_object_id=$1',[known.hierarchy_object_id,partialRemote]);
  await pool.query('UPDATE searchad_remote_object_ownership SET remote_id=$2 WHERE hierarchy_object_id=$1',[known.hierarchy_object_id,partialRemote]);

  const cleanupPlan=await cleanup.prepare({customerId:'1001',hierarchyRunId:root.hierarchyRunId,hierarchyObjectId:known.hierarchy_object_id,activationId:await authority(OPS.keyword.delete,[],'delete')},context);
  assert.equal(cleanupPlan.objectType,'keyword');assert.equal(cleanupPlan.state,'planned');assert.equal(calls.length,0,'planning must stay local');
  // Native Circuit classification over the actual partial-batch source graph.
  // The real cleanup dispatch below still proves the supported known-leaf path.
  const { createCircuitGuard, createCircuitDispatch } = await import('../src/naver/searchad/circuit/service.js');
  const circuit = createCircuitGuard({ pool, clock: () => NOW });
  const dispatch = createCircuitDispatch({customerId:'1001',purpose:'lifecycle',operationKey:OPS.keyword.delete,entityType:'hierarchy_object',entityId:known.hierarchy_object_id}, {planId:cleanupPlan.planId,objectIds:[known.hierarchy_object_id]});
  await circuit.prepareDispatch(dispatch);
  assert.equal((await circuit.repository.getState({customerId:'1001'})).unknownCount,1,'mirrored plan/intent/result rows count as one partial mutation');
  const check = async (change, reason, candidate=dispatch) => {
    const client=await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SELECT customer_id FROM searchad_canary_accounts WHERE customer_id='1001' FOR UPDATE");
      await change(client);
      if(reason) await assert.rejects(circuit.assertDispatchAllowed(candidate,{client,now:NOW}), error=>error.details?.reasons?.includes(reason));
      else await circuit.assertDispatchAllowed(candidate,{client,now:NOW});
    } finally { await client.query('ROLLBACK'); client.release(); }
  };
  await check(async()=>{},null);
  await check(async client=>{
    const sourceId=randomUUID();
    await client.query("INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,details_json,created_at) VALUES($1,$2,$3,'1001','tree_cleanup_intent','attempt_once',$4::jsonb,now())",[sourceId,root.hierarchyRunId,unresolved.hierarchy_object_id,JSON.stringify({planId:randomUUID()})]);
    await client.query("INSERT INTO searchad_circuit_events(customer_id,source_kind,source_id,event_json,projected_at) VALUES('1001','hierarchy',$1,$2::jsonb,now())",[sourceId,JSON.stringify({logicalKey:'fixture-pending-cleanup',outcome:'neutral',occurredAt:NOW})]);
  },'UNRESOLVED_MUTATION');

  await check(client=>client.query("UPDATE searchad_hierarchy_objects SET state='dispatching' WHERE hierarchy_object_id=$1",[unresolved.hierarchy_object_id]),'UNRESOLVED_MUTATION');
  const sameUnknown=createCircuitDispatch({customerId:'1001',purpose:'ordinary',operationKey:'fixture',entityType:'hierarchy_object',entityId:unresolved.hierarchy_object_id});
  await check(async()=>{},'UNRESOLVED_MUTATION',sameUnknown);
  await check(client=>client.query("INSERT INTO searchad_circuit_state(customer_id,manual_paused) VALUES('1001',true) ON CONFLICT(customer_id) DO UPDATE SET manual_paused=true"),'MANUAL_PAUSE');
  await check(async client=>{
    for(let i=0;i<2;i++) await client.query("INSERT INTO searchad_circuit_events(customer_id,source_kind,source_id,event_json,projected_at) VALUES('1001','fixture',$1,$2::jsonb,now())",[randomUUID(),JSON.stringify({logicalKey:`fixture-unknown-${i}`,outcome:'unknown',occurredAt:NOW})]);
  },'UNKNOWN_LIMIT');
  await check(client=>client.query("INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,details_json,created_at) VALUES($1,$2,$3,'1001','fixture_late','unknown_outcome','{}','2000-01-01')",[randomUUID(),root.hierarchyRunId,unresolved.hierarchy_object_id]),'PROJECTION_BACKLOG');
  assert.equal(calls.length,0,'Circuit probes never initiate a remote request');
  const cleaned=await cleanup.execute({customerId:'1001',hierarchyRunId:root.hierarchyRunId,hierarchyObjectId:known.hierarchy_object_id,planId:cleanupPlan.planId,executionToken:(await approve(cleanupPlan.planId)).executionToken,confirmation:cleanupPlan.requiredConfirmation,secondConfirmation:cleanupPlan.requiredSecondConfirmation},context);
  assert.equal(cleaned.state,'deleted');
  assert.equal(calls.filter(value=>value===`DELETE /ncc/keywords/${partialRemote}`).length,1,'known partial leaf is deleted at most once');
  assert.ok(calls.includes(`GET /ncc/keywords/${partialRemote}`),'known partial leaf must be read before and after deletion');
  assert.equal(calls.some(value=>value.includes('null')),false,'unreturned sibling must never become a guessed remote target');

  const after=(await pool.query("SELECT hierarchy_object_id,state,remote_id,deleted_at FROM searchad_hierarchy_objects WHERE object_type='keyword' ORDER BY hierarchy_object_id")).rows;
  const knownAfter=after.find(row=>row.hierarchy_object_id===known.hierarchy_object_id),unresolvedAfter=after.find(row=>row.hierarchy_object_id===unresolved.hierarchy_object_id);
  assert.equal(knownAfter.state,'deleted');assert.ok(knownAfter.deleted_at);
  assert.equal(unresolvedAfter.state,'manual_review');assert.equal(unresolvedAfter.remote_id,null);assert.equal(unresolvedAfter.deleted_at,null);
  const run=(await pool.query('SELECT status FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1',[root.hierarchyRunId])).rows[0];
  assert.equal(run.status,'manual_review','deleting one known partial leaf must not resolve the partial graph');
  const unresolvedHold=(await pool.query("SELECT count(*)::int AS count FROM searchad_remote_object_ownership WHERE hierarchy_object_id=$1",[unresolved.hierarchy_object_id])).rows[0];
  assert.equal(unresolvedHold.count,0,'an unreturned sibling never receives invented ownership');

  calls.length=0;
  await assert.rejects(
    cleanup.prepare({customerId:'1001',hierarchyRunId:root.hierarchyRunId,hierarchyObjectId:group.hierarchyObjectId,activationId:await authority(OPS.adgroup.delete,[],'delete')},context),
    error=>error?.code?.startsWith('SEARCHAD_CHILD_CLEANUP_')===true
  );
  assert.equal(calls.some(value=>value.startsWith('DELETE /ncc/adgroups/')),false,'partial graph must never authorize parent deletion');
  assert.equal(calls.some(value=>value.startsWith('DELETE /ncc/campaigns/')),false,'partial graph must never authorize root deletion');
});