import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAutoEligibility, autoWindow } from '../src/naver/searchad/automation/eligibility.js';
import { validatePolicy } from '../src/naver/searchad/automation/policy.js';
import { CAMPAIGN_WRITE } from '../src/naver/searchad/automation/recipes.js';

import { autoNow, autoFacts } from './helpers/searchad-limited-auto-fixture.js';
const iso=n=>new Date(n).toISOString();

test('synthetic complete source facts permit only a bounded patch and issue no permission',()=>{
  const value=autoFacts(),result=evaluateAutoEligibility(value);
  assert.deepEqual(result,{eligible:true,reasons:[],allowedPatch:{dailyBudget:800}});
  assert.deepEqual(autoWindow(autoNow),{since:'2026-09-26',until:'2026-10-02'});
  assert.deepEqual(value,autoFacts(),'pure evaluation must not mutate source facts');
});
test('default_observe_produces_zero_mutation',()=>{
  const value=autoFacts();value.policy=validatePolicy({customerId:'1001',entityType:'campaign',entityId:'cmp-1',recipe:{kind:'campaign_user_lock',userLock:true},reason:'observe'});
  const result=evaluateAutoEligibility(value);assert.equal(result.eligible,false);assert.equal(result.allowedPatch,null);assert.ok(result.reasons.includes('AUTO_MODE_REQUIRED'));
});
test('seven_elapsed_days_without_complete_observations_is_ineligible',()=>{
  for(const mutate of [v=>v.history.generations=[],v=>v.history.generations.pop(),v=>v.history.generations[0].statDate='2026-09-25',v=>v.history.generations[0].entityRowCount=0,v=>v.history.generations[0].schemaSha=null,v=>v.history.generations[0].generationWindow.slot=3,v=>v.history.generations[0].quality='provisional']){
    const value=autoFacts();mutate(value);const result=evaluateAutoEligibility(value);assert.equal(result.eligible,false);assert.ok(result.reasons.includes('SEVEN_COMPLETE_KST_DAYS_REQUIRED'));
  }
});
test('stale_stock_stats_profit_or_identity_blocks_auto',()=>{
  for(const mutate of [v=>v.evidence.commerce[0].observedAt=iso(autoNow-900001),v=>v.evidence.stats.cycleAt=iso(autoNow-1800001),v=>v.profitability.asOf=iso(autoNow-86400001),v=>v.mapping.current=false,v=>v.mapping.confidence='0.89',v=>v.profitability.quality='partial',v=>v.profitability.unallocatedSpendKrw='1',v=>v.evidence.spend=null,v=>v.capability.automationEnabled=false]){
    const value=autoFacts();mutate(value);assert.equal(evaluateAutoEligibility(value).eligible,false);
  }
});
test('manual_hold_circuit_and_cooldown_block_auto',()=>{
  for(const patch of [{manualHold:true},{circuitReasons:['MANUAL_PAUSED']},{cooldownUntil:autoNow+1},{unresolved:true}]){const value=autoFacts();Object.assign(value.history,patch);assert.equal(evaluateAutoEligibility(value).eligible,false);}
});
test('unsupported_bid_create_delete_unlock_cannot_execute',()=>{
  for(const recipe of [{kind:'bid',bid:10},{kind:'create'},{kind:'delete'},{kind:'campaign_user_lock',userLock:false},{kind:'campaign_budget',dailyBudgetKrw:799}]){const value=autoFacts();value.policy.recipe=recipe;assert.equal(evaluateAutoEligibility(value).eligible,false);}
});
test('missing_estimate_balance_blocks_increase even with synthetic actual profit',()=>{
  const value=autoFacts();value.policy.recipe.dailyBudgetKrw=1200;
  assert.ok(evaluateAutoEligibility(value).reasons.includes('ESTIMATE_BALANCE_UNAVAILABLE'));
  value.capability.estimate={verified:true,observedAt:iso(autoNow),identity:value.evidence.identity};value.capability.balance={verified:true,observedAt:iso(autoNow),identity:value.evidence.identity,availableKrw:'30000'};
  assert.equal(evaluateAutoEligibility(value).eligible,true);
  value.evidence.stats.metrics.conversions='2';assert.ok(evaluateAutoEligibility(value).reasons.includes('CONVERSIONS_INSUFFICIENT'));
});
test('delegation must be current revision bound and cannot loosen hard caps',()=>{
  for(const patch of [{customerId:'2002'},{policyRevision:2},{expiresAt:iso(autoNow)},{authorizedAt:iso(autoNow+1)},{fieldScope:['campaign.userLock']},{maxChangePercent:21},{maxDailyBudgetKrw:100001},{maxIncrementalSpendKrw:30001},{maxDailyOperations:201}]){const value=autoFacts();Object.assign(value.policy.delegation,patch);assert.equal(evaluateAutoEligibility(value).eligible,false);}
});
test('increase requires positive exact actual contribution while loss can still support reduction',()=>{
  const value=autoFacts();value.capability.estimate={verified:true,observedAt:iso(autoNow),identity:value.evidence.identity};value.capability.balance={verified:true,observedAt:iso(autoNow),identity:value.evidence.identity,availableKrw:'30000'};
  for(const amount of ['0','-1','invalid']){value.policy.recipe.dailyBudgetKrw=1200;value.profitability.metrics.contributionKrw=amount;assert.equal(evaluateAutoEligibility(value).eligible,false,amount);}
  value.policy.recipe.dailyBudgetKrw=800;value.profitability.metrics.contributionKrw='-1';assert.equal(evaluateAutoEligibility(value).eligible,true);
});
