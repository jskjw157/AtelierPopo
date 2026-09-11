import { createPostgresPool, closePostgresPool } from '../../../infrastructure/postgres/pool.js';
import { SearchAdWriteError } from '../write/errors.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE } from '../canary/production-recipe.js';
import { PostgresSearchAdActivationRepository } from './postgres-repository.js';
import { PassiveCapabilityEvidenceService } from './passive-evidence-service.js';
import { SearchAdActivationService } from './activation-service.js';
import { SearchAdAccountControlService } from './account-control-service.js';
import { SearchAdActivationGuard } from './activation-guard.js';

const REQUIRED_SCHEMA = Object.freeze(['evidence', 'activations', 'accounts', 'account_events']);

function fail(code, message, details = {}) {
  throw new SearchAdWriteError(code, message, details, 503);
}

function loadConfig(env = process.env) {
  const ttlRaw = String(env.ATELIER_SEARCHAD_PASSIVE_EVIDENCE_TTL_SECONDS || env.ATELIER_SEARCHAD_CANARY_EVIDENCE_TTL_SECONDS || '3600').trim();
  if (!/^\d+$/.test(ttlRaw)) {
    fail('SEARCHAD_ACTIVATION_CONFIG_INVALID', 'Passive evidence TTL must be an integer number of seconds.');
  }
  const ttlSeconds = Number(ttlRaw);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 30 * 86400) {
    fail('SEARCHAD_ACTIVATION_CONFIG_INVALID', 'Passive evidence TTL is outside the allowed range.');
  }
  return {
    databaseUrl: String(env.DATABASE_URL || '').trim() || null,
    postgresSslMode: String(env.ATELIER_POSTGRES_SSL_MODE || 'require').trim() || 'require',
    evidenceTtlMs: ttlSeconds * 1000
  };
}

async function assertSchemaReady(pool) {
  const result = await pool.query(`
    SELECT
      to_regclass('searchad_verification_evidence')::text AS evidence,
      to_regclass('searchad_activation_grants')::text AS activations,
      to_regclass('searchad_canary_accounts')::text AS accounts,
      to_regclass('searchad_account_state_events')::text AS account_events
  `);
  const row = result.rows?.[0] || {};
  const missing = REQUIRED_SCHEMA.filter(key => !row[key]);
  if (missing.length) {
    fail(
      'SEARCHAD_ACTIVATION_SCHEMA_NOT_READY',
      'SearchAd activation PostgreSQL schema is not ready. Run migrations through 0008 first.',
      { missing }
    );
  }
}

async function ensureCustomerRows(pool, credentialsRegistry) {
  const customers = credentialsRegistry.listCustomers();
  for (const customer of customers) {
    if (String(customer?.status || 'active') !== 'active') continue;
    const customerId = String(customer?.customerId || '').trim();
    if (!customerId) continue;
    await pool.query(
      `INSERT INTO searchad_canary_accounts (customer_id, suspended, updated_at)
       VALUES ($1, false, now())
       ON CONFLICT (customer_id) DO NOTHING`,
      [customerId]
    );
  }
}

function gatewayContext(gateway) {
  const status = gateway?.status?.() || {};
  const specSha = String(status.specRef || gateway?.registry?.manifest?.specRef || '').trim();
  const upstreamBaseUrl = String(status.baseUrl || gateway?.config?.baseUrl || '').trim().replace(/\/$/, '');
  if (!specSha || !upstreamBaseUrl) {
    fail(
      'SEARCHAD_ACTIVATION_GATEWAY_CONTEXT_REQUIRED',
      'SearchAd activation requires the pinned spec reference and upstream base URL.'
    );
  }
  return { specSha, upstreamBaseUrl };
}

export async function createProductionSearchAdActivationRuntime({
  gateway,
  credentialsRegistry,
  capabilityService,
  env = process.env,
  pool = null,
  clock = Date.now,
  logger = console
} = {}) {
  if (!gateway?.get) {
    fail('SEARCHAD_ACTIVATION_GATEWAY_REQUIRED', 'SearchAd gateway is required for activation control.');
  }
  if (!credentialsRegistry?.resolve || !credentialsRegistry?.listCustomers) {
    fail('SEARCHAD_ACTIVATION_CREDENTIALS_REQUIRED', 'SearchAd credential registry is required for activation control.');
  }
  if (!capabilityService?.runPassive || !capabilityService?.defaultPassiveOperations) {
    fail('SEARCHAD_ACTIVATION_CAPABILITY_REQUIRED', 'SearchAd capability service is required for trusted Passive evidence.');
  }

  const config = loadConfig(env);
  let postgresPool = pool;
  let ownedPool = false;
  if (!postgresPool) {
    if (!config.databaseUrl) {
      fail('SEARCHAD_ACTIVATION_DATABASE_REQUIRED', 'DATABASE_URL is required for SearchAd activation control.');
    }
    postgresPool = createPostgresPool({
      connectionString: config.databaseUrl,
      sslMode: config.postgresSslMode,
      logger
    });
    ownedPool = true;
  }
  if (!postgresPool?.query) {
    fail('SEARCHAD_ACTIVATION_DATABASE_REQUIRED', 'A PostgreSQL pool is required for SearchAd activation control.');
  }

  try {
    await assertSchemaReady(postgresPool);
    await ensureCustomerRows(postgresPool, credentialsRegistry);
    const context = gatewayContext(gateway);
    const repository = new PostgresSearchAdActivationRepository({ pool: postgresPool });
    const credentialFingerprintResolver = customerId => credentialFingerprintForCustomer(credentialsRegistry, customerId);
    const passiveEvidenceService = new PassiveCapabilityEvidenceService({
      repository,
      capabilityService,
      gateway,
      targetScope: STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE,
      credentialFingerprintResolver,
      gatewayContext: context,
      evidenceTtlMs: config.evidenceTtlMs,
      clock
    });
    const activationService = new SearchAdActivationService({
      repository,
      gateway,
      credentialFingerprintResolver,
      gatewayContext: context,
      clock
    });
    const accountControlService = new SearchAdAccountControlService({ repository, clock });
    const guard = new SearchAdActivationGuard({
      repository,
      gateway,
      credentialFingerprintResolver,
      gatewayContext: context,
      clock
    });

    return {
      config,
      repository,
      passiveEvidenceService,
      activationService,
      accountControlService,
      guard,
      status() {
        return {
          ready: true,
          specSha: context.specSha,
          upstreamBaseUrl: context.upstreamBaseUrl,
          storage: { runtime: 'postgres', schemaReady: true },
          targetOperationCount: STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE.operationKeys.length,
          targetFieldCount: STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE.fieldScope.length
        };
      },
      async close() {
        if (ownedPool) await closePostgresPool(postgresPool);
      }
    };
  } catch (error) {
    if (ownedPool) await closePostgresPool(postgresPool);
    throw error;
  }
}

export const _internal = { loadConfig, assertSchemaReady, ensureCustomerRows, gatewayContext };
