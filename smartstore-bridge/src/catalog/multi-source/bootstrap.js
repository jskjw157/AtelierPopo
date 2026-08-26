import fs from 'node:fs';
import path from 'node:path';
import { DriveCatalogMaterializer } from '../../drive/catalog-materializer.js';
import { loadMultiSourceCatalogConfig } from './config.js';
import { CatalogSourceRegistry, SalesChannelRegistry } from './source-registry.js';
import { GoogleDriveManifestCatalogProvider } from './providers/google-drive-manifest-provider.js';

function sameId(left, right) {
  return String(left || '').trim() && String(left || '').trim() === String(right || '').trim();
}

export async function bootstrapMultiSourceCatalog(app, { env = process.env, logger = console } = {}) {
  const config = loadMultiSourceCatalogConfig(env, { driveConfig: app.driveConfig });
  fs.mkdirSync(config.cacheRoot, { recursive: true });
  const sourceRegistry = new CatalogSourceRegistry({ sources: config.sources, logger });
  const salesChannelRegistry = new SalesChannelRegistry(config.channels);
  const startupErrors = [];

  if (config.enabled) {
    for (const source of config.sources) {
      try {
        if (source.providerType === 'google_drive_manifest') {
          if (!app.driveService) {
            throw Object.assign(new Error('Google Drive 서비스가 설정되지 않았습니다.'), {
              code: 'MULTI_SOURCE_DRIVE_NOT_READY'
            });
          }
          const materializer = app.catalogMaterializer
            && sameId(source.rootReference, app.driveConfig?.catalogFolderId)
            ? app.catalogMaterializer
            : new DriveCatalogMaterializer({
              driveService: app.driveService,
              cacheRoot: path.join(config.cacheRoot, source.sourceId),
              catalogFolderId: source.rootReference,
              cacheTtlSeconds: app.driveConfig?.cacheTtlSeconds || 3600
            });
          sourceRegistry.registerProvider(source.sourceId, new GoogleDriveManifestCatalogProvider({
            source,
            materializer
          }));
          continue;
        }
        startupErrors.push({
          sourceId: source.sourceId,
          providerType: source.providerType,
          code: 'MULTI_SOURCE_PROVIDER_NOT_IMPLEMENTED',
          message: `${source.providerType} Provider는 다음 단계에서 구현됩니다.`
        });
      } catch (error) {
        const item = {
          sourceId: source.sourceId,
          providerType: source.providerType,
          code: error.code || 'MULTI_SOURCE_PROVIDER_STARTUP_FAILED',
          message: error.message
        };
        startupErrors.push(item);
        logger?.error?.('Multi-source catalog provider startup failed', item);
      }
    }
  }

  return {
    multiSourceCatalogConfig: config,
    catalogSourceRegistry: sourceRegistry,
    salesChannelRegistry,
    multiSourceCatalogStartupErrors: startupErrors
  };
}
