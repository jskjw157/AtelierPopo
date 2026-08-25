import { buildOpenApiSpec } from './openapi-v03.js';
import {
  baseUrlFromRequest,
  ensureSameIdempotentOperation,
  operationResponse,
  operationStatusCode,
  readiness as baseReadiness,
  route,
  sendJson
} from './runtime.js';
import { parseIntegerQuery, validateIdempotencyKey } from './security.js';
import { publicDriveConfig } from '../drive/config.js';

async function ensureDriveManifest(app) {
  if (!app.catalogMaterializer) return null;
  const manifest = await app.catalogMaterializer.ensureManifest();
  app.catalogRepository.setRoot(app.catalogMaterializer.cacheRoot);
  return manifest;
}

export function readinessV03(app, httpConfig, operationQueue) {
  const base = baseReadiness(app, httpConfig, operationQueue);
  const drive = publicDriveConfig(app.driveConfig || {});
  const credentialConfigured = Boolean(drive.serviceAccountConfigured || drive.userOAuthConfigured);
  const readyForDriveRead = Boolean(drive.enabled && credentialConfigured && drive.rootFolderId);
  const createCredentialCompatible = Boolean(
    drive.authMode === 'user-oauth' || !drive.requireUserOAuthForMyDriveCreates
  );
  const readyForDriveWrite = Boolean(
    readyForDriveRead &&
    drive.writesEnabled &&
    drive.movesEnabled &&
    drive.trashEnabled &&
    drive.permanentDeleteEnabled &&
    drive.permissionChangesEnabled &&
    createCredentialCompatible
  );
  const driveCatalogReady = Boolean(
    !app.catalogMaterializer || app.catalogMaterializer.status().manifestExists
  );
  return {
    ...base,
    readyForRead: base.readyForRead || readyForDriveRead,
    drive: {
      ...drive,
      credentialConfigured,
      createCredentialCompatible,
      readyForRead: readyForDriveRead,
      readyForFullWrite: readyForDriveWrite,
      catalogProvider: app.catalogProvider || 'local',
      catalogReady: driveCatalogReady,
      startupError: app.driveStartupError || null
    }
  };
}

export function createSystemRoutesV03({
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
        service: 'atelier-popo-smartstore-drive-bridge',
        version,
        health: '/health',
        readiness: '/health/ready',
        openapi: '/openapi.json',
        driveStatus: '/api/v1/drive/status'
      });
    }, { auth: false }),

    route('GET', /^\/health$/, async ({ req, res }) => {
      const state = readinessV03(app, httpConfig, operationQueue);
      sendJson(req, res, 200, {
        ok: true,
        status: state.readyForRead ? 'ok' : 'degraded',
        service: 'atelier-popo-smartstore-drive-bridge',
        version,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
      });
    }, { auth: false }),

    route('HEAD', /^\/health$/, async ({ req, res }) => {
      sendJson(req, res, 200, { ok: true });
    }, { auth: false }),

    route('GET', /^\/health\/ready$/, async ({ req, res }) => {
      const state = readinessV03(app, httpConfig, operationQueue);
      sendJson(req, res, state.readyForRead ? 200 : 503, {
        ok: state.readyForRead,
        status: state.readyForRead ? 'ready' : 'not_ready',
        service: 'atelier-popo-smartstore-drive-bridge',
        version
      });
    }, { auth: false }),

    route('GET', /^\/openapi\.json$/, async ({ req, res }) => {
      sendJson(req, res, 200, buildOpenApiSpec({ serverUrl: baseUrlFromRequest(req), version }));
    }, { auth: false }),

    route('GET', /^\/api\/v1\/status$/, async ({ req, res }) => {
      sendJson(req, res, 200, {
        ok: true,
        service: 'atelier-popo-smartstore-drive-bridge',
        version,
        readiness: readinessV03(app, httpConfig, operationQueue),
        jobs: app.ledger.counts(),
        operations: app.ledger.operationCounts(),
        drive: app.driveService ? await app.driveService.status({ verifyRemote: false }) : null
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
      const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
      if (existing) {
        ensureSameIdempotentOperation(existing, { operationType, sourceProductId });
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
        request: { limit, force, concurrency },
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
    })
  ];
}
