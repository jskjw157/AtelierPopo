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

export function createDriveRoutes({ app, httpConfig, createAsyncOperation, redactionRoots = [] }) {
  const maxBodyBytes = app.driveConfig?.maxJsonBodyBytes || 16 * 1024 * 1024;

  async function enqueueDriveMutation({ req, res, body }, {
    operationType,
    sourceProductId,
    request,
    confirmation,
    secondConfirmation,
    task
  }) {
    if (!httpConfig?.allowWrites) {
      throw new HttpError(403, 'HTTP_WRITES_DISABLED', 'ATELIER_HTTP_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    }
    if (!createAsyncOperation) {
      throw new HttpError(503, 'ASYNC_OPERATION_QUEUE_NOT_CONFIGURED', '비동기 작업 큐가 설정되지 않았습니다.');
    }
    if (String(body.confirmation || '') !== confirmation) {
      throw new HttpError(400, 'DRIVE_INVALID_CONFIRMATION', `confirmation 값은 정확히 ${confirmation}여야 합니다.`);
    }
    if (secondConfirmation !== undefined && String(body.secondConfirmation || '') !== String(secondConfirmation)) {
      throw new HttpError(400, 'DRIVE_INVALID_SECOND_CONFIRMATION', 'secondConfirmation이 대상 ID와 일치하지 않습니다.');
    }
    const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
    const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
    if (existing) {
      ensureSameIdempotentOperation(existing, { operationType, sourceProductId, request });
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
      request,
      task
    });
    sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
      reused: created.reused,
      redactionRoots
    }), { Location: `/api/v1/operations/${created.row.operation_id}` });
  }

  function inlineContentRequest(body) {
    const source = body.contentBase64 !== undefined ? String(body.contentBase64) : String(body.text ?? '');
    return {
      name: body.name,
      parentId: body.parentId,
      mimeType: body.mimeType,
      contentType: body.contentBase64 !== undefined ? 'base64' : 'text',
      contentSha256: crypto.createHash('sha256').update(source).digest('hex')
    };
  }

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
      const operationRequest = { productIds, includeImages, force, limit, concurrency };
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
    }, { write: true }),

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
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/capabilities\/probe$/, async context => {
      const drive = requireDrive(app);
      await enqueueDriveMutation(context, {
        operationType: 'drive:capability-probe',
        sourceProductId: `drive:root:${app.driveConfig.rootFolderId}`,
        request: { rootFolderId: app.driveConfig.rootFolderId },
        confirmation: DRIVE_CONFIRMATIONS.PROBE,
        task: async () => drive.runWriteCanary({ confirmation: context.body.confirmation })
      });
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

    driveRoute('POST', /^\/api\/v1\/drive\/folders$/, async context => {
      const drive = requireDrive(app);
      const parentId = context.body.parentId
        ? validateDriveId(context.body.parentId, 'parentId')
        : app.driveConfig.rootFolderId;
      await enqueueDriveMutation(context, {
        operationType: 'drive:create-folder',
        sourceProductId: `drive:folder:${parentId}:${String(context.body.name || '')}`,
        request: { name: context.body.name, parentId },
        confirmation: DRIVE_CONFIRMATIONS.WRITE,
        task: async () => drive.createFolder({
          name: context.body.name,
          parentId,
          confirmation: context.body.confirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/native-files$/, async context => {
      const drive = requireDrive(app);
      const parentId = context.body.parentId
        ? validateDriveId(context.body.parentId, 'parentId')
        : app.driveConfig.rootFolderId;
      await enqueueDriveMutation(context, {
        operationType: 'drive:create-native-file',
        sourceProductId: `drive:native:${parentId}:${String(context.body.name || '')}`,
        request: { type: context.body.type, name: context.body.name, parentId },
        confirmation: DRIVE_CONFIRMATIONS.WRITE,
        task: async () => drive.createNativeFile({
          type: context.body.type,
          name: context.body.name,
          parentId,
          confirmation: context.body.confirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/upload$/, async context => {
      const drive = requireDrive(app);
      const parentId = context.body.parentId
        ? validateDriveId(context.body.parentId, 'parentId')
        : app.driveConfig.rootFolderId;
      const request = { ...inlineContentRequest(context.body), parentId };
      await enqueueDriveMutation(context, {
        operationType: 'drive:upload-file',
        sourceProductId: `drive:upload:${parentId}:${String(context.body.name || '')}`,
        request,
        confirmation: DRIVE_CONFIRMATIONS.WRITE,
        task: async () => drive.uploadInline({
          name: context.body.name,
          parentId,
          mimeType: context.body.mimeType,
          contentBase64: context.body.contentBase64,
          text: context.body.text,
          confirmation: context.body.confirmation
        })
      });
    }, { write: true, maxBodyBytes }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/replace$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      await enqueueDriveMutation(context, {
        operationType: 'drive:replace-file',
        sourceProductId: `drive:file:${fileId}`,
        request: { ...inlineContentRequest(context.body), fileId, name: undefined, parentId: undefined },
        confirmation: DRIVE_CONFIRMATIONS.WRITE,
        task: async () => drive.replaceInline(fileId, {
          mimeType: context.body.mimeType,
          contentBase64: context.body.contentBase64,
          text: context.body.text,
          confirmation: context.body.confirmation
        })
      });
    }, { write: true, maxBodyBytes }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/rename$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      await enqueueDriveMutation(context, {
        operationType: 'drive:rename-file',
        sourceProductId: `drive:file:${fileId}`,
        request: { fileId, name: context.body.name },
        confirmation: DRIVE_CONFIRMATIONS.WRITE,
        task: async () => drive.rename(fileId, {
          name: context.body.name,
          confirmation: context.body.confirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/move$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      const parentId = validateDriveId(context.body.parentId, 'parentId');
      await enqueueDriveMutation(context, {
        operationType: 'drive:move-file',
        sourceProductId: `drive:file:${fileId}`,
        request: { fileId, parentId },
        confirmation: DRIVE_CONFIRMATIONS.MOVE,
        task: async () => drive.move(fileId, {
          parentId,
          confirmation: context.body.confirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/copy$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      const parentId = context.body.parentId
        ? validateDriveId(context.body.parentId, 'parentId')
        : app.driveConfig.rootFolderId;
      await enqueueDriveMutation(context, {
        operationType: 'drive:copy-file',
        sourceProductId: `drive:file:${fileId}:copy:${parentId}`,
        request: { fileId, name: context.body.name, parentId },
        confirmation: DRIVE_CONFIRMATIONS.WRITE,
        task: async () => drive.copy(fileId, {
          name: context.body.name,
          parentId,
          confirmation: context.body.confirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/trash$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      await enqueueDriveMutation(context, {
        operationType: 'drive:trash-file',
        sourceProductId: `drive:file:${fileId}`,
        request: { fileId },
        confirmation: DRIVE_CONFIRMATIONS.TRASH,
        secondConfirmation: fileId,
        task: async () => drive.trash(fileId, {
          confirmation: context.body.confirmation,
          secondConfirmation: context.body.secondConfirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/restore$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      await enqueueDriveMutation(context, {
        operationType: 'drive:restore-file',
        sourceProductId: `drive:file:${fileId}`,
        request: { fileId },
        confirmation: DRIVE_CONFIRMATIONS.RESTORE,
        secondConfirmation: fileId,
        task: async () => drive.restore(fileId, {
          confirmation: context.body.confirmation,
          secondConfirmation: context.body.secondConfirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/delete$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      await enqueueDriveMutation(context, {
        operationType: 'drive:permanent-delete',
        sourceProductId: `drive:file:${fileId}`,
        request: { fileId },
        confirmation: DRIVE_CONFIRMATIONS.DELETE,
        secondConfirmation: fileId,
        task: async () => drive.permanentlyDelete(fileId, {
          confirmation: context.body.confirmation,
          secondConfirmation: context.body.secondConfirmation
        })
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/permissions$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      const request = {
        fileId,
        type: context.body.type,
        role: context.body.role,
        recipientSha256: crypto.createHash('sha256')
          .update(`${String(context.body.emailAddress || '')}:${String(context.body.domain || '')}`)
          .digest('hex'),
        allowFileDiscovery: context.body.allowFileDiscovery,
        sendNotificationEmail: Boolean(context.body.sendNotificationEmail)
      };
      await enqueueDriveMutation(context, {
        operationType: 'drive:create-permission',
        sourceProductId: `drive:file:${fileId}:permission`,
        request,
        confirmation: DRIVE_CONFIRMATIONS.PERMISSION,
        secondConfirmation: fileId,
        task: async () => drive.createPermission(fileId, context.body)
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/files\/([^/]+)\/permissions\/([^/]+)\/delete$/, async context => {
      const drive = requireDrive(app);
      const fileId = validateDriveId(decodeURIComponent(context.match[1]));
      const permissionId = String(decodeURIComponent(context.match[2]) || '').trim();
      if (!permissionId) throw new HttpError(400, 'DRIVE_INVALID_PERMISSION_ID', 'permissionId가 필요합니다.');
      await enqueueDriveMutation(context, {
        operationType: 'drive:delete-permission',
        sourceProductId: `drive:file:${fileId}:permission:${permissionId}`,
        request: { fileId, permissionId },
        confirmation: DRIVE_CONFIRMATIONS.PERMISSION,
        secondConfirmation: permissionId,
        task: async () => drive.deletePermission(fileId, permissionId, context.body)
      });
    }, { write: true }),

    driveRoute('POST', /^\/api\/v1\/drive\/verify-tree$/, async ({ req, res, body }) => {
      const drive = requireDrive(app);
      const result = await drive.verifyTree({
        rootId: body.rootId ? validateDriveId(body.rootId, 'rootId') : undefined,
        maxNodes: body.maxNodes
      });
      sendJson(req, res, 200, { ok: true, result });
    }, { write: true })
  ];
}

export { DRIVE_CONFIRMATIONS };
