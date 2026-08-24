#!/usr/bin/env node
import { bootstrapV03 } from './bootstrap-v03.js';
import { createHttpApiV03 } from './http/server-v03.js';
import { logger } from './infrastructure/logger.js';

const app = await bootstrapV03();
const api = createHttpApiV03({ app, logger });
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
    driveEnabled: app.driveConfig.enabled,
    driveWritesEnabled: app.driveConfig.allowWrites,
    driveAuthMode: app.driveConfig.authMode,
    drivePrincipal: app.driveConfig.authMode === 'user-oauth'
      ? app.driveConfig.userOAuth?.userEmail || null
      : app.driveConfig.serviceAccount?.clientEmail || null,
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
