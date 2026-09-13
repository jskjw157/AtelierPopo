import { SearchAdWriteError } from '../write/errors.js';

const RESERVE_KEYS = new Set([
  'customerId',
  'intentId',
  'operationKey',
  'lifecycleKind',
  'ownerKind',
  'ownerRunId'
]);
const TRANSITION_KEYS = new Set(['intentId']);
const OWNER_KINDS = new Set(['active_canary', 'hierarchy_canary']);

function fail(code, message, status = 400, details = {}) {
  throw new SearchAdWriteError(code, message, details, status);
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('SEARCHAD_RISK_INPUT_INVALID', `${label} input must be an object.`);
  }
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (extra.length) {
    fail('SEARCHAD_RISK_INPUT_INVALID', `${label} input contains caller-controlled risk fields.`, 400, { fields: extra.sort() });
  }
}

function requiredString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail('SEARCHAD_RISK_INPUT_INVALID', `${field} is required.`);
  return normalized;
}

function normalizePolicy(policy = {}) {
  const normalized = new Map();
  for (const [operationKey, rule] of Object.entries(policy || {})) {
    const op = String(operationKey || '').trim();
    const lifecycleKind = String(rule?.lifecycleKind || '').trim();
    const units = Number(rule?.units);
    if (!op || !lifecycleKind || !Number.isSafeInteger(units) || units <= 0) {
      throw new TypeError('SearchAd lifecycle riskPolicy entries require operationKey, lifecycleKind and positive integer units');
    }
    normalized.set(op, Object.freeze({ lifecycleKind, units }));
  }
  return normalized;
}

function asInstant(clock) {
  const value = clock();
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError('SearchAd lifecycle risk clock returned an invalid instant');
  return instant;
}

export class SearchAdLifecycleRiskService {
  constructor({ repository, dailyCapacityUnits, riskPolicy, clock = () => Date.now() } = {}) {
    if (!repository?.reserveRisk || !repository?.consumeRisk || !repository?.releaseRisk) {
      throw new TypeError('SearchAd lifecycle risk repository is required');
    }
    const capacity = Number(dailyCapacityUnits);
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new TypeError('dailyCapacityUnits must be a positive integer');
    }
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    this.repository = repository;
    this.dailyCapacityUnits = capacity;
    this.riskPolicy = normalizePolicy(riskPolicy);
    this.clock = clock;
  }

  async reserve(input = {}) {
    assertExactKeys(input, RESERVE_KEYS, 'reserve');
    const customerId = requiredString(input.customerId, 'customerId');
    const intentId = requiredString(input.intentId, 'intentId');
    const operationKey = requiredString(input.operationKey, 'operationKey');
    const lifecycleKind = requiredString(input.lifecycleKind, 'lifecycleKind');
    const ownerKind = requiredString(input.ownerKind, 'ownerKind');
    const ownerRunId = requiredString(input.ownerRunId, 'ownerRunId');
    if (!OWNER_KINDS.has(ownerKind)) {
      fail('SEARCHAD_RISK_INPUT_INVALID', 'ownerKind is not an approved SearchAd Canary owner.');
    }

    const policy = this.riskPolicy.get(operationKey);
    if (!policy) {
      fail('SEARCHAD_RISK_OPERATION_NOT_CONFIGURED', 'Operation has no server-owned SearchAd risk policy.', 403, { operationKey });
    }
    if (policy.lifecycleKind !== lifecycleKind) {
      fail('SEARCHAD_RISK_LIFECYCLE_MISMATCH', 'Lifecycle kind does not match the server-owned SearchAd risk policy.', 403, {
        operationKey,
        lifecycleKind
      });
    }

    const instant = asInstant(this.clock);
    return this.repository.reserveRisk({
      customerId,
      intentId,
      operationKey,
      lifecycleKind,
      ownerKind,
      ownerRunId,
      riskDate: instant.toISOString().slice(0, 10),
      units: policy.units,
      capacityUnits: this.dailyCapacityUnits,
      createdAt: instant.toISOString()
    });
  }

  async consume(input = {}) {
    assertExactKeys(input, TRANSITION_KEYS, 'consume');
    const intentId = requiredString(input.intentId, 'intentId');
    const instant = asInstant(this.clock);
    return this.repository.consumeRisk({ intentId, updatedAt: instant.toISOString() });
  }

  async release(input = {}) {
    assertExactKeys(input, TRANSITION_KEYS, 'release');
    const intentId = requiredString(input.intentId, 'intentId');
    const instant = asInstant(this.clock);
    return this.repository.releaseRisk({ intentId, updatedAt: instant.toISOString() });
  }
}

export const _internal = { normalizePolicy, asInstant };
