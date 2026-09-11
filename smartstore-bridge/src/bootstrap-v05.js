import { bootstrapV04 } from './bootstrap-v04.js';
import { loadSearchAdConfig } from './naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from './naver/searchad/auth.js';
import { NaverSearchAdClient } from './naver/searchad/client.js';
import { loadSearchAdSpecRegistry } from './naver/searchad/spec-registry.js';
import { SearchAdOperationGateway } from './naver/searchad/gateway.js';
import { SearchAdCapabilityService } from './naver/searchad/capability.js';
import { bootstrapSearchAdActivationRuntime } from './naver/searchad/activation/bootstrap.js';
import { createProductionSearchAdWriteRuntime } from './naver/searchad/write/runtime-production.js';
import { bootstrapSearchAdLifecycleRuntime } from './naver/searchad/lifecycle/bootstrap.js';
import { bootstrapActiveCanaryRuntime } from './naver/searchad/canary/bootstrap.js';
import { bootstrapMultiSourceCatalog } from './catalog/multi-source/bootstrap.js';
import { logger } from './infrastructure/logger.js';

export async function bootstrapV05(configPath, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
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

  const {
    runtime: searchAdActivationRuntime,
    startupError: searchAdActivationStartupError
  } = await bootstrapSearchAdActivationRuntime({
    app: {
      ...app,
      searchAdGateway,
      searchAdCredentials,
      searchAdCapabilityService
    },
    env,
    logger
  });

  let searchAdWriteRuntime = null;
  let searchAdWriteStartupError = null;
  if (searchAdGateway) {
    try {
      searchAdWriteRuntime = createProductionSearchAdWriteRuntime({
        gateway: searchAdGateway,
        activationGuard: searchAdActivationRuntime?.guard || null,
        ownershipGuard: null,
        env,
        baseDir: app.config?.workDir || process.cwd()
      });
    } catch (error) {
      searchAdWriteStartupError = {
        code: String(error?.code || 'SEARCHAD_WRITE_STARTUP_FAILED'),
        message: 'SearchAd write runtime startup failed; SearchAd writes remain unavailable.'
      };
      logger.error('SearchAd write runtime startup failed', { code: searchAdWriteStartupError.code });
    }
  }

  const {
    runtime: searchAdLifecycleRuntime,
    startupError: searchAdLifecycleStartupError
  } = await bootstrapSearchAdLifecycleRuntime({
    app: {
      ...app,
      searchAdGateway,
      searchAdCredentials,
      searchAdActivationRuntime,
      searchAdWriteRuntime
    },
    env,
    logger
  });

  const {
    runtime: searchAdActiveCanaryRuntime,
    startupError: searchAdActiveCanaryStartupError
  } = await bootstrapActiveCanaryRuntime({
    app: { ...app, searchAdGateway, searchAdCredentials },
    env,
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

  return {
    ...app,
    searchAdConfig,
    searchAdRegistry,
    searchAdCredentials,
    searchAdClient,
    searchAdGateway,
    searchAdCapabilityService,
    searchAdStartupError,
    searchAdActivationRuntime,
    searchAdActivationStartupError,
    searchAdWriteRuntime,
    searchAdWriteStartupError,
    searchAdLifecycleRuntime,
    searchAdLifecycleStartupError,
    searchAdActiveCanaryRuntime,
    searchAdActiveCanaryStartupError,
    multiSourceCatalogConfig,
    catalogSourceRegistry,
    salesChannelRegistry,
    multiSourceCatalogStartupErrors,
    multiSourceCatalogStartupError
  };
}
