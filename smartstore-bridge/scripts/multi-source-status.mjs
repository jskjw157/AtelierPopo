#!/usr/bin/env node
import { loadMultiSourceCatalogConfig, publicMultiSourceCatalogConfig } from '../src/catalog/multi-source/config.js';

const driveConfig = {
  catalogFolderId: process.env.GOOGLE_DRIVE_CATALOG_FOLDER_ID || '',
  cacheDir: process.env.ATELIER_DRIVE_CACHE_DIR || '/tmp/atelier-drive-cache'
};

try {
  const config = loadMultiSourceCatalogConfig(process.env, { driveConfig });
  console.log(JSON.stringify({ ok: true, catalog: publicMultiSourceCatalogConfig(config) }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: { code: error.code || 'MULTI_SOURCE_STATUS_FAILED', message: error.message, details: error.details || null }
  }, null, 2));
  process.exitCode = 1;
}
