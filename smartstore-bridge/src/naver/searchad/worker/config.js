import { SearchAdWriteError } from '../write/errors.js';
import { ENTITY_TYPES } from '../reporting/contracts.js';
import { REPORT_TYPES } from '../reporting/operations.js';
export const KINDS = ['collect_stats','register_stat_report','collect_report_generation','evaluate_automation','reconcile_automation'];
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value);
export function workerError(code='INPUT', status=400) { return new SearchAdWriteError(`SEARCHAD_WORKER_${code}`, 'SearchAd worker request is unavailable or denied.', {}, status); }
export function exact(value,keys) { if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key)))throw workerError(); }
export function loadWorkerConfig(env={}) {
  const raw=env.ATELIER_SEARCHAD_WORKER_ENABLED;
  if(raw!==undefined && !['true','false',''].includes(raw))throw workerError('CONFIG',503);
  const enabled=raw==='true', customerIds=String(env.ATELIER_SEARCHAD_WORKER_CUSTOMERS || '').split(',').map(v=>v.trim()).filter(Boolean);
  const principalId=env.ATELIER_SEARCHAD_WORKER_PRINCIPAL_ID;
  if(enabled && (!env.DATABASE_URL || !identifier(principalId) || !customerIds.length || customerIds.some(id=>!/^\d{1,30}$/.test(id))))throw workerError('CONFIG',503);
  return Object.freeze({enabled,principal:Object.freeze({principalId,role:'executor',customerIds:Object.freeze([...new Set(customerIds)])}),leaseMs:30000,pollMs:1000,retryMs:60000});
}
export function validateSchedule(input) {
  exact(input,['customerId','scheduleId','kind','payload','enabled','startAt']);
  if(typeof input.customerId!=='string' || !/^\d{1,30}$/.test(input.customerId) || !identifier(input.scheduleId) || !KINDS.includes(input.kind) || (input.enabled!==undefined && typeof input.enabled!=='boolean'))throw workerError();
  const p=input.payload;
  if(input.kind==='collect_stats') { exact(p,['entityType','entityId']); if(!ENTITY_TYPES.includes(p.entityType) || typeof p.entityId!=='string' || !/^[A-Za-z0-9_-]{1,200}$/.test(p.entityId))throw workerError(); }
  if(input.kind==='register_stat_report') { exact(p,['reportType']);if(!REPORT_TYPES.stat.includes(p.reportType) || p.reportType==='NAVERPAY_CONVERSION')throw workerError(); }
  for(const [kind,key] of [['evaluate_automation','policyId'],['reconcile_automation','runId'],['collect_report_generation','reportJobId']])if(input.kind===kind){exact(p,[key]);if(!UUID.test(p[key] || ''))throw workerError();}
  if(input.startAt!==undefined && (typeof input.startAt!=='string' || !Number.isFinite(Date.parse(input.startAt)) || new Date(input.startAt).toISOString()!==input.startAt))throw workerError();
  return {...input,payload:structuredClone(p),enabled:input.enabled ?? false};
}
export function publicJob(row) {
  const {jobId,customerId,scheduleId,slotAt,kind,state,leaseGeneration,attempts,result,createdAt,updatedAt}=row;
  return {jobId,customerId,scheduleId,slotAt,kind,state,leaseGeneration,attempts,result,createdAt,updatedAt};
}
// Only fixed codes and local identifiers are allowed in persisted outcomes.
export function safeResult(value={}) {
  const result={};
  for(const key of ['runId','reportJobId','observationId'])if(UUID.test(value?.[key] || ''))result[key]=value[key];
  if(['SOURCE_UNRESOLVED','STALE_SLOT','ATTEMPTS_EXHAUSTED','SERVICE_UNAVAILABLE','SHUTDOWN','LEASE_LOST','SOURCE_LINKED','COLLECTED','PENDING','COMPLETE'].includes(value?.code))result.code=value.code;
  if(Number.isInteger(value?.count) && value.count>=0 && value.count<=3)result.count=value.count;
  return result;
}
