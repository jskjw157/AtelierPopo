import { createHash, randomUUID } from 'node:crypto';

import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_REPORTING_OPERATIONS, assertReportingOperation } from './operations.js';
import { parseStatsResponse } from './stats-parser.js';

const ROLE_RANK = Object.freeze({ reader: 1, operator: 2, executor: 3, admin: 4 });
const INPUT_KEYS = new Set([
  'customerId',
  'entityId',
  'fields',
  'sinceDate',
  'untilDate',
  'timeIncrement',
  'breakdown'
]);
const STAT_FIELDS = new Set([
  'impCnt', 'clkCnt', 'salesAmt', 'ctr', 'cpc', 'avgRnk', 'ccnt', 'recentAvgRnk',
  'recentAvgCpc', 'pcNxAvgRnk', 'mblNxAvgRnk', 'crto', 'convAmt', 'ror', 'cpConv',
  'viewCnt', 'purchaseCcnt', 'purchaseConvAmt', 'purchaseRor'
]);
const BREAKDOWNS = new Set(['pcMblTp', 'dayw', 'hh24', 'regnNo']);

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function principalFrom(context = {}) {
  const principal = context?.principal || {};
  return {
    principalId: String(principal.principalId || '').trim(),
    role: String(principal.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal.customerIds) ? principal.customerIds.map(String) : []
  };
}

function validDateOnly(value) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function normalizeInput(input = {}) {
  const extra = Object.keys(input || {}).filter(key => !INPUT_KEYS.has(key));
  if (extra.length) {
    fail(
      'SEARCHAD_REPORTING_INPUT_INVALID',
      'SearchAd stats observation accepts only explicit range and selection inputs; evidence fields are server-derived.',
      400,
      { rejectedFields: extra.sort() }
    );
  }
  const customerId = String(input.customerId || '').trim();
  const entityId = String(input.entityId || '').trim();
  if (!customerId) fail('SEARCHAD_CUSTOMER_ID_REQUIRED', 'customerId is required.', 400);
  if (!entityId) fail('SEARCHAD_REPORTING_ENTITY_ID_REQUIRED', 'entityId is required.', 400);

  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    fail('SEARCHAD_REPORTING_FIELDS_REQUIRED', 'fields must be a non-empty array.', 400);
  }
  const fields = [...new Set(input.fields.map(value => String(value || '').trim()).filter(Boolean))];
  if (!fields.length || fields.some(field => !STAT_FIELDS.has(field))) {
    fail('SEARCHAD_REPORTING_FIELDS_INVALID', 'fields contains an unsupported SearchAd stat field.', 400, { fields });
  }

  const sinceDate = String(input.sinceDate || '').trim();
  const untilDate = String(input.untilDate || '').trim();
  if (!validDateOnly(sinceDate) || !validDateOnly(untilDate) || untilDate < sinceDate) {
    fail(
      'SEARCHAD_REPORTING_RANGE_INVALID',
      'sinceDate/untilDate must be valid YYYY-MM-DD values with untilDate >= sinceDate.',
      400
    );
  }
  const timeIncrement = String(input.timeIncrement || 'allDays').trim();
  if (!['1', 'allDays'].includes(timeIncrement)) {
    fail('SEARCHAD_REPORTING_TIME_INCREMENT_INVALID', 'timeIncrement must be 1 or allDays.', 400);
  }
  const breakdown = input.breakdown == null || input.breakdown === '' ? null : String(input.breakdown).trim();
  if (breakdown != null && !BREAKDOWNS.has(breakdown)) {
    fail('SEARCHAD_REPORTING_BREAKDOWN_INVALID', 'Unsupported SearchAd stats breakdown.', 400, { breakdown });
  }
  return { customerId, entityId, fields, sinceDate, untilDate, timeIncrement, breakdown };
}

function assertOperator(customerId, context = {}) {
  const principal = principalFrom(context);
  if ((ROLE_RANK[principal.role] || 0) < ROLE_RANK.operator) {
    fail('SEARCHAD_OPERATOR_REQUIRED', 'SearchAd Operator role or higher is required.', 403);
  }
  if (!principal.principalId) {
    fail('SEARCHAD_PRINCIPAL_REQUIRED', 'Authenticated SearchAd principal is required.', 403);
  }
  if (!principal.customerIds.includes(String(customerId))) {
    fail('SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.', 403);
  }
  return principal;
}

export class SearchAdStatsEvidenceService {
  constructor({
    repository,
    gateway,
    credentialFingerprintResolver,
    gatewayContext,
    clock = Date.now,
    maxCycleAgeMs = 72 * 60 * 60 * 1000
  } = {}) {
    if (!repository?.createObservation) throw new TypeError('repository.createObservation is required');
    if (!gateway?.get || !gateway?.execute) throw new TypeError('gateway get/execute are required');
    if (typeof credentialFingerprintResolver !== 'function') {
      throw new TypeError('credentialFingerprintResolver is required');
    }
    this.repository = repository;
    this.gateway = gateway;
    this.credentialFingerprintResolver = credentialFingerprintResolver;
    this.gatewayContext = {
      specSha: String(gatewayContext?.specSha || '').trim(),
      upstreamBaseUrl: String(gatewayContext?.upstreamBaseUrl || '').replace(/\/$/, '')
    };
    this.clock = clock;
    this.maxCycleAgeMs = Number(maxCycleAgeMs);
  }

  async observe(input = {}, context = {}) {
    const normalized = normalizeInput(input);
    assertOperator(normalized.customerId, context);
    if (!this.gatewayContext.specSha || !this.gatewayContext.upstreamBaseUrl) {
      fail('SEARCHAD_REPORTING_CONTEXT_REQUIRED', 'Pinned SearchAd spec and upstream context are required.', 503);
    }
    const credentialFingerprint = String(
      await this.credentialFingerprintResolver(normalized.customerId) || ''
    ).trim();
    if (!credentialFingerprint) {
      fail(
        'SEARCHAD_REPORTING_CREDENTIAL_FINGERPRINT_REQUIRED',
        'Customer credential fingerprint is required for SearchAd reporting evidence.',
        503
      );
    }

    const operationKey = SEARCHAD_REPORTING_OPERATIONS.stat.single;
    assertReportingOperation(this.gateway, operationKey, { sideEffect: false });
    const query = {
      id: normalized.entityId,
      fields: JSON.stringify(normalized.fields),
      timeRange: JSON.stringify({ since: normalized.sinceDate, until: normalized.untilDate }),
      timeIncrement: normalized.timeIncrement,
      ...(normalized.breakdown ? { breakdown: normalized.breakdown } : {})
    };
    const remote = await this.gateway.execute(operationKey, {
      customerId: normalized.customerId,
      query
    });
    const observedAtMs = Number(this.clock());
    if (!Number.isFinite(observedAtMs)) {
      fail('SEARCHAD_REPORTING_CLOCK_INVALID', 'Reporting clock must return epoch milliseconds.', 503);
    }
    const data = remote?.data ?? null;
    const parsed = parseStatsResponse({
      data,
      entityId: normalized.entityId,
      timeIncrement: normalized.timeIncrement,
      observedAtMs,
      maxCycleAgeMs: this.maxCycleAgeMs
    });

    return this.repository.createObservation({
      observationId: randomUUID(),
      customerId: normalized.customerId,
      entityId: normalized.entityId,
      entityType: null,
      operationKey,
      specSha: this.gatewayContext.specSha,
      credentialFingerprint,
      upstreamBaseUrl: this.gatewayContext.upstreamBaseUrl,
      sinceDate: normalized.sinceDate,
      untilDate: normalized.untilDate,
      fields: normalized.fields,
      timeIncrement: normalized.timeIncrement,
      breakdown: normalized.breakdown,
      rawResponse: structuredClone(data),
      rawResponseSha256: sha256Json(data),
      salesAmtKrw: parsed.salesAmtKrw,
      vatBasis: parsed.vatBasis,
      cycleBaseTm: parsed.cycleBaseTm,
      observedAt: new Date(observedAtMs).toISOString(),
      sourceRequestId: remote?.upstream?.requestId == null ? null : String(remote.upstream.requestId),
      validity: parsed.validity
    });
  }
}

export const _internal = {
  normalizeInput,
  assertOperator,
  principalFrom,
  validDateOnly,
  canonicalize,
  sha256Json
};
