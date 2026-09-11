import { createHash, randomUUID } from 'node:crypto';

import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_REPORTING_OPERATIONS, assertReportingOperation } from './operations.js';

const ROLE_RANK = Object.freeze({ reader: 1, operator: 2, executor: 3, admin: 4 });

const STAT_INPUT_KEYS = new Set(['customerId', 'intentKey', 'reportType']);
const MASTER_INPUT_KEYS = new Set(['customerId', 'intentKey', 'item', 'fromTime']);

const STAT_REPORT_TYPES = new Set([
  'AD',
  'AD_DETAIL',
  'AD_CONVERSION',
  'AD_CONVERSION_DETAIL',
  'ADEXTENSION',
  'ADEXTENSION_CONVERSION',
  'EXPKEYWORD',
  'SHOPPINGKEYWORD_DETAIL',
  'SHOPPINGKEYWORD_CONVERSION_DETAIL',
  'SHOPPINGBRANDPRODUCT',
  'SHOPPINGBRANDPRODUCT_CONVERSION',
  'CRITERION',
  'CRITERION_CONVERSION'
]);

const MASTER_ITEMS = new Set([
  'Campaign',
  'CampaignBudget',
  'BusinessChannel',
  'Adgroup',
  'AdgroupBudget',
  'Keyword',
  'Ad',
  'AdExtension',
  'Qi',
  'Label',
  'LabelRef',
  'Media',
  'Biz',
  'SeasonalEvent',
  'ShoppingProduct',
  'ContentsAd',
  'PlaceAd',
  'CatalogAd',
  'AdQi',
  'ProductGroup',
  'ProductGroupRel',
  'BrandAd',
  'BrandThumbnailAd',
  'BrandBannerAd',
  'Criterion',
  'SharedBudget',
  'Asset',
  'AdAssetLink',
  'RsaAd',
  'HospitalAd'
]);

const DETERMINISTIC_REPORTING_GATEWAY_ERRORS = new Set([
  'SEARCHAD_GATEWAY_DISABLED',
  'SEARCHAD_NOT_CONFIGURED',
  'SEARCHAD_REPORTING_JOBS_DISABLED',
  'SEARCHAD_OPERATION_NOT_ALLOWLISTED',
  'SEARCHAD_OPERATION_UNVERIFIED',
  'SEARCHAD_REPORTING_OPERATION_SCOPE_FORBIDDEN',
  'SEARCHAD_CUSTOMER_ID_REQUIRED'
]);

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function principalFrom(context = {}) {
  const principal = context?.principal || {};
  return {
    principalId: String(principal.principalId || '').trim(),
    role: String(principal.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal.customerIds) ? principal.customerIds.map(String) : []
  };
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

function rejectExtraKeys(input, allowed) {
  const extra = Object.keys(input || {}).filter(key => !allowed.has(key));
  if (extra.length) {
    fail(
      'SEARCHAD_REPORT_JOB_INPUT_INVALID',
      'SearchAd report job input contains caller-controlled result or unsupported fields.',
      400,
      { rejectedFields: extra.sort() }
    );
  }
}

function normalizeCommon(input = {}, allowed) {
  rejectExtraKeys(input, allowed);
  const customerId = String(input.customerId || '').trim();
  const intentKey = String(input.intentKey || '').trim();
  if (!customerId) fail('SEARCHAD_CUSTOMER_ID_REQUIRED', 'customerId is required.', 400);
  if (!intentKey) fail('SEARCHAD_REPORT_INTENT_KEY_REQUIRED', 'intentKey is required.', 400);
  if (intentKey.length > 200) {
    fail('SEARCHAD_REPORT_INTENT_KEY_INVALID', 'intentKey is too long.', 400);
  }
  return { customerId, intentKey };
}

function normalizeStatInput(input = {}) {
  const common = normalizeCommon(input, STAT_INPUT_KEYS);
  const reportType = String(input.reportType || '').trim();
  if (!STAT_REPORT_TYPES.has(reportType)) {
    fail('SEARCHAD_REPORT_TYPE_INVALID', 'Unsupported SearchAd stat report type.', 400, { reportType: reportType || null });
  }
  return { ...common, reportType };
}

function validIsoTime(value) {
  const text = String(value || '').trim();
  if (!text || !/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return false;
  return Number.isFinite(Date.parse(text));
}

function normalizeMasterInput(input = {}) {
  const common = normalizeCommon(input, MASTER_INPUT_KEYS);
  const item = String(input.item || '').trim();
  if (!MASTER_ITEMS.has(item)) {
    fail('SEARCHAD_MASTER_REPORT_ITEM_INVALID', 'Unsupported SearchAd master report item.', 400, { item: item || null });
  }
  const fromTime = input.fromTime == null || input.fromTime === '' ? null : String(input.fromTime).trim();
  if (fromTime != null && !validIsoTime(fromTime)) {
    fail('SEARCHAD_MASTER_REPORT_FROM_TIME_INVALID', 'fromTime must be an ISO 8601 datetime with an explicit timezone.', 400);
  }
  return { ...common, item, fromTime };
}

function clockIso(clock) {
  const value = Number(clock());
  if (!Number.isFinite(value)) fail('SEARCHAD_REPORTING_CLOCK_INVALID', 'Reporting clock must return epoch milliseconds.', 503);
  return new Date(value).toISOString();
}

function safeError(error) {
  return {
    code: error?.code == null ? null : String(error.code),
    name: error?.name == null ? 'Error' : String(error.name),
    status: Number.isFinite(Number(error?.status || error?.statusCode))
      ? Number(error.status || error.statusCode)
      : null
  };
}

function isAmbiguousPostError(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  if (DETERMINISTIC_REPORTING_GATEWAY_ERRORS.has(code)) return false;
  return Boolean(
    error?.name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code.includes('TIMEOUT') ||
    code.includes('ABORT') ||
    code.includes('ECONNRESET') ||
    code.includes('EPIPE') ||
    status === 502 || status === 503 || status === 504
  );
}

function scalarId(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  return null;
}

function responseDownloadUrl(data) {
  if (data?.downloadUrl == null || data.downloadUrl === '') return null;
  if (typeof data.downloadUrl !== 'string') return null;
  return data.downloadUrl.trim() || null;
}

function extractResponse(kind, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const returnedJobId = kind === 'stat' ? scalarId(data.reportJobId) : scalarId(data.id);
  if (!returnedJobId) return null;
  if (data.downloadUrl != null && data.downloadUrl !== '' && typeof data.downloadUrl !== 'string') return null;
  return {
    returnedJobId,
    persistedDownloadUrl: responseDownloadUrl(data)
  };
}

function registrationSpec(kind) {
  if (kind === 'stat') {
    return {
      create: SEARCHAD_REPORTING_OPERATIONS.statReport.create,
      list: SEARCHAD_REPORTING_OPERATIONS.statReport.list,
      get: SEARCHAD_REPORTING_OPERATIONS.statReport.get,
      idPathKey: 'reportJobId'
    };
  }
  return {
    create: SEARCHAD_REPORTING_OPERATIONS.masterReport.create,
    list: SEARCHAD_REPORTING_OPERATIONS.masterReport.list,
    get: SEARCHAD_REPORTING_OPERATIONS.masterReport.get,
    idPathKey: 'id'
  };
}

function matchesIntent(kind, request, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (kind === 'stat') return String(item.reportTp || '') === String(request.reportTp || '');
  if (String(item.item || '') !== String(request.item || '')) return false;
  const expectedFromTime = request.fromTime == null || request.fromTime === '' ? null : String(request.fromTime);
  const actualFromTime = item.fromTime == null || item.fromTime === '' ? null : String(item.fromTime);
  return expectedFromTime === actualFromTime;
}

export class SearchAdReportJobService {
  constructor({ repository, gateway, clock = Date.now } = {}) {
    for (const method of [
      'createOrGetReportIntent',
      'claimReportDispatch',
      'getReportIntent',
      'updateReportIntent',
      'appendReportEvent'
    ]) {
      if (typeof repository?.[method] !== 'function') throw new TypeError(`repository.${method} is required`);
    }
    if (!gateway?.get || !gateway?.execute || !gateway?.executeReporting) {
      throw new TypeError('gateway get/execute/executeReporting are required');
    }
    if (typeof clock !== 'function') throw new TypeError('clock is required');
    this.repository = repository;
    this.gateway = gateway;
    this.clock = clock;
  }

  async registerStatReport(input = {}, context = {}) {
    const normalized = normalizeStatInput(input);
    return this.#register({
      kind: 'stat',
      normalized,
      request: { reportTp: normalized.reportType },
      context
    });
  }

  async registerMasterReport(input = {}, context = {}) {
    const normalized = normalizeMasterInput(input);
    return this.#register({
      kind: 'master',
      normalized,
      request: {
        item: normalized.item,
        ...(normalized.fromTime ? { fromTime: normalized.fromTime } : {})
      },
      context
    });
  }

  async #register({ kind, normalized, request, context }) {
    const principal = assertOperator(normalized.customerId, context);
    const spec = registrationSpec(kind);
    assertReportingOperation(this.gateway, spec.create, { sideEffect: true });
    const now = clockIso(this.clock);
    const intent = await this.repository.createOrGetReportIntent({
      reportIntentId: randomUUID(),
      customerId: normalized.customerId,
      reportKind: kind,
      intentKey: normalized.intentKey,
      operationKey: spec.create,
      request,
      requestSha256: sha256Json(request),
      status: 'planned',
      returnedJobId: null,
      persistedDownloadUrl: null,
      createdByPrincipalId: principal.principalId,
      requestId: context?.requestId == null ? null : String(context.requestId),
      createdAt: now,
      updatedAt: now,
      lastError: null
    });

    if (!intent) fail('SEARCHAD_REPORT_INTENT_PERSIST_FAILED', 'Report intent could not be persisted.', 503);
    if (intent.status !== 'planned') return intent;

    const claim = await this.repository.claimReportDispatch(intent.reportIntentId, normalized.customerId, now);
    if (!claim?.claimed) return claim?.intent || intent;

    await this.#event({
      intent: claim.intent,
      phase: 'dispatch',
      status: 'dispatching',
      operationKey: spec.create,
      requestId: context?.requestId
    });

    let remote;
    try {
      remote = await this.gateway.executeReporting(spec.create, {
        customerId: normalized.customerId,
        body: request
      });
    } catch (error) {
      if (!isAmbiguousPostError(error)) {
        const failed = await this.repository.updateReportIntent(intent.reportIntentId, {
          status: 'failed',
          updatedAt: clockIso(this.clock),
          lastError: safeError(error)
        }, normalized.customerId);
        await this.#event({
          intent: failed || claim.intent,
          phase: 'dispatch',
          status: 'failed',
          operationKey: spec.create,
          requestId: context?.requestId,
          error: safeError(error)
        });
        throw error;
      }
      await this.#markUnknown(intent, normalized.customerId, spec.create, context, error);
    }

    const extracted = extractResponse(kind, remote?.data);
    if (!extracted) {
      await this.#markUnknown(
        intent,
        normalized.customerId,
        spec.create,
        context,
        Object.assign(new Error('Unusable report registration response.'), { code: 'SEARCHAD_REPORT_RESPONSE_AMBIGUOUS' })
      );
    }

    const registered = await this.repository.updateReportIntent(intent.reportIntentId, {
      status: 'registered',
      returnedJobId: extracted.returnedJobId,
      persistedDownloadUrl: extracted.persistedDownloadUrl,
      updatedAt: clockIso(this.clock),
      lastError: null
    }, normalized.customerId);
    await this.#event({
      intent: registered,
      phase: 'dispatch',
      status: 'registered',
      operationKey: spec.create,
      requestId: remote?.upstream?.requestId || context?.requestId,
      details: { returnedJobId: extracted.returnedJobId }
    });
    return registered;
  }

  async #markUnknown(intent, customerId, operationKey, context, error) {
    const unknown = await this.repository.updateReportIntent(intent.reportIntentId, {
      status: 'unknown_outcome',
      updatedAt: clockIso(this.clock),
      lastError: safeError(error)
    }, customerId);
    await this.#event({
      intent: unknown || intent,
      phase: 'dispatch',
      status: 'unknown_outcome',
      operationKey,
      requestId: context?.requestId,
      error: safeError(error)
    });
    throw new SearchAdWriteError(
      'SEARCHAD_REPORT_JOB_UNKNOWN_OUTCOME',
      'SearchAd report registration outcome is unknown. POST will not be retried; use GET-only reconcile.',
      { reportIntentId: intent.reportIntentId },
      409
    );
  }

  async reconcile(reportIntentId, context = {}) {
    const id = String(reportIntentId || '').trim();
    if (!id) fail('SEARCHAD_REPORT_INTENT_ID_REQUIRED', 'reportIntentId is required.', 400);
    const intent = await this.repository.getReportIntent(id);
    if (!intent) fail('SEARCHAD_REPORT_INTENT_NOT_FOUND', 'Report intent was not found.', 404);
    assertOperator(intent.customerId, context);

    if (['registered', 'reconciled', 'manual_review', 'failed'].includes(intent.status)) return intent;
    if (!['dispatching', 'unknown_outcome'].includes(intent.status)) {
      fail('SEARCHAD_REPORT_RECONCILE_NOT_READY', 'Report intent is not eligible for read-only reconcile.', 409, {
        reportIntentId: id,
        status: intent.status
      });
    }

    const spec = registrationSpec(intent.reportKind);
    let candidate = null;
    let operationKey;
    let requestId = context?.requestId == null ? null : String(context.requestId);

    if (intent.returnedJobId) {
      operationKey = spec.get;
      assertReportingOperation(this.gateway, operationKey, { sideEffect: false });
      const remote = await this.gateway.execute(operationKey, {
        customerId: intent.customerId,
        pathParams: { [spec.idPathKey]: intent.returnedJobId }
      });
      requestId = remote?.upstream?.requestId || requestId;
      const extracted = extractResponse(intent.reportKind, remote?.data);
      if (extracted && extracted.returnedJobId === String(intent.returnedJobId)) {
        candidate = remote.data;
      }
    } else {
      operationKey = spec.list;
      assertReportingOperation(this.gateway, operationKey, { sideEffect: false });
      const remote = await this.gateway.execute(operationKey, { customerId: intent.customerId });
      requestId = remote?.upstream?.requestId || requestId;
      const items = Array.isArray(remote?.data) ? remote.data : [];
      const matches = items.filter(item => matchesIntent(intent.reportKind, intent.request, item));
      if (matches.length === 1 && extractResponse(intent.reportKind, matches[0])) candidate = matches[0];
    }

    if (!candidate) {
      const manual = await this.repository.updateReportIntent(id, {
        status: 'manual_review',
        updatedAt: clockIso(this.clock),
        lastError: null
      }, intent.customerId);
      await this.#event({
        intent: manual || intent,
        phase: 'reconcile',
        status: 'manual_review',
        operationKey,
        requestId,
        details: { reason: 'zero_or_ambiguous_match' }
      });
      return manual;
    }

    const extracted = extractResponse(intent.reportKind, candidate);
    const reconciled = await this.repository.updateReportIntent(id, {
      status: 'reconciled',
      returnedJobId: extracted.returnedJobId,
      persistedDownloadUrl: extracted.persistedDownloadUrl,
      updatedAt: clockIso(this.clock),
      lastError: null
    }, intent.customerId);
    await this.#event({
      intent: reconciled,
      phase: 'reconcile',
      status: 'reconciled',
      operationKey,
      requestId,
      details: { returnedJobId: extracted.returnedJobId }
    });
    return reconciled;
  }

  async #event({ intent, phase, status, operationKey, requestId = null, details = {}, error = null }) {
    if (!intent?.reportIntentId || !intent?.customerId) return null;
    return this.repository.appendReportEvent({
      eventId: randomUUID(),
      reportIntentId: intent.reportIntentId,
      customerId: intent.customerId,
      phase,
      status,
      operationKey: operationKey || null,
      requestId: requestId == null ? null : String(requestId),
      details,
      error,
      createdAt: clockIso(this.clock)
    });
  }
}

export const _internal = {
  canonicalize,
  sha256Json,
  principalFrom,
  assertOperator,
  normalizeStatInput,
  normalizeMasterInput,
  validIsoTime,
  safeError,
  isAmbiguousPostError,
  scalarId,
  extractResponse,
  matchesIntent,
  STAT_REPORT_TYPES,
  MASTER_ITEMS
};
