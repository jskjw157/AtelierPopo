import fs from 'node:fs';
import { bootstrapV03 } from './bootstrap-v03.js';
import { loadCommerceGatewayConfig } from './naver/commerce/config.js';
import { loadCommerceManifest } from './naver/commerce/spec.js';
import { CommerceOperationGateway } from './naver/commerce/gateway.js';
import { DetailContentService } from './application/commerce/detail-content-service.js';
import { logger } from './infrastructure/logger.js';

export async function bootstrapV04(configPath, { env = process.env } = {}) {
  const app = await bootstrapV03(configPath, { env });
  const commerceConfig = loadCommerceGatewayConfig(env);
  fs.mkdirSync(commerceConfig.backupDir, { recursive: true });
  let commerceManifest = null;
  let commerceGateway = null;
  let commerceStartupError = null;
  try {
    commerceManifest = loadCommerceManifest(commerceConfig.manifestPath);
    commerceGateway = new CommerceOperationGateway({
      client: app.client,
      config: commerceConfig,
      manifest: commerceManifest,
      logger
    });
  } catch (error) {
    commerceStartupError = {
      code: error.code || 'COMMERCE_GATEWAY_STARTUP_FAILED',
      message: error.message
    };
    logger.error('Naver Commerce gateway startup failed', commerceStartupError);
  }
  const detailContentService = new DetailContentService({
    productsApi: app.productsApi,
    backupDir: commerceConfig.backupDir,
    logger
  });
  return {
    ...app,
    commerceConfig,
    commerceManifest,
    commerceGateway,
    commerceStartupError,
    detailContentService
  };
}
