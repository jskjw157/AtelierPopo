import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { createCircuitGuard } from '../src/naver/searchad/circuit/service.js';
import { postgresCompletionFixture } from './helpers/postgres-searchad-completion-fixture.js';

const at = Date.parse('2026-10-05T03:00:00Z');
const iso = value => new Date(value).toISOString();
function native(t) {
  if (process.env.TEST_DATABASE_URL) return true;
  assert.notEqual(process.env.CI, 'true', 'Automation acceptance requires native PostgreSQL');
  t.skip('TEST_DATABASE_URL is required'); return false;
}
async function fixture(t) {
  const f = await postgresCompletionFixture(t);
  await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id) VALUES('1001'),('2002')");
  return { ...f, writer: new PostgresSearchAdWriteRepository({ pool: f.pool }), circuit: createCircuitGuard({ pool: f.pool, clock: () => at }) };
}
async function approved(f, entityId = 'cmp-1') {
  const planId = randomUUID(), approvalId = randomUUID(), tokenHash = randomUUID();
  await f.writer.createPlan({ plan_id: planId, customer_id: '1001', mutation_operation_key: 'PUT:/ncc/campaigns/{nccCampaignId}#fields', mutation_json: { pathParams: { nccCampaignId: entityId }, body: { userLock: true } }, read_json: {}, before_json: { userLock: false }, before_hash: 'fixture', expected_after_json: { userLock: true }, reason: 'fixture', status: 'approved', created_by: 'fixture', created_at: iso(at), expires_at: iso(at + 600000) });
  await f.writer.createApproval({ approval_id: approvalId, plan_id: planId, actor: 'fixture', confirmation: 'APPROVE_SEARCHAD_CHANGE', token_hash: tokenHash, created_at: iso(at), expires_at: iso(at + 600000) });
  return { planId, tokenHash, now: iso(at) };
}
async function terminal(f, planId, status, when = at) {
  await f.writer.updatePlan(planId, { status });
  await f.writer.addAttempt({ attempt_id: randomUUID(), plan_id: planId, phase: status === 'applied' ? 'verify' : status === 'failed' ? 'execute' : 'reconcile', status: status === 'applied' ? 'succeeded' : status, created_at: iso(when) });
}

// Removing durable ordinal allocation or ordering a claim by timestamps must fail these tests.
test('accepted execute claims have durable Customer ordinals and cannot overtake an unfinished attempt', async t => {
  if (!native(t)) return;
  const f = await fixture(t), first = await approved(f), second = await approved(f, 'cmp-2');
  const claim = await f.writer.claimApproval(first);
  assert.equal(String(claim.execution_ordinal), '1');
  await assert.rejects(f.writer.claimApproval(second), { code: 'SEARCHAD_EXECUTION_ORDER_UNRESOLVED' });
  await terminal(f, first.planId, 'failed', at - 86400000);
  f.writer = new PostgresSearchAdWriteRepository({ pool: f.connect() });
  assert.equal(String((await f.writer.claimApproval(second)).execution_ordinal), '2');
  await assert.rejects(f.writer.claimApproval(first), { code: 'SEARCHAD_EXECUTION_TOKEN_USED' });
});

// Classifying not_applied as a verified mutation would falsely establish cooldown/reset authority.
test('not_applied is an unsuccessful outcome and never a changedAt reset', async t => {
  if (!native(t)) return;
  const f = await fixture(t), plan = await approved(f);
  await f.writer.claimApproval(plan); await terminal(f, plan.planId, 'not_applied');
  await f.circuit.projectOutcome('1001');
  const state = await f.circuit.repository.getState({ customerId: '1001', entityType: 'campaign', entityId: 'cmp-1' });
  assert.equal(state.changedAt, null);
  assert.equal(Object.values(state.orderedConsecutiveFailures || {}).reduce((a,b) => a + b, 0), 1);
});

test('production HTTP exposes scoped default observe policy and evaluation without any plan or approval', async t => {
  if (!native(t)) return;
  const f = await postgresCompletionFixture(t), key = 'automation-admin-'.repeat(4);
  const server = await f.start({ appEnv: { ATELIER_SEARCHAD_ADMIN_API_KEY: key, ATELIER_SEARCHAD_ADMIN_CUSTOMERS: '1001', ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'automation-admin' }, allowedPaths: ['/ncc/campaigns/cmp-1'], response: { nccCampaignId: 'cmp-1', dailyBudget: 1000, userLock: false } });
  const created = await server.call(key, 'POST', '/api/v1/searchad/automation/policies', { customerId: '1001', entityType: 'campaign', entityId: 'cmp-1', recipe: { kind: 'campaign_user_lock', userLock: true }, reason: 'observe this campaign' });
  assert.equal(created.status, 201);
  assert.equal(created.body.mode, 'observe'); assert.equal(created.body.enabled, false);
  const result = await server.call(key, 'POST', '/api/v1/searchad/automation/evaluate', { customerId: '1001', policyId: created.body.policyId });
  assert.equal(result.status, 200); assert.equal(result.body.state, 'observed');
  assert.equal(result.body.decision.selected.current?.normalized.dailyBudgetKrw, 1000);
  assert.equal(f.calls.length,1);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n, 0);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_approvals')).rows[0].n, 0);
});

async function automationFixture(t, {mode='approve'}={}) {
  const {reportingFixture,responseFixture}=await import('./helpers/searchad-completion-fixture.js');
  const {createReportingRuntime}=await import('../src/naver/searchad/reporting/runtime.js');
  const {createProductionSearchAdWriteRuntime}=await import('../src/naver/searchad/write/runtime-production.js');
  const {PostgresAutomationRepository}=await import('../src/naver/searchad/automation/postgres-repository.js');
  const {AutomationService}=await import('../src/naver/searchad/automation/service.js');
  const f=await fixture(t), wire=reportingFixture(), state={nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false}, calls=[];
  let time=at, loseResponse=false;
  wire.gateway.config.allowWrites=true;
  wire.gateway.client.clock=()=>time;
  wire.gateway.client.fetchImpl=async(url,init)=>{
    const address=new URL(url); assert.equal(address.origin,'https://api.searchad.naver.com'); assert.ok(['/stats','/ncc/campaigns/cmp-1'].includes(address.pathname)); assert.ok(['GET','PUT'].includes(init.method)); assert.equal(init.headers['X-Customer'],'1001'); assert.equal(init.redirect,'error');
    calls.push(init.method);
    if(address.pathname==='/stats')return new Response(JSON.stringify(responseFixture()),{headers:{'content-type':'application/json'}});
    if(init.method==='PUT'){assert.equal(address.searchParams.get('fields'),'userLock');assert.deepEqual(JSON.parse(init.body),{nccCampaignId:'cmp-1',userLock:true});Object.assign(state,JSON.parse(init.body));if(loseResponse)throw new TypeError('closed fixture response loss');}
    return new Response(JSON.stringify(state),{headers:{'content-type':'application/json','x-request-id':'automation-fixture'}});
  };
  const clock=()=>time;
  const circuit=createCircuitGuard({pool:f.pool,clock,spendEvidence:{async select(){return {spendGrossKrw:100,baselineGrossKrw:100,validUntil:time+60000};}}});
  await f.pool.query("INSERT INTO searchad_circuit_policies(customer_id,policy_json) VALUES('1001',$1)",[{customerDailySpendCeilingGrossKrw:1000,entityCooldownMs:0,postChangeObservationMs:0}]);
  const repository=new PostgresAutomationRepository({pool:f.pool,clock,identityResolver:wire.identityResolver});
  const runtime=createProductionSearchAdWriteRuntime({gateway:wire.gateway,postgresPool:f.pool,clock,circuitGuard:circuit,activationGuard:{async assertMutationAllowed(){return {allowed:true};}},env:{ATELIER_SEARCHAD_WRITE_STORAGE:'postgres',ATELIER_SEARCHAD_ALLOW_WRITES:'true'}});
  const context={principal:{principalId:'fixture-admin',role:'admin',customerIds:['1001']},requestId:'automation-test'};
  await f.pool.query("INSERT INTO searchad_customer_accounts(customer_id) VALUES('1001')");
  const reporting=await createReportingRuntime({pool:f.pool,gateway:wire.gateway,clock});
  await reporting.statsService.collect({customerId:'1001',entityType:'campaign',entityId:'cmp-1',since:'2026-10-01',until:'2026-10-04'},context);
  const service=new AutomationService({repository,circuit,clock,getWriteRuntime:()=>runtime,identityResolver:wire.identityResolver,evidenceSelector:{select:input=>reporting.repository.selectAutomationEvidence(input)}});
  const policy=await service.createPolicy({customerId:'1001',entityType:'campaign',entityId:'cmp-1',mode,enabled:true,recipe:{kind:'campaign_user_lock',userLock:true},reason:'approved fixture change'},context);
  return {...f,service,reporting,repository,runtime,circuit,policy,context,wire,state,calls,clock,setTime:v=>{time=v;},loseResponse:()=>{loseResponse=true;}};
}

test('approve prepares exactly one owned plan and uses existing explicit token claim and execution',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t), input={customerId:'1001',policyId:f.policy.policyId};
  const run=await f.service.evaluate(input,f.context), duplicate=await f.service.evaluate(input,f.context);
  assert.equal(run.runId,duplicate.runId);assert.equal(run.state,'ready');
  const prepared=await f.service.prepare?.({customerId:'1001',runId:run.runId},f.context);
  assert.equal(prepared?.state,'prepared');
  const again=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);assert.equal(again.planId,prepared.planId);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,1);
  const approval=await f.runtime.approvalService.approve(prepared.planId,{actor:'fixture-executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  await assert.rejects(f.runtime.approvalService.approve(prepared.planId,{actor:'fixture-executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}));
  const result=await f.service.executeApproved({customerId:'1001',runId:run.runId,executionToken:approval.executionToken},f.context);
  assert.equal(result.state,'applied');assert.equal(f.calls.filter(x=>x==='PUT').length,1);
  await assert.rejects(f.service.executeApproved({customerId:'1001',runId:run.runId,executionToken:approval.executionToken},f.context));
  assert.equal(f.calls.filter(x=>x==='PUT').length,1);
  const serialized=JSON.stringify((await f.pool.query("SELECT to_jsonb(r) AS value FROM searchad_automation_runs r UNION ALL SELECT to_jsonb(e) FROM searchad_automation_events e UNION ALL SELECT to_jsonb(a) FROM searchad_write_approvals a")).rows);
  assert.equal(serialized.includes(approval.executionToken),false);
});

test('known failure recovery is explicit scoped and audited and does not clear pause tokens or legacy history',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t), rule=f.policy.ruleId;
  const one=await approved(f);await f.writer.claimApproval(one);await terminal(f,one.planId,'failed',at+1000);
  const two=await approved(f);await f.writer.claimApproval(two);await terminal(f,two.planId,'applied',at-2000);
  const three=await approved(f);await f.writer.claimApproval(three);await terminal(f,three.planId,'not_applied',at-4000);
  await f.circuit.repository.projectOnce({customerId:'1001',sourceKind:'legacy-fixture',sourceId:'unordered-failure',event:{logicalKey:'unlinked',outcome:'failed',ruleId:rule,entityType:'campaign',entityId:'cmp-1',occurredAt:at+9999},now:at});
  await f.circuit.projectOutcome('1001');
  let state=await f.circuit.repository.getState({customerId:'1001'});
  assert.equal(state.orderedConsecutiveFailures[rule],1);assert.equal(state.legacyFailures[rule],1);assert.equal(state.consecutiveFailures[rule],2);
  const fourth=await approved(f);await f.writer.claimApproval(fourth);await terminal(f,fourth.planId,'applied',at-5000);await f.circuit.projectOutcome('1001');
  state=await f.circuit.repository.getState({customerId:'1001'});assert.equal(state.orderedConsecutiveFailures[rule],0);assert.equal(state.legacyFailures[rule],1,'new ordered success cannot erase legacy failure');
  await f.circuit.pause({customerId:'1001',reason:'sticky pause'},f.context);
  const input={customerId:'1001',policyId:f.policy.policyId,expectedRevision:1,reason:'reviewed exact known outcomes',confirmation:'RECOVER_SEARCHAD_KNOWN_FAILURES'};
  const recovered=await f.circuit.recoverRule?.(input,f.context);
  assert.ok(recovered?.recoveryId,'explicit Admin recovery must select and audit known failure versions');
  const audits=(await f.pool.query('SELECT * FROM searchad_circuit_failure_recoveries')).rows;
  assert.equal(audits.length,1);assert.equal(audits[0].selected_json.legacyEventIds.length,1);assert.ok(audits[0].selected_json.outcomeIds.length>=2);
  state=await f.circuit.repository.getState({customerId:'1001'});assert.equal(state.consecutiveFailures[rule],0);assert.equal(state.manualPaused,true);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_execution_outcomes')).rows[0].n,4);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_approvals WHERE used_at IS NOT NULL')).rows[0].n,4);
});

test('unknown ordered outcome blocks later claim and recovery until a known primary reconciliation version',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t), one=await approved(f),two=await approved(f);
  await f.writer.claimApproval(one);
  await f.writer.addAttempt({attempt_id:randomUUID(),plan_id:one.planId,phase:'execute',status:'unknown_outcome',created_at:iso(at)});
  await f.writer.updatePlan(one.planId,{status:'unknown_outcome'});await f.circuit.projectOutcome('1001');
  await assert.rejects(f.writer.claimApproval(two),{code:'SEARCHAD_EXECUTION_ORDER_UNRESOLVED'});
  const recover={customerId:'1001',policyId:f.policy.policyId,expectedRevision:1,reason:'reviewed',confirmation:'RECOVER_SEARCHAD_KNOWN_FAILURES'};
  assert.equal(typeof f.circuit.recoverRule,'function');
  await assert.rejects(f.circuit.recoverRule(recover,f.context),{code:'SEARCHAD_CIRCUIT_RECOVERY_UNRESOLVED'});
  await terminal(f,one.planId,'not_applied');await f.circuit.projectOutcome('1001');
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_execution_outcomes')).rows[0].n,2);
  await f.circuit.recoverRule(recover,f.context);assert.equal(String((await f.writer.claimApproval(two)).execution_ordinal),'2');
});

function lostCommitPool(pool,match,after) {
  let injected=false;
  return {query:pool.query.bind(pool),async connect(){const client=await pool.connect();let selected=false;return {release:discard=>client.release(discard),async query(sql,args){
    if(match.test(sql))selected=true;
    if(sql==='COMMIT' && selected && !injected){injected=true;if(after)await client.query(sql,args);throw new Error('injected COMMIT acknowledgment loss');}
    return client.query(sql,args);
  }};}};
}
for(const after of [false,true])test(`prepare reservation COMMIT loss ${after?'after':'before'} commit never creates a plan after restart`,async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  const wrapped=lostCommitPool(f.pool,/state='preparing'/,after);
  f.repository.pool=wrapped;f.runtime.repository.pool=wrapped;
  await assert.rejects(f.service.prepare({customerId:'1001',runId:run.runId},f.context));
  f.repository.pool=f.pool;f.runtime.repository.pool=f.pool;
  const recovered=await f.repository.getRun({customerId:'1001',runId:run.runId});
  assert.equal(recovered.state,'manual_review');
  await assert.rejects(f.service.prepare({customerId:'1001',runId:run.runId},f.context));
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,0);
});

test('current-value drift cannot rebase a recipe and orphan preparation blocks another run',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  f.state.dailyBudget=1200;
  await assert.rejects(f.service.prepare({customerId:'1001',runId:run.runId},f.context),{code:'SEARCHAD_AUTOMATION_CURRENT_VALUE_DRIFT'});
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,0);
  f.state.dailyBudget=1000;f.setTime(at+3600000);
  const next=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  // An orphan preparation holds the Customer; source evidence cannot authorize a new run.
  assert.equal(next.state,'blocked');
});

function revisionInput(f,patch={}) { return {customerId:'1001',policyId:f.policy.policyId,expectedRevision:f.policy.revision,entityType:'campaign',entityId:'cmp-1',mode:'approve',enabled:true,recipe:{kind:'campaign_user_lock',userLock:true},reason:'revised fixture policy',...patch}; }
for(const stage of ['plan','approval','claim'])for(const after of [false,true])test(`${stage} COMMIT acknowledgment loss ${after?'after':'before'} commit cannot mint replacement authority`,async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  let prepared,token;
  if(stage!=='plan')prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  if(stage==='claim')token=await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  const wrapped=lostCommitPool(f.pool,stage==='plan'?/INSERT INTO searchad_write_change_plans/:stage==='approval'?/INSERT INTO searchad_write_approvals/:/INSERT INTO searchad_write_execution_claims/,after);
  for(const repo of [f.repository,f.runtime.repository,f.runtime.repository.automation])repo.pool=wrapped;
  await assert.rejects(stage==='plan'?f.service.prepare({customerId:'1001',runId:run.runId},f.context):stage==='approval'?f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}):f.runtime.executionService.execute(prepared.planId,{customerId:'1001',executionToken:token.executionToken}));
  for(const repo of [f.repository,f.runtime.repository,f.runtime.repository.automation])repo.pool=f.pool;
  assert.equal((await f.service.getRun({customerId:'1001',runId:run.runId},f.context)).state,'manual_review');
  const counts=await f.pool.query('SELECT (SELECT count(*)::int FROM searchad_write_change_plans) AS plans,(SELECT count(*)::int FROM searchad_write_approvals) AS approvals,(SELECT count(*)::int FROM searchad_write_execution_claims) AS claims');
  await assert.rejects(stage==='plan'?f.service.prepare({customerId:'1001',runId:run.runId},f.context):f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}));
  assert.equal(f.calls.filter(x=>x==='PUT').length,0);
  assert.equal(counts.rows[0].plans,stage==='plan'?Number(after):1);
  if(stage==='approval')assert.equal(counts.rows[0].approvals,Number(after));
  if(stage==='claim')assert.equal(counts.rows[0].claims,Number(after));
});

test('direct generic execution rechecks a policy revision committed after claim and before the final fence',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  const token=await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  const original=f.circuit.prepareDispatch.bind(f.circuit);
  f.circuit.prepareDispatch=async dispatch=>{await f.service.createPolicy(revisionInput(f),f.context);await original(dispatch);};
  await assert.rejects(f.runtime.executionService.execute(prepared.planId,{customerId:'1001',executionToken:token.executionToken}),{code:'SEARCHAD_CIRCUIT_UNAVAILABLE'});
  assert.equal(f.calls.filter(x=>x==='PUT').length,0);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_execution_claims')).rows[0].n,1);
  const state=await f.circuit.repository.getState({customerId:'1001'});assert.equal(state.orderedConsecutiveFailures[f.policy.ruleId],1,'accepted local no-send failures count');
  await assert.rejects(f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}));
  const replacement=await f.service.createPolicy({...revisionInput(f),policyId:undefined,expectedRevision:undefined},f.context);assert.equal(replacement.ruleId,f.policy.ruleId);
  assert.equal((await f.circuit.repository.getState({customerId:'1001'})).consecutiveFailures[replacement.ruleId],1);
});

test('response loss is never replayed and existing GET reconcile appends an applied_reconciled version',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  const token=await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  f.loseResponse();
  await assert.rejects(f.runtime.executionService.execute(prepared.planId,{customerId:'1001',executionToken:token.executionToken}),{code:'SEARCHAD_UNKNOWN_OUTCOME'});
  const result=await f.runtime.executionService.reconcile(prepared.planId,{},f.context);
  assert.equal(result.status,'applied_reconciled');assert.equal(f.calls.filter(x=>x==='PUT').length,1);
  assert.equal((await f.service.getRun({customerId:'1001',runId:run.runId},f.context)).state,'applied_reconciled');
  const outcomes=(await f.pool.query('SELECT version,outcome FROM searchad_write_execution_outcomes ORDER BY version')).rows;
  assert.deepEqual(outcomes,[{version:1,outcome:'unknown'},{version:2,outcome:'applied_reconciled'}]);
  await assert.rejects(f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}));
  assert.equal((await f.circuit.repository.getState({customerId:'1001'})).orderedConsecutiveFailures[f.policy.ruleId],0);
});

test('full application HTTP restart preserves owned plan token claim and unknown result with GET-only reconciliation',async t=>{
  if(!native(t))return;
  const {responseFixture}=await import('./helpers/searchad-completion-fixture.js');
  const {credentialFingerprintForCustomer}=await import('../src/naver/searchad/canary/credential-fingerprint.js');
  const {CANARY_OPERATION_KEYS}=await import('../src/naver/searchad/canary/production-recipe.js');
  const f=await postgresCompletionFixture(t),key='automation-restart-admin-'.repeat(4),state={nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false};
  const appEnv={ATELIER_SEARCHAD_ADMIN_API_KEY:key,ATELIER_SEARCHAD_ADMIN_CUSTOMERS:'1001',ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID:'automation-admin',ATELIER_SEARCHAD_WRITE_STORAGE:'postgres',ATELIER_SEARCHAD_ALLOW_WRITES:'true',ATELIER_HTTP_ALLOW_WRITES:'true'};
  const start=async()=>{
    const server=await f.start({appEnv,allowedPaths:['/stats','/ncc/campaigns/cmp-1'],allowedMethods:{'/ncc/campaigns/cmp-1':['GET','PUT']},response:({target,init})=>{
      if(target.pathname==='/stats')return new Response(JSON.stringify(responseFixture()),{headers:{'content-type':'application/json'}});
      if(init.method==='PUT'){Object.assign(state,JSON.parse(init.body));throw new TypeError('closed upstream response loss');}
      return new Response(JSON.stringify(state),{headers:{'content-type':'application/json'}});
    }});
    server.app.searchAdCompletionRuntime.circuitService.spendEvidence={async select(){return {spendGrossKrw:100,baselineGrossKrw:100,validUntil:at+600000};}};
    return server;
  };
  let server=await start();
  await f.pool.query("INSERT INTO searchad_circuit_policies(customer_id,policy_json) VALUES('1001',$1)",[{customerDailySpendCeilingGrossKrw:1000}]);
  const activation=server.app.searchAdActivationRuntime;
  const evidence=await activation.repository.createEvidence({evidenceId:randomUUID(),evidenceType:'active_canary',customerId:'1001',specSha:activation.status().specSha,credentialFingerprint:credentialFingerprintForCustomer(server.app.searchAdCredentials,'1001'),upstreamBaseUrl:'https://api.searchad.naver.com',result:'verified',sourceRunId:'synthetic-restart-only-not-live',details:{fixtureOnly:true},operationKeys:[CANARY_OPERATION_KEYS.updateCampaign],fieldScope:['campaign.userLock','campaign.dailyBudget'],createdAt:iso(at),expiresAt:iso(at+600000)});
  await activation.activationService.activate({evidenceId:evidence.evidenceId},{principal:{principalId:'fixture-admin',role:'admin',customerIds:['1001']}});
  assert.equal((await server.call(key,'POST','/api/v1/searchad/reporting/stats',{customerId:'1001',entityType:'campaign',entityId:'cmp-1',since:'2026-10-01',until:'2026-10-04'})).status,201);
  const policy=await server.call(key,'POST','/api/v1/searchad/automation/policies',{customerId:'1001',entityType:'campaign',entityId:'cmp-1',mode:'approve',enabled:true,recipe:{kind:'campaign_user_lock',userLock:true},reason:'restart fixture'});assert.equal(policy.status,201);
  const run=await server.call(key,'POST','/api/v1/searchad/automation/evaluate',{customerId:'1001',policyId:policy.body.policyId});assert.equal(run.body.state,'ready');
  const prepared=await server.call(key,'POST',`/api/v1/searchad/automation/runs/${run.body.runId}/prepare`,{customerId:'1001'});assert.equal(prepared.status,200);assert.equal(prepared.body.state,'prepared');
  assert.equal(server.app.searchAdWriteRuntime.repository.pool,server.app.searchAdCompletionRuntime.automationRepository.pool);
  await server.api.close();server=await start();
  const token=await server.call(key,'POST',`/api/v1/searchad/changes/${prepared.body.planId}/approve`,{customerId:'1001',confirmation:'APPROVE_SEARCHAD_CHANGE'});assert.equal(token.status,200);
  await server.api.close();server=await start();
  assert.equal((await server.call(key,'POST',`/api/v1/searchad/changes/${prepared.body.planId}/approve`,{customerId:'1001',confirmation:'APPROVE_SEARCHAD_CHANGE'})).status,409);
  const failed=await server.call(key,'POST',`/api/v1/searchad/automation/runs/${run.body.runId}/execute-approved`,{customerId:'1001',executionToken:token.body.executionToken});assert.equal(failed.status,409);assert.equal(failed.body.error?.code,'SEARCHAD_UNKNOWN_OUTCOME',JSON.stringify(failed.body));
  await server.api.close();server=await start();
  const reopened=await server.call(key,'GET',`/api/v1/searchad/automation/runs/${run.body.runId}?customerId=1001`);assert.equal(reopened.body.state,'unknown_outcome');
  assert.equal((await server.call(key,'POST',`/api/v1/searchad/automation/runs/${run.body.runId}/execute-approved`,{customerId:'1001',executionToken:token.body.executionToken})).status,409);
  const reconciled=await server.call(key,'POST',`/api/v1/searchad/changes/${prepared.body.planId}/reconcile`,{customerId:'1001'});assert.equal(reconciled.body.status,'applied_reconciled');
  assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,1);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_approvals')).rows[0].n,1);
});


test('selected stats expiration revokes direct approval even while exact current GET remains fresh',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t);f.setTime(at+24*60000);
  const run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  assert.equal(run.state,'ready');
  const prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  f.setTime(at+26*60000); // stats cycle is 11:55 KST; current GET is only two minutes old.
  await assert.rejects(f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}),{code:'SEARCHAD_AUTOMATION_EVIDENCE_EXPIRED'});
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_approvals')).rows[0].n,0);
});

test('persisted executing state alone cannot replace a committed consumed approval and exact ordinal',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  await f.pool.query("UPDATE searchad_automation_runs SET state='executing' WHERE run_id=$1",[run.runId]);
  await f.pool.query("UPDATE searchad_automation_reservations SET state='consumed' WHERE run_id=$1",[run.runId]);
  await assert.rejects(f.repository.planAuthority(prepared.planId,{states:['executing']}),{code:'SEARCHAD_AUTOMATION_CLAIM_BINDING'});
});

test('automation participates in application shutdown readiness and refuses use after close',async t=>{
  if(!native(t))return;
  const f=await postgresCompletionFixture(t),key='automation-close-admin-'.repeat(4);
  const server=await f.start({appEnv:{ATELIER_SEARCHAD_ADMIN_API_KEY:key,ATELIER_SEARCHAD_ADMIN_CUSTOMERS:'1001'}});
  const runtime=server.app.searchAdCompletionRuntime;
  await server.api.close();
  assert.equal(runtime.status().automation.ready,false);
  await assert.rejects(runtime.automationService.listRuns({customerId:'1001'},{principal:{principalId:'admin',role:'admin',customerIds:['1001']}}),{code:'SEARCHAD_REPORTING_NOT_READY'});
});

test('concurrent prepare has one owner and a losing request cannot revoke the committed winner',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  const results=await Promise.allSettled([1,2].map(()=>f.service.prepare({customerId:'1001',runId:run.runId},f.context)));
  assert.ok(results.some(result=>result.status==='fulfilled'));
  assert.equal((await f.service.getRun({customerId:'1001',runId:run.runId},f.context)).state,'prepared');
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,1);
});

for(const phase of ['approval_pending','claim_pending'])for(const after of [false,true])test(`${phase} acknowledgment loss ${after?'after':'before'} commit durably retires the run`,async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  const token=phase==='claim_pending'?await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}):null;
  const wrapped=lostCommitPool(f.pool,/SET state=\$3,updated_at/,after);f.runtime.repository.automation.pool=wrapped;
  await assert.rejects(phase==='claim_pending'?f.runtime.executionService.execute(prepared.planId,{customerId:'1001',executionToken:token.executionToken}):f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}));
  f.runtime.repository.automation.pool=f.pool;
  assert.equal((await f.service.getRun({customerId:'1001',runId:run.runId},f.context)).state,'manual_review');
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_execution_claims')).rows[0].n,0);
  await assert.rejects(f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}));
  assert.equal(f.calls.filter(x=>x==='PUT').length,0);
});

test('native evidence selection pins exact scope identity and original times; refresh cannot revive the same decision',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),identity=f.wire.identityResolver('1001');
  const input={customerId:'1001',entityType:'campaign',entityId:'cmp-1',identity,now:at};
  assert.ok((await f.reporting.repository.selectAutomationEvidence(input)).stats);
  for(const patch of [{entityId:'cmp-2'},{entityType:'adgroup'},{identity:{...identity,specSha:'f'.repeat(64)}},{identity:{...identity,credentialFingerprint:'f'.repeat(64)}},{now:at-1},{now:at+26*60000},{maxCurrentAgeMs:60000}])assert.equal((await f.reporting.repository.selectAutomationEvidence({...input,...patch})).stats,null);
  const run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  f.setTime(at+26*60000);
  // A new GET cannot relabel the originally selected stats observation as recent.
  await assert.rejects(f.service.prepare({customerId:'1001',runId:run.runId},f.context),{code:'SEARCHAD_AUTOMATION_EVIDENCE_EXPIRED'});
  f.wire.rotate();
  await assert.rejects(f.repository.authority({customerId:'1001',runId:run.runId,states:['ready']}),{code:'SEARCHAD_AUTOMATION_IDENTITY_CHANGED'});
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,0);
});

test('native policy revisions are immutable and rule lineage cannot reset by swapping recipes or replacing policies',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  const next=await f.service.createPolicy(revisionInput(f,{recipe:{kind:'campaign_budget',dailyBudgetKrw:900}}),f.context);
  assert.equal(next.revision,2);assert.equal(next.ruleId,f.policy.ruleId);
  await assert.rejects(f.service.prepare({customerId:'1001',runId:run.runId},f.context),{code:'SEARCHAD_AUTOMATION_AUTHORITY_REVOKED'});
  await assert.rejects(f.pool.query('UPDATE searchad_automation_policy_revisions SET policy_json=$1',[{}]));
  const revisions=(await f.pool.query('SELECT revision,policy_json FROM searchad_automation_policy_revisions ORDER BY revision')).rows;
  assert.equal(revisions[0].policy_json.recipe.kind,'campaign_user_lock');assert.equal(revisions[1].policy_json.recipe.kind,'campaign_budget');
  const replacement=await f.service.createPolicy({...revisionInput(f),policyId:undefined,expectedRevision:undefined},f.context);assert.equal(replacement.ruleId,next.ruleId);
  await assert.rejects(f.service.createPolicy(revisionInput(f),f.context),{code:'SEARCHAD_AUTOMATION_REVISION_CONFLICT'});
});

test('production roles and Customer allowlists deny evidence overrides and missing baseline blocks locks',async t=>{
  if(!native(t))return;
  const {completionReaderKey,completionOperatorKey}=await import('./helpers/postgres-searchad-completion-fixture.js');
  const {responseFixture}=await import('./helpers/searchad-completion-fixture.js');
  const f=await postgresCompletionFixture(t),key='automation-roles-admin-'.repeat(4);
  const server=await f.start({appEnv:{ATELIER_SEARCHAD_ADMIN_API_KEY:key,ATELIER_SEARCHAD_ADMIN_CUSTOMERS:'1001'},allowedPaths:['/stats','/ncc/campaigns/cmp-1'],response:({target})=>new Response(JSON.stringify(target.pathname==='/stats'?responseFixture():{nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false}),{headers:{'content-type':'application/json'}})});
  const policyInput={customerId:'1001',entityType:'campaign',entityId:'cmp-1',mode:'approve',enabled:true,recipe:{kind:'campaign_user_lock',userLock:true},reason:'explicit policy'};
  for(const token of [completionReaderKey,completionOperatorKey])assert.equal((await server.call(token,'POST','/api/v1/searchad/automation/policies',policyInput)).status,403);
  assert.equal((await server.call(key,'POST','/api/v1/searchad/automation/policies',{...policyInput,mode:'auto'})).status,400);
  assert.equal((await server.call(key,'POST','/api/v1/searchad/automation/policies',{...policyInput,customerId:'2002'})).status,403);
  const policy=await server.call(key,'POST','/api/v1/searchad/automation/policies',policyInput);
  assert.equal((await server.call(completionOperatorKey,'POST','/api/v1/searchad/reporting/stats',{customerId:'1001',entityType:'campaign',entityId:'cmp-1',since:'2026-10-01',until:'2026-10-04'})).status,201);
  const evaluate={customerId:'1001',policyId:policy.body.policyId};
  assert.equal((await server.call(completionReaderKey,'POST','/api/v1/searchad/automation/evaluate',evaluate)).status,403);
  for(const patch of [{current:{dailyBudget:1000}},{evidenceId:randomUUID()},{ruleId:randomUUID()},{approved:true}])assert.equal((await server.call(completionOperatorKey,'POST','/api/v1/searchad/automation/evaluate',{...evaluate,...patch})).status,400);
  const run=await server.call(completionOperatorKey,'POST','/api/v1/searchad/automation/evaluate',evaluate);
  assert.equal(run.body.state,'blocked');assert.ok(run.body.decision.reasons.includes('SPEND_EVIDENCE_UNAVAILABLE'));
  assert.equal((await server.call(completionOperatorKey,'POST',`/api/v1/searchad/automation/runs/${run.body.runId}/prepare`,{customerId:'1001'})).status,409);
  assert.equal((await server.call(completionReaderKey,'GET',`/api/v1/searchad/automation/runs/${run.body.runId}?customerId=2002`)).status,403);
  assert.equal((await server.call(completionReaderKey,'GET','/api/v1/searchad/automation/runs?customerId=1001&customerId=2002')).status,400);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,0);
  assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
});

test('legacy projected not_applied and historical entity names remain failures after protocol upgrade',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),p=await approved(f),attemptId=randomUUID();
  await f.writer.updatePlan(p.planId,{status:'not_applied'});
  await f.writer.addAttempt({attempt_id:attemptId,plan_id:p.planId,phase:'reconcile',status:'not_applied',created_at:iso(at)});
  // Simulate the immutable projection produced by 0012 before corrected classification.
  await f.circuit.repository.projectOnce({customerId:'1001',sourceKind:'write',sourceId:attemptId,event:{logicalKey:`write:${p.planId}:execute`,outcome:'succeeded',entityType:'nccCampaign',entityId:'cmp-1',occurredAt:at},now:at});
  const state=await f.circuit.repository.getState({customerId:'1001',entityType:'campaign',entityId:'cmp-1'});
  assert.equal(state.legacyFailures[f.policy.ruleId],1);assert.equal(state.changedAt,null);
});

test('pre-claim rejection and current neutral read acceptance rollback never alter the ordered suffix',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),one=await approved(f);await f.writer.claimApproval(one);await terminal(f,one.planId,'failed');
  for(const [phase,status] of [['read','succeeded'],['execute','remote_accepted'],['rollback','rollback_failed']])await f.writer.addAttempt({attempt_id:randomUUID(),plan_id:one.planId,phase,status,created_at:iso(at)});
  const run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  await assert.rejects(f.runtime.executionService.execute(prepared.planId,{customerId:'2002',executionToken:'invalid'}),{code:'SEARCHAD_CUSTOMER_SCOPE_MISMATCH'});
  await assert.rejects(f.runtime.executionService.execute(prepared.planId,{customerId:'1001',executionToken:'invalid'}));
  await f.circuit.projectOutcome('1001');
  const state=await f.circuit.repository.getState({customerId:'1001'});
  assert.equal(state.orderedConsecutiveFailures[f.policy.ruleId],1);assert.equal(state.legacyFailures[f.policy.ruleId] || 0,0);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_execution_claims')).rows[0].n,1);
});

test('known recovery preserves consumed reservations risk account pause and source history while revoking old decisions',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  const token=await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  await f.runtime.approvalService.claim(prepared.planId,token.executionToken);
  await terminal({...f,writer:f.runtime.repository},prepared.planId,'failed');
  await f.pool.query("INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at) VALUES('1001','2026-10-05',10,2,3,$1)",[iso(at)]);
  await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
  await f.circuit.pause({customerId:'1001',reason:'independent account review'},f.context);
  const input={customerId:'1001',policyId:f.policy.policyId,expectedRevision:1,reason:'reviewed local failure',confirmation:'RECOVER_SEARCHAD_KNOWN_FAILURES'};
  await assert.rejects(f.circuit.recoverRule({...input,expectedRevision:2},f.context),{code:'SEARCHAD_CIRCUIT_RECOVERY_REVISION'});
  await assert.rejects(f.circuit.recoverRule({...input,confirmation:'RESUME'},f.context),{code:'SEARCHAD_CIRCUIT_INPUT'});
  await assert.rejects(f.circuit.recoverRule(input,{principal:{...f.context.principal,role:'operator'}}),{code:'SEARCHAD_CIRCUIT_FORBIDDEN'});
  await f.circuit.recoverRule(input,f.context);
  assert.ok((await f.service.getRun({customerId:'1001',runId:run.runId},f.context)).revokedAt);
  assert.equal((await f.pool.query('SELECT state FROM searchad_automation_reservations WHERE run_id=$1',[run.runId])).rows[0].state,'consumed');
  assert.deepEqual((await f.pool.query('SELECT reserved_units,consumed_units FROM searchad_daily_risk_capacity')).rows[0],{reserved_units:2,consumed_units:3});
  assert.equal((await f.pool.query("SELECT suspended FROM searchad_canary_accounts WHERE customer_id='1001'")).rows[0].suspended,true);
  assert.equal((await f.circuit.repository.getState({customerId:'1001'})).manualPaused,true);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_execution_outcomes')).rows[0].n,1);
  await assert.rejects(f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'}));
});

test('owned plan binding rejects foreign existing plans and migrations repeat with exact metadata',async t=>{
  if(!native(t))return;
  const {runPostgresMigrations,listMigrationFiles}=await import('../src/infrastructure/postgres/migrator.js');
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),foreign=await approved(f);
  await assert.rejects(f.repository.attachPlan({customerId:'1001',runId:run.runId,planId:foreign.planId}),{code:'SEARCHAD_AUTOMATION_PLAN_BINDING'});
  await assert.rejects(f.service.getRun({customerId:'2002',runId:run.runId},f.context),{code:'SEARCHAD_AUTOMATION_FORBIDDEN'});
  const files=listMigrationFiles('migrations/postgres');
  const metadata=(await f.pool.query('SELECT version,file_name,checksum FROM schema_migrations ORDER BY version')).rows;
  assert.deepEqual(metadata,files.map(file=>({version:file.version,file_name:file.fileName,checksum:file.checksum})));
  assert.equal(files.length,15);assert.equal(files.at(-1).fileName,'0015_searchad_profitability.sql');
  assert.deepEqual(await runPostgresMigrations({pool:f.pool,migrationsDir:'migrations/postgres',logger:{info(){}}}),{applied:[],currentVersion:'0015'});
  assert.deepEqual((await f.pool.query('SELECT version,file_name,checksum FROM schema_migrations ORDER BY version')).rows,metadata);
});

test('recommend mode records a reviewable recommendation without a plan token or executable preparation',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t,{mode:'recommend'}),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  assert.equal(run.state,'recommended');assert.equal(run.decision.allowed,true);
  await assert.rejects(f.service.prepare({customerId:'1001',runId:run.runId},f.context),{code:'SEARCHAD_AUTOMATION_AUTHORITY_REVOKED'});
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,0);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_approvals')).rows[0].n,0);
});

for(const lateUnknown of [false,true])test(`fix1 complete legacy unknown to not_applied history stays known across recovery and restart${lateUnknown?' with late unknown projection':''}`,async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context);
  const prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  const token=await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  await f.runtime.approvalService.claim(prepared.planId,token.executionToken);
  await terminal({...f,writer:f.runtime.repository},prepared.planId,'failed');
  // A separate ordinary pre-protocol plan has a consumed approval but no ordinal.
  const legacy=await f.runtime.planService.create({...run.decision.recipe,createdBy:'legacy-executor'});
  await f.runtime.approvalService.approve(legacy.plan_id,{actor:'legacy-executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  await f.pool.query('UPDATE searchad_write_approvals SET used_at=$2 WHERE plan_id=$1',[legacy.plan_id,iso(at)]);
  await f.writer.updatePlan(legacy.plan_id,{status:'unknown_outcome'});
  const unknownId=randomUUID();
  await f.writer.addAttempt({attempt_id:unknownId,plan_id:legacy.plan_id,phase:'execute',status:'unknown_outcome',created_at:iso(at)});
  const common={logicalKey:`write:${legacy.plan_id}:execute`,entityType:'nccCampaign',entityId:'cmp-1',ownerId:legacy.plan_id,occurredAt:at};
  if(!lateUnknown){
    await f.circuit.repository.projectOnce({customerId:'1001',sourceKind:'write',sourceId:unknownId,event:{...common,outcome:'unknown'},now:at});
    assert.equal((await f.circuit.repository.getState({customerId:'1001'})).unknownCount,1);
  }
  // Use the real existing GET-only reconciliation, then project its 0012 JSON shape.
  f.runtime.executionService.circuitGuard=null;
  assert.equal((await f.runtime.executionService.reconcile(legacy.plan_id,{},f.context)).status,'not_applied');
  const terminalAttempt=(await f.pool.query("SELECT attempt_id FROM searchad_write_attempts WHERE plan_id=$1 AND phase='reconcile'",[legacy.plan_id])).rows[0];
  await f.circuit.repository.projectOnce({customerId:'1001',sourceKind:'write',sourceId:terminalAttempt.attempt_id,event:{...common,outcome:'succeeded',occurredAt:at+1000},now:at});
  if(lateUnknown)await f.circuit.repository.projectOnce({customerId:'1001',sourceKind:'write',sourceId:unknownId,event:{...common,outcome:'unknown'},now:at});
  const unrelated=await f.service.createPolicy({...revisionInput(f),policyId:undefined,expectedRevision:undefined,entityId:'cmp-2'},f.context);
  const other=await approved(f,'cmp-2');await terminal(f,other.planId,'failed');
  await f.pool.query("INSERT INTO searchad_daily_risk_capacity(customer_id,risk_date,capacity_units,reserved_units,consumed_units,updated_at) VALUES('1001','2026-10-05',10,2,3,$1)",[iso(at)]);
  await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
  await f.circuit.pause({customerId:'1001',reason:'independent manual hold'},f.context);
  await f.circuit.repository.projectOnce({customerId:'1001',sourceKind:'legacy-drift',sourceId:'manual',event:{logicalKey:'manual',outcome:'manual_drift',entityType:'campaign',entityId:'cmp-1',occurredAt:at-1000},now:at});
  await f.circuit.projectOutcome('1001');
  const sourceSnapshot=async()=>({attempts:(await f.pool.query('SELECT * FROM searchad_write_attempts ORDER BY attempt_id')).rows,events:(await f.pool.query('SELECT * FROM searchad_circuit_events ORDER BY event_id')).rows,approvals:(await f.pool.query('SELECT * FROM searchad_write_approvals ORDER BY approval_id')).rows,reservations:(await f.pool.query('SELECT * FROM searchad_automation_reservations ORDER BY reservation_id')).rows,risk:(await f.pool.query('SELECT * FROM searchad_daily_risk_capacity')).rows,account:(await f.pool.query("SELECT * FROM searchad_canary_accounts WHERE customer_id='1001'")).rows});
  const preserved=await sourceSnapshot();
  let circuit=createCircuitGuard({pool:f.connect(),clock:f.clock});
  const state=await circuit.repository.getState({customerId:'1001',entityType:'campaign',entityId:'cmp-1'});
  assert.equal(state.unknownCount,0);assert.equal(state.legacyFailures[f.policy.ruleId],1);
  assert.equal(state.legacyFailures[unrelated.ruleId],1);assert.equal(state.changedAt,null);
  const recovered=await circuit.recoverRule({customerId:'1001',policyId:f.policy.policyId,expectedRevision:1,reason:'verified legacy absence',confirmation:'RECOVER_SEARCHAD_KNOWN_FAILURES'},f.context);
  const terminalEvent=preserved.events.find(event=>event.source_id===terminalAttempt.attempt_id);
  assert.deepEqual(recovered.selected.legacyEventIds,[String(terminalEvent.event_id)]);
  circuit=createCircuitGuard({pool:f.connect(),clock:f.clock});
  const after=await circuit.repository.getState({customerId:'1001',entityType:'campaign',entityId:'cmp-1'});
  assert.equal(after.unknownCount,0,'audited terminal exemption must never resurrect the earlier unknown');
  assert.equal(after.legacyFailures[f.policy.ruleId] || 0,0);assert.equal(after.consecutiveFailures[f.policy.ruleId] || 0,0);
  assert.equal(after.legacyFailures[unrelated.ruleId],1);assert.equal(after.changedAt,null);
  assert.equal(after.manualPaused,true);assert.equal(after.manualChangedAt,at-1000);
  assert.deepEqual(await sourceSnapshot(),preserved);
  assert.ok((await f.service.getRun({customerId:'1001',runId:run.runId},f.context)).revokedAt);
  assert.equal(f.calls.filter(method=>method==='PUT').length,0);
});

test('fix1 arbitrary failed legacy events cannot resolve an earlier unknown',async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),p=await approved(f);
  await f.writer.updatePlan(p.planId,{status:'unknown_outcome'});
  for(const [phase,status] of [['execute','unknown_outcome'],['execute','failed'],['reconcile','failed'],['execute','not_applied']])await f.writer.addAttempt({attempt_id:randomUUID(),plan_id:p.planId,phase,status,created_at:iso(at)});
  await f.circuit.projectOutcome('1001');
  const state=await f.circuit.repository.getState({customerId:'1001'});
  assert.equal(state.unknownCount,1);
  await assert.rejects(f.circuit.recoverRule({customerId:'1001',policyId:f.policy.policyId,expectedRevision:1,reason:'cannot clear unknown',confirmation:'RECOVER_SEARCHAD_KNOWN_FAILURES'},f.context),{code:'SEARCHAD_CIRCUIT_RECOVERY_UNRESOLVED'});
});

for(const failure of ['begin','before-commit','after-commit','rollback-failure','settlement-failure'])test(`fix1 max1 pool releases failed claim before settlement: ${failure}`,async t=>{
  if(!native(t))return;
  const {createPostgresPool}=await import('../src/infrastructure/postgres/pool.js');
  const f=await automationFixture(t),run=await f.service.evaluate({customerId:'1001',policyId:f.policy.policyId},f.context),prepared=await f.service.prepare({customerId:'1001',runId:run.runId},f.context);
  await f.runtime.approvalService.approve(prepared.planId,{actor:'executor',confirmation:'APPROVE_SEARCHAD_CHANGE'});
  const approval=(await f.pool.query('SELECT * FROM searchad_write_approvals WHERE plan_id=$1',[prepared.planId])).rows[0];
  const small=createPostgresPool({connectionString:f.databaseUrl,max:1,sslMode:'disable',logger:{error(){}}});
  const primary=new Error(`injected ${failure}`),held=new Set(),trace=[],discards=[];let acquisitions=0,injected=false,timer;
  const pool={query:small.query.bind(small),async connect(){
    const client=await small.connect(),index=++acquisitions;trace.push(`acquire:${index}`);
    let released=false;
    const wrapped={release(discard){if(released)return;released=true;held.delete(wrapped);trace.push(`release:${index}`);if(index===2)discards.push(Boolean(discard));client.release(discard);},async query(sql,args){
      if(index===2 && failure==='rollback-failure' && sql==='ROLLBACK')throw new Error('secondary rollback failure');
      if(index===3 && failure==='settlement-failure' && sql==='BEGIN')throw new Error('secondary retirement failure');
      if(index===2 && !injected && (['begin','rollback-failure','settlement-failure'].includes(failure)?sql==='BEGIN':sql==='COMMIT')){
        injected=true;
        if(['after-commit','rollback-failure'].includes(failure))await client.query(sql,args);
        throw primary;
      }
      return client.query(sql,args);
    }};held.add(wrapped);return wrapped;
  }};
  f.runtime.repository.pool=pool;f.runtime.repository.automation.pool=pool;
  try {
    const operation=f.runtime.repository.claimApproval({planId:prepared.planId,tokenHash:approval.token_hash,now:iso(at)}).then(value=>({type:'fulfilled',value}),error=>({type:'rejected',error}));
    const result=await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(()=>resolve({type:'deadline'}),2000);})]);
    clearTimeout(timer);
    if(result.type==='deadline'){
      // Cleanup only: release the rolled-back client so the failing test can drain.
      // The deadline remains an assertion failure, never a successful fallback.
      for(const client of [...held])client.release(new Error('watchdog test cleanup'));
      await operation;
    }
    assert.equal(result.type,'rejected',`claim deadlocked at max1: ${trace.join(',')}`);
    assert.equal(result.error,primary,'best-effort settlement must preserve the original error');
    assert.ok(trace.indexOf('release:2')<trace.indexOf('acquire:3'));
    assert.deepEqual(discards,[failure==='rollback-failure']);
    assert.equal((await small.query('SELECT 1 AS available')).rows[0].available,1);
    assert.equal((await f.service.getRun({customerId:'1001',runId:run.runId},f.context)).state,failure==='settlement-failure'?'claim_pending':'manual_review');
    const committed=failure==='after-commit';
    assert.equal((await small.query('SELECT count(*)::int AS n FROM searchad_write_execution_claims')).rows[0].n,Number(committed));
    assert.equal(Boolean((await small.query('SELECT used_at FROM searchad_write_approvals WHERE approval_id=$1',[approval.approval_id])).rows[0].used_at),committed);
    assert.equal((await small.query('SELECT state FROM searchad_automation_reservations WHERE run_id=$1',[run.runId])).rows[0].state,committed?'consumed':'reserved');
    assert.equal(f.calls.filter(method=>method==='PUT').length,0);
  } finally {clearTimeout(timer);for(const client of [...held])client.release(new Error('test cleanup'));await small.end();}
});

for(const after of [false,true])test(`fix1 current insert acknowledgment loss ${after?'after':'before'} persistence cannot select nonexistent authority`,async t=>{
  if(!native(t))return;
  const f=await automationFixture(t),append=f.repository.appendCurrent.bind(f.repository);
  f.repository.appendCurrent=async row=>{if(after)await append(row);throw new Error('injected current observation persistence error');};
  const input={customerId:'1001',policyId:f.policy.policyId};
  const failed=await f.service.evaluate(input,f.context);
  assert.equal(failed.state,'blocked');assert.equal(failed.decision.selected.current,null);
  assert.ok(failed.decision.reasons.includes('CURRENT_VALUE_UNAVAILABLE'));
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_automation_current_observations')).rows[0].n,Number(after));
  await assert.rejects(f.service.prepare({customerId:'1001',runId:failed.runId},f.context));
  f.repository.appendCurrent=append;
  const recovered=await f.service.evaluate(input,f.context),repeat=await f.service.evaluate(input,f.context);
  assert.equal(recovered.state,'ready');assert.equal(recovered.runId,repeat.runId);
  const prepared=await f.service.prepare({customerId:'1001',runId:recovered.runId},f.context);
  assert.equal((await f.service.prepare({customerId:'1001',runId:repeat.runId},f.context)).planId,prepared.planId);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,1);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_approvals')).rows[0].n,0);
});
