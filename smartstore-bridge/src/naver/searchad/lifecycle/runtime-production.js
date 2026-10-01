import { SearchAdWriteError } from '../write/errors.js';
import { CampaignCreateService } from './campaign-create-service.js';

const ROOT_CREATE_RISK_UNITS = 2;
const DAILY_RISK_CAPACITY_UNITS = 5;
const REQUIRED_SCHEMA = Object.freeze([
  'runs', 'objects', 'events', 'ownership', 'plans',
  'approvals', 'attempts', 'risk_capacity', 'risk_reservations'
]);

function fail(code, message, details = {}) {
  throw new SearchAdWriteError(code, message, details, 503);
}

async function assertSchemaReady(pool) {
  const result = await pool.query(`
    SELECT
      to_regclass('searchad_hierarchy_canary_runs')::text AS runs,
      to_regclass('searchad_hierarchy_objects')::text AS objects,
      to_regclass('searchad_hierarchy_events')::text AS events,
      to_regclass('searchad_remote_object_ownership')::text AS ownership,
      to_regclass('searchad_write_change_plans')::text AS plans,
      to_regclass('searchad_write_approvals')::text AS approvals,
      to_regclass('searchad_write_attempts')::text AS attempts,
      to_regclass('searchad_daily_risk_capacity')::text AS risk_capacity,
      to_regclass('searchad_risk_reservations')::text AS risk_reservations
  `);
  const row = result.rows?.[0] || {};
  const missing = REQUIRED_SCHEMA.filter(key => !row[key]);
  if (missing.length) {
    fail(
      'SEARCHAD_HIERARCHY_SCHEMA_NOT_READY',
      'SearchAd hierarchy PostgreSQL schema is not ready. Run migrations through 0009 first.',
      { missing }
    );
  }
}

function disabledRuntime() {
  return {
    campaignCreateService: null,
    status() {
      return {
        enabled: false,
        ready: false,
        storage: { runtime: 'postgres', schemaReady: false },
        scope: { campaignCreate: false }
      };
    },
    async close() {}
  };
}

/**
 * Public wiring for the already verified bounded root campaign lifecycle.
 * The activation runtime owns the authoritative PostgreSQL pool/account row;
 * this runtime borrows it and never creates a second account authority.
 */
export async function createProductionSearchAdHierarchyRuntime({
  registry,
  credentialsRegistry,
  searchAdConfig,
  activeCanaryRuntime,
  activationRuntime,
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  logger = console
} = {}) {
  if (searchAdConfig?.allowActiveCanary !== true) return disabledRuntime();

  const activeStatus = activeCanaryRuntime?.status?.();
  const activationStatus = activationRuntime?.status?.();
  const pool = activationRuntime?.repository?.pool;
  const dailyBudget = activeCanaryRuntime?.config?.dailyBudgetKrw;

  if (activeStatus?.ready !== true) {
    fail('SEARCHAD_HIERARCHY_CANARY_RUNTIME_REQUIRED', 'A ready Active Canary runtime is required for hierarchy lifecycle wiring.');
  }
  if (activationStatus?.ready !== true || typeof pool?.query !== 'function' || typeof pool?.connect !== 'function') {
    fail('SEARCHAD_HIERARCHY_ACTIVATION_RUNTIME_REQUIRED', 'A ready native activation PostgreSQL runtime is required for hierarchy lifecycle wiring.');
  }
  if (typeof registry?.get !== 'function' || typeof registry?.status !== 'function' ||
      typeof credentialsRegistry?.resolve !== 'function') {
    fail('SEARCHAD_HIERARCHY_SEARCHAD_RUNTIME_REQUIRED', 'Pinned SearchAd registry and credentials are required for hierarchy lifecycle wiring.');
  }
  if (!Number.isSafeInteger(dailyBudget) || dailyBudget <= 0) {
    fail('SEARCHAD_HIERARCHY_POLICY_REQUIRED', 'The bounded server-owned Canary budget policy is unavailable.');
  }

  await assertSchemaReady(pool);
  const campaignCreateService = new CampaignCreateService({
    pool,
    registry,
    credentialsRegistry,
    config: searchAdConfig,
    enabled: true,
    dailyBudget,
    riskUnits: ROOT_CREATE_RISK_UNITS,
    dailyCapacityUnits: DAILY_RISK_CAPACITY_UNITS,
    planTtlSeconds: 300,
    clock,
    fetchImpl,
    logger
  });

  return {
    campaignCreateService,
    status() {
      return {
        enabled: true,
        ready: true,
        storage: { runtime: 'postgres', schemaReady: true },
        scope: {
          campaignCreate: true,
          adgroupCreate: false,
          siblingCreate: false,
          cleanup: false
        },
        risk: {
          rootCreateUnits: ROOT_CREATE_RISK_UNITS,
          dailyCapacityUnits: DAILY_RISK_CAPACITY_UNITS
        }
      };
    },
    // The activation runtime owns and closes the shared authoritative pool.
    async close() {}
  };
}

export const _internal = {
  assertSchemaReady,
  disabledRuntime,
  ROOT_CREATE_RISK_UNITS,
  DAILY_RISK_CAPACITY_UNITS
};
