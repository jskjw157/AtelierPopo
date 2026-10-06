import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { CampaignCleanupService } from '../src/naver/searchad/lifecycle/campaign-cleanup-service.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const ORIGIN='https://api.searchad.naver.com', NOW=Date.parse('2026-09-29T01:00:00Z');
const context={principal:{principalId:'root-maintenance-admin',role:'admin',customerIds:['1001']}};
const logger={info(){},warn(){},error(){}};
const response=(status,data={})=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const TABLES=['searchad_hierarchy_canary_runs','searchad_hierarchy_objects','searchad_remote_object_ownership','searchad_write_change_plans','searchad_write_approvals','searchad_write_attempts','searchad_hierarchy_events','searchad_write_locks','searchad_risk_reservations','searchad_daily_risk_capacity','searchad_verification_evidence','searchad_activation_grants'];
const errorCode=error=>{assert.match(error.code??'',/^SEARCHAD_/);return true;};

// These tests require real PostgreSQL and real producers. Only upstream replies
// and the isolated test authority records are synthetic; never call live Naver.
test('root-only campaign DELETE plan retirement and one explicit replacement preserve recovery ownership',{timeout:180_000},async t=>{
  assert.equal(typeof CampaignCleanupService.prototype.retire,'function','root-only cleanup retirement must exist');
  assert.equal(typeof CampaignCleanupService.prototype.replan,'function','root-only cleanup replanning must exist');
  assert.ok(process.env.TEST_DATABASE_URL,'Real PostgreSQL is required; no silent skip');
  const admin=createPostgresPool({connectionString:process.env.TEST_DATABASE_URL,sslMode:'disable',logger});
  const originalFetch=globalThis.fetch;let escaped=0;
  globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  t.after(async()=>{globalThis.fetch=originalFetch;await closePostgresPool(admin);assert.equal(escaped,0);});

  async function fixture(st){
    const schema=`root_replan_${randomUUID().replaceAll('-','')}`,pools=new Set();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    st.after(async()=>{try{await Promise.all([...pools].map(closePostgresPool));}finally{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}});
    const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-csearch_path=${schema} -ctimezone=UTC`);
    const connect=()=>{const p=createPostgresPool({connectionString:url.toString(),sslMode:'disable',logger});pools.add(p);return p;};
    const pool=connect();await runPostgresMigrations({pool,migrationsDir:path.resolve('migrations/postgres'),logger});
    const registry=loadSearchAdSpecRegistry(path.resolve('specs/naver-searchad/current.json'));
    const credentials=new SearchAdCredentialsRegistry({principals:[{principalId:'fixture-signer',accessLicense:'fixture-license',secretKey:'fixture-secret',status:'active'}],customers:[{customerId:'1001',status:'active'}],grants:[{principalId:'fixture-signer',customerId:'1001',role:'admin'}]});
    const config={enabled:true,configured:true,baseUrl:ORIGIN,allowReads:true,allowActiveCanary:true,allowWrites:false,allowCreates:false,allowDeletes:false,allowBatchWrites:false,allowRollbacks:false,allowUnverifiedOperations:false};
    await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    async function grant(kind){
      const id=randomUUID(),evidence=`fixture-${randomUUID()}`;
      const common=['active_canary','1001',registry.status().specRef,credentialFingerprintForCustomer(credentials,'1001'),ORIGIN,JSON.stringify([OPS.campaign[kind]]),JSON.stringify(kind==='create'?['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget']:[]),JSON.stringify([kind])];
      await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'verified',$10,$11)`,[evidence,...common,new Date(NOW-1000).toISOString(),new Date(NOW+600_000).toISOString()]);
      await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,'fixture',$11,$12)`,[id,evidence,...common,new Date(NOW-1000).toISOString(),new Date(NOW+600_000).toISOString()]);return id;
    }
    const createActivationId=await grant('create'),activationId=await grant('delete');
    let now=NOW,remote,answer=null,checked=0;const calls=[];
    const fetchImpl=async(url,init)=>{
      const u=new URL(url);calls.push({method:init.method,path:u.pathname});
      assert.equal(u.origin,ORIGIN);assert.equal(u.search,'');assert.equal(init.redirect,'error');assert.equal(init.headers['X-Customer'],'1001');
      assert.equal(init.headers['X-Signature'],createHmac('sha256',credentials.resolve('1001').secretKey).update(`${init.headers['X-Timestamp']}.${init.method}.${u.pathname}`).digest('base64'));
      if(init.method!=='POST'){assert.equal(u.pathname,`/ncc/campaigns/${remote.nccCampaignId}`);assert.equal(init.body,undefined);}checked++;
      if(answer)return answer(init.method);
      if(init.method==='POST')remote={...JSON.parse(init.body),customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`};return response(200,remote);
    };
    st.after(()=>assert.equal(checked,calls.length,'Transport assertions must not be swallowed'));
    const writer=new PostgresSearchAdWriteRepository({pool}),approvals=new SearchAdApprovalService({repository:writer,config:{approvalTtlSeconds:300},clock:()=>now});
    const approve=p=>approvals.approve(p.planId,{actor:context.principal.principalId,confirmation:'APPROVE_SEARCHAD_CHANGE'});
    const creator=new CampaignCreateService({pool,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:2,dailyCapacityUnits:10,clock:()=>now,fetchImpl,logger});
    const cp=await creator.prepare({customerId:'1001',activationId:createActivationId},context),ca=await approve(cp);
    const scope={customerId:'1001',hierarchyRunId:cp.hierarchyRunId,hierarchyObjectId:cp.hierarchyObjectId};
    assert.equal((await creator.execute({...scope,planId:cp.planId,executionToken:ca.executionToken},context)).state,'owned');
    const offset=calls.length;let deleted=false;
    answer=method=>{if(method==='DELETE'){deleted=true;return response(204);}return deleted?response(404):response(200,remote);};
    const make=(p=pool,extra={})=>new CampaignCleanupService({pool:p,registry,credentialsRegistry:credentials,config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:10,planTtlSeconds:60,clock:()=>now,fetchImpl,logger,...extra});
    const service=make(),plan=await service.prepare({...scope,activationId},context);
    const retireInput={...scope,planId:plan.planId,confirmation:'RETIRE_EXPIRED_UNUSED_CAMPAIGN_CLEANUP_PLAN'};
    const replanInput={...scope,predecessorPlanId:plan.planId,activationId,confirmation:'REPLAN_EXPIRED_UNUSED_CAMPAIGN_CLEANUP_PLAN'};
    const input=(p,a)=>({...scope,planId:p.planId,executionToken:a.executionToken,confirmation:p.requiredConfirmation,secondConfirmation:p.requiredSecondConfirmation});
    return {pool,connect,make,service,config,registry,writer,approvals,scope,cp,remote,activationId,plan,retireInput,replanInput,approve,input,
      get calls(){return calls.slice(offset);},get deletes(){return calls.slice(offset).filter(c=>c.method==='DELETE').length;},
      get now(){return now;},set now(v){now=v;},set answer(v){answer=v;},expire(){now=Date.parse(plan.expiresAt);},
      async snapshot(){const out={};for(const table of TABLES)out[table]=(await pool.query(`SELECT row_to_json(t) AS r FROM ${table} t ORDER BY row_to_json(t)::text`)).rows;return out;},
      async old(){return (await pool.query('SELECT *,xmin::text AS version FROM searchad_write_change_plans WHERE plan_id=$1',[plan.planId])).rows[0];},
      async event(phase,details={},customerId='1001'){await pool.query(`INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) VALUES($1,$2,$3,$4,$5,'test',NULL,NULL,$6::jsonb,$7)`,[randomUUID(),scope.hierarchyRunId,scope.hierarchyObjectId,customerId,phase,JSON.stringify(details),new Date(now).toISOString()]);}
    };
  }
  function intercept(pool,after){return {query:(...args)=>pool.query(...args),async connect(){const c=await pool.connect();return {async query(sql,args){return after(c,sql,args);},release:discard=>c.release(discard)};}};}
  async function retired(f){f.expire();return f.service.retire(f.retireInput,context);}
  async function successor(f){await retired(f);return f.service.replan(f.replanInput,context);}

  await t.test('retire locally, preserve original rows, require a new approval and delete once through generation 2',async st=>{
    const f=await fixture(st),oldApproval=await f.approve(f.plan),before=await f.snapshot();
    const r=await retired(f);assert.equal(r.state,'expired_unused');assert.equal(r.cleanupAuthority,false);assert.equal(f.calls.length,0);
    const after=await f.snapshot();for(const table of TABLES.filter(x=>!['searchad_write_change_plans','searchad_write_attempts','searchad_hierarchy_events'].includes(x)))assert.deepEqual(after[table],before[table],table);
    const old=await f.old();assert.equal(old.status,'expired');
    assert.equal((await f.make(f.connect()).retire(f.retireInput,context)).alreadyRetired,true);assert.deepEqual(await f.snapshot(),after);
    const p=await f.service.replan(f.replanInput,context);assert.notEqual(p.planId,f.plan.planId);assert.equal(p.state,'planned');assert.equal(f.calls.length,0);
    const row=(await f.pool.query('SELECT * FROM searchad_write_change_plans WHERE plan_id=$1',[p.planId])).rows[0];
    assert.equal(row.before_json.cleanupGeneration,2);assert.equal(row.before_json.predecessorPlanId,f.plan.planId);
    const event=(await f.pool.query("SELECT * FROM searchad_hierarchy_events WHERE phase='cleanup_plan_retired'")).rows[0];
    assert.equal(row.before_json.predecessorRetirementEventId,event.event_id);assert.equal(row.before_json.predecessorRetirementHash,contentHash(event.details_json));
    for(const req of [f.input(f.plan,oldApproval),f.input(p,oldApproval)])await assert.rejects(()=>f.service.execute(req,context),errorCode);
    await assert.rejects(()=>f.service.reconcile({...f.scope,planId:f.plan.planId},context),errorCode);assert.equal(f.calls.length,0);
    const approval=await f.approve(p);assert.notEqual(approval.executionToken,oldApproval.executionToken);
    assert.equal((await f.service.execute(f.input(p,approval),context)).state,'deleted');assert.deepEqual(f.calls.map(x=>x.method),['GET','DELETE','GET']);
    assert.deepEqual(await f.old(),old);assert.equal((await f.writer.getApproval(oldApproval.approvalId)).used_at,null);
    assert.equal((await f.pool.query('SELECT sum(consumed_units)::int n FROM searchad_daily_risk_capacity')).rows[0].n,3);
    const final=await f.snapshot();assert.equal((await f.make(f.connect()).reconcile({...f.scope,planId:p.planId},context)).state,'deleted');assert.deepEqual(await f.snapshot(),final);
    await assert.rejects(()=>f.service.execute(f.input(p,approval),context),errorCode);assert.equal(f.deletes,1);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_verification_evidence')).rows[0].n,2);
  });
  await t.test('the plan expiry boundary applies to both unapproved and approval-service-expired plans',async st=>{
    const f=await fixture(st);f.now=Date.parse(f.plan.expiresAt)-1;const before=await f.snapshot();
    await assert.rejects(()=>f.service.retire(f.retireInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);
    f.expire();await assert.rejects(()=>f.approve(f.plan));assert.equal((await f.service.retire(f.retireInput,context)).state,'expired_unused');assert.equal(f.calls.length,0);
  });
  await t.test('an expired approval alone does not retire a still-live plan',async st=>{
    const f=await fixture(st);const short=new SearchAdApprovalService({repository:f.writer,config:{approvalTtlSeconds:1},clock:()=>f.now});
    await short.approve(f.plan.planId,{actor:context.principal.principalId,confirmation:'APPROVE_SEARCHAD_CHANGE'});f.now+=2000;
    const before=await f.snapshot();await assert.rejects(()=>f.service.retire(f.retireInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);
  });
  await t.test('explicit retirement and predecessor are mandatory; generation 3 remains unsupported',async st=>{
    const f=await fixture(st);f.expire();await assert.rejects(()=>f.service.replan(f.replanInput,context),errorCode);
    const p=await successor(f);await assert.rejects(()=>f.service.prepare({...f.scope,activationId:f.activationId},context),errorCode);
    await assert.rejects(()=>f.service.replan(f.replanInput,context),errorCode);f.now=Date.parse(p.expiresAt);
    await assert.rejects(()=>f.service.retire({...f.retireInput,planId:p.planId},context),errorCode);assert.equal(f.calls.length,0);
  });
  await t.test('suspension and remote gates OFF allow local retirement but not new deletion authority',async st=>{
    const f=await fixture(st);await f.pool.query('UPDATE searchad_canary_accounts SET suspended=true');f.config.allowActiveCanary=false;f.config.allowReads=false;
    assert.equal((await retired(f)).state,'expired_unused');const before=await f.snapshot();
    await assert.rejects(()=>f.service.replan(f.replanInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  await t.test('inventory veto survives retirement and blocks replacement',async st=>{
    const f=await fixture(st);await f.event('descendant_inventory',{completeAbsence:false,cleanupAuthority:false});await retired(f);
    const before=await f.snapshot();await assert.rejects(()=>f.service.replan(f.replanInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  for(const [label,sql] of [
    ['used approval',"UPDATE searchad_write_approvals SET used_at=created_at WHERE plan_id=$1"],
    ['unknown outcome',"UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1"],
    ['changed descriptor',"UPDATE searchad_write_change_plans SET mutation_json='{}'::jsonb WHERE plan_id=$1"],
    ['changed planning attempt',"UPDATE searchad_write_attempts SET response_json='{}'::jsonb WHERE plan_id=$1"],
    ['non-planning attempt',"INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,created_at) VALUES(gen_random_uuid(),$1,'unexpected','test',now())"],
    ['forged expired reason',"UPDATE searchad_write_change_plans SET status='expired',last_error_json='{\"code\":\"UNUSED_CAMPAIGN_CLEANUP_PLAN_EXPIRED\"}'::jsonb WHERE plan_id=$1"],
    ['rollback descriptor',"UPDATE searchad_write_change_plans SET rollback_json='{}'::jsonb WHERE plan_id=$1"]
  ])await t.test(`${label} prevents retirement without changing any further state`,async st=>{
    const f=await fixture(st);await f.approve(f.plan);f.expire();await f.pool.query(sql,[f.plan.planId]);const before=await f.snapshot();
    await assert.rejects(()=>f.service.retire(f.retireInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  await t.test('foreign-owner released DELETE risk is still prior work, unlike legitimate CREATE risk',async st=>{
    const f=await fixture(st);f.expire();await f.pool.query(`INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at) VALUES($1,$2,'1001','2026-09-29',$3,'delete',1,'released','hierarchy_canary','foreign-owner',$4,$4)`,[randomUUID(),`unexpected:delete:${f.plan.planId}`,OPS.campaign.delete,new Date(f.now).toISOString()]);
    const before=await f.snapshot();await assert.rejects(()=>f.service.retire(f.retireInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);assert.equal(f.deletes,0);
  });
  await t.test('target-linked foreign events cannot disappear behind Customer filters',async st=>{
    const f=await fixture(st);f.expire();await f.event('cleanup_dispatch_intent',{planId:f.plan.planId},'2002');const before=await f.snapshot();
    await assert.rejects(()=>f.service.retire(f.retireInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  await t.test('an orphan target-linked plan cannot be ignored to create a replacement',async st=>{
    const f=await fixture(st);await retired(f);
    await f.pool.query(`INSERT INTO searchad_write_change_plans(plan_id,customer_id,mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,reason,status,created_by,created_at,expires_at) SELECT $1,'2002',mutation_operation_key,mutation_json,read_json,before_json,before_hash,expected_after_json,reason,'planned',created_by,created_at,expires_at FROM searchad_write_change_plans WHERE plan_id=$2`,[randomUUID(),f.plan.planId]);
    const before=await f.snapshot();await assert.rejects(()=>f.service.replan(f.replanInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  await t.test('a committed claim with zero DELETE calls is not an unused plan',async st=>{
    const f=await fixture(st),a=await f.approve(f.plan);let claimed=false,flipped=false;
    const wrapped=intercept(f.pool,async(c,sql,args)=>{const r=await c.query(sql,args);if(args?.includes('cleanup_dispatch_intent'))claimed=true;if(sql==='COMMIT'&&claimed&&!flipped){flipped=true;f.config.allowActiveCanary=false;}return r;});
    f.answer=()=>response(200,f.remote);await f.make(wrapped).execute(f.input(f.plan,a),context);assert.equal(flipped,true);assert.equal(f.deletes,0);
    f.expire();const before=await f.snapshot();await assert.rejects(()=>f.service.retire(f.retireInput,context),errorCode);await assert.rejects(()=>f.service.replan(f.replanInput,context),errorCode);assert.deepEqual(await f.snapshot(),before);
  });
  await t.test('ambiguous generation-2 DELETE recovers on another pool with writes OFF and suspension, never replaying',async st=>{
    const f=await fixture(st),p=await successor(f),a=await f.approve(p),old=await f.old();let sent=false;
    f.answer=method=>{if(method==='DELETE'){sent=true;throw new Error('lost reply');}return sent?response(503):response(200,f.remote);};
    assert.equal((await f.service.execute(f.input(p,a),context)).state,'delete_unknown');assert.equal(f.deletes,1);f.now=Date.parse(p.expiresAt);
    await assert.rejects(()=>f.service.retire({...f.retireInput,planId:p.planId},context),errorCode);
    await f.pool.query('UPDATE searchad_canary_accounts SET suspended=true');f.config.allowActiveCanary=false;f.answer=()=>response(404);
    assert.equal((await f.make(f.connect()).reconcile({...f.scope,planId:p.planId},context)).state,'deleted');assert.equal(f.deletes,1);assert.deepEqual(await f.old(),old);
  });
  for(const stage of ['replan','execute','reconcile'])await t.test(`corrupt predecessor is rechecked before ${stage}`,async st=>{
    const f=await fixture(st);await retired(f);let p,a;
    if(stage!=='replan'){p=await f.service.replan(f.replanInput,context);a=await f.approve(p);}
    if(stage==='reconcile'){let sent=false;f.answer=method=>{if(method==='DELETE'){sent=true;return response(204);}return sent?response(503):response(200,f.remote);};await f.service.execute(f.input(p,a),context);}
    await f.pool.query("UPDATE searchad_write_change_plans SET last_error_json='{}'::jsonb WHERE plan_id=$1",[f.plan.planId]);const before=await f.snapshot(),count=f.calls.length;
    await assert.rejects(()=>stage==='replan'?f.service.replan(f.replanInput,context):stage==='execute'?f.service.execute(f.input(p,a),context):f.service.reconcile({...f.scope,planId:p.planId},context),errorCode);
    assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,count);
  });
  for(const action of ['retire','replan'])for(const table of ['searchad_hierarchy_events','searchad_write_attempts'])await t.test(`${action}: ${table} audit failure rolls everything back`,async st=>{
    const f=await fixture(st);f.expire();if(action==='replan')await retired(f);
    const phase=action==='retire'?'cleanup_plan_retired':'cleanup_plan';
    await f.pool.query(`CREATE FUNCTION reject_root_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='${phase}' THEN RAISE EXCEPTION 'SECRET fixture'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_root_audit BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_root_audit()`);
    const before=await f.snapshot();await assert.rejects(()=>f.service[action](action==='retire'?f.retireInput:f.replanInput,context),e=>{errorCode(e);assert.ok(!e.message.includes('SECRET'));return true;});assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  for(const drift of ['identity','clock'])await t.test(`final retirement audit ${drift} drift rolls back`,async st=>{
    const f=await fixture(st);f.expire();const before=await f.snapshot();let changed=false;
    const wrapped=intercept(f.pool,async(c,sql,args)=>{const r=await c.query(sql,args);if(sql.includes('INSERT INTO searchad_write_attempts')&&args?.includes('cleanup_plan_retired')){changed=true;if(drift==='identity')f.config.baseUrl='https://invalid.example';else f.now=NOW;}return r;});
    await assert.rejects(()=>f.make(wrapped).retire(f.retireInput,context),errorCode);assert.equal(changed,true);assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
  for(const mode of ['send','ack'])await t.test(`retirement COMMIT ${mode} uncertainty returns no success`,async st=>{
    const f=await fixture(st);f.expire();let fired=false,discarded=false;
    const wrapped={query:(...args)=>f.pool.query(...args),async connect(){const c=await f.pool.connect();return {async query(sql,args){if(sql==='COMMIT'&&!fired){fired=true;if(mode==='ack')await c.query(sql,args);throw new Error('lost commit');}return c.query(sql,args);},release(v){discarded=v===true;c.release(v);}};}};
    await assert.rejects(()=>f.make(wrapped).retire(f.retireInput,context),errorCode);assert.equal(fired,true);assert.equal(discarded,true);assert.equal(f.calls.length,0);
    const result=await f.make(f.connect()).retire(f.retireInput,context);assert.equal(result.alreadyRetired,mode==='ack');
  });
  await t.test('two independent pools append one retirement and at most one successor',async st=>{
    const f=await fixture(st);f.expire();const other=f.make(f.connect());
    const r=await Promise.all([f.service.retire(f.retireInput,context),other.retire(f.retireInput,context)]);assert.equal(r.filter(x=>x.alreadyRetired===false).length,1);
    const p=await Promise.allSettled([f.service.replan(f.replanInput,context),other.replan(f.replanInput,context)]);assert.equal(p.filter(x=>x.status==='fulfilled').length,1);
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM searchad_hierarchy_events WHERE phase='cleanup_plan_retired'")).rows[0].n,1);assert.equal(f.calls.length,0);
  });
  await t.test('default OFF, exact confirmations, roles and local IDs are checked before any work',async st=>{
    const f=await fixture(st);f.expire();const before=await f.snapshot();
    for(const action of ['retire','replan']){const input=action==='retire'?f.retireInput:f.replanInput;
      for(const enabled of [false,undefined])await assert.rejects(()=>f.make(f.pool,{enabled})[action](input,context),errorCode);
      for(const patch of [{remoteId:'victim'},{body:{}},{actorPrincipalId:'forged'},{confirmation:'yes'},{hierarchyObjectId:'bad'}])await assert.rejects(()=>f.service[action]({...input,...patch},context),errorCode);
      for(const principal of [null,{...context.principal,role:'reader'},{...context.principal,customerIds:[]}])await assert.rejects(()=>f.service[action](input,{principal}),errorCode);
    }assert.deepEqual(await f.snapshot(),before);assert.equal(f.calls.length,0);
  });
});
