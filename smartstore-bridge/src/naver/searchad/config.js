import path from 'node:path';

const AUTOMATION_MODES = new Set(['observe', 'recommend', 'approve', 'auto']);

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function asInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function asString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function parseJson(value, fallback, label) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    const wrapped = new Error(`${label} must be valid JSON: ${error.message}`);
    wrapped.code = 'SEARCHAD_INVALID_JSON_CONFIG';
    throw wrapped;
  }
}

function normalizeCustomerId(value, label = 'customerId') {
  const text = String(value ?? '').trim();
  if (!/^\d{1,30}$/.test(text)) {
    const error = new Error(`${label} must contain 1-30 digits.`);
    error.code = 'SEARCHAD_INVALID_CUSTOMER_ID';
    throw error;
  }
  return text;
}

function normalizePrincipal(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw Object.assign(new Error(`SearchAd principal at index ${index} must be an object.`), {
      code: 'SEARCHAD_INVALID_PRINCIPAL'
    });
  }
  const principalId = asString(entry.principalId || entry.id, `principal-${index + 1}`);
  const accessLicense = asString(entry.accessLicense || entry.apiKey);
  const secretKey = asString(entry.secretKey || entry.secret);
  if (!accessLicense || !secretKey) {
    throw Object.assign(new Error(`SearchAd principal ${principalId} requires accessLicense and secretKey.`), {
      code: 'SEARCHAD_INCOMPLETE_PRINCIPAL'
    });
  }
  return { principalId, accessLicense, secretKey, status: asString(entry.status, 'active') };
}

function normalizeCustomer(entry, index) {
  if (typeof entry === 'string' || typeof entry === 'number') {
    return { customerId: normalizeCustomerId(entry), accountName: null, status: 'active' };
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw Object.assign(new Error(`SearchAd customer at index ${index} must be an object or numeric id.`), {
      code: 'SEARCHAD_INVALID_CUSTOMER'
    });
  }
  return {
    customerId: normalizeCustomerId(entry.customerId || entry.id, `customers[${index}].customerId`),
    accountName: asString(entry.accountName || entry.name) || null,
    status: asString(entry.status, 'active')
  };
}

function normalizeGrant(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw Object.assign(new Error(`SearchAd grant at index ${index} must be an object.`), {
      code: 'SEARCHAD_INVALID_GRANT'
    });
  }
  return {
    principalId: asString(entry.principalId),
    customerId: normalizeCustomerId(entry.customerId, `grants[${index}].customerId`),
    role: asString(entry.role, 'operator')
  };
}

function buildCredentialTopology(env) {
  let principals = parseJson(env.NAVER_SEARCHAD_PRINCIPALS_JSON, [], 'NAVER_SEARCHAD_PRINCIPALS_JSON');
  let customers = parseJson(env.NAVER_SEARCHAD_CUSTOMERS_JSON, [], 'NAVER_SEARCHAD_CUSTOMERS_JSON');
  let grants = parseJson(env.NAVER_SEARCHAD_GRANTS_JSON, [], 'NAVER_SEARCHAD_GRANTS_JSON');

  if (!Array.isArray(principals) || !Array.isArray(customers) || !Array.isArray(grants)) {
    throw Object.assign(new Error('SearchAd principals, customers and grants JSON values must be arrays.'), {
      code: 'SEARCHAD_INVALID_TOPOLOGY'
    });
  }

  if (!principals.length && asString(env.NAVER_SEARCHAD_ACCESS_LICENSE) && asString(env.NAVER_SEARCHAD_SECRET_KEY)) {
    principals = [{
      principalId: asString(env.NAVER_SEARCHAD_PRINCIPAL_ID, 'default'),
      accessLicense: asString(env.NAVER_SEARCHAD_ACCESS_LICENSE),
      secretKey: asString(env.NAVER_SEARCHAD_SECRET_KEY)
    }];
  }

  if (!customers.length && asString(env.NAVER_SEARCHAD_CUSTOMER_ID)) {
    customers = [{ customerId: asString(env.NAVER_SEARCHAD_CUSTOMER_ID), accountName: null }];
  }

  const normalizedPrincipals = principals.map(normalizePrincipal);
  const normalizedCustomers = customers.map(normalizeCustomer);

  if (!grants.length && normalizedPrincipals.length === 1) {
    grants = normalizedCustomers.map(customer => ({
      principalId: normalizedPrincipals[0].principalId,
      customerId: customer.customerId,
      role: 'operator'
    }));
  }
  const normalizedGrants = grants.map(normalizeGrant);

  const principalIds = new Set(normalizedPrincipals.map(item => item.principalId));
  const customerIds = new Set(normalizedCustomers.map(item => item.customerId));
  const uniqueGrantKeys = new Set();
  for (const grant of normalizedGrants) {
    if (!principalIds.has(grant.principalId)) {
      throw Object.assign(new Error(`Grant references unknown principal ${grant.principalId}.`), {
        code: 'SEARCHAD_UNKNOWN_PRINCIPAL'
      });
    }
    if (!customerIds.has(grant.customerId)) {
      throw Object.assign(new Error(`Grant references unknown customer ${grant.customerId}.`), {
        code: 'SEARCHAD_UNKNOWN_CUSTOMER'
      });
    }
    const key = `${grant.principalId}:${grant.customerId}`;
    if (uniqueGrantKeys.has(key)) {
      throw Object.assign(new Error(`Duplicate SearchAd grant ${key}.`), {
        code: 'SEARCHAD_DUPLICATE_GRANT'
      });
    }
    uniqueGrantKeys.add(key);
  }

  return {
    principals: normalizedPrincipals,
    customers: normalizedCustomers,
    grants: normalizedGrants
  };
}

export function loadSearchAdConfig(env = process.env, { cwd = process.cwd() } = {}) {
  const baseUrl = new URL(asString(env.NAVER_SEARCHAD_BASE_URL, 'https://api.searchad.naver.com'));
  if (baseUrl.protocol !== 'https:') {
    throw Object.assign(new Error('NAVER_SEARCHAD_BASE_URL must use https.'), {
      code: 'SEARCHAD_INSECURE_BASE_URL'
    });
  }

  const automationMode = asString(env.ATELIER_SEARCHAD_AUTOMATION_MODE, 'observe').toLowerCase();
  if (!AUTOMATION_MODES.has(automationMode)) {
    throw Object.assign(new Error(`Unsupported SearchAd automation mode: ${automationMode}`), {
      code: 'SEARCHAD_INVALID_AUTOMATION_MODE'
    });
  }

  const topology = buildCredentialTopology(env);
  const configured = topology.principals.length > 0 && topology.customers.length > 0 && topology.grants.length > 0;

  return {
    enabled: asBoolean(env.ATELIER_SEARCHAD_GATEWAY_ENABLED, true),
    configured,
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    manifestPath: path.resolve(cwd, asString(
      env.NAVER_SEARCHAD_MANIFEST_PATH,
      './specs/naver-searchad/current.json'
    )),
    sourceManifestPath: path.resolve(cwd, asString(
      env.NAVER_SEARCHAD_SOURCE_MANIFEST_PATH,
      './specs/naver-searchad/source-manifest.json'
    )),
    correctionPath: path.resolve(cwd, asString(
      env.NAVER_SEARCHAD_COMPILED_CORRECTIONS_PATH,
      './specs/naver-searchad/corrections/compiled.json'
    )),
    topology,
    requestTimeoutMs: asInteger(env.ATELIER_SEARCHAD_REQUEST_TIMEOUT_MS, 30_000, { min: 1_000, max: 300_000 }),
    maxRetries: asInteger(env.ATELIER_SEARCHAD_MAX_RETRIES, 3, { min: 0, max: 8 }),
    maxJsonBodyBytes: asInteger(env.ATELIER_SEARCHAD_MAX_JSON_BODY_BYTES, 8 * 1024 * 1024, {
      min: 1_024,
      max: 64 * 1024 * 1024
    }),
    allowReads: asBoolean(env.ATELIER_SEARCHAD_ALLOW_READS, true),
    allowWrites: asBoolean(env.ATELIER_SEARCHAD_ALLOW_WRITES, false),
    allowCreates: asBoolean(env.ATELIER_SEARCHAD_ALLOW_CREATES, false),
    allowBatchWrites: asBoolean(env.ATELIER_SEARCHAD_ALLOW_BATCH_WRITES, false),
    allowRollbacks: asBoolean(env.ATELIER_SEARCHAD_ALLOW_ROLLBACK, false),
    allowDeletes: asBoolean(env.ATELIER_SEARCHAD_ALLOW_DELETES, false),
    allowBillingReads: asBoolean(env.ATELIER_SEARCHAD_ALLOW_BILLING_READS, true),
    allowAccountAdmin: asBoolean(env.ATELIER_SEARCHAD_ALLOW_ACCOUNT_ADMIN, false),
    allowActiveCanary: asBoolean(env.ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY, false),
    allowReportingJobs: asBoolean(env.ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS, false),
    allowUnverifiedOperations: asBoolean(env.ATELIER_SEARCHAD_ALLOW_UNVERIFIED_OPERATIONS, false),
    automationMode,
    passiveProbeLimit: asInteger(env.ATELIER_SEARCHAD_PASSIVE_PROBE_LIMIT, 12, { min: 1, max: 50 }),
    incrementalSyncIntervalMs: asInteger(env.ATELIER_SEARCHAD_INCREMENTAL_SYNC_INTERVAL_MS, 300_000, {
      min: 60_000,
      max: 86_400_000
    }),
    entityCooldownHours: asInteger(env.ATELIER_ADS_ENTITY_COOLDOWN_HOURS, 24, { min: 0, max: 720 }),
    manualChangeHoldHours: asInteger(env.ATELIER_ADS_MANUAL_CHANGE_HOLD_HOURS, 24, { min: 0, max: 720 }),
    maxConsecutiveFailures: asInteger(env.ATELIER_ADS_MAX_CONSECUTIVE_FAILURES, 3, { min: 1, max: 100 }),
    maxUnknownOutcomes: asInteger(env.ATELIER_ADS_MAX_UNKNOWN_OUTCOMES, 3, { min: 1, max: 100 })
  };
}

export function publicSearchAdConfig(config) {
  return {
    enabled: config.enabled,
    configured: config.configured,
    baseUrl: config.baseUrl,
    manifestPath: config.manifestPath,
    principalCount: config.topology.principals.length,
    customerCount: config.topology.customers.length,
    grantCount: config.topology.grants.length,
    customers: config.topology.customers.map(item => ({
      customerIdMasked: item.customerId.length <= 4 ? '*'.repeat(item.customerId.length) : `${'*'.repeat(item.customerId.length - 4)}${item.customerId.slice(-4)}`,
      accountName: item.accountName,
      status: item.status
    })),
    gates: {
      reads: config.allowReads,
      writes: config.allowWrites,
      creates: config.allowCreates,
      batchWrites: config.allowBatchWrites,
      rollbacks: config.allowRollbacks,
      deletes: config.allowDeletes,
      billingReads: config.allowBillingReads,
      accountAdmin: config.allowAccountAdmin,
      activeCanary: config.allowActiveCanary,
      reportingJobs: config.allowReportingJobs,
      unverifiedOperations: config.allowUnverifiedOperations
    },
    automationMode: config.automationMode,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRetries: config.maxRetries
  };
}

export const _internal = {
  asBoolean,
  asInteger,
  normalizeCustomerId,
  buildCredentialTopology
};
