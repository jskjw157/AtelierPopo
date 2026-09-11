import { createProductionSearchAdLifecycleRuntime } from './runtime-production.js';

function publicStartupError(error) {
  return {
    code: String(error?.code || 'SEARCHAD_HIERARCHY_STARTUP_FAILED'),
    message: 'SearchAd hierarchy lifecycle startup failed; hierarchy lifecycle remains unavailable.'
  };
}

export async function bootstrapSearchAdLifecycleRuntime({
  app = {},
  env = process.env,
  pool = null,
  clock = Date.now,
  logger = console
} = {}) {
  try {
    const runtime = await createProductionSearchAdLifecycleRuntime({
      gateway: app.searchAdGateway,
      credentialsRegistry: app.searchAdCredentials,
      activationRuntime: app.searchAdActivationRuntime,
      approvalService: app.searchAdWriteRuntime?.approvalService || null,
      env,
      pool,
      clock,
      logger
    });

    const writeRuntime = app.searchAdWriteRuntime;
    if (runtime?.ownershipGuard && writeRuntime) {
      if (typeof writeRuntime.setOwnershipGuard === 'function') {
        writeRuntime.setOwnershipGuard(runtime.ownershipGuard);
      } else if (writeRuntime.executionService) {
        writeRuntime.executionService.ownershipGuard = runtime.ownershipGuard;
      }
    }

    return { runtime, startupError: null };
  } catch (error) {
    const startupError = publicStartupError(error);
    logger.error?.('SearchAd hierarchy lifecycle startup failed', { code: startupError.code });
    return { runtime: null, startupError };
  }
}

export const _internal = { publicStartupError };
