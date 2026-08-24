import fs from 'node:fs';
import path from 'node:path';
import { bootstrap } from './bootstrap.js';
import { loadDriveConfig } from './drive/config.js';
import { GoogleDriveService } from './drive/service.js';
import { DriveCatalogMaterializer } from './drive/catalog-materializer.js';
import { logger } from './infrastructure/logger.js';

export async function bootstrapV03(configPath, { env = process.env } = {}) {
  const driveConfig = loadDriveConfig(env);
  const catalogProvider = String(env.ATELIER_CATALOG_PROVIDER || (driveConfig.catalogFolderId ? 'google-drive' : 'local'))
    .trim()
    .toLowerCase();
  let driveCatalogRoot = null;
  if (driveConfig.enabled) fs.mkdirSync(driveConfig.cacheDir, { recursive: true });
  if (driveConfig.enabled && catalogProvider === 'google-drive') {
    driveCatalogRoot = path.join(driveConfig.cacheDir, 'catalog');
    fs.mkdirSync(driveCatalogRoot, { recursive: true });
    if (!process.env.ATELIER_CATALOG_ROOT) process.env.ATELIER_CATALOG_ROOT = driveCatalogRoot;
  }

  const app = bootstrap(configPath);
  const driveService = driveConfig.enabled
    ? new GoogleDriveService({
      config: driveConfig,
      logger,
      localUploadRoots: [app.config.workDir, driveConfig.cacheDir]
    })
    : null;
  const catalogMaterializer = driveService && catalogProvider === 'google-drive'
    ? new DriveCatalogMaterializer({
      driveService,
      cacheRoot: driveCatalogRoot,
      catalogFolderId: driveConfig.catalogFolderId,
      cacheTtlSeconds: driveConfig.cacheTtlSeconds
    })
    : null;
  let driveStartupError = null;
  if (catalogMaterializer) {
    try {
      await catalogMaterializer.ensureManifest();
      app.catalogRepository.setRoot(driveCatalogRoot);
    } catch (error) {
      driveStartupError = {
        code: error.code || 'DRIVE_CATALOG_STARTUP_SYNC_FAILED',
        message: error.message
      };
      logger.error('Drive catalog startup sync failed', driveStartupError);
    }
  }

  return {
    ...app,
    driveConfig,
    driveService,
    catalogProvider,
    catalogMaterializer,
    driveStartupError
  };
}
