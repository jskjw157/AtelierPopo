import crypto from 'node:crypto';
import { FILE_ID_PATTERN } from '../drive/config.js';
import { DRIVE_CONFIRMATIONS, DriveServiceError, normalizeDriveError } from '../drive/service.js';
import { DriveBoundaryError } from '../drive/boundary.js';
import { HttpError } from './errors.js';
import { parseBooleanQuery, parseIntegerQuery, validateIdempotencyKey } from './security.js';
import {
  ensureSameIdempotentOperation,
  operationResponse,
  operationStatusCode,
  route,
  sendJson,
  validateProductId
} from './runtime.js';

function validateDriveId(value, label = 'fileId') {
  const id = String(value || '').trim();
  if (!FILE_ID_PATTERN.test(id)) {
    throw new HttpError(400, 'DRIVE_INVALID_FILE_ID', `${label} 형식이 올바르지 않습니다.`);
  }
  return id;
}

function driveErrorStatus(error) {
  const code = error.code || '';
  if (code === 'DRIVE_FILE_NOT_FOUND') return 404;
  if (code.includes('OUTSIDE_ALLOWED_ROOT') || code.includes('ROOT_OPERATION_NOT_ALLOWED')) return 403;
  if (code.includes('DISABLED') || code.includes('NOT_CONFIGURED')) return 503;
  if (code.includes('TOO_LARGE')) return 413;
  if (code.includes('CONFLICT') || code.includes('REQUIRES_USER_OAUTH')) return 409;
  if (code.startsWith('DRIVE_') && (
    code.includes('INVALID') ||
    code.includes('REQUIRED') ||
    code.includes('NOT_ALLOWED') ||
    code.includes('MULTIPLE_CONTENT') ||
    code.includes('EXPORT_MIME')
  )) return 400;
  return 502;
}

function asHttpError(error) {
  const normalized = normalizeDriveError(error);
  if (normalized instanceof HttpError) return normalized;
  if (normalized instanceof DriveServiceError || normalized instanceof DriveBoundaryError) {
    return new HttpError(driveErrorStatus(normalized), normalized.code, normalized.message, normalized.details);
  }
  return error;
}

function wrap(handler) {
  return async context => {
    try {
      return await handler(context);
    } catch (error) {
      throw asHttpError(error);
    }
  };
}

function driveRoute(method, pattern, handler, options = {}) {
  const defined = route(method, pattern, wrap(handler), options);
  if (options.maxBodyBytes) defined.maxBodyBytes = options.maxBodyBytes;
  return defined;
}

function requireDrive(app) {
  if (!app.driveService) {
    throw new HttpError(503, 'DRIVE_NOT_CONFIGURED', 'Google Drive 연동이 설정되지 않았습니다.');
  }
  return app.driveService;
}

export function createDriveRoutes({ app, createAsyncOperation, redactionRoots = [] }) {
  const maxBodyBytes = app.driveConfig?.maxJsonBodyBytes || 16 * 1024 * 1024;
  return [
    driveRoute('GET', /^\/api\/v1\/drive\/status$/, async ({ req, res, url }) => {
      const drive = requireDrive(app);
      const verifyRemote = parseBooleanQuery(url.searchParams.get('verifyRemote'), true);
      sendJson(req, res, 200, {
        ok: true,
        drive: await drive.status({ verifyRemote }),
        catalog: app.catalogMaterializer?.status?.() || null,
        startupError: app.driveStartupError || null
      });
    }),

    driveRoute('GET', /^\/api\/v1\/drive\/catalog\/status$/, async ({ req, res }) => {
      requireDrive(app);
      if (!app.catalogMaterializer) {
        throw new HttpError(503, 'DRIVE_CATALOG_PROVIDER_NOT_CONFIGURED', 'Google Drive 카탈로그 공급자가 설정되지 않았습니다.');
      }
      const manifest = await app.catalogMaterializer.ensureManifest();
      app.catalogRepository.setRoot(app.catalogMaterializer.cacheRoot);
      sendJson(req, res, 200, {
        ok: true,
        catalog: {
          ...app.catalogMaterializer.status(),
          source: manifest.source || null,
          totalProducts: Number(manifest.total_products || Object.keys(manifest.products || {}).length || 0)
        }
      });
    }),

    driveRoute('POST', /^\/api\/v1\/drive\/catalog\/sync$/, async ({ req, res, body }) => {
      requireDrive(app);
      if (!app.catalogMaterializer) {
        throw new HttpError(503, 'DRIVE_CATALOG_PROVIDER_NOT_CONFIGURED', 'Google Drive 카탈로그 공급자가 설정되지 않았습니다.');
      }
      if (!createAsyncOperation) {
        throw new HttpError(503, 'ASYNC_OPERATION_QUEUE_NOT_CONFIGURED', '비동기 작업 큐가 설정되지 않았습니다.');
      }
      const productIds = Array.isArray(body.productIds)
        ? [...new Set(body.productIds.map(validateProductId))]
        : [];
      const includeImages = Boolean(body.includeImages);
      const force = Boolean(body.force);
      const limit = parseIntegerQuery(
        body.limit,
        productIds.length || 20,
        { min: 1, max: 2000 }
      );
      const concurrency = parseIntegerQuery(body.concurrency, 4, { min: 1, max: 8 });
      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        productIds,
        includeImages,
        force,
        limit,
        concurrency
      })).digest('hex').slice(0, 24);
      const operationType = 'sync_drive_catalog';
      const sourceProductId = `drive-catalog:${fingerprint}`;
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
        request: { productIds, includeImages, force, limit, concurrency },
        task: async () => {
          const result = await app.catalogMaterializer.syncCatalog({
            productIds,
            includeImages,
            force,
            limit,
            concurrency,
            resultLimit: 200
          });
          app.catalogRepository.setRoot(app.catalogMaterializer.cacheRoot);
          return result;
        }
      });
      sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
        reused: created.reused,
        redactionRoots
      }), { Location: `/api/v1/operations/${created.row.operation_id}` });
    }),

    driveRoute('POST', /^\/api\/v1\/drive\/cache\/cleanup$/, async ({ req, res, body }) => {
      requireDrive(app);
      if (!app.catalogMaterializer) {
        throw new HttpError(503, 'DRIVE_CATALOG_PROVIDER_NOT_CONFIGURED', 'Google Drive 카탈로그 공급자가 설정되지 않았습니다.');
      }
      const maxAgeSeconds = parseIntegerQuery(
        body.maxAgeSeconds,
        app.driveConfig.cacheTtlSeconds,
        { min: 0, max: 30 * 24 * 3600 }
      );
      sendJson(req, res, 200, {
        ok: true,
        result: app.catalogMaterializer.cleanupCache({ maxAgeSeconds })
      });
    }),

    driveRoute('POST', /^\/api\/v1\/drive\/capabilities\/probe$/, async ({ req, res, body }) => {
      const drive = requireDrive(app);
      const result = await drive.runWriteCanary({ confirmation: body.confirmation });
      sendJson(req, res, 200, { ok: true, result });
    }, { write: true }),

    driveRoute('GET', /^\/api\/v1\/drive\/files$/, async ({ req, res, url }) => {
      const drive = requireDrive(app);
      const parentId = url.searchParams.get('parentId');
      if (parentId) {
        const result = await drive.listChildren(validateDriveId(parentId, 'parentId'), {
          pageSize: parseIntegerQuery(url.searchParams.get('pageSize'), 100, { min: 1, max: 1000 }),
          pageToken: url.searchParams.get('pageToken') || undefined,
          includeTrashed: parseBooleanQuery(url.searchParams.get('includeTrashed'), false)
        });
        sendJson(req, res, 200, { ok: true, ...result });
        return;
      }
      const result = await drive.searchTree({
        query: url.searchParams.get('query') || '',
        mimeType: url.searchParams.get('mimeType') || undefined,
        rootId: url.searchParams.get('rootId')
          ? validateDriveId(url.searchParams.get('rootId'), 'rootId')
          : undefined,
        limit: parseIntegerQuery(url.searchParams.get('limit'), 100, { min: 1, max: 1000 }),
        maxNodes: parseIntegerQuery(url.searchParams.get('maxNodes'), 5000, { min: 1, max: 50_000 })
      });
      sendJson(req, res, 200, { ok: true, result });
    }),

    driveRoute('GET', /^\/api\/v1\/drive\/files\/([^/]+)$/, async ({ req, res, match }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 200, { ok: true, file: await drive.getFile(fileId) });
    }),

    driveRoute('GET', /^\/api\/v1\/drive\/folders\/([^/]+)\/children$/, async ({ req, res, match, url }) => {
      const drive = requireDrive(app);
      const folderId = validateDriveId(decodeURIComponent(match[1]), 'folderId');
      const result = await drive.listChildren(folderId, {
        pageSize: parseIntegerQuery(url.searchParams.get('pageSize'), 100, { min: 1, max: 1000 }),
        pageToken: url.searchParams.get('pageToken') || undefined,
        includeTrashed: parseBooleanQuery(url.searchParams.get('includeTrashed'), false)
      });
      sendJson(req, res, 200, { ok: true, ...result });
    }),

    driveRoute('GET', /^\/api\/v1\/drive\/files\/([^/]+)\/permissions$/, async ({ req, res, match }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 200, { ok: true, permissions: await drive.listPermissions(fileId) });
    }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/download$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      const result = await drive.downloadInline(fileId, {
        exportMimeType: body.exportMimeType,
        maxBytes: body.maxBytes
      });
      sendJson(req, res, 200, { ok: true, result });
    }),

    driveRoute('POST', /^\/api\/v1\/drive\/folders$/, async ({ req, res, body }) => {
      const drive = requireDrive(app);
      const file = await drive.createFolder({
        name: body.name,
        parentId: body.parentId ? validateDriveId(body.parentId, 'parentId') : undefined,
        confirmation: body.confirmation
      });
      sendJson(req, res, 201, { ok: true, file });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/native-files$/, async ({ req, res, body }) => {
      const drive = requireDrive(app);
      const file = await drive.createNativeFile({
        type: body.type,
        name: body.name,
        parentId: body.parentId ? validateDriveId(body.parentId, 'parentId') : undefined,
        confirmation: body.confirmation
      });
      sendJson(req, res, 201, { ok: true, file });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/upload$/, async ({ req, res, body }) => {
      const drive = requireDrive(app);
      const file = await drive.uploadInline({
        name: body.name,
        parentId: body.parentId ? validateDriveId(body.parentId, 'parentId') : undefined,
        mimeType: body.mimeType,
        contentBase64: body.contentBase64,
        text: body.text,
        confirmation: body.confirmation
      });
      sendJson(req, res, 201, { ok: true, file });
    }, { write: true, maxBodyBytes }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/replace$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      const file = await drive.replaceInline(fileId, {
        mimeType: body.mimeType,
        contentBase64: body.contentBase64,
        text: body.text,
        confirmation: body.confirmation
      });
      sendJson(req, res, 200, { ok: true, file });
    }, { write: true, maxBodyBytes }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/rename$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 200, {
        ok: true,
        file: await drive.rename(fileId, { name: body.name, confirmation: body.confirmation })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/move$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      const parentId = validateDriveId(body.parentId, 'parentId');
      sendJson(req, res, 200, {
        ok: true,
        file: await drive.move(fileId, { parentId, confirmation: body.confirmation })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/copy$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 201, {
        ok: true,
        file: await drive.copy(fileId, {
          name: body.name,
          parentId: body.parentId ? validateDriveId(body.parentId, 'parentId') : undefined,
          confirmation: body.confirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/trash$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 200, {
        ok: true,
        file: await drive.trash(fileId, {
          confirmation: body.confirmation,
          secondConfirmation: body.secondConfirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/restore$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 200, {
        ok: true,
        file: await drive.restore(fileId, {
          confirmation: body.confirmation,
          secondConfirmation: body.secondConfirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/delete$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 200, {
        ok: true,
        result: await drive.permanentlyDelete(fileId, {
          confirmation: body.confirmation,
          secondConfirmation: body.secondConfirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/permissions$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      sendJson(req, res, 201, {
        ok: true,
        permission: await drive.createPermission(fileId, body)
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/permissions\/([^/]+)\/delete$/, async ({ req, res, match, body }) => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(match[1]));
      const permissionId = String(decodeURIComponent(match[2]) || '').trim();
      if (!permissionId) throw new HttpError(400, 'DRIVE_INVALID_PERMISSION_ID', 'permissionId가 필요합니다.');
      sendJson(req, res, 200, {
        ok: true,
        result: await drive.deletePermission(fileId, permissionId, body)
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/verify-tree$/, async ({ req, res, body }) => {
      const drive = requireDrive(app);
      const result = await drive.verifyTree({
        rootId: body.rootId ? validateDriveId(body.rootId, 'rootId') : undefined,
        maxNodes: body.maxNodes
      });
      sendJson(req, res, 200, { ok: true, result });
    })
  ];
}

export { DRIVE_CONFIRMATIONS };
