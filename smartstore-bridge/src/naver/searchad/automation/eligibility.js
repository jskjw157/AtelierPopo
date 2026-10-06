import { contentHash } from '../write/canonical.js';
import { hasProvenCollectionSlot, isGenerationFresh } from '../reporting/spend-evidence-service.js';
import { CAMPAIGN_WRITE } from './recipes.js';
export const AUTO_CAPS=Object.freeze({maxChangePercent:20,maxDailyBudgetKrw:100000,maxIncrementalSpendKrw:30000,maxDailyOperations:200});
const DAY=86400000;
const time=v=>typeof v==='number'?v:typeof v==='string'?Date.parse(v):NaN;
const fresh=(v,age,now)=>Number.isFinite(time(v))&&time(v)<=now&&now-time(v)<=age;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)?BigInt(v):Number.isSafeInteger(v)&&v>=0?BigInt(v):null;
const signedInteger=v=>typeof v==='string'&&/^-?(0|[1-9][0-9]*)$/.test(v)?BigInt(v):Number.isSafeInteger(v)?BigInt(v):null;
export function autoWindow(now) {
  const day=new Date(now+9*3600000).toISOString().slice(0,10),start=Date.parse(`${day}T00:00:00+09:00`);
  return {since:new Date(start-9*DAY+9*3600000).toISOString().slice(0,10),until:new Date(start-3*DAY+9*3600000).toISOString().slice(0,10)};
}
export function delegationValid(policy,now) {
  const d=policy?.delegation,field=policy?.recipe?.kind==='campaign_budget'?'campaign.dailyBudget':'campaign.userLock';
  return Boolean(d&&d.customerId===policy.customerId&&d.policyRevision===policy.revision&&typeof d.authorizedByPrincipalId==='string'&&d.authorizedByPrincipalId.length>0&&fresh(d.authorizedAt,Infinity,now)&&time(d.expiresAt)>now&&Array.isArray(d.operationKeys)&&d.operationKeys.length===1&&d.operationKeys[0]===CAMPAIGN_WRITE&&Array.isArray(d.fieldScope)&&d.fieldScope.length===1&&d.fieldScope[0]===field&&Object.entries(AUTO_CAPS).every(([key,max])=>Number.isSafeInteger(d[key])&&d[key]>0&&d[key]<=max));
}
/** Pure analysis of trusted source facts. This result is never an approval, token,
 * activation grant, lease or send permit. Consumers reselect under the send fence. */
export function evaluateAutoEligibility({policy={},evidence={},profitability,mapping,history={},capability={},now}) {
  const reasons=[],deny=code=>reasons.push(code);
  if(!Number.isFinite(now))return {eligible:false,reasons:['CLOCK_UNAVAILABLE'],allowedPatch:null};
  if(policy.mode!=='limited_auto')deny('AUTO_MODE_REQUIRED');
  if(!policy.enabled)deny('POLICY_DISABLED');
  if(capability.automationEnabled!==true)deny('AUTOMATION_GATE_OFF');
  if(!delegationValid(policy,now))deny('DELEGATION_UNAVAILABLE');
  const recipe=policy.recipe,kind=recipe?.kind,prior=evidence.current?.normalized;
  let patch=null,increase=false;
  if(policy.entityType!=='campaign'||!prior||!fresh(evidence.current?.observedAt,Math.min(policy.maxCurrentAgeMs||1800000,1800000),now))deny('CURRENT_VALUE_UNAVAILABLE');
  else if(kind==='campaign_user_lock'&&recipe.userLock===true&&prior.userLock===false)patch={userLock:true};
  else if(kind==='campaign_budget'&&Number.isSafeInteger(recipe.dailyBudgetKrw)&&recipe.dailyBudgetKrw>=0&&Number.isSafeInteger(prior.dailyBudgetKrw)&&prior.dailyBudgetKrw>0){
    const before=BigInt(prior.dailyBudgetKrw),after=BigInt(recipe.dailyBudgetKrw),delta=after>before?after-before:before-after;
    increase=after>before;
    if(delta===0n)deny('NO_CHANGE');
    if(delta*100n>before*BigInt(policy.delegation?.maxChangePercent||20)||after>BigInt(policy.delegation?.maxDailyBudgetKrw||100000)||after>100000n||delta*100n>before*20n)deny('RECIPE_BOUNDS');
    patch={dailyBudget:recipe.dailyBudgetKrw};
  }else deny('UNSUPPORTED_AUTO_RECIPE');
  if(!mapping?.current||mapping.customerId!==policy.customerId||mapping.entityType!=='campaign'||mapping.entityId!==policy.entityId||!Array.isArray(mapping.bindingIds)||!mapping.bindingIds.length||!hash(mapping.sourceHash)||!/^(0\.[0-9]+|1(?:\.0+)?)$/.test(String(mapping.confidence))||Number(mapping.confidence)<0.90)deny('MAPPING_UNAVAILABLE');
  if(!evidence.identity||evidence.identity.customerId!==policy.customerId||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(evidence.identity.specSha||'')||!hash(evidence.identity.credentialFingerprint)||evidence.identity.upstreamBaseUrl!=='https://api.searchad.naver.com')deny('IDENTITY_UNAVAILABLE');
  if(!fresh(evidence.stats?.observedAt,1800000,now)||!fresh(evidence.stats?.cycleAt,1800000,now))deny('STATS_STALE');
  if(evidence.spend?.quality!=='stabilized_by_policy'||!fresh(evidence.spend?.generation_lower,DAY,now))deny('STABILIZED_SPEND_UNAVAILABLE');
  for(const name of ['productState','orderLines']){
    const rows=evidence.commerce?.filter(o=>o.capability===name)||[];
    if(!rows.length||rows.some(o=>o.complete!==true||o.missingReasons?.length||!fresh(o.observedAt,900000,now)||!Array.isArray(o.rows)||(name==='productState'&&!o.rows.length)))deny('STOCK_SALES_UNAVAILABLE');
  }
  if(!profitability||profitability.quality!=='actual'||profitability.missingReasons?.length||profitability.mappingVerified!==true||profitability.allocationVerified!==true||integer(profitability.unallocatedSpendKrw)!==0n||signedInteger(profitability.metrics?.contributionKrw)===null||!hash(profitability.inputHash)||!fresh(profitability.asOf,DAY,now))deny('PROFITABILITY_UNAVAILABLE');
  const range=autoWindow(now),start=Date.parse(`${range.since}T00:00:00+09:00`),generations=history.generations||[];
  for(let i=0;i<7;i++){
    const date=new Date(start+i*DAY+9*3600000).toISOString().slice(0,10),rows=generations.filter(g=>g.statDate===date&&g.reportType==='AD');
    const g=rows[0];
    if(rows.length!==1||!g.ingestionId||!hash(g.generationSha)||!hash(g.schemaSha)||!Number.isSafeInteger(g.rowCount)||g.rowCount<1||!Number.isSafeInteger(g.entityRowCount)||g.entityRowCount<1||g.entityRowCount>g.rowCount||g.quality!=='stabilized_by_policy'||g.generationWindow?.stableAge!==true||g.generationWindow.policy?.version!=='generation-window-v1'||!hasProvenCollectionSlot(g.generationWindow,date)||g.generationWindow.slot<3||!isGenerationFresh(g.generationWindow,now,DAY))deny('SEVEN_COMPLETE_KST_DAYS_REQUIRED');
  }
  if(history.manualHold||history.unresolved||time(history.cooldownUntil)>now||history.circuitReasons?.length)deny('AUTOMATION_HOLD');
  if(increase){
    if(signedInteger(profitability?.metrics?.contributionKrw)===null||signedInteger(profitability.metrics.contributionKrw)<=0n)deny('PROFITABILITY_INCREASE_UNAVAILABLE');
    if(integer(evidence.stats?.metrics?.conversions)===null||integer(evidence.stats.metrics.conversions)<3n)deny('CONVERSIONS_INSUFFICIENT');
    const estimate=capability.estimate,balance=capability.balance;
    if(![estimate,balance].every(v=>v?.verified===true&&fresh(v.observedAt,1800000,now)&&contentHash(v.identity)===contentHash(evidence.identity))||integer(balance?.availableKrw)===null||integer(balance.availableKrw)<BigInt(recipe.dailyBudgetKrw-prior.dailyBudgetKrw))deny('ESTIMATE_BALANCE_UNAVAILABLE');
  }
  return {eligible:reasons.length===0,reasons:[...new Set(reasons)],allowedPatch:reasons.length?null:patch};
}
