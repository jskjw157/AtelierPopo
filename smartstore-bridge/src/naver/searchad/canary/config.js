import { SearchAdWriteError } from '../write/errors.js';

function invalid(message, details = {}) {
  throw new SearchAdWriteError('SEARCHAD_CANARY_CONFIG_INVALID', message, details, 500);
}

function bool(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  invalid('Active Canary boolean config is invalid.', { value: normalized });
}

function integer(value, fallback, { name, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || String(value).trim() === '') return fallback;
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) invalid(`${name} must be an integer.`, { name });
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    invalid(`${name} is outside the allowed safety range.`, { name, min, max });
  }
  return parsed;
}

function positiveMoney(env, name, { required = false } = {}) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') {
    if (required) invalid(`${name} is required when Active Canary is enabled.`, { name });
    return null;
  }
  return integer(raw, null, { name, min: 1, max: Number.MAX_SAFE_INTEGER });
}

function exactDate(env, name, { required = false } = {}) {
  const text = String(env[name] ?? '').trim();
  if (!text) {
    if (required) invalid(`${name} is required when Active Canary is enabled.`, { name });
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    invalid(`${name} must be YYYY-MM-DD.`, { name });
  }
  return text;
}

export function loadActiveCanaryConfig(env = process.env) {
  const allowActiveCanary = bool(env.ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY, false);
  const activationMode = String(env.ATELIER_SEARCHAD_ACTIVATION_MODE || 'prevalidation').trim() || 'prevalidation';
  const observationSeconds = integer(env.ATELIER_SEARCHAD_CANARY_OBSERVATION_SECONDS, 172800, {
    name: 'ATELIER_SEARCHAD_CANARY_OBSERVATION_SECONDS', min: 172800, max: 30 * 86400
  });
  const evidenceTtlSeconds = integer(env.ATELIER_SEARCHAD_CANARY_EVIDENCE_TTL_SECONDS, 86400, {
    name: 'ATELIER_SEARCHAD_CANARY_EVIDENCE_TTL_SECONDS', min: 60, max: 30 * 86400
  });
  const maxSpendKrw = integer(env.ATELIER_SEARCHAD_CANARY_MAX_SPEND_KRW, 0, {
    name: 'ATELIER_SEARCHAD_CANARY_MAX_SPEND_KRW', min: 0, max: 0
  });
  const maxConcurrentPerCustomer = integer(env.ATELIER_SEARCHAD_CANARY_MAX_CONCURRENT_PER_CUSTOMER, 1, {
    name: 'ATELIER_SEARCHAD_CANARY_MAX_CONCURRENT_PER_CUSTOMER', min: 1, max: 1
  });
  const maxObjects = integer(env.ATELIER_SEARCHAD_CANARY_MAX_OBJECTS, 4, {
    name: 'ATELIER_SEARCHAD_CANARY_MAX_OBJECTS', min: 1, max: 4
  });
  const maxMutations = integer(env.ATELIER_SEARCHAD_CANARY_MAX_MUTATIONS, 12, {
    name: 'ATELIER_SEARCHAD_CANARY_MAX_MUTATIONS', min: 1, max: 12
  });
  const ttlSeconds = integer(env.ATELIER_SEARCHAD_CANARY_TTL_SECONDS, 3600, {
    name: 'ATELIER_SEARCHAD_CANARY_TTL_SECONDS', min: 60, max: 86400
  });
  const databaseUrl = String(env.DATABASE_URL || '').trim() || null;
  const postgresSslMode = String(env.ATELIER_POSTGRES_SSL_MODE || 'require').trim() || 'require';

  const dailyBudgetKrw = positiveMoney(env, 'ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW', { required: allowActiveCanary });
  const budgetDeltaKrw = positiveMoney(env, 'ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW', { required: allowActiveCanary });
  const maxDailyBudgetKrw = positiveMoney(env, 'ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW', { required: allowActiveCanary });
  const maxBudgetDeltaKrw = positiveMoney(env, 'ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW', { required: allowActiveCanary });
  const statsSince = exactDate(env, 'ATELIER_SEARCHAD_CANARY_STATS_SINCE', { required: allowActiveCanary });
  const statsUntil = exactDate(env, 'ATELIER_SEARCHAD_CANARY_STATS_UNTIL', { required: allowActiveCanary });

  if (allowActiveCanary) {
    if (activationMode !== 'canary') {
      invalid('ATELIER_SEARCHAD_ACTIVATION_MODE must be canary when Active Canary is enabled.', { activationMode });
    }
    if (!databaseUrl) {
      // The runtime may still supply a pool explicitly; it will decide whether this is fatal.
    }
    if (dailyBudgetKrw + budgetDeltaKrw > maxDailyBudgetKrw) {
      invalid('Canary daily budget plus mutation delta exceeds the configured maximum daily budget.', {
        dailyBudgetKrw, budgetDeltaKrw, maxDailyBudgetKrw
      });
    }
    if (budgetDeltaKrw > maxBudgetDeltaKrw) {
      invalid('Canary budget mutation exceeds the configured maximum delta.', { budgetDeltaKrw, maxBudgetDeltaKrw });
    }
    if (Date.parse(`${statsSince}T00:00:00Z`) > Date.parse(`${statsUntil}T23:59:59Z`)) {
      invalid('Active Canary stats range is invalid.', { statsSince, statsUntil });
    }
  }

  return {
    allowActiveCanary,
    activationMode,
    observationPeriodMs: observationSeconds * 1000,
    evidenceTtlMs: evidenceTtlSeconds * 1000,
    maxSpendKrw,
    maxConcurrentPerCustomer,
    maxObjects,
    maxMutations,
    ttlMs: ttlSeconds * 1000,
    dailyBudgetKrw,
    budgetDeltaKrw,
    maxDailyBudgetKrw,
    maxBudgetDeltaKrw,
    statsTimeRange: statsSince && statsUntil ? { since: statsSince, until: statsUntil } : null,
    databaseUrl,
    postgresSslMode
  };
}

export const _internal = { bool, integer, positiveMoney, exactDate };
