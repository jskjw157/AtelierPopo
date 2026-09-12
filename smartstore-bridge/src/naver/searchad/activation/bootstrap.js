import { createProductionSearchAdActivationRuntime } from './runtime-production.js';

function publicStartupError(error) {
  return {
    code: String(error?.code || 'SEARCHAD_ACTIVATION_STARTUP_FAILED'),
    message: 'SearchAd activation startup failed; activation remains unavailable.'
  };
}

export async function bootstrapSearchAdActivationRuntime({
  app = {},
  env = process.env,
  pool = null,
  clock = Date.now,
  logger = console
} = {}) {
  try {
    const runtime = await createProductionSearchAdActivationRuntime({
      gateway: app.searchAdGateway,
      credentialsRegistry: app.searchAdCredentials,
      capabilityService: app.searchAdCapabilityService,
      env,
      pool,
      clock,
      logger
    });
    return { runtime, startupError: null };
  } catch (error) {
    const startupError = publicStartupError(error);
    logger.error?.('SearchAd activation startup failed', { code: startupError.code });
    return { runtime: null, startupError };
  }
}

export const _internal = { publicStartupError };
