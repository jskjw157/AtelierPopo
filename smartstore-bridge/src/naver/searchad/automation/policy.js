import { contentHash } from '../write/canonical.js';
import { SearchAdWriteError } from '../write/errors.js';
import { AUTO_CAPS } from './eligibility.js';
import { CAMPAIGN_WRITE } from './recipes.js';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function automationError(code, status = 409) { return new SearchAdWriteError(`SEARCHAD_AUTOMATION_${code}`, 'SearchAd automation request is unavailable or denied.', {}, status); }
export function exact(input, keys) { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw automationError('INPUT',400); }
export function authorize(customerId, context, role = 'reader') {
  const ranks = { reader:0, operator:1, executor:2, admin:3 }, principal=context?.principal;
  if (!/^\d{1,30}$/.test(customerId || '') || !principal?.principalId || !principal.customerIds?.includes(customerId) || !(principal.role in ranks) || ranks[principal.role] < ranks[role]) throw automationError('FORBIDDEN',403);
  return principal.principalId;
}
export function validatePolicy(input) {
  exact(input,['customerId','policyId','expectedRevision','entityType','entityId','mode','enabled','recipe','maxCurrentAgeMs','reason','delegation']);
  const mode=input.mode ?? 'observe', enabled=input.enabled ?? false, maxCurrentAgeMs=input.maxCurrentAgeMs ?? 1800000;
  if (!['observe','recommend','approve','limited_auto'].includes(mode) || typeof enabled !== 'boolean' || input.entityType !== 'campaign' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.entityId || '') || (input.policyId !== undefined && !UUID.test(input.policyId)) || (input.policyId ? !Number.isInteger(input.expectedRevision) || input.expectedRevision<1 : input.expectedRevision !== undefined) || !Number.isSafeInteger(maxCurrentAgeMs) || maxCurrentAgeMs<1 || maxCurrentAgeMs>1800000 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length>500) throw automationError('INPUT',400);
  const recipe=input.recipe;
  if (recipe?.kind === 'campaign_user_lock') { exact(recipe,['kind','userLock']); if (recipe.userLock !== true) throw automationError('RECIPE',400); }
  else if (recipe?.kind === 'campaign_budget') { exact(recipe,['kind','dailyBudgetKrw']); if (!Number.isSafeInteger(recipe.dailyBudgetKrw) || recipe.dailyBudgetKrw<0 || recipe.dailyBudgetKrw>100000) throw automationError('RECIPE',400); }
  else throw automationError('RECIPE',400);
  if(mode==='limited_auto') {
    const d=input.delegation;exact(d,['expiresAt','operationKeys','fieldScope',...Object.keys(AUTO_CAPS)]);
    const field=recipe.kind==='campaign_budget'?'campaign.dailyBudget':'campaign.userLock';
    if(typeof d.expiresAt!=='string'||!Number.isFinite(Date.parse(d.expiresAt))||new Date(d.expiresAt).toISOString()!==d.expiresAt||JSON.stringify(d.operationKeys)!==JSON.stringify([CAMPAIGN_WRITE])||JSON.stringify(d.fieldScope)!==JSON.stringify([field])||Object.entries(AUTO_CAPS).some(([k,max])=>!Number.isSafeInteger(d[k])||d[k]<1||d[k]>max))throw automationError('DELEGATION',400);
  }else if(input.delegation!==undefined)throw automationError('DELEGATION',400);
  return { ...input, mode, enabled, maxCurrentAgeMs, recipe:structuredClone(recipe), reason:input.reason.trim() };
}
export function logicalSlot(slotAt, now) {
  const value=slotAt === undefined ? Math.floor(now/3600000)*3600000 : Date.parse(slotAt);
  if (!Number.isFinite(value) || value>now || value%3600000 !== 0 || (slotAt !== undefined && new Date(value).toISOString() !== slotAt)) throw automationError('INPUT',400);
  return new Date(value).toISOString();
}
export function decisionIdentity(policy, selected, slotAt) {
  // Repeated acknowledged GETs may have different immutable record IDs, while
  // the selected value remains identical. Its content hash already binds it.
  const auto=selected.auto?{...selected.auto,evidence:{...selected.auto.evidence,current:undefined}}:null;
  const inputs={ identity:selected.identity, currentHash:selected.current?.snapshotHash ?? null, statsHash:selected.stats?.responseSha ?? null, spendHash:selected.spend?.evidence_id ?? null, ...(auto?{autoHash:contentHash(auto)}:{}) };
  const inputHash=contentHash(inputs);
  return { inputHash, decisionKey:contentHash({ customerId:policy.customerId, policyId:policy.policyId, revision:policy.revision, entityType:policy.entityType, entityId:policy.entityId, inputHash, slotAt }) };
}
