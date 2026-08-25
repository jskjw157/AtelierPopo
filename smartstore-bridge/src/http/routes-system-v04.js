import { buildOpenApiSpecV04 } from './openapi-v04.js';
import {
  baseUrlFromRequest,
  ensureSameIdempotentOperation,
  operationResponse,
  operationStatusCode,
  route,
  sendJson
} from './runtime.js';
import { parseIntegerQuery, validateIdempotencyKey } from './security.js';
import { readinessV03 } from './routes-system-v03.js';

async function ensureDriveManifest(app) {
  if (!app.catalogMaterializer) return null;
  const manifest = await app.catalogMaterializer.ensureManifest();
  app.catalogRepository.setRoot(app.catalogMaterializer.cacheRoot);
  return manifest;
}

export function readinessV04(app, httpConfig, operationQueue) {
  const base = readinessV03(app, httpConfig, operationQueue);
  const commerceReady = Boolean(app.commerceGateway && app.commerceManifest?.operations?.length);
  return {
    ...base,
    commerce: {
      configured: Boolean(app.commerceConfig),
      ready: commerceReady,
      operationCount: app.commerceManifest?.operations?.length || 0,
      commerceApiVersion: app.commerceManifest?.commerceApiVersion || null,
      startupError: app.commerceStartupError || null,
      status: app.commerceGateway?.status?.() || null
    }
  };
}

export function createSystemRoutesV04({
  app,
  httpConfig,
  operationQueue,
  version,
  startedAt,
  createAsyncOperation,
  redactionRoots = []
}) {
  return [
    route('GET', /^\/$/, async ({ req, res }) => {
      sendJson(req, res, 200, {
        ok: true,
        service: 'haar-smartstore-commerce-drive-bridge',
        version,
        health: '/health',
        readiness: '/health/ready',
        openapi: '/openapi.json',
        driveStatus: '/api/v1/drive/status',
        commerceStatus: '/api/v1/commerce/status',
        commerceOperations: '/api/v1/commerce/operations'
      });
    }, { auth: false }),

    route('GET', /^\/health$/, async ({ req, res }) => {
      const state = readinessV04(app, httpConfig, operationQueue);
      sendJson(req, res, 200, {
        ok: true,
        status: state.readyForRead ? 'ok' : 'degraded',
        service: 'haar-smartstore-commerce-drive-bridge',
        version,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
      });
    }, { auth: false }),

    route('HEAD', /^\/health$/, async ({ req, res }) => {
      sendJson(req, res, 200, { ok: true });
    }, { auth: false }),

    route('GET', /^\/health\/ready$/, async ({ req, res }) => {
      const state = readinessV04(app, httpConfig, operationQueue);
      sendJson(req, res, state.readyForRead ? 200 : 503, {
        ok: state.readyForRead,
        status: state.readyForRead ? 'ready' : 'not_ready',
        service: 'haar-smartstore-commerce-drive-bridge',
        version
      });
    }, { auth: false }),

    route('GET', /^\/openapi\.json$/, async ({ req, res }) => {
      sendJson(req, res, 200, buildOpenApiSpecV04({ serverUrl: baseUrlFromRequest(req), version }));
    }, { auth: false }),

    route('GET', /^\/api\/v1\/status$/, async ({ req, res }) => {
      sendJson(req, res, 200, {
        ok: true,
        service: 'haar-smartstore-commerce-drive-bridge',
        version,
        readiness: readinessV04(app, httpConfig, operationQueue),
        jobs: app.ledger.counts(),
        operations: app.ledger.operationCounts(),
        drive: app.driveService ? await app.driveService.status({ verifyRemote: false }) : null,
        commerce: app.commerceGateway?.status?.() || null
      });
    }),

    route('POST', /^\/api\/v1\/auth\/test$/, async ({ req, res }) => {
      const { issueAccessToken } = await import('../naver/auth.js');
      const token = await issueAccessToken({
        clientId: app.config.naver.clientId,
        clientSecret: app.config.naver.clientSecret,
        tokenType: app.config.naver.tokenType,
        accountId: app.config.naver.accountId,
        baseUrl: app.config.naver.baseUrl
      });
      sendJson(req, res, 200, {
        ok: true,
        tokenType: token.tokenType,
        expiresIn: token.expiresIn
      });
    }),

    route('GET', /^\/api\/v1\/catalog\/stats$/, async ({ req, res }) => {
      await ensureDriveManifest(app);
      sendJson(req, res, 200, { ok: true, catalog: app.catalogRepository.stats() });
    }),

    route('POST', /^\/api\/v1\/catalog\/enqueue$/, async ({ req, res, body }) => {
      if (!app.catalogMaterializer) {
        sendJson(req, res, 200, { ok: true, result: app.productService.enqueueCatalog(app.config.catalogRoot) });
        return;
      }
      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const force = Boolean(body.force);
      const manifest = await app.catalogMaterializer.ensureManifest({ force });
      const total = Number(manifest.total_products || Object.keys(manifest.products || {}).length || 0);
      const limit = parseIntegerQuery(body.limit, total || 1, { min: 1, max: 2000 });
      const concurrency = parseIntegerQuery(body.concurrency, 4, { min: 1, max: 8 });
      const operationType = 'sync_and_enqueue_catalog';
      const sourceProductId = `catalog:${limit}:${force ? 'force' : 'cached'}`;
      const operationRequest = { limit, force, concurrency };
      const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
      if (existing) {
        ensureSameIdempotentOperation(existing, { operationType, sourceProductId, request: operationRequest });
        sendJson(req, res, operationStatusCode(existing), operationResponse(existing, {
          reused: true,
          redactionRoots
        }), { Location: `/api/v1/operations/${existing.operation_id}` });
        return;
      }
      const created = await createAsyncOperation({
        idempotencyKey,
        operationType,
        sourceProductId,
        request: operationRequest,
        task: async () => {
          const sync = await app.catalogMaterializer.syncCatalog({
            includeImages: false,
            limit,
            force,
            concurrency,
            resultLimit: 100
          });
          app.catalogRepository.setRoot(app.catalogMaterializer.cacheRoot);
          const enqueue = app.productService.enqueueCatalog(app.catalogMaterializer.cacheRoot);
          return { sync, enqueue };
        }
      });
      sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
        reused: created.reused,
        redactionRoots
      }), { Location: `/api/v1/operations/${created.row.operation_id}` });
    }, { write: true })
  ];
}
