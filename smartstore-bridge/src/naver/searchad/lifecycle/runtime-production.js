import { SearchAdWriteError } from '../write/errors.js';
import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { CampaignCreateService } from './campaign-create-service.js';
import { AdgroupCreateService } from './adgroup-create-service.js';
import { SiblingCreateService } from './sibling-create-service.js';
import { ChildFirstCleanupService } from './child-first-cleanup-service.js';
import { DescendantInventoryService } from './descendant-inventory-service.js';
import { PostgresDescendantInventoryRepository } from './postgres-descendant-inventory-repository.js';

const ORIGIN = 'https://api.searchad.naver.com';
const ROOT_CREATE_RISK_UNITS = 2;
const ADGROUP_CREATE_RISK_UNITS = 1;
const SIBLING_CREATE_RISK_UNITS = 1;
const LEAF_CLEANUP_RISK_UNITS = 1;
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
    adgroupCreateService: null,
    siblingCreateService: null,
    leafCleanupService: null,
    descendantInventoryService: null,
    status() {
      return {
        enabled: false,
        ready: false,
        storage: { runtime: 'postgres', schemaReady: false },
        scope: { campaignCreate: false, adgroupCreate: false, siblingCreate: false, leafCleanup: false, inventoryScan: false, cleanup: false }
      };
    },
    async close() {}
  };
}

/**
 * Public wiring for the already verified bounded root + one-adgroup lifecycle.
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
  const common = {
    pool,
    registry,
    credentialsRegistry,
    config: searchAdConfig,
    enabled: true,
    dailyBudget,
    dailyCapacityUnits: DAILY_RISK_CAPACITY_UNITS,
    planTtlSeconds: 300,
    clock,
    fetchImpl,
    logger
  };
  const campaignCreateService = new CampaignCreateService({
    ...common,
    riskUnits: ROOT_CREATE_RISK_UNITS
  });
  const adgroupCreateService = new AdgroupCreateService({
    ...common,
    riskUnits: ADGROUP_CREATE_RISK_UNITS
  });
  const siblingCreateService = new SiblingCreateService({
    ...common,
    riskUnits: SIBLING_CREATE_RISK_UNITS
  });
  const leafCleanupService = new ChildFirstCleanupService({
    ...common,
    riskUnits: LEAF_CLEANUP_RISK_UNITS,
    allowedObjectTypes: ['keyword','creative']
  });

  // Observation is deliberately separate from the mutation services. It uses
  // the same pinned registry/current credentials but only executes operations
  // whose manifest classification is read-only. The HTTP projection below
  // never exposes the discovered remote IDs as local mapping authority.
  const inventoryFetch = async (url, init = {}) => {
    const target = new URL(url);
    if (target.origin !== ORIGIN || target.username || target.password) {
      fail('SEARCHAD_HIERARCHY_INVENTORY_ORIGIN_INVALID', 'Inventory reads require the fixed official SearchAd origin.');
    }
    const response = await fetchImpl(url, { ...init, redirect: 'error' });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      fail('SEARCHAD_HIERARCHY_INVENTORY_REDIRECT_FORBIDDEN', 'Inventory redirects are forbidden.');
    }
    return response;
  };
  const inventoryClient = new NaverSearchAdClient({
    baseUrl: ORIGIN,
    credentialsRegistry,
    fetchImpl: inventoryFetch,
    clock,
    maxRetries: 0,
    logger
  });
  const inventoryGateway = new SearchAdOperationGateway({
    client: inventoryClient,
    config: searchAdConfig,
    registry,
    credentialsRegistry,
    logger
  });
  const inventoryRepository = new PostgresDescendantInventoryRepository({ pool });
  const inventoryContext = customerId => {
    if (searchAdConfig?.baseUrl !== ORIGIN) {
      fail('SEARCHAD_HIERARCHY_INVENTORY_CONTEXT_INVALID', 'Inventory requires the fixed official SearchAd origin.');
    }
    const specSha = registry.status().specRef;
    const credentialFingerprint = credentialFingerprintForCustomer(credentialsRegistry, customerId);
    if (typeof specSha !== 'string' || !specSha ||
        typeof credentialFingerprint !== 'string' || !credentialFingerprint) {
      fail('SEARCHAD_HIERARCHY_INVENTORY_CONTEXT_INVALID', 'Current pinned SearchAd identity is unavailable.');
    }
    return { specSha, credentialFingerprint, upstreamBaseUrl: ORIGIN };
  };
  const descendantInventoryService = new DescendantInventoryService({
    repository: inventoryRepository,
    remote: {
      read(descriptor) {
        return inventoryGateway.execute(descriptor.operationKey, {
          customerId: descriptor.customerId,
          pathParams: descriptor.pathParams || {},
          query: descriptor.query || {},
          ...(descriptor.body === undefined ? {} : { body: descriptor.body })
        });
      }
    },
    contextResolver: inventoryContext,
    clock
  });

  return {
    campaignCreateService,
    adgroupCreateService,
    siblingCreateService,
    leafCleanupService,
    descendantInventoryService,
    status() {
      return {
        enabled: true,
        ready: true,
        storage: { runtime: 'postgres', schemaReady: true },
        scope: {
          campaignCreate: true,
          adgroupCreate: true,
          siblingCreate: true,
          leafCleanup: true,
          inventoryScan: true,
          cleanup: false
        },
        risk: {
          rootCreateUnits: ROOT_CREATE_RISK_UNITS,
          adgroupCreateUnits: ADGROUP_CREATE_RISK_UNITS,
          siblingCreateUnits: SIBLING_CREATE_RISK_UNITS,
          leafCleanupUnits: LEAF_CLEANUP_RISK_UNITS,
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
  ADGROUP_CREATE_RISK_UNITS,
  SIBLING_CREATE_RISK_UNITS,
  LEAF_CLEANUP_RISK_UNITS,
  DAILY_RISK_CAPACITY_UNITS
};
