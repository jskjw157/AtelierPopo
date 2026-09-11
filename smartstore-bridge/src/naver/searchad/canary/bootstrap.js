import { createProductionActiveCanaryRuntime } from './runtime-production.js';

function publicStartupError(error) {
  return {
    code: String(error?.code || 'SEARCHAD_CANARY_STARTUP_FAILED'),
    message: 'SearchAd Active Canary startup failed; Canary remains unavailable.'
  };
}

export async function bootstrapActiveCanaryRuntime({
  app = {},
  env = process.env,
  pool = null,
  clock = Date.now,
  logger = console
} = {}) {
  try {
    const runtime = await createProductionActiveCanaryRuntime({
      gateway: app.searchAdGateway,
      credentialsRegistry: app.searchAdCredentials,
      env,
      pool,
      clock,
      logger
    });
    return { runtime, startupError: null };
  } catch (error) {
    const startupError = publicStartupError(error);
    logger.error?.('SearchAd Active Canary startup failed', { code: startupError.code });
    return { runtime: null, startupError };
  }
}

export const _internal = { publicStartupError };
