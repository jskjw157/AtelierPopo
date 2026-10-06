import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { postgresCompletionFixture, completionOperatorKey, completionReaderKey } from './helpers/postgres-searchad-completion-fixture.js';
import { autoNow, autoFacts } from './helpers/searchad-limited-auto-fixture.js';
import { responseFixture } from './helpers/searchad-completion-fixture.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { CAMPAIGN_WRITE } from '../src/naver/searchad/automation/recipes.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalReportStorage } from '../src/naver/searchad/reporting/blob-storage.js';
import { autoWindow, evaluateAutoEligibility } from '../src/naver/searchad/automation/eligibility.js';
const key='limited-auto-native-admin-'.repeat(4),iso=n=>new Date(n).toISOString();
const context={principal:{principalId:'fixture-admin',role:'admin',customerIds:['1001']},requestId:'synthetic-auto-test'};
function native(t){if(process.env.TEST_DATABASE_URL)return true;assert.notEqual(process.env.CI,'true');t.skip('TEST_DATABASE_URL required');return false;}
async function fixture(t,{gate=true,activation=true,activationTtl=3600000,worker=false,nativeSources=false,syntheticIncrease=false,limits={},recipe={kind:'campaign_budget',dailyBudgetKrw:800}}={}){
  const f=await postgresCompletionFixture(t);let time=autoNow,failVerify=false,mutations=0;
  const state={nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false};
  const jobs=new Map(),root=nativeSources?fs.mkdtempSync(path.join(os.tmpdir(),'auto-report-sources-')):null;
  if(root)t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const appEnv={ATELIER_SEARCHAD_ADMIN_API_KEY:key,ATELIER_SEARCHAD_ADMIN_CUSTOMERS:'1001',ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID:'fixture-admin',ATELIER_SEARCHAD_WRITE_STORAGE:'postgres',ATELIER_SEARCHAD_ALLOW_WRITES:'true',ATELIER_HTTP_ALLOW_WRITES:'true',ATELIER_SEARCHAD_AUTOMATION_ENABLED:String(gate),...(worker?{ATELIER_SEARCHAD_WORKER_ENABLED:'true',ATELIER_SEARCHAD_WORKER_CUSTOMERS:'1001',ATELIER_SEARCHAD_WORKER_PRINCIPAL_ID:'auto-worker'}:{})};
  if(nativeSources)Object.assign(appEnv,{ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true',ATELIER_SEARCHAD_REPORT_CLOCK_UNCERTAINTY_MS:'1000',ATELIER_SEARCHAD_REPORT_ROLLOUT_UNCERTAINTY_MS:'1000',ATELIER_COMMERCE_ALLOW_UNVERIFIED_OPERATIONS:'true'});
  let server;
  async function start(){
    server=await f.start({appEnv,clock:()=>time,blobStorage:root?new LocalReportStorage({root}):null,allowedPaths:['/stats','/ncc/campaigns/cmp-1',...(nativeSources?['/stat-reports','/report-download',...Array.from({length:40},(_,i)=>`/stat-reports/${i+1}`)]:[])],allowedMethods:{'/ncc/campaigns/cmp-1':['GET','PUT']},response:({target,init})=>{
      if(target.pathname==='/stats'){const result=responseFixture();if(syntheticIncrease)result.summaryStatResponse.data[0].ccnt=4;return Response.json(result);}
      if(target.pathname==='/report-download'){const date=jobs.get(target.searchParams.get('authtoken')).date;return new Response(`${date}\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\tbiz-1\t1\tP\t100\t2\t110\t100\t0\n`);}
      if(target.pathname.startsWith('/stat-reports')){
        if(init.method==='POST'){const body=JSON.parse(init.body),date=`${body.statDt.slice(0,4)}-${body.statDt.slice(4,6)}-${body.statDt.slice(6,8)}`,id=jobs.size+1,response={reportJobId:id,reportTp:'AD',statDt:new Date(Date.parse(`${date}T00:00:00+09:00`)).toISOString(),status:'BUILT',updateTm:iso(time),downloadUrl:`https://api.searchad.naver.com/report-download?authtoken=${id}`};jobs.set(String(id),{date,response});return Response.json(response);}
        return Response.json(jobs.get(target.pathname.split('/').at(-1)).response);
      }
      if(init.method==='PUT'){mutations++;Object.assign(state,JSON.parse(init.body));}
      if(init.method==='GET'&&failVerify&&mutations)throw new TypeError('synthetic verification response loss');
      return new Response(JSON.stringify(state),{headers:{'content-type':'application/json'}});
    }});
    const completion=server.app.searchAdCompletionRuntime;
    if(!nativeSources)completion.circuitService.spendEvidence={async select(){return {spendGrossKrw:100,baselineGrossKrw:100,validUntil:autoNow+86400000};}};
    // Explicit synthetic source selector: no eligible/allowed/approval result.
    if(syntheticIncrease)completion.circuitService.lossEvidence={async select(){return {customerId:'1001',quality:'actual',completeCustomerDay:true,identityVerified:true,observedAt:autoNow,statDateKst:'2026-10-05',amountNetKrw:0};}};
    if(!nativeSources)completion.automationRepository.autoEvidenceSelector={async select(input){const value=autoFacts(autoNow);value.policy=input;value.evidence.identity=completion.identityResolver('1001');value.capability.automationEnabled=gate;if(syntheticIncrease){value.capability.estimate={verified:true,observedAt:iso(autoNow),identity:value.evidence.identity};value.capability.balance={verified:true,observedAt:iso(autoNow),identity:value.evidence.identity,availableKrw:'30000'};}return value;}};
    return server;
  }
  await start();
  await f.pool.query("INSERT INTO searchad_circuit_policies(customer_id,policy_json) VALUES('1001',$1)",[{customerDailySpendCeilingGrossKrw:100000}]);
  if(activation){const runtime=server.app.searchAdActivationRuntime;
    const e=await runtime.repository.createEvidence({evidenceId:randomUUID(),evidenceType:'active_canary',customerId:'1001',specSha:runtime.status().specSha,credentialFingerprint:credentialFingerprintForCustomer(server.app.searchAdCredentials,'1001'),upstreamBaseUrl:'https://api.searchad.naver.com',result:'verified',sourceRunId:'synthetic-auto-only-not-live',details:{fixtureOnly:true},operationKeys:[CAMPAIGN_WRITE],fieldScope:['campaign.userLock','campaign.dailyBudget'],createdAt:iso(time),expiresAt:iso(time+activationTtl)});
    await runtime.activationService.activate({evidenceId:e.evidenceId},context);
  }
  assert.equal((await server.call(key,'POST','/api/v1/searchad/reporting/stats',{customerId:'1001',entityType:'campaign',entityId:'cmp-1',since:'2026-10-05',until:'2026-10-05'})).status,201);
  const facts=autoFacts(),{authorizedByPrincipalId,authorizedAt,customerId,policyRevision,...delegation}=facts.policy.delegation;
  delegation.fieldScope=[recipe.kind==='campaign_budget'?'campaign.dailyBudget':'campaign.userLock'];
  Object.assign(delegation,limits);
  const policyInput={customerId:'1001',entityType:'campaign',entityId:'cmp-1',mode:'limited_auto',enabled:true,recipe,reason:'synthetic bounded auto fixture',delegation};
  const policyResponse=await server.call(key,'POST','/api/v1/searchad/automation/policies',policyInput);
  assert.equal(policyResponse.status,201,JSON.stringify(policyResponse.body));
  const policy=policyResponse.body;
  const evaluate=()=>server.call(key,'POST','/api/v1/searchad/automation/evaluate',{customerId:'1001',policyId:policy.policyId});
  const execute=runId=>server.call(key,'POST',`/api/v1/searchad/automation/runs/${runId}/execute-auto`,{customerId:'1001'});
  async function ingest(statDate,at){time=at;const runtime=server.app.searchAdCompletionRuntime,created=await runtime.jobService.register({customerId:'1001',kind:'stat',reportType:'AD',statDate,intentKey:`auto-source:${statDate}:${at}`},context),input={customerId:'1001',reportJobId:created.reportJobId};await runtime.ingestionService.ingest(input,context);await runtime.spendEvidenceService.evaluateGeneration(input,context);return created.reportJobId;}
  return {...f,policy,policyInput,evaluate,execute,ingest,get server(){return server;},get mutations(){return mutations;},setTime:n=>time=n,failVerify:()=>failVerify=true,async restart(){await server.api.close();await start();},state};
}

test('auto_calls_real_plan_approval_execute_once with exact synthetic budget outcome verification',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate();assert.equal(run.body.state,'ready',JSON.stringify(run.body));
  const [a,b]=await Promise.all([f.execute(run.body.runId),f.execute(run.body.runId)]);
  assert.ok([a,b].some(r=>r.status===200&&r.body.state==='applied'),JSON.stringify([a,b]));assert.equal(f.mutations,1);assert.equal(f.state.dailyBudget,800);
  const counts=(await f.pool.query('SELECT (SELECT count(*)::int FROM searchad_write_change_plans) plans,(SELECT count(*)::int FROM searchad_write_approvals) approvals,(SELECT count(*)::int FROM searchad_write_execution_claims) claims')).rows[0];assert.deepEqual(counts,{plans:1,approvals:1,claims:1});
  assert.equal((await f.execute(run.body.runId)).status,409);assert.equal(f.mutations,1);
});
test('default OFF gate and missing activation produce zero upstream mutation',async t=>{
  if(!native(t))return;
  for(const options of [{gate:false},{activation:false}])await t.test(JSON.stringify(options),async t=>{const f=await fixture(t,options),run=await f.evaluate();const outcome=await f.execute(run.body.runId);assert.notEqual(outcome.status,200);assert.equal(f.mutations,0);});
});
test('delegation_revoked_before_send_blocks_dispatch after accepted token claim',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate(),circuit=f.server.app.searchAdCompletionRuntime.circuitService,prepare=circuit.prepareDispatch.bind(circuit);
  circuit.prepareDispatch=async dispatch=>{await f.server.app.searchAdCompletionRuntime.automationService.createPolicy({...f.policyInput,policyId:f.policy.policyId,expectedRevision:1,enabled:false},context);return prepare(dispatch);};
  assert.notEqual((await f.execute(run.body.runId)).status,200);assert.equal(f.mutations,0);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_write_execution_claims')).rows[0].n,1);
});
test('verification_failure_holds_followup and restart never replays',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate();f.failVerify();assert.equal((await f.execute(run.body.runId)).status,409);assert.equal(f.mutations,1);
  await f.restart();assert.equal((await f.execute(run.body.runId)).status,409);assert.equal(f.mutations,1);
  const stored=(await f.pool.query('SELECT state FROM searchad_automation_runs WHERE run_id=$1',[run.body.runId])).rows[0];assert.ok(['unknown_outcome','manual_review'].includes(stored.state));
});
test('public auto requests cannot select principal delegation token or evidence and obey roles',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate(),route=`/api/v1/searchad/automation/runs/${run.body.runId}/execute-auto`;
  for(const token of [completionReaderKey,completionOperatorKey])assert.equal((await f.server.call(token,'POST',route,{customerId:'1001'})).status,403);
  for(const field of ['principal','delegation','executionToken','evidence','identity','allowed'])assert.equal((await f.server.call(key,'POST',route,{customerId:'1001',[field]:{}})).status,400);
  assert.equal((await f.server.call(key,'POST',route,{customerId:'2002'})).status,403);assert.equal(f.mutations,0);
});

test('same immutable inputs and slot create one decision despite fresh current GET record IDs',async t=>{
  if(!native(t))return;const f=await fixture(t),a=await f.evaluate(),b=await f.evaluate();assert.equal(a.body.runId,b.body.runId);assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_automation_runs')).rows[0].n,1);
});
test('activation expiration after accepted claim is rechecked inside the final account fence',async t=>{
  if(!native(t))return;const f=await fixture(t,{activationTtl:5000}),run=await f.evaluate(),circuit=f.server.app.searchAdCompletionRuntime.circuitService,prepare=circuit.prepareDispatch.bind(circuit);
  circuit.prepareDispatch=async d=>{f.setTime(autoNow+6000);return prepare(d);};
  assert.notEqual((await f.execute(run.body.runId)).status,200);assert.equal(f.mutations,0);assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_write_execution_claims')).rows[0].n,1);
});
test('final account fence rechecks current identity, Circuit pause, spend ceiling, baseline and activation fields',async t=>{
  if(!native(t))return;
  for(const control of ['identity','pause','ceiling','baseline','fields'])await t.test(control,async t=>{
    const f=await fixture(t),run=await f.evaluate(),runtime=f.server.app.searchAdCompletionRuntime,circuit=runtime.circuitService,prepare=circuit.prepareDispatch.bind(circuit);
    circuit.prepareDispatch=async dispatch=>{
      if(control==='identity')f.server.app.searchAdCredentials.principals.values().next().value.secretKey='rotated-synthetic-secret';
      if(control==='pause')await circuit.pause({customerId:'1001',reason:'synthetic final pause'},context);
      if(control==='ceiling')await f.pool.query("UPDATE searchad_circuit_policies SET policy_json='{}' WHERE customer_id='1001'");
      if(control==='baseline')circuit.spendEvidence={async select(){return {spendGrossKrw:100,validUntil:autoNow+86400000};}};
      if(control==='fields')await f.pool.query("UPDATE searchad_activation_grants SET field_scope_json='[]' WHERE customer_id='1001'");
      return prepare(dispatch);
    };
    assert.notEqual((await f.execute(run.body.runId)).status,200);assert.equal(f.mutations,0);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_write_execution_claims')).rows[0].n,1);
  });
});
test('restart_after_token_issue_never_reissues_or_replays and does not persist transient token',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate(),writer=f.server.app.searchAdWriteRuntime;let token;
  writer.executionService.execute=async(id,input)=>{token=input.executionToken;throw new Error('synthetic process loss before claim');};
  assert.equal((await f.execute(run.body.runId)).status,500);assert.equal(f.mutations,0);assert.ok(token);
  await f.restart();assert.equal((await f.execute(run.body.runId)).status,409);assert.equal(f.mutations,0);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_write_approvals')).rows[0].n,1);
  const stored=JSON.stringify((await f.pool.query('SELECT row_to_json(r) value FROM searchad_automation_runs r UNION ALL SELECT row_to_json(e) FROM searchad_automation_events e UNION ALL SELECT row_to_json(a) FROM searchad_write_attempts a UNION ALL SELECT row_to_json(p) FROM searchad_write_approvals p')).rows);assert.equal(stored.includes(token),false);assert.equal(stored.includes('executionToken'),false);
});
test('twenty_percent_and_daily_limits_are_atomic and unknown reservations are not refunded',async t=>{
  if(!native(t))return;const f=await fixture(t,{limits:{maxDailyOperations:1}}),repo=f.server.app.searchAdCompletionRuntime.automationRepository;
  const second=await f.server.app.searchAdCompletionRuntime.automationService.createPolicy(f.policyInput,context),a=await f.evaluate(),b=await f.server.app.searchAdCompletionRuntime.automationService.evaluate({customerId:'1001',policyId:second.policyId},context);
  const outcomes=await Promise.allSettled([repo.reserveRun({customerId:'1001',runId:a.body.runId,now:autoNow}),repo.reserveRun({customerId:'1001',runId:b.runId,now:autoNow})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'SEARCHAD_AUTOMATION_DAILY_LIMIT');
  await f.pool.query("UPDATE searchad_automation_reservations SET state='unknown'");
  await assert.rejects(()=>repo.reserveRun({customerId:'1001',runId:outcomes[0].status==='rejected'?a.body.runId:b.runId,now:autoNow}),{code:'SEARCHAD_AUTOMATION_DAILY_LIMIT'});
  assert.equal(f.mutations,0);
});
test('eligible stop recipe uses exact userLock activation and verifies stopped outcome',async t=>{
  if(!native(t))return;const f=await fixture(t,{recipe:{kind:'campaign_user_lock',userLock:true}}),run=await f.evaluate();assert.equal(run.body.state,'ready');assert.equal((await f.execute(run.body.runId)).body.state,'applied');assert.equal(f.state.userLock,true);assert.equal(f.mutations,1);
});
test('worker executes eligible run once and source link survives restart',async t=>{
  if(!native(t))return;const f=await fixture(t,{worker:true}),w=f.server.app.searchAdCompletionRuntime.workerRuntime,payload={policyId:f.policy.policyId};
  await w.repository.enqueueSlot({customerId:'1001',scheduleId:'auto',slotAt:iso(autoNow),kind:'evaluate_automation',payload,requestHash:contentHash({kind:'evaluate_automation',payload}),now:autoNow});
  assert.equal((await w.worker.runOnce()).state,'succeeded');assert.equal(f.mutations,1);assert.equal(f.state.dailyBudget,800);
  await f.restart();assert.equal(await f.server.app.searchAdCompletionRuntime.workerRuntime.worker.runOnce(),null);assert.equal(f.mutations,1);
});
test('expired worker owner paused after claim cannot initiate dispatch or replay on generation handoff',async t=>{
  if(!native(t))return;const f=await fixture(t,{worker:true}),w=f.server.app.searchAdCompletionRuntime.workerRuntime,payload={policyId:f.policy.policyId};
  await w.repository.enqueueSlot({customerId:'1001',scheduleId:'lease-auto',slotAt:iso(autoNow),kind:'evaluate_automation',payload,requestHash:contentHash({kind:'evaluate_automation',payload}),now:autoNow});
  const circuit=f.server.app.searchAdCompletionRuntime.circuitService,prepare=circuit.prepareDispatch.bind(circuit);let next;
  circuit.prepareDispatch=async d=>{f.setTime(autoNow+30001);next=await w.repository.claim({workerId:'new-owner',now:autoNow+30001,leaseMs:30000});return prepare(d);};
  await w.worker.runOnce();assert.ok(next);assert.equal(next.leaseGeneration,2);assert.equal(f.mutations,0);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_write_approvals')).rows[0].n,1);
  const result=await w.worker.handlers.evaluate_automation(next);assert.equal(result.state,'manual_review');assert.equal(f.mutations,0);
});
test('same entity cannot reserve a second plan while first reservation is unconsumed',async t=>{
  if(!native(t))return;const f=await fixture(t),repo=f.server.app.searchAdCompletionRuntime.automationRepository,a=await f.evaluate();
  const p=await f.server.app.searchAdCompletionRuntime.automationService.createPolicy(f.policyInput,context),b=await f.server.app.searchAdCompletionRuntime.automationService.evaluate({customerId:'1001',policyId:p.policyId},context);
  await repo.reserveRun({customerId:'1001',runId:a.body.runId,now:autoNow});await assert.rejects(()=>repo.reserveRun({customerId:'1001',runId:b.runId,now:autoNow}),{code:'SEARCHAD_AUTOMATION_ENTITY_HELD'});
});
test('reservation cannot transfer its KST daily limits across midnight',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate(),writer=f.server.app.searchAdWriteRuntime,execute=writer.executionService.execute.bind(writer.executionService);
  writer.executionService.execute=async(id,input,ctx)=>{await f.pool.query("UPDATE searchad_automation_reservations SET dispatch_json=jsonb_set(dispatch_json,'{autoDayKst}','\"2026-10-04\"')");return execute(id,input,ctx);};
  assert.notEqual((await f.execute(run.body.runId)).status,200);assert.equal(f.mutations,0);
});

async function sourceProduct(f){
  const id=randomUUID();await f.pool.query("INSERT INTO haar_products(haar_product_id,product_name) VALUES($1,'synthetic source product')",[id]);
  await f.pool.query("INSERT INTO channel_products(channel_id,haar_product_id,channel_product_no,remote_product_id,channel_product_key,product_name) VALUES('haar_naver_smartstore',$1,'123','123','haar_naver_smartstore:123','synthetic source product')",[id]);
  const app=f.server.app;app.client.tokenProvider.cached={accessToken:'auto-synthetic-commerce-token',issuedAt:Date.now(),expiresIn:3600};
  app.client.fetchImpl=async(url,init)=>{assert.equal(init.method,'GET');const u=new URL(url);assert.equal(u.origin,'https://api.commerce.naver.com');const file={'/external/v2/products/channel-products/123':'naver-product','/external/v1/pay-order/seller/product-orders':'naver-orders','/external/v1/pay-settle/settle/case':'naver-settlements'}[u.pathname];assert.ok(file,'closed synthetic Commerce read trap');return Response.json(JSON.parse(fs.readFileSync(`test/fixtures/searchad-profitability/${file}.json`)));};
  assert.equal((await f.server.call(key,'POST','/api/v1/searchad/customer-channel-bindings',{customerId:'1001',channelId:'haar_naver_smartstore'})).status,200);
  assert.equal((await f.server.call(key,'POST','/api/v1/searchad/product-mappings',{customerId:'1001',haarProductId:id,channelProductKey:'haar_naver_smartstore:123',entityType:'campaign',entityId:'cmp-1',method:'manual',validFrom:'2026-09-01T00:00:00Z'})).status,200);
  assert.equal((await f.server.call(key,'POST','/api/v1/searchad/product-evidence/collect',{customerId:'1001',haarProductId:id,...autoWindow(autoNow)})).status,200);return id;
}
test('actual bootstrap selector uses seven real ingestions and preserves manual/provider financial blockers',async t=>{
  if(!native(t))return;const f=await fixture(t,{nativeSources:true}),id=await sourceProduct(f),dates=autoFacts().history.generations.map(g=>g.statDate);
  const missing=await f.evaluate();assert.ok(missing.body.decision.reasons.includes('SEVEN_COMPLETE_KST_DAYS_REQUIRED'));
  for(const date of dates){const start=Date.parse(`${date}T00:00:00+09:00`);for(const slot of [1,2,3])await f.ingest(date,start+slot*86400000+12*3600000);if(start+3*86400000+12*3600000<autoNow)await f.ingest(date,autoNow);}
  f.setTime(autoNow);const complete=await f.evaluate(),facts=complete.body.decision.selected.auto;
  assert.equal(facts.history.generations.length,7);assert.deepEqual(facts.history.generations.map(g=>g.statDate).sort(),dates);assert.ok(facts.history.generations.every(g=>g.entityRowCount===1&&g.quality==='stabilized_by_policy'));
  assert.equal(complete.body.decision.reasons.includes('SEVEN_COMPLETE_KST_DAYS_REQUIRED'),false);assert.equal(complete.body.state,'blocked');assert.ok(complete.body.decision.reasons.includes('PROFITABILITY_UNAVAILABLE'));
  assert.deepEqual(facts.history.sourceReasons,[]);assert.equal(facts.profitability.haarProductId,id);assert.equal(facts.profitability.quality,'partial');assert.ok(facts.profitability.missingReasons.includes('MANUAL_MAPPING_UNVERIFIED'));assert.equal(facts.capability.estimateReason,'ESTIMATE_READ_CAPABILITY_UNAVAILABLE');assert.equal(f.mutations,0);
  f.setTime(autoNow+900001);const stale=await f.evaluate();assert.ok(stale.body.decision.reasons.includes('STOCK_SALES_UNAVAILABLE'));f.setTime(autoNow);
  // Native date text, actual selected schema/proof and generation row hashes are
  // present even though current provider finances cannot supply Auto authority.
  for(const mutate of [v=>v.history.generations.pop(),v=>v.history.generations[0].statDate='2026-02-30',v=>v.history.generations[0].entityRowCount=0,v=>v.history.generations[0].generationWindow.lower=iso(autoNow-86400001)]){const value=structuredClone(facts);mutate(value);assert.ok(evaluateAutoEligibility({...value,policy:f.policy,now:autoNow}).reasons.includes('SEVEN_COMPLETE_KST_DAYS_REQUIRED'));}
  f.server.app.searchAdCompletionRuntime.commerceProviders.get('haar_naver_smartstore').sourceIdentity='f'.repeat(64);
  const changed=await f.evaluate();assert.equal(changed.body.decision.selected.auto.mapping.current,false);assert.ok(changed.body.decision.reasons.includes('MAPPING_UNAVAILABLE'));assert.equal(f.mutations,0);
  const stored=JSON.stringify((await f.pool.query('SELECT row_to_json(r) value FROM searchad_automation_runs r')).rows);assert.equal(stored.includes('auto-synthetic-commerce-token'),false);assert.equal(stored.includes('authtoken='),false);
});
test('reservation COMMIT acknowledgement loss never creates a plan or a token after restart',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate(),repo=f.server.app.searchAdCompletionRuntime.automationRepository,transaction=repo.transaction.bind(repo);let injected=false;
  repo.transaction=async(customerId,task)=>{const result=await transaction(customerId,task);if(!injected){injected=true;throw new Error('synthetic committed reservation acknowledgement lost');}return result;};
  assert.equal((await f.execute(run.body.runId)).status,500);await f.restart();assert.equal((await f.execute(run.body.runId)).status,409);assert.equal(f.mutations,0);
  const counts=(await f.pool.query('SELECT (SELECT count(*)::int FROM searchad_automation_reservations) reservations,(SELECT count(*)::int FROM searchad_write_change_plans) plans,(SELECT count(*)::int FROM searchad_write_approvals) approvals')).rows[0];assert.deepEqual(counts,{reservations:1,plans:0,approvals:0});
});
test('verification failure blocks new policy follow-up and read/reconcile remain available under Circuit hold',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate();f.failVerify();assert.equal((await f.execute(run.body.runId)).status,409);
  await f.server.app.searchAdCompletionRuntime.circuitService.pause({customerId:'1001',reason:'synthetic inspection hold'},context);
  assert.equal((await f.server.call(completionReaderKey,'GET',`/api/v1/searchad/automation/runs/${run.body.runId}?customerId=1001`)).status,200);
  const reconcile=await f.server.call(key,'POST',`/api/v1/searchad/changes/${(await f.server.app.searchAdCompletionRuntime.automationService.getRun({customerId:'1001',runId:run.body.runId},context)).planId}/reconcile`,{customerId:'1001'});assert.notEqual(reconcile.status,403);assert.ok(f.calls.filter(c=>c.path==='/ncc/campaigns/cmp-1'&&c.method==='GET').length>=4);
  const p=await f.server.app.searchAdCompletionRuntime.automationService.createPolicy(f.policyInput,context),next=await f.server.app.searchAdCompletionRuntime.automationService.evaluate({customerId:'1001',policyId:p.policyId},context);assert.equal(next.state,'blocked');assert.ok(next.decision.reasons.includes('UNRESOLVED_MUTATION'));assert.equal((await f.server.app.searchAdCompletionRuntime.circuitService.repository.getState({customerId:'1001',now:autoNow})).manualPaused,true);assert.equal(f.mutations,1);
});
test('rollback under Circuit hold keeps original gate and after-hash requirements',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate(),applied=await f.execute(run.body.runId);assert.equal(applied.body.state,'applied');
  const runtime=f.server.app.searchAdWriteRuntime,circuit=f.server.app.searchAdCompletionRuntime.circuitService;await circuit.pause({customerId:'1001',reason:'synthetic rollback review'},context);
  await assert.rejects(()=>runtime.executionService.rollback(applied.body.planId,{confirmation:'ROLLBACK_SEARCHAD_CHANGE',idempotencyKey:'synthetic-rollback'},context),{code:'SEARCHAD_ROLLBACK_PREVALIDATION_GATED'});assert.equal(f.mutations,1);
  // Only this disposable fixture explicitly supplies the preexisting rollback gate.
  runtime.config.allowRollback=true;f.state.dailyBudget=799;await assert.rejects(()=>runtime.executionService.rollback(applied.body.planId,{confirmation:'ROLLBACK_SEARCHAD_CHANGE',idempotencyKey:'synthetic-drift'},context),{code:'SEARCHAD_ROLLBACK_DRIFT'});f.state.dailyBudget=800;
  const result=await runtime.executionService.rollback(applied.body.planId,{confirmation:'ROLLBACK_SEARCHAD_CHANGE',idempotencyKey:'synthetic-rollback-enabled'},context);assert.equal(result.status,'rolled_back');assert.equal(f.state.dailyBudget,1000);assert.equal(f.mutations,2);
});
test('actual ingestion selector denies missing day, quarantine, wrong Customer and rotated identity',async t=>{
  if(!native(t))return;const f=await fixture(t,{nativeSources:true}),date='2026-10-02',start=Date.parse(`${date}T00:00:00+09:00`);await sourceProduct(f);
  let last;for(const slot of [1,2,3])last=await f.ingest(date,start+slot*86400000+12*3600000);f.setTime(autoNow);
  const runtime=f.server.app.searchAdCompletionRuntime,selector=runtime.automationRepository.autoEvidenceSelector;
  assert.equal((await selector.select(f.policy)).history.generations.length,1);
  assert.ok((await f.evaluate()).body.decision.reasons.includes('SEVEN_COMPLETE_KST_DAYS_REQUIRED'));
  assert.equal((await runtime.repository.selectedIngestions(f.pool,{customerId:'2002',reportType:'AD',identity:{...runtime.identityResolver('1001'),customerId:'2002'}})).length,0);
  assert.equal((await runtime.repository.selectedIngestions(f.pool,{customerId:'1001',reportType:'AD',identity:{...runtime.identityResolver('1001'),credentialFingerprint:'f'.repeat(64)}})).length,0);
  await f.pool.query("UPDATE searchad_report_jobs SET metadata_json=metadata_json||$2::jsonb WHERE report_job_id=$1",[last,JSON.stringify({quarantineAt:iso(autoNow)})]);
  assert.equal((await selector.select(f.policy)).history.generations.length,0);
  assert.equal((await runtime.repository.selectedIngestions(f.pool,{customerId:'2002',reportType:'AD',identity:{...runtime.identityResolver('1001'),customerId:'2002'}})).length,0);
  assert.equal((await runtime.repository.selectedIngestions(f.pool,{customerId:'1001',reportType:'AD',identity:{...runtime.identityResolver('1001'),credentialFingerprint:'f'.repeat(64)}})).length,0);assert.equal(f.mutations,0);
});
test('Customer day hard operations and incremental spend limits serialize concurrent policy reservations',async t=>{
  if(!native(t))return;
  for(const kind of ['operations','incremental'])await t.test(kind,async t=>{
    const f=await fixture(t,kind==='incremental'?{syntheticIncrease:true,recipe:{kind:'campaign_budget',dailyBudgetKrw:1200}}:{}),runtime=f.server.app.searchAdCompletionRuntime,repo=runtime.automationRepository;
    const p=await runtime.automationService.createPolicy(f.policyInput,context),a=await f.evaluate(),b=await runtime.automationService.evaluate({customerId:'1001',policyId:p.policyId},context);assert.equal(a.body.state,'ready',JSON.stringify(a.body));assert.equal(b.state,'ready');
    const count=kind==='operations'?199:1,incrementalSpendKrw=kind==='incremental'?29700:0;
    for(let i=0;i<count;i++)await f.pool.query("INSERT INTO searchad_automation_reservations(reservation_id,customer_id,dispatch_key,entity_type,entity_id,state,dispatch_json,created_at,updated_at) VALUES($1,'1001',$2,'campaign',$2,'consumed',$3,$4,$4)",[randomUUID(),`synthetic-prior-${i}`,{autoDayKst:'2026-10-05',incrementalSpendKrw},iso(autoNow)]);
    const outcomes=await Promise.allSettled([repo.reserveRun({customerId:'1001',runId:a.body.runId,now:autoNow}),repo.reserveRun({customerId:'1001',runId:b.runId,now:autoNow})]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.code,'SEARCHAD_AUTOMATION_DAILY_LIMIT');assert.equal(f.mutations,0);
  });
});

async function pauseFinalEvidence(circuit){
  let release,entered,final=false,snapshotError,snapshotChecks=0;const blocked=new Promise(r=>release=r),waiting=new Promise(r=>entered=r),prepare=circuit.prepareDispatch.bind(circuit),spend=circuit.spendEvidence.select.bind(circuit.spendEvidence),assertDispatch=circuit.assertDispatchAllowed.bind(circuit);
  circuit.prepareDispatch=async d=>{final=true;return prepare(d);};
  circuit.spendEvidence.select=async(...args)=>{if(final){entered();await blocked;}return spend(...args);};
  circuit.assertDispatchAllowed=async(...args)=>{const validate=await assertDispatch(...args);return()=>{snapshotChecks++;try{validate();}catch(error){snapshotError=error;throw error;}};};
  return {waiting,release,get snapshotError(){return snapshotError;},get snapshotChecks(){return snapshotChecks;}};
}
test('worker row lock prevents takeover after final lease query and exact synchronous expiry blocks send',async t=>{
  if(!native(t))return;const f=await fixture(t,{worker:true}),w=f.server.app.searchAdCompletionRuntime.workerRuntime,payload={policyId:f.policy.policyId};
  await w.repository.enqueueSlot({customerId:'1001',scheduleId:'gap-auto',slotAt:iso(autoNow),kind:'evaluate_automation',payload,requestHash:contentHash({kind:'evaluate_automation',payload}),now:autoNow});
  const owner=await w.repository.claim({workerId:'first-owner',now:autoNow,leaseMs:30000}),pause=await pauseFinalEvidence(f.server.app.searchAdCompletionRuntime.circuitService),work=w.worker.handlers.evaluate_automation(owner).then(result=>({result}),error=>({error}));
  t.after(pause.release);
  await pause.waiting;f.setTime(autoNow+30000);
  assert.equal(await w.repository.claim({workerId:'gap-owner',now:autoNow+30000,leaseMs:30000}),null,'SKIP LOCKED cannot advance a generation held by the actual final account fence');
  pause.release();assert.equal((await work).error?.code,'SEARCHAD_SEND_FENCE_CONTEXT');assert.equal(pause.snapshotChecks,1);assert.equal(pause.snapshotError?.code,'SEARCHAD_CIRCUIT_EVIDENCE_EXPIRED');assert.equal(f.mutations,0);
  const next=await w.repository.claim({workerId:'after-fence-owner',now:autoNow+30000,leaseMs:30000});assert.equal(next.leaseGeneration,2);assert.equal((await w.worker.handlers.evaluate_automation(next)).state,'manual_review');assert.equal(f.mutations,0);
});
test('policy revocation waits on the authoritative account row until local transport initiation',async t=>{
  if(!native(t))return;const f=await fixture(t),run=await f.evaluate(),runtime=f.server.app.searchAdCompletionRuntime,pause=await pauseFinalEvidence(runtime.circuitService),execution=f.execute(run.body.runId);
  t.after(pause.release);
  await pause.waiting;let revised=false;
  const revoke=runtime.automationService.createPolicy({...f.policyInput,policyId:f.policy.policyId,expectedRevision:1,enabled:false},context).then(value=>{revised=true;return value;});
  // The native update must be waiting on this schema's actual account row.
  let waiting=false;for(let i=0;i<20&&!waiting;i++){const rows=(await f.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%searchad_canary_accounts%FOR UPDATE%'")).rows;waiting=rows.length>0;if(!waiting)await new Promise(r=>setImmediate(r));}
  assert.equal(waiting,true);assert.equal(revised,false);assert.equal(f.mutations,0);pause.release();assert.equal((await execution).body.state,'applied');await revoke;assert.equal(revised,true);assert.equal(f.mutations,1);
});
