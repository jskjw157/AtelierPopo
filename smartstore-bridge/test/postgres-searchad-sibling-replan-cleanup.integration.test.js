import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { SiblingCreateService } from '../src/naver/searchad/lifecycle/sibling-create-service.js';
import { SiblingPlanRetirementService } from '../src/naver/searchad/lifecycle/sibling-plan-retirement-service.js';
import { PostgresSiblingPlanRetirementRepository } from '../src/naver/searchad/lifecycle/postgres-sibling-plan-retirement-repository.js';
import { ChildFirstCleanupService } from '../src/naver/searchad/lifecycle/child-first-cleanup-service.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { KEYWORD_FIELDS, CREATIVE_FIELDS } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';

const logger={info(){},warn(){},error(){}};
const context={principal:{principalId:'replan-cleanup-admin',role:'admin',customerIds:['1001']}};
const NOW=Date.parse('2026-09-23T00:00:00Z');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

// All persistence, approval, ancestry, gateway/signing and lifecycle services are
// real. Only authority fixtures and Naver transport are synthetic. No live calls.
test('real PostgreSQL sibling replacement preserves history through owned and partial cleanup', {timeout:240_000}, async t=>{
  assert.equal(typeof SiblingCreateService.prototype.replanKeywords,'function','explicit keyword replan method is required');
  assert.equal(typeof SiblingCreateService.prototype.replanCreative,'function','explicit creative replan method is required');
  const url=process.env.TEST_DATABASE_URL;
  if(!url){assert.notEqual(process.env.CI,'true','CI requires PostgreSQL');return t.skip('Local PostgreSQL not configured');}
  const admin=createPostgresPool({connectionString:url,sslMode:'disable',logger});
  const originalFetch=globalThis.fetch;let escaped=0;
  globalThis.fetch=async()=>{escaped++;throw new Error('External transport forbidden');};
  t.after(async()=>{globalThis.fetch=originalFetch;await closePostgresPool(admin);assert.equal(escaped,0);});

  async function fixture(st,kind='keywords'){
    const schema=`sibling_replan_${randomUUID().replaceAll('-','')}`,pools=new Set();let created=false;
    const f={now:NOW,kind,mode:'exact',calls:[],transportErrors:[],remote:new Map(),deleted:new Set()};
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
      const id=randomUUID(),evidenceId=`synthetic-${randomUUID()}`,start=new Date(f.now-1000).toISOString(),end=new Date(f.now+3600000).toISOString();
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`,[evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([lifecycle]),start,end]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture',$9,$10)`,[id,evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([lifecycle]),start,end]);
      return id;
    };
    f.fetchImpl=async(value,init)=>{
      const u=new URL(value),body=init.body?JSON.parse(init.body):null,headers=new Headers(init.headers);
      f.calls.push(`${init.method} ${u.pathname}`);
      try{
        assert.equal(u.origin,f.identity.upstreamBaseUrl);assert.equal(init.redirect,'error');assert.equal(headers.get('X-Customer'),'1001');
        assert.equal(headers.get('X-Signature'),createHmac('sha256',f.credentials.resolve('1001').secretKey).update(`${headers.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));
      }catch(e){f.transportErrors.push(e.message);throw e;}
      if(init.method==='POST'&&u.pathname==='/ncc/campaigns'){
        f.rootRemote={customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body};f.remote.set(`/ncc/campaigns/${f.rootRemote.nccCampaignId}`,f.rootRemote);return json(f.rootRemote);
      }
      if(init.method==='POST'&&u.pathname==='/ncc/adgroups'){
        f.groupRemote={customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body};f.remote.set(`/ncc/adgroups/${f.groupRemote.nccAdgroupId}`,f.groupRemote);return json(f.groupRemote,201);
      }
      if(init.method==='POST'&&['/ncc/keywords','/ncc/ads'].includes(u.pathname)&&f.mode==='timeout')throw new Error('synthetic lost response');
      if(init.method==='POST'&&u.pathname==='/ncc/keywords'){
        const rows=body.map(item=>({nccKeywordId:`kw-${randomUUID()}`,keyword:item.keyword}));
        for(const row of rows)f.remote.set(`/ncc/keywords/${row.nccKeywordId}`,{customerId:'1001',nccAdgroupId:f.groupRemote.nccAdgroupId,...row});
        return json(f.mode==='partial'?[rows[1]]:rows);
      }
      if(init.method==='POST'&&u.pathname==='/ncc/ads'){
        const row={customerId:'1001',nccAdId:`ad-${randomUUID()}`,...body};f.remote.set(`/ncc/ads/${row.nccAdId}`,row);return json(row,201);
      }
      if(init.method==='GET'&&f.remote.has(u.pathname))return f.deleted.has(u.pathname)?json({code:'NOT_FOUND'},404):json(f.remote.get(u.pathname));
      if(init.method==='DELETE'&&f.remote.has(u.pathname)){f.deleted.add(u.pathname);return json({accepted:true});}
      f.transportErrors.push(`Unexpected ${init.method} ${u.pathname}`);throw new Error('Unexpected transport');
    };
    f.args={pool:f.pool,registry:f.registry,credentialsRegistry:f.credentials,config:f.config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:60,preflightMaxAgeMs:5000,clock:()=>f.now,fetchImpl:f.fetchImpl,logger,keywordTexts:['haar-order-first','haar-order-second']};
    const approvals=new SearchAdApprovalService({repository:new PostgresSearchAdWriteRepository({pool:f.pool}),config:{approvalTtlSeconds:300},clock:()=>f.now});
    f.approve=id=>approvals.approve(id,{confirmation:'APPROVE_SEARCHAD_CHANGE',actor:'fixture-approver'});
    const rootCreator=new CampaignCreateService(f.args);
    const rp=await rootCreator.prepare({customerId:'1001',activationId:await f.authority(OPS.campaign.create,['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'])},context);
    f.root=await rootCreator.execute({customerId:'1001',hierarchyRunId:rp.hierarchyRunId,hierarchyObjectId:rp.hierarchyObjectId,planId:rp.planId,executionToken:(await f.approve(rp.planId)).executionToken},context);assert.equal(f.root.state,'owned');f.now+=1000;
    const groupCreator=new AdgroupCreateService(f.args);
    const gp=await groupCreator.prepare({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,activationId:await f.authority(OPS.adgroup.create,['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'])},context);
    f.group=await groupCreator.execute({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,hierarchyObjectId:gp.hierarchyObjectId,planId:gp.planId,executionToken:(await f.approve(gp.planId)).executionToken},context);assert.equal(f.group.state,'owned');f.now+=1000;
    f.creator=new SiblingCreateService(f.args);f.type=kind==='keywords'?'keyword':'creative';
    f.activationId=await f.authority(OPS[f.type].create,kind==='keywords'?KEYWORD_FIELDS:CREATIVE_FIELDS,kind==='keywords'?'batch_create':'create');
    f.prepareInput={customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,activationId:f.activationId};
    f.old=await f.creator[kind==='keywords'?'prepareKeywords':'prepareCreative'](f.prepareInput,context);
    f.oldApproval=await f.approve(f.old.planId);f.now=Date.parse(f.old.expiresAt);
    f.retirement=new SiblingPlanRetirementService({repository:new PostgresSiblingPlanRetirementRepository({pool:f.pool,dailyBudget:1000,current:()=>f.identity,clock:()=>f.now}),enabled:true});
    await f.retirement.retire({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:f.old.planId,kind,confirmation:kind==='keywords'?'RETIRE_EXPIRED_UNUSED_KEYWORD_PLAN':'RETIRE_EXPIRED_UNUSED_CREATIVE_PLAN'},context);
    f.replanInput={...f.prepareInput,predecessorPlanId:f.old.planId,confirmation:kind==='keywords'?'REPLAN_EXPIRED_UNUSED_KEYWORD_PLAN':'REPLAN_EXPIRED_UNUSED_CREATIVE_PLAN'};
    f.replan=(pool=f.pool)=>new SiblingCreateService({...f.args,pool})[kind==='keywords'?'replanKeywords':'replanCreative'](f.replanInput,context);
    f.execution=(plan,token)=>({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:plan.planId,kind,executionToken:token});
    f.run=async plan=>f.creator.execute(f.execution(plan,(await f.approve(plan.planId)).executionToken),context);
    f.cleanup=new ChildFirstCleanupService(f.args);
    f.cleanPlan=async(id,type=f.type)=>f.cleanup.prepare({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:id,activationId:await f.authority(OPS[type].delete,[],'delete')},context);
    f.clean=async(id)=>{
      const p=await f.cleanPlan(id);const input={customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:id,planId:p.planId,executionToken:(await f.approve(p.planId)).executionToken,confirmation:p.requiredConfirmation,secondConfirmation:p.requiredSecondConfirmation};
      const result=await f.cleanup.execute(input,context);return {result,input};
    };
    f.history=async()=>{
      const o=await f.pool.query('SELECT to_jsonb(t) AS row,t.xmin::text AS version FROM searchad_hierarchy_objects t WHERE hierarchy_object_id=ANY($1::uuid[]) ORDER BY hierarchy_object_id',[f.old.objectIds]);
      const p=await f.pool.query('SELECT to_jsonb(t) AS row,t.xmin::text AS version FROM searchad_write_change_plans t WHERE plan_id=$1',[f.old.planId]);
      const a=await f.pool.query('SELECT to_jsonb(t) AS row,t.xmin::text AS version FROM searchad_write_approvals t WHERE plan_id=$1 ORDER BY approval_id',[f.old.planId]);
      return {objects:o.rows,plans:p.rows,approvals:a.rows};
    };
    f.countPlans=async()=>Number((await f.pool.query('SELECT count(*) FROM searchad_write_change_plans')).rows[0].count);
    f.calls.length=0;return f;
  }

  for(const kind of ['keywords','creative'])await t.test(`${kind}: new approval, current-generation DELETE once, historical rows unchanged`,async st=>{
    const f=await fixture(st,kind),before=await f.history(),plan=await f.replan();
    assert.notEqual(plan.planId,f.old.planId);assert.ok(plan.objectIds.every(id=>!f.old.objectIds.includes(id)));assert.deepEqual(f.calls,[]);
    await assert.rejects(f.creator.execute(f.execution(plan,f.oldApproval.executionToken),context));assert.deepEqual(f.calls,[]);
    const owned=await f.run(plan);assert.equal(owned.state,'owned');assert.equal(f.calls.filter(c=>c===`POST /ncc/${kind==='keywords'?'keywords':'ads'}`).length,1);
    await assert.rejects(f.replan());await assert.rejects(f.creator.execute(f.execution(f.old,f.oldApproval.executionToken),context));
    for(const id of f.old.objectIds)await assert.rejects(f.cleanPlan(id));
    for(const [index,id] of plan.objectIds.entries()){
      f.calls.length=0;const {result,input}=await f.clean(id);assert.equal(result.state,'deleted');
      const prefix=kind==='keywords'?'keywords':'ads',remoteId=owned.remoteIds[index];
      assert.equal(f.calls.filter(c=>c===`DELETE /ncc/${prefix}/${remoteId}`).length,1);
      assert.equal(f.calls.filter(c=>c===`GET /ncc/${prefix}/${remoteId}`).length,2);
      const beforeReplay=f.calls.length;await assert.rejects(f.cleanup.execute(input,context));assert.equal(f.calls.length,beforeReplay);
    }
    assert.deepEqual(await f.history(),before,'predecessor objects, plan, token and row versions stay unchanged');
    // Retired predecessors are not remote absence; a new unproven inventory
    // event must still veto parent deletion after every current leaf is deleted.
    await f.pool.query("INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) VALUES($1,$2,$3,'1001','descendant_inventory','observed_empty_unproven',NULL,NULL,$4::jsonb,$5)",[randomUUID(),f.root.hierarchyRunId,f.group.hierarchyObjectId,JSON.stringify({readOnly:true,parentType:'adgroup',childType:f.type,completeAbsence:false,cleanupAuthority:false}),new Date(f.now)]);
    f.calls.length=0;await assert.rejects(f.cleanPlan(f.group.hierarchyObjectId,'adgroup'));assert.deepEqual(f.calls,[]);
  });

  await t.test('generation-2 partial result binds the second request item; only its known leaf can be deleted',async st=>{
    const f=await fixture(st),before=await f.history(),plan=await f.replan();f.mode='partial';
    const result=await f.run(plan);assert.equal(result.state,'manual_review');
    const rows=(await f.pool.query('SELECT * FROM searchad_hierarchy_objects WHERE hierarchy_object_id=ANY($1::uuid[])',[plan.objectIds])).rows;
    const known=rows.find(r=>r.remote_id!==null);assert.equal(known.hierarchy_object_id,plan.objectIds[1]);
    const unknown=rows.find(r=>r.remote_id===null);f.calls.length=0;
    await assert.rejects(f.cleanPlan(unknown.hierarchy_object_id));await assert.rejects(f.cleanPlan(f.group.hierarchyObjectId,'adgroup'));assert.deepEqual(f.calls,[]);
    const cleaned=await f.clean(known.hierarchy_object_id);assert.equal(cleaned.result.state,'deleted');
    assert.equal((await f.pool.query('SELECT status FROM searchad_hierarchy_canary_runs WHERE hierarchy_run_id=$1',[f.root.hierarchyRunId])).rows[0].status,'manual_review');
    await assert.rejects(f.cleanPlan(f.group.hierarchyObjectId,'adgroup'));assert.deepEqual(await f.history(),before);
    assert.ok(f.calls.every(c=>!c.endsWith('/null')));
  });

  await t.test('two real pools serialize the same predecessor into exactly one successor',async st=>{
    const f=await fixture(st),count=await f.countPlans();
    const outcomes=await Promise.allSettled([f.replan(),f.replan(f.connect())]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.filter(r=>r.status==='rejected').length,1);
    assert.equal(await f.countPlans(),count+1);assert.deepEqual(f.calls,[]);
  });

  await t.test('real planning-audit insertion failure rolls back new objects and successor plan',async st=>{
    const f=await fixture(st),count=await f.countPlans(),before=await f.history();
    const objects=Number((await f.pool.query('SELECT count(*) FROM searchad_hierarchy_objects')).rows[0].count);
    await f.pool.query("CREATE FUNCTION reject_successor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='sibling_plan' AND NEW.details_json->>'generation'='2' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$");
    await f.pool.query('CREATE TRIGGER reject_successor BEFORE INSERT ON searchad_hierarchy_events FOR EACH ROW EXECUTE FUNCTION reject_successor()');
    await assert.rejects(f.replan());assert.equal(await f.countPlans(),count);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM searchad_hierarchy_objects')).rows[0].count),objects);assert.deepEqual(await f.history(),before);assert.deepEqual(f.calls,[]);
  });

  await t.test('cleanup rechecks predecessor proof; tampered retirement reason cannot be hidden',async st=>{
    const f=await fixture(st),plan=await f.replan();await f.run(plan);
    await f.pool.query("UPDATE searchad_write_change_plans SET last_error_json='{}'::jsonb WHERE plan_id=$1",[f.old.planId]);
    f.calls.length=0;await assert.rejects(f.cleanPlan(plan.objectIds[0]));assert.deepEqual(f.calls,[]);
  });

  await t.test('unresolved create outcome cannot be retried through replacement or cleanup',async st=>{
    const f=await fixture(st),before=await f.history(),plan=await f.replan();f.mode='timeout';
    const result=await f.run(plan);assert.equal(result.state,'create_unknown');assert.equal(f.calls.filter(c=>c==='POST /ncc/keywords').length,1);
    f.calls.length=0;await assert.rejects(f.replan());await assert.rejects(f.cleanPlan(plan.objectIds[0]));assert.deepEqual(f.calls,[]);assert.deepEqual(await f.history(),before);
  });
});
