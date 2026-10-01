import { createProductionSearchAdHierarchyRuntime } from './runtime-production.js';

function publicStartupError(error) {
  return {
    code: String(error?.code || 'SEARCHAD_HIERARCHY_STARTUP_FAILED'),
    message: 'SearchAd hierarchy lifecycle startup failed; hierarchy mutations remain unavailable.'
  };
}

export async function bootstrapSearchAdHierarchyRuntime({
  app = {},
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  logger = console
} = {}) {
  try {
    const runtime = await createProductionSearchAdHierarchyRuntime({
      registry: app.searchAdRegistry,
      credentialsRegistry: app.searchAdCredentials,
      searchAdConfig: app.searchAdConfig,
      activeCanaryRuntime: app.searchAdActiveCanaryRuntime,
      activationRuntime: app.searchAdActivationRuntime,
      fetchImpl,
      clock,
      logger
    });
    return { runtime, startupError: null };
  } catch (error) {
    const startupError = publicStartupError(error);
    logger.error?.('SearchAd hierarchy lifecycle startup failed', { code: startupError.code });
    return { runtime: null, startupError };
  }
}

export const _internal = { publicStartupError };
