import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePolicy,decisionIdentity } from '../src/naver/searchad/automation/policy.js';
import { buildRecipe,normalizeCurrent } from '../src/naver/searchad/automation/recipes.js';
import { AutomationService } from '../src/naver/searchad/automation/service.js';
import { searchAdCompletionOpenApi } from '../src/http/openapi-searchad-completion.js';
const policy={customerId:'1001',entityType:'campaign',entityId:'c1',recipe:{kind:'campaign_user_lock',userLock:true},reason:'review'};
test('policy defaults observe disabled and rejects auto unlock raw descriptors and relaxed freshness',()=>{
  assert.equal(validatePolicy(policy).mode,'observe');assert.equal(validatePolicy(policy).enabled,false);
  for(const patch of [{mode:'auto'},{mode:'limited_auto'},{enabled:'true'},{maxCurrentAgeMs:1800001},{recipe:{kind:'campaign_user_lock',userLock:false}},{recipe:{kind:'campaign_user_lock',userLock:true,operationKey:'override'}},{mutation:{}}])assert.throws(()=>validatePolicy({...policy,...patch}),{status:400});
});
test('same canonical selected inputs retain their decision key without pretending cached data was freshly observed',()=>{
  const p={...policy,policyId:'00000000-0000-0000-0000-000000000001',revision:1};
  const selected={identity:{customerId:'1001'},current:{snapshotHash:'original',observedAt:100},stats:{responseSha:'stats'}};
  const first=decisionIdentity(p,selected,'2026-10-05T03:00:00.000Z');
  assert.equal(decisionIdentity(p,{...selected,current:{snapshotHash:'original',observedAt:200}},'2026-10-05T03:00:00.000Z').decisionKey,first.decisionKey);
  assert.notEqual(decisionIdentity({...p,revision:2},selected,'2026-10-05T03:00:00.000Z').decisionKey,first.decisionKey);
  assert.notEqual(decisionIdentity(p,{...selected,current:{snapshotHash:'changed'}},'2026-10-05T03:00:00.000Z').decisionKey,first.decisionKey);
});
test('recipes keep exact original current values and conservatively enforce integer budget bounds',()=>{
  const current={normalized:{dailyBudgetKrw:1000,userLock:false}};
  const p={...policy,recipe:{kind:'campaign_budget',dailyBudgetKrw:800}};
  const recipe=buildRecipe(p,current);assert.deepEqual(recipe.reasons,[]);assert.equal(recipe.input.mutation.query.fields,'budget');assert.deepEqual(recipe.input.mutation.body,{nccCampaignId:'c1',dailyBudget:800});
  assert.deepEqual(buildRecipe({...p,recipe:{kind:'campaign_budget',dailyBudgetKrw:799}},current).reasons,['RECIPE_BOUNDS']);
  assert.throws(()=>normalizeCurrent({nccCampaignId:'other',dailyBudget:1000,userLock:false},'c1'));
  for(const dailyBudget of [null,'1000',1.2,-1,NaN])assert.throws(()=>normalizeCurrent({nccCampaignId:'c1',dailyBudget,userLock:false},'c1'));
});
test('payload cannot select evidence current value or internal approval authority before touching suppliers',async()=>{
  const service=new AutomationService({}),context={principal:{principalId:'operator',role:'operator',customerIds:['1001']}};
  for(const key of ['evidence','evidenceId','currentValue','planId','ruleId','reservationId','purpose','executionToken'])await assert.rejects(service.evaluate({customerId:'1001',policyId:'00000000-0000-0000-0000-000000000001',[key]:'forged'},context),{code:'SEARCHAD_AUTOMATION_INPUT'});
});
test('role OpenAPI exposes complete automation inputs and explicit recovery without auto or token persistence contracts',()=>{
  const reader=searchAdCompletionOpenApi({role:'reader'}),operator=searchAdCompletionOpenApi({role:'operator'}),executor=searchAdCompletionOpenApi({role:'executor'}),admin=searchAdCompletionOpenApi({role:'admin'});
  assert.ok(reader.paths['/api/v1/searchad/automation/runs/{runId}']?.get);
  assert.equal(reader.paths['/api/v1/searchad/automation/evaluate'],undefined);
  assert.ok(operator.paths['/api/v1/searchad/automation/runs/{runId}/prepare']?.post);
  assert.equal(operator.paths['/api/v1/searchad/automation/runs/{runId}/execute-approved'],undefined);
  assert.ok(executor.paths['/api/v1/searchad/automation/runs/{runId}/execute-approved']?.post);
  const schema=admin.paths['/api/v1/searchad/automation/policies']?.post?.requestBody.content['application/json'].schema;
  assert.equal(schema?.additionalProperties,false);assert.deepEqual(schema.properties.mode.enum,['observe','recommend','approve']);
  assert.ok(admin.paths['/api/v1/searchad/circuit/recover-rule']?.post);
  const body=operator.paths['/api/v1/searchad/automation/evaluate'].post.requestBody.content['application/json'].schema;
  assert.deepEqual(Object.keys(body.properties).sort(),['customerId','policyId','slotAt']);
});

test('fix1 current observation persistence failure cannot produce a ready decision',async()=>{
  const currentPolicy={...validatePolicy({...policy,mode:'approve',enabled:true}),policyId:'00000000-0000-0000-0000-000000000001',revision:1,ruleId:'rule'};
  const identity={customerId:'1001'},context={principal:{principalId:'operator',role:'operator',customerIds:['1001']}};
  const service=new AutomationService({
    repository:{async findPolicy(){return currentPolicy;},async appendCurrent(){throw new Error('injected storage failure');},async createDecisionOnce(input){return input;}},
    evidenceSelector:{async select(){return {stats:{responseSha:'fixture'}};}},
    circuit:{async evaluate(){return {allowed:true,reasons:[]};}},
    getWriteRuntime:()=>({remote:{async read(){return {value:{nccCampaignId:'c1',dailyBudget:1000,userLock:false}};}}}),
    identityResolver:()=>identity,clock:()=>Date.parse('2026-10-05T03:00:00Z')
  });
  const result=await service.evaluate({customerId:'1001',policyId:currentPolicy.policyId},context);
  assert.equal(result.state,'blocked');assert.equal(result.decision.allowed,false);
  assert.equal(result.decision.selected.current,null);
  assert.ok(result.decision.reasons.includes('CURRENT_VALUE_UNAVAILABLE'));
});
