import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { AdgroupPlanRetirementService } from '../src/naver/searchad/lifecycle/adgroup-plan-retirement-service.js';
import { PostgresAdgroupPlanRetirementRepository } from '../src/naver/searchad/lifecycle/postgres-adgroup-plan-retirement-repository.js';
import { SiblingCreateService } from '../src/naver/searchad/lifecycle/sibling-create-service.js';
import { PostgresSiblingCreateRepository } from '../src/naver/searchad/lifecycle/postgres-sibling-create-repository.js';
import { ChildFirstCleanupService } from '../src/naver/searchad/lifecycle/child-first-cleanup-service.js';
import { siblingScope, KEYWORD_FIELDS, CREATIVE_FIELDS } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';

const logger = { info() {}, warn() {}, error() {} };
const NOW = Date.parse('2026-09-23T00:00:00Z');
const context = { principal: { principalId: 'sibling-retirement-admin', role: 'admin', customerIds: ['1001'] } };
const confirmation = kind => kind === 'keywords' ? 'RETIRE_EXPIRED_UNUSED_KEYWORD_PLAN' : 'RETIRE_EXPIRED_UNUSED_CREATIVE_PLAN';
const reason = { code: 'UNUSED_SIBLING_PLAN_EXPIRED' };
const code = suffix => e => e?.code === `SEARCHAD_SIBLING_PLAN_RETIREMENT_${suffix}`;
const retirementError = e => e?.code?.startsWith('SEARCHAD_SIBLING_PLAN_RETIREMENT_');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const envelope = (operationKey, data) => ({ operation: { operationKey, sideEffect: false }, upstream: { status: 200 }, data });
async function feature(file) {
  try { return await import(file); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(file.split('/').at(-1))) return {}; throw e; }
}
function intercepted(pool, hook) {
  return { query: pool.query.bind(pool), connect: async () => { const c = await pool.connect(); return { release: c.release.bind(c), query: (sql, values) => hook(c, sql, values) }; } };
}

test('unused expired sibling retirement is atomic, local-only and preserves all live ancestors', { timeout: 180_000 }, async t => {
  const { SiblingPlanRetirementService: Service } = await feature('../src/naver/searchad/lifecycle/sibling-plan-retirement-service.js');
  const { PostgresSiblingPlanRetirementRepository: Repository } = await feature('../src/naver/searchad/lifecycle/postgres-sibling-plan-retirement-repository.js');
  assert.equal(typeof Service, 'function', 'SiblingPlanRetirementService must be implemented');
  assert.equal(typeof Repository, 'function', 'PostgresSiblingPlanRetirementRepository must be implemented');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { assert.notEqual(process.env.CI, 'true', 'CI requires PostgreSQL'); return t.skip('Local PostgreSQL not configured'); }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const originalFetch = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => { globalThis.fetch = originalFetch; await closePostgresPool(admin); assert.equal(escaped, 0); });

  async function fixture(st, { kind = 'keywords', approved = false, replacementParent = false, ttl = 60, approvalTtl = 300 } = {}) {
    const schema = `sibling_retirement_${randomUUID().replaceAll('-', '')}`, pools = new Set();
    let created = false;
    const f = { now: NOW, kind, calls: [], transportErrors: [], mode: 'exact' };
    st.after(async () => {
      try { await Promise.all([...pools].map(p => closePostgresPool(p))); }
      finally { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
      assert.deepEqual(f.transportErrors, []);
    });
    await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    f.connect = () => { const p = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger }); pools.add(p); return p; };
    f.pool = f.connect();
    await runPostgresMigrations({ pool: f.pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    f.registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
    f.config = loadSearchAdConfig({ NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret', NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_SEARCHAD_ALLOW_READS: 'true', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true' });
    f.credentials = new SearchAdCredentialsRegistry(f.config.topology);
    f.identity = { specSha: f.registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(f.credentials, '1001'), upstreamBaseUrl: 'https://api.searchad.naver.com' };
    f.current = { ...f.identity };
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    f.authority = async (operation, fields, lifecycle = 'create') => {
      const activationId = randomUUID(), evidenceId = `synthetic-${randomUUID()}`;
      const start = new Date(f.now - 1000).toISOString(), end = new Date(f.now + 3600000).toISOString();
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`, [evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([lifecycle]),start,end]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture-authority',$9,$10)`, [activationId,evidenceId,f.identity.specSha,f.identity.credentialFingerprint,f.identity.upstreamBaseUrl,JSON.stringify([operation]),JSON.stringify(fields),JSON.stringify([lifecycle]),start,end]);
      return activationId;
    };
    f.fetchImpl = async (value, init) => {
      const u = new URL(value), headers = new Headers(init.headers), body = init.body ? JSON.parse(init.body) : null;
      f.calls.push(`${init.method} ${u.pathname}`);
      try {
        assert.equal(u.origin, f.identity.upstreamBaseUrl); assert.equal(init.redirect, 'error'); assert.equal(headers.get('X-Customer'), '1001');
        const credentials = f.credentials.resolve('1001');
        assert.equal(headers.get('X-Signature'), createHmac('sha256', credentials.secretKey).update(`${headers.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));
      } catch (e) { f.transportErrors.push(e.message); throw e; }
      if (init.method === 'POST' && u.pathname === '/ncc/campaigns') { f.rootRemote = { customerId:'1001',nccCampaignId:`cmp-${randomUUID()}`,...body }; return json(f.rootRemote); }
      if (init.method === 'GET' && u.pathname === `/ncc/campaigns/${f.rootRemote?.nccCampaignId}`) return json(f.rootRemote);
      if (init.method === 'POST' && u.pathname === '/ncc/adgroups') { f.groupRemote = { customerId:'1001',nccAdgroupId:`grp-${randomUUID()}`,...body }; return json(f.groupRemote,201); }
      if (init.method === 'GET' && u.pathname === `/ncc/adgroups/${f.groupRemote?.nccAdgroupId}`) return json(f.groupRemote);
      if (init.method === 'POST' && ['/ncc/keywords','/ncc/ads'].includes(u.pathname) && f.mode === 'timeout') throw new Error('synthetic lost response');
      if (init.method === 'POST' && u.pathname === '/ncc/keywords') {
        const rows = body.map(item => ({ nccKeywordId:`kw-${randomUUID()}`,keyword:item.keyword })); f.keywordRemote = rows;
        if (f.mode === 'partial') return json(rows.slice(0,1));
        if (f.mode === 'duplicate') return json([rows[0],{...rows[1],nccKeywordId:rows[0].nccKeywordId}]);
        return json(rows);
      }
      if (init.method === 'GET' && u.pathname.startsWith('/ncc/keywords/')) { const row = f.keywordRemote?.find(r => r.nccKeywordId === u.pathname.split('/').at(-1)); return row ? json({customerId:'1001',nccAdgroupId:f.groupRemote.nccAdgroupId,...row}) : json({code:'NOT_FOUND'},404); }
      if (init.method === 'POST' && u.pathname === '/ncc/ads') { f.creativeRemote = {customerId:'1001',nccAdId:`ad-${randomUUID()}`,...body}; return json(f.creativeRemote,201); }
      if (init.method === 'GET' && u.pathname === `/ncc/ads/${f.creativeRemote?.nccAdId}`) return json(f.creativeRemote);
      f.transportErrors.push(`Unexpected ${init.method} ${u.pathname}`); throw new Error('Unexpected fixture transport');
    };
    f.args = { pool:f.pool,registry:f.registry,credentialsRegistry:f.credentials,config:f.config,enabled:true,dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,planTtlSeconds:ttl,preflightMaxAgeMs:5000,clock:()=>f.now,fetchImpl:f.fetchImpl,logger,keywordTexts:['haar-one','haar-two'] };
    const approvals = new SearchAdApprovalService({ repository:new PostgresSearchAdWriteRepository({pool:f.pool}),config:{approvalTtlSeconds:approvalTtl},clock:()=>f.now });
    f.approve = id => approvals.approve(id,{confirmation:'APPROVE_SEARCHAD_CHANGE',actor:'fixture-approver'});
    const rootCreator = new CampaignCreateService(f.args);
    const rootPlan = await rootCreator.prepare({customerId:'1001',activationId:await f.authority(OPS.campaign.create,['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'])},context);
    f.root = await rootCreator.execute({customerId:'1001',hierarchyRunId:rootPlan.hierarchyRunId,hierarchyObjectId:rootPlan.hierarchyObjectId,planId:rootPlan.planId,executionToken:(await f.approve(rootPlan.planId)).executionToken},context);
    assert.equal(f.root.state,'owned'); f.now += 1000;
    const groupCreator = new AdgroupCreateService(f.args);
    const prepareGroup = {customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,activationId:await f.authority(OPS.adgroup.create,['adgroup.nccCampaignId','adgroup.name','adgroup.userLock'])};
    let groupPlan = await groupCreator.prepare(prepareGroup,context);
    if (replacementParent) {
      f.now = Date.parse(groupPlan.expiresAt);
      const retire = new AdgroupPlanRetirementService({repository:new PostgresAdgroupPlanRetirementRepository({pool:f.pool,dailyBudget:1000,current:()=>f.current,clock:()=>f.now}),enabled:true});
      await retire.retire({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,hierarchyObjectId:groupPlan.hierarchyObjectId,planId:groupPlan.planId,confirmation:'RETIRE_EXPIRED_UNUSED_ADGROUP_PLAN'},context);
      groupPlan = await groupCreator.prepare(prepareGroup,context);
    }
    f.group = await groupCreator.execute({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.root.hierarchyObjectId,hierarchyObjectId:groupPlan.hierarchyObjectId,planId:groupPlan.planId,executionToken:(await f.approve(groupPlan.planId)).executionToken},context);
    assert.equal(f.group.state,'owned'); f.now += 1000;
    f.creator = new SiblingCreateService(f.args);
    const activationId = await f.authority(kind === 'keywords' ? OPS.keyword.create : OPS.creative.create,kind === 'keywords' ? KEYWORD_FIELDS : CREATIVE_FIELDS,kind === 'keywords' ? 'batch_create' : 'create');
    f.prepareInput = {customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,activationId};
    f.prepare = () => kind === 'keywords' ? f.creator.prepareKeywords(f.prepareInput,context) : f.creator.prepareCreative(f.prepareInput,context);
    f.plan = await f.prepare(); f.approval = approved ? await f.approve(f.plan.planId) : null;
    f.scope = {customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:f.plan.planId,kind,confirmation:confirmation(kind)};
    f.execution = () => ({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:f.plan.planId,kind,executionToken:f.approval?.executionToken ?? 'A'.repeat(43)});
    f.service = (pool = f.pool) => new Service({repository:new Repository({pool,dailyBudget:1000,current:()=>f.current,clock:()=>f.now}),enabled:true});
    f.expire = () => {f.now=Date.parse(f.plan.expiresAt);};
    f.rows = async table => (await f.pool.query(`SELECT to_jsonb(t) AS data FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.data);
    f.state = async () => {const result={}; for(const table of ['searchad_canary_accounts','searchad_hierarchy_canary_runs','searchad_hierarchy_objects','searchad_remote_object_ownership','searchad_write_change_plans','searchad_write_approvals','searchad_write_locks','searchad_write_attempts','searchad_hierarchy_events','searchad_risk_reservations','searchad_daily_risk_capacity','searchad_verification_evidence','searchad_activation_grants']) result[table]=await f.rows(table); return result;};
    f.calls.length=0; return f;
  }

  for (const kind of ['keywords','creative']) {
    await t.test(`${kind}: retire the entire unused plan; preserve ancestors, objects, approvals and consumed risk`, async st => {
      const f=await fixture(st,{kind,approved:kind==='creative'}); f.expire(); const before=await f.state();
      const result=await f.service().retire(f.scope,context);
      assert.deepEqual(result,{customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,parentObjectId:f.group.hierarchyObjectId,planId:f.plan.planId,kind,objectIds:f.plan.objectIds,planStatus:'expired',runStatus:'cleanup_pending',changed:true,targetRemoteDispatched:false,runTerminated:false,replacementCreated:false,requiresNewApproval:true,replanningSupported:false,cleanupAuthority:false});
      const after=await f.state();
      for(const table of Object.keys(before).filter(k=>!['searchad_write_change_plans','searchad_hierarchy_events','searchad_write_attempts'].includes(k))) assert.deepEqual(after[table],before[table],table);
      for(const old of before.searchad_write_change_plans) assert.deepEqual(after.searchad_write_change_plans.find(p=>p.plan_id===old.plan_id),old.plan_id===f.plan.planId?{...old,status:'expired',last_error_json:reason}:old);
      for(const table of ['searchad_hierarchy_events','searchad_write_attempts']) {assert.equal(after[table].length,before[table].length+1);for(const row of before[table]) assert.ok(after[table].some(v=>JSON.stringify(v)===JSON.stringify(row)));}
      const event=after.searchad_hierarchy_events.find(e=>e.phase==='sibling_plan_retired');
      const attempt=after.searchad_write_attempts.find(e=>e.phase==='sibling_plan_retired');
      const oldPlan=before.searchad_write_change_plans.find(p=>p.plan_id===f.plan.planId);
      assert.equal(event.status,'expired_unused');assert.equal(event.lifecycle_kind,null);assert.equal(event.hierarchy_object_id,f.plan.objectIds[0]);
      assert.equal(event.details_json.actorPrincipalId,context.principal.principalId);assert.deepEqual(event.details_json.objectIds,f.plan.objectIds);
      assert.equal(event.details_json.beforeHash,oldPlan.before_hash);assert.equal(event.details_json.requestFingerprint,contentHash(oldPlan.mutation_json));
      assert.equal(event.details_json.targetRemoteDispatched,false);assert.equal(event.details_json.runTerminated,false);assert.equal(event.details_json.cleanupAuthority,false);
      assert.deepEqual(attempt.response_json,event.details_json);assert.equal(attempt.request_fingerprint,contentHash(oldPlan.mutation_json));
      assert.equal(after.searchad_risk_reservations.length,2);assert.ok(after.searchad_risk_reservations.every(r=>r.state==='consumed'));
      assert.equal(JSON.stringify(event.details_json).includes('haar-one'),false);
      assert.equal((await f.service().retire(f.scope,context)).changed,false);
      await assert.rejects(f.prepare());await assert.rejects(f.approve(f.plan.planId));await assert.rejects(f.creator.execute(f.execution(),context));assert.deepEqual(f.calls,[]);
    });
    await t.test(`${kind}: generation-2 adgroup parent and retired predecessor remain intact`, async st=>{
      const f=await fixture(st,{kind,replacementParent:true}); f.expire();const before=await f.state();
      assert.equal((await f.service().retire(f.scope,context)).changed,true);
      const after=await f.state();for(const table of ['searchad_hierarchy_objects','searchad_remote_object_ownership','searchad_hierarchy_canary_runs','searchad_risk_reservations'])assert.deepEqual(after[table],before[table]);
      assert.deepEqual(f.calls,[]);
    });
    await t.test(`${kind}: plan expiry, not approval expiry, is the retirement boundary`,async st=>{
      const f=await fixture(st,{kind,approved:true,ttl:600,approvalTtl:60});f.now+=61000;const before=await f.state();
      await assert.rejects(f.service().retire(f.scope,context),code('NOT_EXPIRED'));assert.deepEqual(await f.state(),before);
      f.now=Date.parse(f.plan.expiresAt)-1;await assert.rejects(f.service().retire(f.scope,context),code('NOT_EXPIRED'));
      f.expire();assert.equal((await f.service().retire(f.scope,context)).changed,true);
    });
    await t.test(`${kind}: approval-service expiration remains eligible without fabricating a retirement proof`,async st=>{
      const f=await fixture(st,{kind});f.expire();await assert.rejects(f.approve(f.plan.planId));
      assert.equal((await f.service().retire(f.scope,context)).changed,true);
    });
    await t.test(`${kind}: actual committed claim with no sibling POST is never unused`,async st=>{
      const f=await fixture(st,{kind,approved:true});
      const repo=new PostgresSiblingCreateRepository({...f.args,current:()=>f.identity,gate:()=>{}});
      const snap=await repo.executionSnapshot(siblingScope(f.execution(),context,'execute'),kind);
      await repo.claim(snap.ticket,[envelope(OPS.campaign.read,f.rootRemote),envelope(OPS.adgroup.read,f.groupRemote)]);
      f.expire();const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),retirementError);assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
    });
    await t.test(`${kind}: completed remote creation is not retired`,async st=>{
      const f=await fixture(st,{kind,approved:true});assert.equal((await f.creator.execute(f.execution(),context)).state,'owned');f.expire();f.calls.length=0;
      const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),retirementError);assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
    });
    await t.test(`${kind}: local retirement remains available while suspended and remote gates are off`,async st=>{
      const f=await fixture(st,{kind});f.expire();f.config.allowReads=false;f.config.allowActiveCanary=false;
      await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");const before=await f.state();
      assert.equal((await f.service().retire(f.scope,context)).changed,true);
      const after=await f.state();assert.deepEqual(after.searchad_canary_accounts,before.searchad_canary_accounts);assert.deepEqual(after.searchad_risk_reservations,before.searchad_risk_reservations);assert.deepEqual(f.calls,[]);
    });
  }
  await t.test('default OFF and exact Admin, Customer, kind/confirmation and copied local identifiers',async st=>{
    const f=await fixture(st);let calls=0;const repository={retire:async()=>{calls++;}};
    await assert.rejects(new Service({repository}).retire(f.scope,context),code('DISABLED'));
    assert.throws(()=>new Service({repository,enabled:'true'}),TypeError);
    const service=new Service({repository,enabled:true});
    for(const extra of [{objectIds:f.plan.objectIds},{remoteId:'victim'},{actorPrincipalId:'forged'},{executionToken:'A'.repeat(43)},{kind:'keyword'},{kind:'creative'},{confirmation:'APPROVE_SEARCHAD_CHANGE'},{expiresAt:'2000-01-01'}])await assert.rejects(service.retire({...f.scope,...extra},context),code('INPUT_INVALID'));
    for(const principal of [{...context.principal,role:'reader'},{...context.principal,customerIds:['1002']}])await assert.rejects(service.retire(f.scope,{principal}),code('FORBIDDEN'));
    assert.equal(calls,0);
    f.expire();const input={...f.scope},ctx=structuredClone(context);
    const pool={query:f.pool.query.bind(f.pool),connect:async()=>{input.planId=randomUUID();ctx.principal.principalId='forged';return f.pool.connect();}};
    assert.equal((await f.service(pool).retire(input,ctx)).planId,f.plan.planId);
    assert.equal((await f.rows('searchad_hierarchy_events')).find(e=>e.phase==='sibling_plan_retired').details_json.actorPrincipalId,context.principal.principalId);
  });
  await t.test('wrong local scope cannot retire a different plan or parent',async st=>{
    const f=await fixture(st);f.expire();const before=await f.state();
    for(const key of ['hierarchyRunId','parentObjectId','planId'])await assert.rejects(f.service().retire({...f.scope,[key]:randomUUID()},context),code('NOT_FOUND'));
    await assert.rejects(f.service().retire({...f.scope,kind:'creative',confirmation:confirmation('creative')},context),retirementError);
    assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  const invalid=[
    ['one returned keyword ID',"UPDATE searchad_hierarchy_objects SET remote_id='returned-leaf' WHERE hierarchy_object_id=$1",'leaf'],
    ['one dispatching keyword',"UPDATE searchad_hierarchy_objects SET state='dispatching' WHERE hierarchy_object_id=$1",'leaf'],
    ['one manual-review keyword',"UPDATE searchad_hierarchy_objects SET state='manual_review' WHERE hierarchy_object_id=$1",'leaf'],
    ['unknown plan',"UPDATE searchad_write_change_plans SET status='unknown_outcome' WHERE plan_id=$1",'plan'],
    ['used approval','UPDATE searchad_write_approvals SET used_at=created_at WHERE plan_id=$1','plan'],
    ['execution lock',"INSERT INTO searchad_write_locks(plan_id,purpose,acquired_at) SELECT plan_id,'execute',created_at FROM searchad_write_change_plans WHERE plan_id=$1",'plan'],
    ['non-planning attempt',"INSERT INTO searchad_write_attempts(attempt_id,plan_id,phase,status,created_at) SELECT gen_random_uuid(),plan_id,'send_intent','attempt_once',created_at FROM searchad_write_change_plans WHERE plan_id=$1",'plan'],
    ['altered plan hash',"UPDATE searchad_write_change_plans SET before_hash=repeat('a',64) WHERE plan_id=$1",'plan'],
    ['reordered keyword body',"UPDATE searchad_write_change_plans SET mutation_json=jsonb_set(mutation_json,'{body}',jsonb_build_array(mutation_json->'body'->1,mutation_json->'body'->0)) WHERE plan_id=$1",'plan'],
    ['changed parent snapshot',"UPDATE searchad_write_change_plans SET applied_after_hash=repeat('b',64) WHERE plan_id=$1",'parentPlan'],
    ['unexpected planning attempt body',"UPDATE searchad_write_attempts SET request_json='{}'::jsonb WHERE plan_id=$1 AND phase='sibling_plan'",'plan']
  ];
  for(const [name,sql,target] of invalid)await t.test(`${name} vetoes the whole keyword batch`,async st=>{
    const f=await fixture(st,{approved:true});f.expire();await f.pool.query(sql,[{leaf:f.plan.objectIds[1],plan:f.plan.planId,parentPlan:f.group.planId}[target]]);
    const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),retirementError);assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  for(const mode of ['partial','duplicate','timeout'])await t.test(`${mode} keyword result is never cleared or resent through retirement`,async st=>{
    const f=await fixture(st,{approved:true});f.mode=mode;const result=await f.creator.execute(f.execution(),context);assert.notEqual(result.state,'owned');
    f.expire();f.calls.length=0;const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),retirementError);assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
  await t.test('a released risk intent with a foreign owner run is still target prior work',async st=>{
    const f=await fixture(st);f.expire();
    await f.pool.query("INSERT INTO searchad_risk_reservations(reservation_id,intent_id,customer_id,risk_date,operation_key,lifecycle_kind,units,state,owner_kind,owner_run_id,created_at,updated_at,released_at) VALUES($1,$2,'1001','2026-09-23',$3,'batch_create',1,'released','hierarchy_canary',$4,$5,$5,$5)",[randomUUID(),`hierarchy:sibling:keywords:${f.plan.planId}`,OPS.keyword.create,randomUUID(),new Date(f.now)]);
    const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),retirementError);assert.deepEqual(await f.state(),before);
  });
  await t.test('foreign linked descendant is not hidden by Customer filtering',async st=>{
    const f=await fixture(st);f.expire();await f.pool.query("INSERT INTO searchad_hierarchy_objects(hierarchy_object_id,hierarchy_run_id,customer_id,object_type,parent_object_id,create_operation_key,read_operation_key,delete_operation_key,state,created_at,updated_at) VALUES($1,$2,'1002','keyword',$3,$4,$5,$6,'planned',$7,$7)",[randomUUID(),f.root.hierarchyRunId,f.group.hierarchyObjectId,OPS.keyword.create,OPS.keyword.read,OPS.keyword.delete,new Date(f.now)]);
    const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),retirementError);assert.deepEqual(await f.state(),before);
  });
  await t.test('duplicate planning event cannot act as one immutable batch proof',async st=>{
    const f=await fixture(st);f.expire();await f.pool.query("INSERT INTO searchad_hierarchy_events(event_id,hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at) SELECT gen_random_uuid(),hierarchy_run_id,hierarchy_object_id,customer_id,phase,status,operation_key,lifecycle_kind,details_json,created_at FROM searchad_hierarchy_events WHERE phase='sibling_plan'");
    const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),retirementError);assert.deepEqual(await f.state(),before);
  });
  for(const table of ['searchad_hierarchy_events','searchad_write_attempts'])await t.test(`${table} insert failure rolls back retirement and sanitizes errors`,async st=>{
    const f=await fixture(st);f.expire();const before=await f.state();
    await f.pool.query("CREATE FUNCTION reject_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='sibling_plan_retired' THEN RAISE EXCEPTION 'SECRET-fixture'; END IF; RETURN NEW; END $$");
    await f.pool.query(`CREATE TRIGGER reject_retirement BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_retirement()`);
    await assert.rejects(f.service().retire(f.scope,context),e=>code('STORE_FAILED')(e)&&!JSON.stringify(e).includes('SECRET-fixture'));assert.deepEqual(await f.state(),before);
  });
  for(const drift of ['identity','clock'])await t.test(`${drift} drift after final audit rolls the retirement back`,async st=>{
    const f=await fixture(st);f.expire();const before=await f.state();
    const pool=intercepted(f.pool,async(c,sql,values)=>{const r=await c.query(sql,values);if(/^INSERT INTO searchad_write_attempts/.test(sql.trim())){if(drift==='identity')f.current={...f.identity,credentialFingerprint:'rotated'};else f.now=NOW;}return r;});
    await assert.rejects(f.service(pool).retire(f.scope,context),code(drift==='identity'?'CONTEXT_MISMATCH':'CLOCK_CHANGED'));assert.deepEqual(await f.state(),before);
  });
  await t.test('independent concurrent repositories record one retirement, including after reconstruction',async st=>{
    const f=await fixture(st);f.expire();const results=await Promise.all([f.service().retire(f.scope,context),f.service(f.connect()).retire(f.scope,context)]);
    assert.deepEqual(results.map(r=>r.changed).sort(),[false,true]);assert.equal((await f.service(f.connect()).retire(f.scope,context)).changed,false);
    for(const table of ['searchad_hierarchy_events','searchad_write_attempts'])assert.equal((await f.rows(table)).filter(e=>e.phase==='sibling_plan_retired').length,1);
  });
  for(const committed of [false,true])await t.test(`COMMIT ${committed?'ACK':'send'} failure returns unknown and discards the connection`,async st=>{
    const f=await fixture(st);f.expire();let discarded=false;
    const pool={query:f.pool.query.bind(f.pool),connect:async()=>{const c=await f.pool.connect();return {release:destroy=>{discarded=destroy;c.release(destroy);},query:async(sql,values)=>{if(sql==='COMMIT'&&!committed)throw new Error('SECRET lost send');const r=await c.query(sql,values);if(sql==='COMMIT')throw new Error('SECRET lost ACK');return r;}};}};
    await assert.rejects(f.service(pool).retire(f.scope,context),e=>code('COMMIT_UNKNOWN')(e)&&!JSON.stringify(e).includes('SECRET'));assert.equal(discarded,true);
    assert.equal((await f.service().retire(f.scope,context)).changed,!committed);assert.equal((await f.rows('searchad_hierarchy_events')).filter(e=>e.phase==='sibling_plan_retired').length,1);assert.deepEqual(f.calls,[]);
  });
  await t.test('expired flags with an altered retirement reason do not produce idempotent success',async st=>{
    const f=await fixture(st);f.expire();await f.service().retire(f.scope,context);await f.pool.query("UPDATE searchad_write_change_plans SET last_error_json='{}'::jsonb WHERE plan_id=$1",[f.plan.planId]);
    const before=await f.state();await assert.rejects(f.service().retire(f.scope,context),code('PROVENANCE'));assert.deepEqual(await f.state(),before);
  });
  await t.test('retiring planned leaves never authorizes deleting their live parent',async st=>{
    const f=await fixture(st);f.expire();await f.service().retire(f.scope,context);
    const activationId=await f.authority(OPS.adgroup.delete,[],'delete');const before=await f.state();
    await assert.rejects(new ChildFirstCleanupService(f.args).prepare({customerId:'1001',hierarchyRunId:f.root.hierarchyRunId,hierarchyObjectId:f.group.hierarchyObjectId,activationId},context));assert.deepEqual(await f.state(),before);assert.deepEqual(f.calls,[]);
  });
});
