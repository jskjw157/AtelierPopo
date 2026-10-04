import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { SiblingCreateService } from '../src/naver/searchad/lifecycle/sibling-create-service.js';
import { ChildFirstCleanupService } from '../src/naver/searchad/lifecycle/child-first-cleanup-service.js';
import { PostgresChildFirstCleanupRepository } from '../src/naver/searchad/lifecycle/postgres-child-first-cleanup-repository.js';
import { cleanupScope } from '../src/naver/searchad/lifecycle/child-first-cleanup-contract.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { KEYWORD_FIELDS, CREATIVE_FIELDS } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';

const logger={info(){},warn(){},error(){}};
const NOW=Date.parse('2026-09-28T00:00:00Z');
const context={principal:{principalId:'cleanup-replan-admin',role:'admin',customerIds:['1001']}};
const RETIRE='RETIRE_EXPIRED_UNUSED_CLEANUP_PLAN',REPLAN='REPLAN_EXPIRED_UNUSED_CLEANUP_PLAN';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const errorCode=suffix=>error=>error?.code===`SEARCHAD_CHILD_CLEANUP_${suffix}`;
const refused=error=>error?.code?.startsWith('SEARCHAD_CHILD_CLEANUP_');
function hooked(pool,hook){return {query:pool.query.bind(pool),connect:async()=>{const c=await pool.connect();return {release:c.release.bind(c),query:(sql,values)=>hook(c,sql,values)};}};}

test('expired unused cleanup plans can be retired and explicitly replaced without replaying DELETE', {timeout:240_000},async t=>{
  assert.equal(typeof ChildFirstCleanupService.prototype.retirePlan,'function','explicit cleanup plan retirement method is required');
  assert.equal(typeof ChildFirstCleanupService.prototype.replan,'function','explicit cleanup replan method is required');
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}
  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const originalFetch=globalThis.fetch;let escaped=0;
  globalThis.fetch=async()=>{escaped++;throw new Error('External network forbidden');};
  t.after(async()=>{globalThis.fetch=originalFetch;await closePostgresPool(admin);assert.equal(escaped,0);});

  async function fixture(st,type='adgroup',options={}){
    const schema=`cleanup_replan_${randomUUID().replaceAll('-','')}`,pools=new Set();let created=false;
    const f={now:NOW,type,calls:[],transportErrors:[],remote:new Map(),deleted:new Set(),unknownDelete:false};
    st.after(async()=>{try{await Promise.all([...pools].map(closePostgresPool));}finally{if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}assert.deepEqual(f.transportErrors,[]);});
    await admin.query(`CREATE SCHEMA "${schema}"`);created=true;
    const scoped=new URL(url);scoped.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);
    f.connect=()=>{const p=createPostgresPool({connectionString:scoped.toString(),sslMode:'disable',logger});pools.add(p);return p;};
    f.pool=f.connect();await runPostgresMigrations({pool:f.pool,migrationsDir:path.resolve('migrations/postgres'),logger});
    f.registry=loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
    f.config=loadSearchAdConfig({NAVER_SEARCHAD_ACCESS_LICENSE:'fixture-license',NAVER_SEARCHAD_SECRET_KEY:'fixture-secret',NAVER_SEARCHAD_CUSTOMER_ID:'1001',ATELIER_SEARCHAD_ALLOW_READS:'true',ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY:'true'});
    f.credentials=new SearchAdCredentialsRegistry(f.config.topology);
    f.identity={specSha:f.registry.status().specRef,credentialFingerprint:credentialFingerprintForCustomer(f.credentials,'1001'),upstreamBaseUrl:'https://api.searchad.naver.com'};
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    f.authority=async(operation,fields,lifecycle='create')=>{
      const id=randomUUID(),eid=`synthetic-${randomUUID()}`,start=new Date(f.now-1000).toISOString(),end=new Date(f.now+3600000).toISOString();
      const values=[f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([lifecycle]),start,end];
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`,[eid,...values]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture',$9,$10)`,[id,eid,...values]);return id;
    };
    f.fetchImpl=async(value,init)=>{
      const u=new URL(value),body=init.body?JSON.parse(init.body):null,h=new Headers(init.headers);f.calls.push(`${init.method} ${u.pathname}`);
      try{assert.equal(u.origin,f.identity.upstreamBaseUrl);assert.equal(init.redirect,'error');assert.equal(h.get('X-Customer'),'1001');assert.equal(h.get('X-Signature'),createHmac('sha256',f.credentials.resolve('1001').secretKey).update(`${h.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));}
      catch(e){f.transportErrors.push(e.message);throw e;}
      if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){f.rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};f.remote.set(`/ncc/campaigns/${f.rootRemote.nccCampaignId}`,f.rootRemote);return json(f.rootRemote);}
      if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){f.groupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};f.remote.set(`/ncc/adgroups/${f.groupRemote.nccAdgroupId}`,f.groupRemote);return json(f.groupRemote,201);}
      if(init.method==='POST'&&u.pathname==='/ncc/keywords'){const rows=body.map(item=>({nccKeywordId:`kw-${randomUUID()}`,keyword:item.keyword}));for(const row of rows)f.remote.set(`/ncc/keywords/${row.nccKeywordId}`,{customerId:'1001',nccAdgroupId:f.groupRemote.nccAdgroupId,...row});return json(options.partial?[rows[1]]:rows);}
      if(init.method==='POST'&&u.pathname==='/ncc/ads'){const row={customerId:'1001',nccAdId:`ad-${randomUUID()}`,...body};f.remote.set(`/ncc/ads/${row.nccAdId}`,row);return json(row,201);}
      if(init.method==='GET'&&f.remote.has(u.pathname))return f.deleted.has(u.pathname)?json({code:'NOT_FOUND'},404):json(f.remote.get(u.pathname));
      if(init.method==='DELETE'&&f.remote.has(u.pathname)){if(f.unknownDelete)throw new Error('synthetic ambiguous DELETE');f.deleted.add(u.pathname);return json({accepted:true});}
      f.transportErrors.push(`Unexpected ${init.method} ${u.pathname}`);throw new Error('Unexpected transport');
    };
    f.args={pool:f.pool,registry:f.registry,credentialsRegistry:f.credentials,config:f.config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:options.planTtlSeconds??60,preflightMaxAgeMs:5000,clock:()=>f.now,fetchImpl:f.fetchImpl,logger,keywordTexts:options.partial?['first','second']:['single']};
    const approvals=new SearchAdApprovalService({repository:new PostgresSearchAdWriteRepository({pool:f.pool}),config:{approvalTtlSeconds:options.approvalTtlSeconds??300},clock:()=>f.now});
    f.approve=id=>approvals.approve(id,{confirmation:'APPROVE_SEARCHAD_CHANGE',actor:'fixture-approver'});
    const rootCreator=new CampaignCreateService(f.args);
    const rp=await rootCreator.prepare({customerId:'1001',activationId:await f.authority(OPS.campaign.create,['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'])},context);
    f.root=await rootCreator.execute({customerId:'1001',hierarchyRunId:rp.hierarchyRunId,hierarchyObjectId:rp.hierarchyObjectId,planId:rp.planId,executionToken:(await f.approve(rp.planId)).executionToken},context);assert.equal(f.root.state,'owned');f.now+=1000;
    const groupCreator=new AdgroupCreateService(f.args);
    const gp=await groupCreator.prepare({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,activationId:await f.authority(OPS.adgroup.create,['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'])},context);
    f.group=await groupCreator.execute({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,hierarchyObjectId:gp.hierarchyObjectId,planId:gp.planId,executionToken:(await f.approve(gp.planId)).executionToken},context);assert.equal(f.group.state,'owned');f.now+=1000;
    f.target=f.group.hierarchyObjectId;
    if(type!=='adgroup'){
      const creator=new SiblingCreateService(f.args),kind=type==='keyword'?'keywords':'creative';
      const plan=await creator[type==='keyword'?'prepareKeywords':'prepareCreative']({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,activationId:await f.authority(OPS[type].create,type==='keyword'?KEYWORD_FIELDS:CREATIVE_FIELDS,type==='keyword'?'batch_create':'create')},context);
      const result=await creator.execute({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:plan.planId,kind,executionToken:(await f.approve(plan.planId)).executionToken},context);
      assert.equal(result.state,options.partial?'manual_review':'owned');
      f.target=(await f.pool.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 AND object_type=$2 AND remote_id IS NOT NULL ORDER BY hierarchy_object_id',[f.root.hierarchyRunId,type])).rows[0].hierarchy_object_id;
    }
    f.cleanup=new ChildFirstCleanupService(f.args);
    f.deleteAuthority=await f.authority(OPS[type].delete,[],'delete');
    f.prepareInput={customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:f.target,activationId:f.deleteAuthority};
    f.old=await f.cleanup.prepare(f.prepareInput,context);
    f.oldApproval=options.approved===false?null:await f.approve(f.old.planId);
    f.retireInput={customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:f.target,planId:f.old.planId,confirmation:RETIRE};
    f.replanInput={...f.prepareInput,predecessorPlanId:f.old.planId,confirmation:REPLAN};
    f.retire=(pool=f.pool)=>new ChildFirstCleanupService({...f.args,pool}).retirePlan(f.retireInput,context);
    f.replan=(pool=f.pool)=>new ChildFirstCleanupService({...f.args,pool}).replan(f.replanInput,context);
    f.expire=()=>{f.now=Date.parse(f.old.expiresAt);};
    f.execution=(p,token)=>({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:p.hierarchyObjectId,planId:p.planId,executionToken:token,confirmation:p.requiredConfirmation,secondConfirmation:p.requiredSecondConfirmation});
    f.clean=async p=>f.cleanup.execute(f.execution(p,(await f.approve(p.planId)).executionToken),context);
    f.rows=async table=>(await f.pool.query(`SELECT to_jsonb(t) AS row,t.xmin::text AS version FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
    f.state=async()=>{const result={};for(const table of ['searchad_hierarchy_canary_runs','searchad_hierarchy_objects','searchad_remote_object_ownership','searchad_write_change_plans','searchad_write_approvals','searchad_write_locks','searchad_write_attempts','searchad_hierarchy_events','searchad_risk_reservations','searchad_daily_risk_capacity'])result[table]=await f.rows(table);return result;};
    f.calls.length=0;return f;
  }

  for(const type of ['adgroup','keyword','creative'])await t.test(`${type}: preserve object/history, fresh token, DELETE once and generation-aware ancestor proof`,async st=>{
    const f=await fixture(st,type);f.expire();const before=await f.state();
    const retired=await f.retire();assert.equal(retired.changed,true);assert.equal(retired.planStatus,'expired');assert.equal(retired.targetRemoteDispatched,false);assert.equal(retired.replacementCreated,false);assert.equal(retired.cleanupAuthority,false);
    const after=await f.state();
    for(const key of Object.keys(before).filter(k=>!['searchad_write_change_plans','searchad_write_attempts','searchad_hierarchy_events'].includes(k)))assert.deepEqual(after[key],before[key],key);
    assert.equal(after.searchad_hierarchy_events.length,before.searchad_hierarchy_events.length+1);assert.equal(after.searchad_write_attempts.length,before.searchad_write_attempts.length+1);
    assert.deepEqual(after.searchad_write_change_plans.find(x=>x.row.plan_id===f.old.planId).row.last_error_json,{code:'UNUSED_CLEANUP_PLAN_EXPIRED'});
    assert.equal((await f.retire()).changed,false);await assert.rejects(f.cleanup.prepare(f.prepareInput,context));assert.deepEqual(f.calls,[]);
    const replacement=await f.replan();assert.notEqual(replacement.planId,f.old.planId);
    const plan=(await f.rows('searchad_write_change_plans')).find(p=>p.row.plan_id===replacement.planId).row;
    assert.equal(plan.before_json.cleanupGeneration,2);assert.equal(plan.before_json.predecessorPlanId,f.old.planId);assert.match(plan.before_json.predecessorRetirementHash,/^[a-f0-9]{64}$/);
    const history=await f.state();await assert.rejects(f.cleanup.execute(f.execution(replacement,f.oldApproval.executionToken),context));assert.deepEqual(await f.state(),history);assert.deepEqual(f.calls,[]);
    const result=await f.clean(replacement);assert.equal(result.state,'deleted');assert.equal(f.calls.filter(c=>c.startsWith('DELETE ')).length,1);
    await assert.rejects(f.replan());await assert.rejects(f.cleanup.execute(f.execution(f.old,f.oldApproval.executionToken),context));
    const targetPath=f.calls.find(c=>c.startsWith('DELETE ')).slice(7);assert.equal(f.calls.filter(c=>c===`GET ${targetPath}`).length,2);
    const parentId=type==='adgroup'?f.root.hierarchyObjectId:f.group.hierarchyObjectId,parentType=type==='adgroup'?'campaign':'adgroup';
    f.calls.length=0;const parentPlan=await f.cleanup.prepare({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:parentId,activationId:await f.authority(OPS[parentType].delete,[],'delete')},context);assert.deepEqual(f.calls,[]);
    if(type==='adgroup'){
      f.now=Date.parse(parentPlan.expiresAt);
      await f.cleanup.retirePlan({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:parentId,planId:parentPlan.planId,confirmation:RETIRE},context);
      const next=await f.cleanup.replan({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:parentId,predecessorPlanId:parentPlan.planId,activationId:await f.authority(OPS.campaign.delete,[],'delete'),confirmation:REPLAN},context);
      assert.equal((await f.clean(next)).state,'deleted');assert.equal(f.calls.filter(c=>c.startsWith('DELETE ')).length,1);
    }
  });
  await t.test('partial quarantine replacement deletes only the known leaf and never authorizes its parents',async st=>{
    const f=await fixture(st,'keyword',{partial:true});f.expire();const baseline=await f.rows('searchad_hierarchy_objects');await f.retire();const p=await f.replan();assert.equal((await f.clean(p)).state,'deleted');
    const unknown=baseline.find(o=>o.row.object_type==='keyword'&&o.row.remote_id===null);assert.deepEqual((await f.rows('searchad_hierarchy_objects')).find(o=>o.row.hierarchy_object_id===unknown.row.hierarchy_object_id),unknown);
    assert.equal((await f.rows('searchad_hierarchy_canary_runs'))[0].row.status,'manual_review');
    await assert.rejects(f.cleanup.prepare({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:f.group.hierarchyObjectId,activationId:await f.authority(OPS.adgroup.delete,[],'delete')},context));
  });
  await t.test('only plan expiry counts, not approval expiry or a caller-supplied expiry',async st=>{
    const f=await fixture(st,'adgroup',{planTtlSeconds:600,approvalTtlSeconds:60});f.now+=61000;const before=await f.state();await assert.rejects(f.retire(),errorCode('NOT_EXPIRED'));assert.deepEqual(await f.state(),before);
    await assert.rejects(f.cleanup.retirePlan({...f.retireInput,expiresAt:'2000-01-01'},context),errorCode('INPUT'));
    f.now=Date.parse(f.old.expiresAt)-1;await assert.rejects(f.retire(),errorCode('NOT_EXPIRED'));f.expire();assert.equal((await f.retire()).changed,true);
  });
  await t.test('an unapproved plan and an approval-service-expired plan can be retired',async st=>{
    const f=await fixture(st,'adgroup',{approved:false});f.expire();await assert.rejects(f.approve(f.old.planId));assert.equal((await f.retire()).changed,true);assert.equal((await f.replan()).state,'planned');
  });
  await t.test('default OFF and exact Admin/Customer/input/confirmation rules apply before any I/O',async st=>{
    const f=await fixture(st);f.expire();const before=await f.state();await assert.rejects(new ChildFirstCleanupService({...f.args,enabled:false}).retirePlan(f.retireInput,context),errorCode('DISABLED'));
    for(const extra of [{remoteId:'victim'},{confirmation:'APPROVE_SEARCHAD_CHANGE'},{actorPrincipalId:'forged'}])await assert.rejects(f.cleanup.retirePlan({...f.retireInput,...extra},context),errorCode('INPUT'));
    await assert.rejects(f.cleanup.retirePlan(f.retireInput,{principal:{...context.principal,role:'reader'}}),errorCode('FORBIDDEN'));
    await assert.rejects(f.cleanup.retirePlan(f.retireInput,{principal:{...context.principal,customerIds:['1002']}}),errorCode('FORBIDDEN'));
    await assert.rejects(f.cleanup.replan({...f.replanInput,confirmation:RETIRE},context),errorCode('INPUT'));assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  const corruptions=[
    ['used approval',"UPDATE searchad_write_approvals SET used_at=created_at WHERE plan_id=$1"],
    ['execution lock',"INSERT INTO searchad_write_locks(plan_id,purpose,acquired_at) SELECT plan_id,'execute',created_at FROM searchad_write_change_plans WHERE plan_id=$1"],
    ['unknown plan',"UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1"],
    ['tampered request',"UPDATE searchad_write_change_plans SET mutation_json=jsonb_set(mutation_json,'{pathParams,adgroupId}','\"victim\"') WHERE plan_id=$1"],
    ['tampered metadata hash',"UPDATE searchad_write_change_plans SET before_hash=repeat('b',64) WHERE plan_id=$1"],
    ['non-planning attempt',"INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,created_at) SELECT gen_random_uuid(),plan_id,'transport_intent','attempt_once',created_at FROM searchad_write_change_plans WHERE plan_id=$1"]
  ];
  for(const [name,sql] of corruptions)await t.test(`${name} prevents local retirement without any write`,async st=>{const f=await fixture(st);f.expire();await f.pool.query(sql,[f.old.planId]);const before=await f.state();await assert.rejects(f.retire(),refused);assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);});
  await t.test('released DELETE risk still blocks retirement and is never refunded/recycled',async st=>{
    const f=await fixture(st);f.expire();await f.pool.query("INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,released_at) VALUES($1,$2,'1001','2026-09-28',$3,'delete',1,'released','hierarchy_canary',$4,$5,$5,$5)",[randomUUID(),`hierarchy:tree:delete:${f.old.planId}`,OPS.adgroup.delete,f.root.hierarchyRunId,new Date(f.now)]);const before=await f.state();await assert.rejects(f.retire(),refused);assert.deepEqual(await f.state(),before);
  });
  await t.test('a real committed claim with zero DELETE calls is not an unused cleanup plan',async st=>{
    const f=await fixture(st);const input=f.execution(f.old,f.oldApproval.executionToken);
    const store=new PostgresChildFirstCleanupRepository({...f.args,current:()=>f.identity,gate:()=>{},confirmation:type=>f.registry.get(OPS[type].delete).confirmation});
    const snap=await store.executionSnapshot(cleanupScope(input,context,'execute'));
    const observations=snap.reads.map(d=>({kind:'present',result:{operation:{operationKey:d.operationKey,sideEffect:false},upstream:{status:200},data:d.operationKey===OPS.campaign.read?f.rootRemote:f.groupRemote}}));
    await store.claim(snap.ticket,observations);f.expire();const before=await f.state();await assert.rejects(f.retire(),refused);assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  await t.test('an ambiguous DELETE is only reconciled by GET and cannot be retired/replanned/replayed',async st=>{
    const f=await fixture(st);f.unknownDelete=true;const input=f.execution(f.old,f.oldApproval.executionToken);assert.equal((await f.cleanup.execute(input,context)).state,'delete_unknown');f.expire();const before=await f.state();await assert.rejects(f.retire(),refused);await assert.rejects(f.replan(),refused);await assert.rejects(f.cleanup.execute(input,context),refused);assert.deepEqual(await f.state(),before);assert.equal(f.calls.filter(c=>c.startsWith('DELETE ')).length,1);
  });
  await t.test('two independent pools yield one retirement and one successor, not two deletion plans',async st=>{
    const f=await fixture(st);f.expire();const retired=await Promise.all([f.retire(),f.retire(f.connect())]);assert.deepEqual(retired.map(r=>r.changed).sort(),[false,true]);
    const replans=await Promise.allSettled([f.replan(),f.replan(f.connect())]);assert.equal(replans.filter(r=>r.status==='fulfilled').length,1);assert.equal(replans.filter(r=>r.status==='rejected').length,1);assert.deepEqual(f.calls,[]);
    assert.equal((await f.rows('searchad_hierarchy_events')).filter(e=>e.row.phase==='tree_cleanup_plan_retired').length,1);
  });
  for(const phase of ['tree_cleanup_plan_retired','tree_cleanup_plan'])for(const table of ['searchad_hierarchy_events','searchad_write_attempts'])await t.test(`${phase}/${table} audit failure rolls the transaction back`,async st=>{
    const f=await fixture(st);f.expire();if(phase==='tree_cleanup_plan')await f.retire();const before=await f.state();
    await f.pool.query(`CREATE FUNCTION reject_cleanup_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='${phase}' THEN RAISE EXCEPTION 'SECRET injected'; END IF; RETURN NEW; END $$`);
    await f.pool.query(`CREATE TRIGGER reject_cleanup_audit BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_cleanup_audit()`);
    await assert.rejects(phase==='tree_cleanup_plan'?f.replan():f.retire(),e=>errorCode('STORE')(e)&&!JSON.stringify(e).includes('SECRET'));assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  await t.test('old retirement proof is rechecked before executing its replacement',async st=>{
    const f=await fixture(st);f.expire();await f.retire();const p=await f.replan(),token=(await f.approve(p.planId)).executionToken;
    await f.pool.query("UPDATE searchad_write_change_plans SET last_error_json='{}'::jsonb WHERE plan_id=$1",[f.old.planId]);const before=await f.state();await assert.rejects(f.cleanup.execute(f.execution(p,token),context),refused);assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  await t.test('generation 3 and retiring the second cleanup plan remain unsupported',async st=>{
    const f=await fixture(st);f.expire();await f.retire();const p=await f.replan();f.now=Date.parse(p.expiresAt);const before=await f.state();
    await assert.rejects(f.cleanup.retirePlan({...f.retireInput,planId:p.planId},context),refused);await assert.rejects(f.cleanup.replan({...f.replanInput,predecessorPlanId:p.planId},context),refused);assert.deepEqual(await f.state(),before);
  });
  await t.test('local retirement works with account suspended/gates OFF; replacement still needs execution policy',async st=>{
    const f=await fixture(st);f.expire();await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");f.config.allowReads=false;f.config.allowActiveCanary=false;assert.equal((await f.retire()).changed,true);await assert.rejects(f.replan(),errorCode('SUSPENDED'));assert.deepEqual(f.calls,[]);
  });
  await t.test('unproven inventory still blocks parent replanning but not local plan retirement',async st=>{
    const f=await fixture(st);f.expire();await f.pool.query("INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,details_json,created_at) VALUES($1,$2,$3,'1001','descendant_inventory','observed_empty_unproven',$4::jsonb,$5)",[randomUUID(),f.root.hierarchyRunId,f.target,JSON.stringify({readOnly:true,parentType:'adgroup',childType:'keyword',completeAbsence:false,cleanupAuthority:false}),new Date(f.now)]);
    await f.retire();const before=await f.state();await assert.rejects(f.replan(),errorCode('INVENTORY_UNPROVEN'));assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  for(const committed of [false,true])await t.test(`retirement COMMIT ${committed?'acknowledgement':'send'} failure never returns success`,async st=>{
    const f=await fixture(st);f.expire();let discarded=false;
    const pool={query:f.pool.query.bind(f.pool),connect:async()=>{const c=await f.pool.connect();return {release:destroy=>{discarded=destroy;c.release(destroy);},query:async(sql,values)=>{if(sql==='COMMIT'&&!committed)throw new Error('SECRET commit');const r=await c.query(sql,values);if(sql==='COMMIT')throw new Error('SECRET ACK');return r;}};}};
    await assert.rejects(f.retire(pool),errorCode('COMMIT_UNKNOWN'));assert.equal(discarded,true);assert.equal((await f.retire()).changed,!committed);assert.deepEqual(f.calls,[]);
  });
  for(const drift of ['identity','clock'])await t.test(`${drift} change during final retirement audit rolls everything back`,async st=>{
    const f=await fixture(st);f.expire();const before=await f.state();
    const pool=hooked(f.pool,async(c,sql,values)=>{const r=await c.query(sql,values);if(sql.includes('INSERT INTO searchad_write_attempts')){if(drift==='clock')f.now=NOW;else f.config.baseUrl='https://changed.invalid';}return r;});
    await assert.rejects(f.retire(pool),refused);assert.deepEqual(await f.state(),before);
  });
});
