import { getApplicationSearchAdWriteRuntime } from './naver/searchad/write/runtime-production.js';
import { circuitError } from './naver/searchad/circuit/postgres-repository.js';
import { bootstrapV04 } from './bootstrap-v04.js';
import { loadSearchAdConfig } from './naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from './naver/searchad/auth.js';
import { NaverSearchAdClient } from './naver/searchad/client.js';
import { loadSearchAdSpecRegistry } from './naver/searchad/spec-registry.js';
import { SearchAdOperationGateway } from './naver/searchad/gateway.js';
import { SearchAdCapabilityService } from './naver/searchad/capability.js';
import { bootstrapActiveCanaryRuntime } from './naver/searchad/canary/bootstrap.js';
import { bootstrapSearchAdActivationRuntime } from './naver/searchad/activation/bootstrap.js';
import { bootstrapSearchAdHierarchyRuntime } from './naver/searchad/lifecycle/bootstrap.js';
import { bootstrapSearchAdCompletionRuntime } from './naver/searchad/completion-bootstrap.js';
import { bootstrapMultiSourceCatalog } from './catalog/multi-source/bootstrap.js';
import { logger } from './infrastructure/logger.js';

export async function bootstrapV05(configPath, { env = process.env, fetchImpl = globalThis.fetch, clock = Date.now, blobStorage = null } = {}) {
  const app = await bootstrapV04(configPath, { env });
  const searchAdConfig = loadSearchAdConfig(env);
  let searchAdRegistry = null;
  let searchAdCredentials = null;
  let searchAdClient = null;
  let searchAdGateway = null;
  let searchAdCapabilityService = null;
  let searchAdStartupError = null;

  try {
    searchAdRegistry = loadSearchAdSpecRegistry(searchAdConfig.manifestPath);
    searchAdCredentials = new SearchAdCredentialsRegistry(searchAdConfig.topology);
    searchAdClient = new NaverSearchAdClient({
      baseUrl: searchAdConfig.baseUrl,
      credentialsRegistry: searchAdCredentials,
      fetchImpl,
      clock,
      requestTimeoutMs: searchAdConfig.requestTimeoutMs,
      maxRetries: searchAdConfig.maxRetries,
      logger
    });
    searchAdGateway = new SearchAdOperationGateway({
      client: searchAdClient,
      config: searchAdConfig,
      registry: searchAdRegistry,
      credentialsRegistry: searchAdCredentials,
      logger
    });
    searchAdCapabilityService = new SearchAdCapabilityService({
      gateway: searchAdGateway,
      config: searchAdConfig
    });
  } catch (error) {
    searchAdStartupError = {
      code: error.code || 'SEARCHAD_STARTUP_FAILED',
      message: error.message
    };
    logger.error('Naver SearchAd startup failed', searchAdStartupError);
  }

  let completionCircuit = null;
  const circuitGuard = Object.freeze(Object.fromEntries(['prepareDispatch', 'assertDispatchAllowed', 'projectOutcome'].map(method => [method, (...args) => {
    if (!completionCircuit) throw circuitError();
    return completionCircuit[method](...args);
  }])));

  const {
    runtime: searchAdActiveCanaryRuntime,
    startupError: searchAdActiveCanaryStartupError
  } = await bootstrapActiveCanaryRuntime({
    app: { ...app, searchAdGateway, searchAdCredentials },
    env,
    circuitGuard,
    clock,
    logger
  });

  const {
    runtime: searchAdActivationRuntime,
    startupError: searchAdActivationStartupError
  } = await bootstrapSearchAdActivationRuntime({
    app: { ...app, searchAdGateway, searchAdCredentials, searchAdCapabilityService },
    env,
    clock,
    logger
  });

  const {
    runtime: searchAdHierarchyRuntime,
    startupError: searchAdHierarchyStartupError
  } = await bootstrapSearchAdHierarchyRuntime({
    app: {
      ...app,
      searchAdRegistry,
      searchAdCredentials,
      searchAdConfig,
      searchAdActiveCanaryRuntime,
      searchAdActivationRuntime
    },
    fetchImpl,
    circuitGuard,
    clock,
    logger
  });

  let multiSourceCatalogConfig = null;
  let catalogSourceRegistry = null;
  let salesChannelRegistry = null;
  let multiSourceCatalogStartupErrors = [];
  let multiSourceCatalogStartupError = null;
  try {
    const multiSource = await bootstrapMultiSourceCatalog(app, { env, logger });
    ({
      multiSourceCatalogConfig,
      catalogSourceRegistry,
      salesChannelRegistry,
      multiSourceCatalogStartupErrors
    } = multiSource);
  } catch (error) {
    multiSourceCatalogStartupError = {
      code: error.code || 'MULTI_SOURCE_CATALOG_STARTUP_FAILED',
      message: error.message
    };
    logger.error('Multi-source catalog startup failed', multiSourceCatalogStartupError);
  }

  let completedApp;
  const { runtime: searchAdCompletionRuntime, startupError: searchAdCompletionStartupError } = await bootstrapSearchAdCompletionRuntime({
    app: { ...app, searchAdConfig, searchAdRegistry, searchAdCredentials, searchAdGateway, searchAdActivationRuntime, searchAdHierarchyRuntime, catalogSourceRegistry, salesChannelRegistry },
    env, clock, blobStorage, getWriteRuntime: () => getApplicationSearchAdWriteRuntime({app:completedApp,env}), logger
  });

  completionCircuit = searchAdCompletionRuntime?.circuitService || null;
  completedApp = {
    ...app,
    clock,
    searchAdCompletionRuntime,
    searchAdCompletionStartupError,
    searchAdCompletionRequired: searchAdConfig.configured === true && env.ATELIER_SEARCHAD_REPORTING_ENABLED !== 'false',
    searchAdConfig,
    searchAdRegistry,
    searchAdCredentials,
    searchAdClient,
    searchAdGateway,
    searchAdCapabilityService,
    searchAdStartupError,
    searchAdActiveCanaryRuntime,
    searchAdActiveCanaryStartupError,
    searchAdActivationRuntime,
    searchAdActivationStartupError,
    searchAdHierarchyRuntime,
    searchAdHierarchyStartupError,
    multiSourceCatalogConfig,
    catalogSourceRegistry,
    salesChannelRegistry,
    multiSourceCatalogStartupErrors,
    multiSourceCatalogStartupError
  };
  completedApp.close=()=>disposeApplicationV05(completedApp);
  return completedApp;
}

const disposal=new WeakMap();
/** Shared headless/HTTP resource owner; never opens an HTTP listener. */
export function disposeApplicationV05(app,{drainTimeoutMs=30000}={}) {
  if(disposal.has(app))return disposal.get(app);
  const pending=(async()=>{
    // A worker must drain before any shared writer, pool or ledger is closed.
    await app.searchAdCompletionRuntime?.workerRuntime?.close({drainTimeoutMs});
    const errors=[];
    for(const resource of new Set([app.searchAdCompletionRuntime,app.searchAdWriteRuntime,app.searchAdActiveCanaryRuntime,app.searchAdHierarchyRuntime,app.searchAdActivationRuntime,app.ledger])) {
      try { await resource?.close?.(); } catch(error) { errors.push(error); }
    }
    if(errors.length)throw new AggregateError(errors,'Application runtime shutdown failed.');
    return true;
  })().catch(error=>{if(error?.code==='SEARCHAD_WORKER_SHUTDOWN_PENDING')disposal.delete(app);throw error;});
  disposal.set(app,pending);return pending;
}
