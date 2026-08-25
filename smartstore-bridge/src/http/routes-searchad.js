import { HttpError } from './errors.js';
import { parseIntegerQuery, validateIdempotencyKey } from './security.js';
import {
  baseUrlFromRequest,
  ensureSameIdempotentOperation,
  operationResponse,
  operationStatusCode,
  route,
  sendJson
} from './runtime.js';
import { buildSearchAdOpenApi } from './openapi-searchad.js';
import { SearchAdGatewayError, toPublicSearchAdError } from '../naver/searchad/gateway.js';

function requireGateway(app) {
  if (!app.searchAdGateway) {
    throw new HttpError(503, app.searchAdStartupError?.code || 'SEARCHAD_NOT_READY', app.searchAdStartupError?.message || 'SearchAd gateway is not ready.');
  }
  return app.searchAdGateway;
}

function publicOperation(gateway, operation) {
  return gateway.registry.publicOperation(operation);
}

function asBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

export function createSearchAdRoutes({ app, httpConfig, createAsyncOperation, redactionRoots, version }) {
  const maxBodyBytes = app.searchAdConfig?.maxJsonBodyBytes || 8 * 1024 * 1024;
  return [
    route('GET', /^\/openapi-searchad\.json$/, async ({ req, res }) => {
      sendJson(req, res, 200, buildSearchAdOpenApi({ serverUrl: baseUrlFromRequest(req), version }));
    }, { auth: false }),

    route('GET', /^\/api\/v1\/searchad\/status$/, async ({ req, res }) => {
      const gateway = requireGateway(app);
      sendJson(req, res, 200, {
        ok: true,
        searchAd: gateway.status(),
        startupError: app.searchAdStartupError || null,
        httpWritesEnabled: Boolean(httpConfig.allowWrites)
      });
    }),

    route('GET', /^\/api\/v1\/searchad\/accounts$/, async ({ req, res }) => {
      const gateway = requireGateway(app);
      sendJson(req, res, 200, { ok: true, accounts: gateway.credentialsRegistry.listCustomers() });
    }),

    route('GET', /^\/api\/v1\/searchad\/operations$/, async ({ req, res, url }) => {
      const gateway = requireGateway(app);
      const result = gateway.list({
        sourceId: url.searchParams.get('sourceId') || undefined,
        domain: url.searchParams.get('domain') || undefined,
        method: url.searchParams.get('method') || undefined,
        state: url.searchParams.get('state') || undefined,
        action: url.searchParams.get('action') || undefined,
        runtimeOnly: asBoolean(url.searchParams.get('runtimeOnly')),
        query: url.searchParams.get('query') || undefined,
        limit: parseIntegerQuery(url.searchParams.get('limit'), 100, { min: 1, max: 500 }),
        offset: parseIntegerQuery(url.searchParams.get('offset'), 0, { min: 0, max: 100_000 })
      });
      sendJson(req, res, 200, { ok: true, ...result });
    }),

    route('GET', /^\/api\/v1\/searchad\/operations\/([^/]+)$/, async ({ req, res, match }) => {
      const gateway = requireGateway(app);
      const operation = gateway.get(decodeURIComponent(match[1]));
      sendJson(req, res, 200, { ok: true, operation: publicOperation(gateway, operation) });
    }),

    route('POST', /^\/api\/v1\/searchad\/operations\/([^/]+)\/preview$/, async ({ req, res, match, body }) => {
      const gateway = requireGateway(app);
      const preview = gateway.preview(decodeURIComponent(match[1]), body);
      sendJson(req, res, 200, { ok: true, preview });
    }, { maxBodyBytes }),

    route('POST', /^\/api\/v1\/searchad\/operations\/([^/]+)\/execute$/, async ({ req, res, match, body }) => {
      const gateway = requireGateway(app);
      const operationKey = decodeURIComponent(match[1]);
      const operation = gateway.get(operationKey);
      gateway.executionCheck(operation, body, { throwOnFailure: true });
      if (!operation.sideEffect) {
        const result = await gateway.execute(operationKey, body);
        sendJson(req, res, 200, { ok: true, result });
        return;
      }
      if (!httpConfig.allowWrites) throw new HttpError(403, 'HTTP_WRITES_DISABLED', 'ATELIER_HTTP_ALLOW_WRITES=false입니다.');
      const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
      const preview = gateway.preview(operationKey, body);
      const operationType = `searchad:${operationKey}`;
      const sourceProductId = preview.resourceKey;
      const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
      if (existing) {
        ensureSameIdempotentOperation(existing, { operationType, sourceProductId });
        sendJson(req, res, operationStatusCode(existing), operationResponse(existing, { reused: true, redactionRoots }), {
          Location: `/api/v1/operations/${existing.operation_id}`
        });
        return;
      }
      const created = await createAsyncOperation({
        idempotencyKey,
        operationType,
        sourceProductId,
        request: { operationKey, requestFingerprint: preview.requestFingerprint, resourceKey: preview.resourceKey },
        task: async () => gateway.execute(operationKey, body)
      });
      sendJson(req, res, created.reused ? operationStatusCode(created.row) : 202, operationResponse(created.row, {
        reused: created.reused,
        redactionRoots
      }), { Location: `/api/v1/operations/${created.row.operation_id}` });
    }, { write: true, maxBodyBytes }),

    route('POST', /^\/api\/v1\/searchad\/capabilities\/passive-probe$/, async ({ req, res, body }) => {
      requireGateway(app);
      if (!app.searchAdCapabilityService) throw new HttpError(503, 'SEARCHAD_CAPABILITY_NOT_READY', 'SearchAd capability service is not ready.');
      try {
        const result = await app.searchAdCapabilityService.runPassive({
          customerId: String(body.customerId || ''),
          operations: body.operations,
          inputs: body.inputs,
          limit: body.limit
        });
        sendJson(req, res, 200, { ok: true, probe: result });
      } catch (error) {
        if (error instanceof SearchAdGatewayError) throw error;
        throw new HttpError(error.status || 400, error.code || 'SEARCHAD_PROBE_FAILED', error.message, toPublicSearchAdError(error));
      }
    }, { maxBodyBytes })
  ];
}
