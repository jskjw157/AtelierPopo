#!/usr/bin/env node
import { bootstrapV04 } from './bootstrap-v04.js';
import { createHttpApiV04 } from './http/server-v04.js';
import { logger } from './infrastructure/logger.js';

const app = await bootstrapV04();
const api = createHttpApiV04({ app, logger });
let closing = false;

async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info('HTTP server shutting down', { signal });
  try {
    await api.close();
    logger.info('HTTP server stopped');
  } catch (error) {
    logger.error('HTTP server shutdown failed', { message: error.message, stack: error.stack });
    process.exitCode = 1;
  }
}

async function main() {
  const address = await api.listen();
  logger.info('HTTP server started', {
    host: typeof address === 'object' ? address.address : api.httpConfig.host,
    port: typeof address === 'object' ? address.port : api.httpConfig.port,
    writesEnabled: api.httpConfig.allowWrites,
    batchWritesEnabled: api.httpConfig.allowBatchWrites,
    commerceOperations: app.commerceManifest?.operations?.length || 0,
    readiness: api.readiness()
  });
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

main().catch(async error => {
  logger.error('HTTP server failed to start', { message: error.message, stack: error.stack });
  process.exitCode = 1;
  try { await api.close(); } catch {}
});
