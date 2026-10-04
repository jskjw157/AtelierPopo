import { SearchAdWriteError } from '../write/errors.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
/** @typedef {() => number} Clock Epoch milliseconds, injected into policy checks. */
/** @typedef {{customerId:string,specSha:string,credentialFingerprint:string,upstreamBaseUrl:string}} Identity */
/** @typedef {{principal:{principalId:string,role:string,customerIds:string[]},requestId:string}} ScopeContext */
export const ENTITY_TYPES = Object.freeze(['campaign', 'adgroup', 'keyword', 'creative', 'criterion']);
export function reportingError(code, status = 400) {
  return new SearchAdWriteError(code, 'SearchAd reporting request could not be completed.', {}, status);
}
export function exactKeys(value, keys, code = 'SEARCHAD_STATS_INPUT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw reportingError(code);
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
export function scopedCustomer(value) {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw reportingError('SEARCHAD_STATS_INPUT_INVALID');
  return value;
}
export function validateStatsInput(input) {
  exactKeys(input, ['customerId', 'entityType', 'entityId', 'since', 'until']);
  scopedCustomer(input.customerId);
  if (!ENTITY_TYPES.includes(input.entityType) || typeof input.entityId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.entityId) || !validDate(input.since) || !validDate(input.until) || input.since > input.until) throw reportingError('SEARCHAD_STATS_INPUT_INVALID');
  return { customerId: input.customerId, entityType: input.entityType, entityId: input.entityId, since: input.since, until: input.until };
}
export function assertReportingScope(customerId, context) {
  if (!context?.principal?.principalId || !context.principal.customerIds?.includes(customerId)) throw reportingError('SEARCHAD_CUSTOMER_FORBIDDEN', 403);
  if (!['operator', 'executor', 'admin'].includes(context.principal.role)) throw reportingError('SEARCHAD_REPORTING_ROLE_FORBIDDEN', 403);
  if (typeof context.requestId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(context.requestId)) throw reportingError('SEARCHAD_REPORTING_CONTEXT_INVALID');
}
export function validateIdentity(identity, customerId) {
  if (identity?.customerId !== customerId || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(identity.specSha || '') || !/^[a-f0-9]{64}$/.test(identity.credentialFingerprint || '') || identity.upstreamBaseUrl !== 'https://api.searchad.naver.com') throw reportingError('SEARCHAD_REPORTING_IDENTITY_INVALID', 503);
  return { customerId, specSha: identity.specSha, credentialFingerprint: identity.credentialFingerprint, upstreamBaseUrl: identity.upstreamBaseUrl };
}
export function currentReportingIdentity({ customerId, registry, credentialsRegistry, config }) {
  try { return validateIdentity({ customerId, specSha: registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(credentialsRegistry, customerId), upstreamBaseUrl: config.baseUrl }, customerId); }
  catch { throw reportingError('SEARCHAD_REPORTING_IDENTITY_INVALID', 503); }
}
export function strictDecimal(value, { integer = false } = {}) {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(value)))) throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
  if (typeof value !== 'string' && typeof value !== 'number') throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
  const text = String(value);
  if (!(integer ? /^(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)(\.\d+)?$/).test(text) || text.length > 100) throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
  return text;
}
export function cycleTimestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{12}$/.test(value)) throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const hour = Number(value.slice(8, 10)), minute = Number(value.slice(10, 12));
  const timestamp = Date.parse(`${date}T${value.slice(8, 10)}:${value.slice(10, 12)}:00+09:00`);
  if (!validDate(date) || hour > 23 || minute > 59 || !Number.isFinite(timestamp) || timestamp > now) throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
  return new Date(timestamp).toISOString();
}
export function publicObservation(row) {
  if (!row) return null;
  const { observationId, customerId, entityType, entityId, since, until, observedAt, cycleBaseTm, cycleAt, quality, metrics, missingMetrics, rangeBasis, entityTypeBasis, responseSha } = row;
  return { observationId, customerId, entityType, entityId, since, until, observedAt, cycleBaseTm, cycleAt, quality, metrics, missingMetrics, rangeBasis, entityTypeBasis, responseSha };
}
