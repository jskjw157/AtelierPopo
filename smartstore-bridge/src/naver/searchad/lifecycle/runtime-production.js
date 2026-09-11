import { createPostgresPool, closePostgresPool } from '../../../infrastructure/postgres/pool.js';
import { SearchAdWriteError } from '../write/errors.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { ActiveCanaryGatewayRemoteAdapter } from '../canary/remote-adapter.js';
import { PostgresSearchAdLifecycleRepository } from './postgres-repository.js';
import { SearchAdLifecycleRiskService } from './risk-service.js';
import { SearchAdLifecycleActivationGuard } from './activation-guard.js';
import { SearchAdCanaryOwnershipGuard } from './ownership-guard.js';
import { HierarchyCanaryService } from './hierarchy-canary-service.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from './operations.js';

const REQUIRED_SCHEMA = Object.freeze(['runs', 'objects', 'events', 'ownership', 'capacity', 'reservations']);
const MUTATION_METHODS = Object.freeze(['start', 'createAdgroup', 'createKeywords', 'createCreative', 'cleanupNext']);

function fail(code, message, details = {}, status = 503) {
  throw new SearchAdWriteError(code, message, details, status);
}

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function integer(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) fail('SEARCHAD_HIERARCHY_CONFIG_INVALID', 'Hierarchy Canary integer configuration is invalid.');
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail('SEARCHAD_HIERARCHY_CONFIG_INVALID', 'Hierarchy Canary integer configuration is outside the allowed range.');
  }
  return parsed;
}

function loadConfig(env = process.env) {
  return {
    mutationEnabled: bool(env.ATELIER_SEARCHAD_HIERARCHY_CANARY_ENABLED, false),
    databaseUrl: String(env.DATABASE_URL || '').trim() || null,
    postgresSslMode: String(env.ATELIER_POSTGRES_SSL_MODE || 'require').trim() || 'require',
    dailyRiskCapacityUnits: integer(env.ATELIER_SEARCHAD_HIERARCHY_DAILY_RISK_CAPACITY, 20, { min: 1, max: 1000 }),
    campaignDailyBudget: integer(env.ATELIER_SEARCHAD_HIERARCHY_DAILY_BUDGET, 1000, { min: 1, max: 1000000000 })
  };
}

async function assertSchemaReady(pool) {
  const result = await pool.query(`
    SELECT
      to_regclass('searchad_hierarchy_canary_runs')::text AS runs,
      to_regclass('searchad_hierarchy_objects')::text AS objects,
      to_regclass('searchad_hierarchy_events')::text AS events,
      to_regclass('searchad_remote_object_ownership')::text AS ownership,
      to_regclass('searchad_daily_risk_capacity')::text AS capacity,
      to_regclass('searchad_risk_reservations')::text AS reservations
  `);
  const row = result.rows?.[0] || {};
  const missing = REQUIRED_SCHEMA.filter(key => !row[key]);
  if (missing.length) {
    fail('SEARCHAD_HIERARCHY_SCHEMA_NOT_READY', 'SearchAd hierarchy lifecycle PostgreSQL schema is not ready. Run migrations through 0009 first.', { missing });
  }
}

function currentGatewayContext(gateway) {
  const status = gateway?.status?.() || {};
  const specSha = String(status.specRef || gateway?.registry?.manifest?.specRef || '').trim();
  const upstreamBaseUrl = String(status.baseUrl || gateway?.config?.baseUrl || '').trim().replace(/\/$/, '');
  if (!specSha || !upstreamBaseUrl) {
    fail('SEARCHAD_HIERARCHY_GATEWAY_CONTEXT_REQUIRED', 'Hierarchy Canary requires the current SearchAd spec reference and upstream base URL.');
  }
  return { specSha, upstreamBaseUrl };
}

function riskPolicy() {
  return Object.freeze({
    [SEARCHAD_HIERARCHY_OPERATIONS.campaign.create]: Object.freeze({ lifecycleKind: 'create', units: 1 }),
    [SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create]: Object.freeze({ lifecycleKind: 'create', units: 1 }),
    [SEARCHAD_HIERARCHY_OPERATIONS.keyword.create]: Object.freeze({ lifecycleKind: 'batch_create', units: 2 }),
    [SEARCHAD_HIERARCHY_OPERATIONS.creative.create]: Object.freeze({ lifecycleKind: 'create', units: 1 }),
    [SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete]: Object.freeze({ lifecycleKind: 'delete', units: 1 }),
    [SEARCHAD_HIERARCHY_OPERATIONS.adgroup.delete]: Object.freeze({ lifecycleKind: 'delete', units: 1 }),
    [SEARCHAD_HIERARCHY_OPERATIONS.keyword.delete]: Object.freeze({ lifecycleKind: 'delete', units: 1 }),
    [SEARCHAD_HIERARCHY_OPERATIONS.creative.delete]: Object.freeze({ lifecycleKind: 'delete', units: 1 })
  });
}

function disabledMutation() {
  fail('SEARCHAD_HIERARCHY_CANARY_DISABLED', 'SearchAd hierarchy lifecycle mutation gate is disabled.', {}, 403);
}

export async function createProductionSearchAdLifecycleRuntime({
  gateway,
  credentialsRegistry,
  activationRuntime,
  approvalService = null,
  env = process.env,
  pool = null,
  clock = Date.now,
  logger = console
} = {}) {
  if (!gateway?.get || !gateway?.execute || !gateway?.executeCanary) {
    fail('SEARCHAD_HIERARCHY_GATEWAY_REQUIRED', 'SearchAd gateway is required for hierarchy lifecycle runtime.');
  }
  if (!credentialsRegistry?.resolve || !credentialsRegistry?.listCustomers) {
    fail('SEARCHAD_HIERARCHY_CREDENTIALS_REQUIRED', 'SearchAd credential registry is required for hierarchy lifecycle runtime.');
  }
  if (!activationRuntime?.repository || activationRuntime?.status?.()?.ready !== true) {
    fail('SEARCHAD_HIERARCHY_ACTIVATION_REQUIRED', 'SearchAd activation runtime must be ready before hierarchy lifecycle runtime.');
  }

  const config = loadConfig(env);
  if (config.mutationEnabled && !approvalService?.claim) {
    fail('SEARCHAD_HIERARCHY_APPROVAL_REQUIRED', 'Enabled hierarchy lifecycle mutation requires the established SearchAd one-time approval service.');
  }

  let postgresPool = pool;
  let ownedPool = false;
  if (!postgresPool) {
    if (!config.databaseUrl) fail('SEARCHAD_HIERARCHY_DATABASE_REQUIRED', 'DATABASE_URL is required for hierarchy lifecycle runtime.');
    postgresPool = createPostgresPool({ connectionString: config.databaseUrl, sslMode: config.postgresSslMode, logger });
    ownedPool = true;
  }
  if (!postgresPool?.query) fail('SEARCHAD_HIERARCHY_DATABASE_REQUIRED', 'A PostgreSQL pool is required for hierarchy lifecycle runtime.');

  try {
    await assertSchemaReady(postgresPool);
    const gatewayContext = currentGatewayContext(gateway);
    const repository = new PostgresSearchAdLifecycleRepository({ pool: postgresPool });
    const credentialFingerprintResolver = async customerId => credentialFingerprintForCustomer(credentialsRegistry, customerId);
    const activationGuard = new SearchAdLifecycleActivationGuard({
      repository: activationRuntime.repository,
      gateway,
      credentialFingerprintResolver,
      gatewayContext,
      clock
    });
    const riskService = new SearchAdLifecycleRiskService({
      repository,
      dailyCapacityUnits: config.dailyRiskCapacityUnits,
      riskPolicy: riskPolicy(),
      clock
    });
    const ownershipGuard = new SearchAdCanaryOwnershipGuard({ repository });
    const remote = new ActiveCanaryGatewayRemoteAdapter({ gateway });
    const campaignRecipe = createHierarchyCampaignRecipe({ dailyBudget: config.campaignDailyBudget });
    const childRecipe = createHierarchyChildRecipe();
    const failClosedApproval = approvalService?.claim
      ? approvalService
      : { claim() { fail('SEARCHAD_HIERARCHY_APPROVAL_REQUIRED', 'Hierarchy lifecycle mutation approval service is unavailable.'); } };
    const baseService = new HierarchyCanaryService({
      repository,
      activationGuard,
      riskService,
      approvalService: failClosedApproval,
      remote,
      campaignRecipe,
      childRecipe,
      gatewayContext,
      credentialFingerprintResolver,
      clock
    });
    const service = { reconcile: baseService.reconcile.bind(baseService) };
    for (const method of MUTATION_METHODS) {
      service[method] = config.mutationEnabled
        ? baseService[method].bind(baseService)
        : disabledMutation;
    }

    return {
      config,
      repository,
      riskService,
      activationGuard,
      ownershipGuard,
      remote,
      baseService,
      service,
      status() {
        return {
          ready: true,
          mutationEnabled: config.mutationEnabled,
          activationReady: true,
          gatewayReady: true,
          storage: { runtime: 'postgres', schemaReady: true },
          risk: { dailyCapacityUnits: config.dailyRiskCapacityUnits }
        };
      },
      async close() {
        if (ownedPool) await closePostgresPool(postgresPool);
      }
    };
  } catch (error) {
    if (ownedPool) {
      try { await closePostgresPool(postgresPool); } catch {}
    }
    throw error;
  }
}

export const _internal = { loadConfig, assertSchemaReady, currentGatewayContext, riskPolicy, MUTATION_METHODS };
