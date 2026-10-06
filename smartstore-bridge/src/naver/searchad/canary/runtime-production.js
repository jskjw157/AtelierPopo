import { createCircuitGuard } from '../circuit/service.js';
import { createPostgresPool, closePostgresPool } from '../../../infrastructure/postgres/pool.js';
import { SearchAdWriteError } from '../write/errors.js';
import { createPostgresMutationGateway } from '../lifecycle/postgres-mutation-gateway.js';
import { ActiveCanaryService } from './active-canary-service.js';
import { loadActiveCanaryConfig } from './config.js';
import { credentialFingerprintForCustomer } from './credential-fingerprint.js';
import { PostgresActiveCanaryRepository } from './postgres-repository.js';
import { createStoppedWebSiteCampaignRecipe } from './production-recipe.js';
import { ActiveCanaryGatewayRemoteAdapter } from './remote-adapter.js';

const REQUIRED_SCHEMA_COLUMNS = Object.freeze(['accounts', 'evidence', 'runs', 'objects', 'events']);

async function assertSchemaReady(pool) {
  const result = await pool.query(`
    SELECT
      to_regclass('searchad_canary_accounts')::text AS accounts,
      to_regclass('searchad_verification_evidence')::text AS evidence,
      to_regclass('searchad_canary_runs')::text AS runs,
      to_regclass('searchad_canary_objects')::text AS objects,
      to_regclass('searchad_canary_events')::text AS events
  `);
  const row = result.rows?.[0] || {};
  const missing = REQUIRED_SCHEMA_COLUMNS.filter(key => !row[key]);
  if (missing.length) {
    throw new SearchAdWriteError(
      'SEARCHAD_CANARY_SCHEMA_NOT_READY',
      'Active Canary PostgreSQL schema is not ready. Run migrations before enabling Canary.',
      { missing },
      503
    );
  }
}

async function ensureCustomerRows(pool, credentialsRegistry) {
  const customers = credentialsRegistry?.listCustomers?.() || [];
  for (const customer of customers) {
    if (String(customer.status || 'active') !== 'active') continue;
    await pool.query(
      `INSERT INTO searchad_canary_accounts (customer_id, suspended, updated_at)
       VALUES ($1, false, now())
       ON CONFLICT (customer_id) DO NOTHING`,
      [String(customer.customerId)]
    );
  }
}

function gatewayContext(gateway) {
  const status = gateway?.status?.() || {};
  const specSha = String(status.specRef || gateway?.registry?.manifest?.specRef || '').trim();
  const upstreamBaseUrl = String(status.baseUrl || gateway?.config?.baseUrl || '').replace(/\/$/, '');
  if (!specSha || !upstreamBaseUrl) {
    throw new SearchAdWriteError(
      'SEARCHAD_CANARY_GATEWAY_CONTEXT_REQUIRED',
      'Active Canary requires pinned SearchAd specRef and upstream base URL.',
      {},
      503
    );
  }
  return { specSha, upstreamBaseUrl };
}

function disabledRuntime(config) {
  return {
    config,
    repository: null,
    remote: null,
    recipe: null,
    service: null,
    status() {
      return {
        enabled: false,
        ready: false,
        activationMode: config.activationMode,
        specSha: null,
        upstreamBaseUrl: null,
        storage: { runtime: 'postgres', schemaReady: false },
        safety: {
          maxSpendKrw: config.maxSpendKrw,
          maxConcurrentPerCustomer: config.maxConcurrentPerCustomer,
          maxObjects: config.maxObjects,
          maxMutations: config.maxMutations
        }
      };
    },
    async close() {}
  };
}

export async function createProductionActiveCanaryRuntime({
  gateway,
  circuitGuard = null,
  credentialsRegistry,
  env = process.env,
  pool = null,
  clock = Date.now,
  logger = console
} = {}) {
  const config = loadActiveCanaryConfig(env);
  if (!config.allowActiveCanary) return disabledRuntime(config);

  if (!gateway?.get || !gateway?.execute || !gateway?.executeCanary) {
    throw new SearchAdWriteError('SEARCHAD_CANARY_GATEWAY_REQUIRED', 'Active Canary SearchAd gateway is unavailable.', {}, 503);
  }
  if (!credentialsRegistry?.resolve || !credentialsRegistry?.listCustomers) {
    throw new SearchAdWriteError('SEARCHAD_CANARY_CREDENTIALS_REQUIRED', 'Active Canary credential registry is unavailable.', {}, 503);
  }

  let ownedPool = false;
  let postgresPool = pool;
  if (!postgresPool) {
    if (!config.databaseUrl) {
      throw new SearchAdWriteError(
        'SEARCHAD_CANARY_DATABASE_REQUIRED',
        'DATABASE_URL is required when Active Canary is enabled.',
        {},
        503
      );
    }
    postgresPool = createPostgresPool({
      connectionString: config.databaseUrl,
      sslMode: config.postgresSslMode,
      logger
    });
    ownedPool = true;
  }
  if (!postgresPool?.query) {
    throw new SearchAdWriteError('SEARCHAD_CANARY_DATABASE_REQUIRED', 'A PostgreSQL pool is required for Active Canary.', {}, 503);
  }

  try {
    await assertSchemaReady(postgresPool);
    await ensureCustomerRows(postgresPool, credentialsRegistry);
    const { specSha, upstreamBaseUrl } = gatewayContext(gateway);
    const repository = new PostgresActiveCanaryRepository({ pool: postgresPool });
    const guard = circuitGuard || createCircuitGuard({ pool: postgresPool, clock });
    const remote = new ActiveCanaryGatewayRemoteAdapter({ gateway: createPostgresMutationGateway({ gateway, pool: postgresPool, circuitGuard: guard }) });
    const recipe = createStoppedWebSiteCampaignRecipe({
      dailyBudget: config.dailyBudgetKrw,
      budgetDelta: config.budgetDeltaKrw,
      statsTimeRange: config.statsTimeRange
    });
    const credentialFingerprintResolver = customerId => credentialFingerprintForCustomer(credentialsRegistry, customerId);
    const service = new ActiveCanaryService({
      repository,
      circuitGuard: guard,
      remote,
      recipe,
      config: {
        allowActiveCanary: true,
        activationMode: config.activationMode,
        observationPeriodMs: config.observationPeriodMs,
        evidenceTtlMs: config.evidenceTtlMs,
        specSha,
        upstreamBaseUrl
      },
      credentialFingerprintResolver,
      clock
    });

    return {
      config,
      repository,
      remote,
      recipe,
      service,
      status() {
        return {
          enabled: true,
          ready: true,
          activationMode: config.activationMode,
          specSha,
          upstreamBaseUrl,
          storage: { runtime: 'postgres', schemaReady: true },
          safety: {
            maxSpendKrw: config.maxSpendKrw,
            maxConcurrentPerCustomer: config.maxConcurrentPerCustomer,
            maxObjects: config.maxObjects,
            maxMutations: config.maxMutations,
            ttlMs: config.ttlMs,
            observationPeriodMs: config.observationPeriodMs,
            dailyBudgetKrw: config.dailyBudgetKrw,
            budgetDeltaKrw: config.budgetDeltaKrw,
            maxDailyBudgetKrw: config.maxDailyBudgetKrw,
            maxBudgetDeltaKrw: config.maxBudgetDeltaKrw
          }
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

export const _internal = { assertSchemaReady, ensureCustomerRows, gatewayContext };
