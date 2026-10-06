import { contentHash } from '../write/canonical.js';
import { decimal } from './calculator.js';
import { CAMPAIGN_WRITE } from '../automation/recipes.js';
export const RULE_VERSION='profit-recommendations-v1';
export function deterministicId(value){const h=contentHash(value);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export function recommend(input,{now=Date.now()}={}){
  const reasons=[];
  const observed=Date.parse(input.asOf),expires=Number.isFinite(observed)?observed+86400000:0;
  if(!Number.isFinite(observed)||observed>now||now>expires||input.stale===true)reasons.push('PROFIT_EVIDENCE_STALE');
  if(input.quality!=='actual')reasons.push('ACTUAL_PROFIT_REQUIRED');
  if((decimal(input.metrics?.conversions)??0n)<30000n)reasons.push('SPARSE_CONVERSIONS');
  if(input.mappingVerified!==true)reasons.push('MAPPING_UNCERTAIN');
  if(input.allocationVerified!==true)reasons.push('SPEND_UNALLOCATED');
  const tools=input.tools||{};
  const currentBudget=decimal(input.campaign?.dailyBudget);
  const budgetPatch=!reasons.length&&currentBudget!==null&&currentBudget>0n&&currentBudget<=1000000000n&&currentBudget%10000n===0n&&tools.bidEstimate?.status==='available'&&tools.bidEstimate?.verified===true&&input.balanceVerified===true&&decimal(input.metrics?.contributionKrw)>0n?{dailyBudget:Number((currentBudget*120n/100n)/10000n>100000n?100000n:(currentBudget*120n/100n)/10000n)}:null;
  const proposals=[
    ['keyword',null,['KEYWORD_CREATE_MAPPING_UNSUPPORTED',...(tools.keywordIdeas?.status==='available'?[]:[tools.keywordIdeas?.reason||'KEYWORD_READ_UNAVAILABLE'])],'Review related keyword ideas',null,null],
    ['search-term',null,['SEARCH_TERM_MUTATION_MAPPING_UNSUPPORTED',...(input.searchTerms?.length?[]:['SEARCH_TERM_EVIDENCE_MISSING'])],'Review collected search terms',null,null],
    ['bid-estimate',null,['BID_MUTATION_MAPPING_UNSUPPORTED',tools.bidEstimate?.reason||'ESTIMATE_READ_CAPABILITY_UNAVAILABLE'],'Review bid estimate capability',null,null],
    ['budget',budgetPatch,[...reasons,...(input.campaign?[]:['CURRENT_CAMPAIGN_UNAVAILABLE']),...(tools.bidEstimate?.status==='available'&&tools.bidEstimate?.verified===true?[]:['VERIFIED_ESTIMATE_REQUIRED']),...(input.balanceVerified?[]:['VERIFIED_BALANCE_REQUIRED'])],'Budget increase requires complete actual profit and current account evidence',CAMPAIGN_WRITE,'campaign.dailyBudget'],
    ['negative',null,['NEGATIVE_MUTATION_MAPPING_UNSUPPORTED'],'Review wasteful search terms before manual negative-keyword action',null,null],
    ['stop',input.campaign&&decimal(input.metrics?.contributionKrw)<0n&&input.quality==='actual'?{userLock:true}:null,[...(input.campaign?[]:['CURRENT_CAMPAIGN_UNAVAILABLE']),...(input.quality==='actual'?[]:['ACTUAL_PROFIT_REQUIRED'])],'Consider campaign stop only after verified losses',CAMPAIGN_WRITE,'campaign.userLock']
  ];
  return proposals.map(([category,patch,blocked,reason,operationKey,validator])=>{
    const blockedReasons=[...new Set([...blocked,'TASK9_READ_ONLY'])].sort();
    const key={customerId:input.customerId,haarProductId:input.haarProductId,ruleVersion:RULE_VERSION,inputHash:input.inputHash,category,patch,blockedReasons,toolsHash:contentHash(tools)};
    return {recommendationId:deterministicId(key),decisionKey:contentHash(key),...key,reason,confidence:reasons.length?'low':'medium',expiresAt:new Date(expires).toISOString(),operationKey,validator,capability:category==='keyword'?'rel_kwd_stat.read':operationKey?'campaign.update':null,activationConstraints:['exact_current_customer_entity_identity','existing_change_plan_approval_execution_verification','current_field_activation','circuit_and_account_fence'],executable:false,liveVerified:false,outcomeVerified:false,...(category==='keyword'?{ideas:tools.keywordIdeas?.ideas||[]}:{}),...(category==='search-term'?{terms:input.searchTerms||[]}:{} )};
  });
}
