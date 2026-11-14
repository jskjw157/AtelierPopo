#!/usr/bin/env node
import { bootstrapV05 } from './bootstrap-v05.js';
import { createHttpApiV05 } from './http/server-v05.js';
import { logger } from './infrastructure/logger.js';
import { SERVICE_VERSION } from './version.js';

const app = await bootstrapV05();
const api = createHttpApiV05({ app, logger, version: SERVICE_VERSION });
let closing = false;

async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info('HTTP server shutting down', { signal });
  try { await api.close(); } catch (error) {
    logger.error('HTTP server shutdown failed', { message: error.message, stack: error.stack });
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  const address = await api.listen();
  logger.info('HTTP server started', {
    version: SERVICE_VERSION,
    host: typeof address === 'object' ? address.address : api.httpConfig.host,
    port: typeof address === 'object' ? address.port : api.httpConfig.port,
    commerceOperations: app.commerceManifest?.operations?.length || 0,
    searchAdOperations: app.searchAdRegistry?.manifest?.operations?.length || 0,
    searchAdConfigured: Boolean(app.searchAdConfig?.configured),
    searchAdStartupError: app.searchAdStartupError || null,
    catalogSources: app.catalogSourceRegistry?.status?.() || null,
    salesChannels: app.salesChannelRegistry?.status?.() || null,
    multiSourceCatalogStartupError: app.multiSourceCatalogStartupError || null,
    multiSourceCatalogStartupErrors: app.multiSourceCatalogStartupErrors || []
  });
} catch (error) {
  logger.error('HTTP server failed to start', { message: error.message, stack: error.stack });
  process.exitCode = 1;
  try { await api.close(); } catch {}
}
