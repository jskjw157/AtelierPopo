import { randomUUID } from 'node:crypto';
import { contentHash } from '../write/canonical.js';
import { automationError } from './policy.js';
export const CAMPAIGN_READ = 'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id';
export const CAMPAIGN_WRITE = 'ncc.put.modify_using_put_5__p_ncc_campaigns_campaign_id__q_fields';
export function normalizeCurrent(value, entityId) {
  if (!value || Array.isArray(value) || value.nccCampaignId !== entityId || !Number.isSafeInteger(value.dailyBudget) || value.dailyBudget<0 || typeof value.userLock !== 'boolean') throw automationError('CURRENT_VALUE_UNAVAILABLE');
  return { dailyBudgetKrw:value.dailyBudget, userLock:value.userLock };
}
export async function observeCurrent({ policy, runtime, identity, identityResolver, clock }) {
  const result=await runtime.remote.read({ customerId:policy.customerId, operationKey:CAMPAIGN_READ, pathParams:{campaignId:policy.entityId}, query:{} },{ customerId:policy.customerId });
  const normalized=normalizeCurrent(result.value,policy.entityId);
  if (contentHash(identity) !== contentHash(await identityResolver(policy.customerId))) throw automationError('IDENTITY_CHANGED');
  return { observationId:randomUUID(), customerId:policy.customerId, entityType:'campaign', entityId:policy.entityId, operationKey:CAMPAIGN_READ, ...identity, observedAt:clock(), sourceRequestId:result.raw?.upstream?.requestId || null, snapshotHash:contentHash(result.value), snapshot:structuredClone(result.value), normalized };
}
export function buildRecipe(policy,current) {
  if (!current) return { input:null, reasons:['CURRENT_VALUE_UNAVAILABLE'], actionClass:'mutation', incrementalSpendKrw:0 };
  const normalized=current.normalized, recipe=policy.recipe;
  let field,value;
  if (recipe.kind === 'campaign_user_lock') { field='userLock'; value=true; }
  else { field='dailyBudget'; value=recipe.dailyBudgetKrw; }
  const before=field==='dailyBudget'?normalized.dailyBudgetKrw:normalized.userLock;
  const reasons=[];
  if (before===value) reasons.push('NO_CHANGE');
  if (field==='dailyBudget' && (value>100000 || BigInt(Math.abs(value-before))*100n>BigInt(before)*20n)) reasons.push('RECIPE_BOUNDS');
  const pathParams={campaignId:policy.entityId}, query={fields:field==='dailyBudget'?'budget':field};
  const descriptor={operationKey:CAMPAIGN_WRITE,pathParams,query,body:{nccCampaignId:policy.entityId,[field]:value},confirmation:'UPDATE_AD_ENTITY'};
  return { reasons, actionClass:field==='dailyBudget'&&value>before?'increase':'mutation', incrementalSpendKrw:field==='dailyBudget'?Math.max(0,value-before):0, input:{ customerId:policy.customerId, reason:policy.reason, mutation:descriptor, verification:{read:{operationKey:CAMPAIGN_READ,pathParams},expectedPatch:{[field]:value}}, rollback:{mutation:{...descriptor,body:{nccCampaignId:policy.entityId,[field]:before}},expectedBefore:{[field]:before}} } };
}
