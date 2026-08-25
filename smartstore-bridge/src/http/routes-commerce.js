import { NaverApiError } from '../naver/errors.js';
import { CommerceGatewayError, redactCommerceData } from '../naver/commerce/gateway.js';
import { HttpError } from './errors.js';
import { parseIntegerQuery, validateIdempotencyKey } from './security.js';
import {
  ensureSameIdempotentOperation,
  operationResponse,
  operationStatusCode,
  route,
  sendJson
} from './runtime.js';

function validateProductNo(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{1,30}$/.test(text)) throw new HttpError(400, 'INVALID_PRODUCT_NO', `${label} 형식이 올바르지 않습니다.`);
  return text;
}

function assertCommerceWriteBase(app, httpConfig) {
  if (!httpConfig.allowWrites) throw new HttpError(403, 'HTTP_WRITES_DISABLED', 'ATELIER_HTTP_ALLOW_WRITES=false입니다.');
  if (!app.config.naver.allowWrites) throw new HttpError(403, 'NAVER_WRITES_DISABLED', 'NAVER_ALLOW_WRITES=false입니다.');
  if (!app.commerceConfig?.allowWrites) throw new HttpError(403, 'COMMERCE_WRITES_DISABLED', 'ATELIER_COMMERCE_ALLOW_WRITES=false입니다.');
}

function assertExact(value, expected, field = 'confirmation') {
  if (String(value || '') !== expected) {
    throw new HttpError(400, 'INVALID_CONFIRMATION', `${field} 값은 정확히 ${expected}여야 합니다.`);
  }
}

function publicOperationDefinition(operation) {
  return {
    operationId: operation.operationId,
    domain: operation.domain,
    apiGroup: operation.apiGroup,
    method: operation.method,
    path: operation.path,
    title: operation.title,
    docUrl: operation.docUrl,
    pathParams: operation.pathParams,
    readOnly: operation.readOnly,
    sideEffect: operation.sideEffect,
    destructive: operation.destructive,
    transport: operation.transport,
    asynchronous: operation.asynchronous,
    risk: operation.risk,
    confirmation: operation.confirmation,
    gate: operation.gate,
    status: operation.status
  };
}

export function createCommerceRoutes({ app, httpConfig, createAsyncOperation, redactionRoots }) {
  const maxBodyBytes = app.commerceConfig?.maxJsonBodyBytes || 16 * 1024 * 1024;
  return [
    route('GET', /^\/api\/v1\/commerce\/status$/, async ({ req, res }) => {
      sendJson(req, res, 200, {
        ok: true,
        commerce: app.commerceGateway.status(),
        naverWritesEnabled: Boolean(app.config.naver.allowWrites),
        httpWritesEnabled: Boolean(httpConfig.allowWrites)
      });
    }),

    route('GET', /^\/api\/v1\/commerce\/operations$/, async ({ req, res, url }) => {
      const result = app.commerceGateway.list({
        domain: url.searchParams.get('domain'),
        method: url.searchParams.get('method'),
        risk: url.searchParams.get('risk'),
        query: url.searchParams.get('query'),
        limit: parseIntegerQuery(url.searchParams.get('limit'), 100, { min: 1, max: 500 }),
        offset: parseIntegerQuery(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 })
      });
      sendJson(req, res, 200, {
        ok: true,
        ...result,
        items: result.items.map(publicOperationDefinition)
      });
    }),

    route('GET', /^\/api\/v1\/commerce\/operations\/([^/]+)$/, async ({ req, res, match }) => {
      const operation = app.commerceGateway.get(decodeURIComponent(match[1]));
      sendJson(req, res, 200, { ok: true, operation: publicOperationDefinition(operation) });
    }),

    route('POST', /^\/api\/v1\/commerce\/operations\/([^/]+)\/preview$/, async ({ req, res, match, body }) => {
      const preview = app.commerceGateway.preview(decodeURIComponent(match[1]), body);
      sendJson(req, res, 200, { ok: true, preview: {
        ...preview,
        operation: publicOperationDefinition(preview.operation)
      } });
    }, { maxBodyBytes }),

    route('POST', /^\/api\/v1\/commerce\/operations\/([^/]+)\/execute$/, async ({ req, res, match, body }) => {
      const operationId = decodeURIComponent(match[1]);
      const operation = app.commerceGateway.get(operationId);
      const executionContext = {
        naverWritesEnabled: Boolean(app.config.naver.allowWrites),
        httpWritesEnabled: Boolean(httpConfig.allowWrites)
      };
      app.commerceGateway.assertExecutionAllowed(operation, body, executionContext);

      if (!operation.sideEffect) {
        const result = await app.commerceGateway.execute(operationId, body, executionContext);
        sendJson(req, res, 200, { ok: true, result });
        return;
      }

      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const preview = app.commerceGateway.preview(operationId, body);
      const operationType = `commerce:${operationId}`;
      const sourceProductId = `commerce:${preview.resourceKey}`;
      const operationRequest = {
        operationId,
        resourceKey: preview.resourceKey,
        request: preview.request
      };
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
        task: async () => app.commerceGateway.execute(operationId, body, executionContext)
      });
      sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
        reused: created.reused,
        redactionRoots
      }), { Location: `/api/v1/operations/${created.row.operation_id}` });
    }, { write: true, maxBodyBytes }),

    route('POST', /^\/api\/v1\/commerce\/capabilities\/probe$/, async ({ req, res, body }) => {
      const requested = Array.isArray(body.operations) ? body.operations : [];
      if (!requested.length || requested.length > 20) {
        throw new HttpError(400, 'INVALID_PROBE_OPERATIONS', 'operations 배열은 1~20개여야 합니다.');
      }
      const results = [];
      for (const item of requested) {
        const operationId = String(item?.operationId || '');
        try {
          const operation = app.commerceGateway.get(operationId);
          if (!operation.readOnly) throw new CommerceGatewayError('PROBE_WRITE_NOT_ALLOWED', 'Capability probe는 읽기 operation만 허용합니다.', { status: 400 });
          const result = await app.commerceGateway.execute(operationId, item || {}, {
            naverWritesEnabled: false,
            httpWritesEnabled: false
          });
          results.push({ operationId, supported: true, upstreamStatus: result.upstream.status, traceId: result.upstream.traceId });
        } catch (error) {
          results.push({
            operationId,
            supported: false,
            error: {
              name: error.name,
              code: error.code || null,
              status: error.status || null,
              message: error.message,
              traceId: error.traceId || null
            }
          });
        }
      }
      sendJson(req, res, 200, { ok: true, results });
    }, { maxBodyBytes }),

    route('GET', /^\/api\/v1\/commerce\/products\/channel\/([^/]+)$/, async ({ req, res, match }) => {
      const channelProductNo = validateProductNo(decodeURIComponent(match[1]), 'channelProductNo');
      const product = await app.productsApi.getChannelProduct(channelProductNo);
      sendJson(req, res, 200, { ok: true, product: redactCommerceData(product, app.commerceConfig) });
    }),

    route('GET', /^\/api\/v1\/commerce\/products\/origin\/([^/]+)$/, async ({ req, res, match }) => {
      const originProductNo = validateProductNo(decodeURIComponent(match[1]), 'originProductNo');
      const product = await app.productsApi.getOriginProduct(originProductNo);
      sendJson(req, res, 200, { ok: true, product: redactCommerceData(product, app.commerceConfig) });
    }),

    route('POST', /^\/api\/v1\/commerce\/products\/channel\/([^/]+)\/detail\/preview$/, async ({ req, res, match, body }) => {
      const channelProductNo = validateProductNo(decodeURIComponent(match[1]), 'channelProductNo');
      const preview = await app.detailContentService.previewChannelUpdate(channelProductNo, body.detailContent);
      sendJson(req, res, 200, {
        ok: true,
        preview: {
          channelProductNo: preview.channelProductNo,
          originProductNo: preview.originProductNo,
          current: preview.current,
          next: preview.next,
          changed: preview.changed,
          requiredConfirmation: 'UPDATE_PRODUCT_DETAIL',
          requiredSecondConfirmation: channelProductNo
        }
      });
    }, { maxBodyBytes }),

    route('POST', /^\/api\/v1\/commerce\/products\/channel\/([^/]+)\/detail\/update$/, async ({ req, res, match, body }) => {
      const channelProductNo = validateProductNo(decodeURIComponent(match[1]), 'channelProductNo');
      assertCommerceWriteBase(app, httpConfig);
      assertExact(body.confirmation, 'UPDATE_PRODUCT_DETAIL');
      assertExact(body.secondConfirmation, channelProductNo, 'secondConfirmation');
      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const operationType = 'commerce:update_product_detail';
      const sourceProductId = `channel:${channelProductNo}`;
      const operationRequest = { channelProductNo, detailContent: body.detailContent };
      const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
      if (existing) {
        ensureSameIdempotentOperation(existing, { operationType, sourceProductId, request: operationRequest });
        sendJson(req, res, operationStatusCode(existing), operationResponse(existing, { reused: true, redactionRoots }), {
          Location: `/api/v1/operations/${existing.operation_id}`
        });
        return;
      }
      const preview = await app.detailContentService.previewChannelUpdate(channelProductNo, body.detailContent);
      const created = await createAsyncOperation({
        idempotencyKey,
        operationType,
        sourceProductId,
        request: operationRequest,
        task: async () => app.detailContentService.updateChannelDetail(channelProductNo, body.detailContent)
      });
      sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
        reused: created.reused,
        redactionRoots
      }), { Location: `/api/v1/operations/${created.row.operation_id}` });
    }, { write: true, maxBodyBytes }),

    route('POST', /^\/api\/v1\/commerce\/products\/channel\/([^/]+)\/detail\/rollback$/, async ({ req, res, match, body }) => {
      const channelProductNo = validateProductNo(decodeURIComponent(match[1]), 'channelProductNo');
      assertCommerceWriteBase(app, httpConfig);
      assertExact(body.confirmation, 'ROLLBACK_PRODUCT_DETAIL');
      assertExact(body.secondConfirmation, channelProductNo, 'secondConfirmation');
      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const backup = app.detailContentService.loadBackup(body.backupId);
      if (String(backup.channelProductNo) !== channelProductNo) {
        throw new HttpError(409, 'BACKUP_PRODUCT_MISMATCH', 'backupId의 채널상품번호가 요청 경로와 다릅니다.');
      }
      const operationType = 'commerce:rollback_product_detail';
      const sourceProductId = `channel:${channelProductNo}:backup:${body.backupId}`;
      const operationRequest = { channelProductNo, backupId: body.backupId };
      const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
      if (existing) {
        ensureSameIdempotentOperation(existing, { operationType, sourceProductId, request: operationRequest });
        sendJson(req, res, operationStatusCode(existing), operationResponse(existing, { reused: true, redactionRoots }), {
          Location: `/api/v1/operations/${existing.operation_id}`
        });
        return;
      }
      const created = await createAsyncOperation({
        idempotencyKey,
        operationType,
        sourceProductId,
        request: operationRequest,
        task: async () => app.detailContentService.rollbackChannelDetail(body.backupId)
      });
      sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
        reused: created.reused,
        redactionRoots
      }), { Location: `/api/v1/operations/${created.row.operation_id}` });
    }, { write: true, maxBodyBytes })
  ];
}
