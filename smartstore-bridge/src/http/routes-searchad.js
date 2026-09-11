import { HttpError } from './errors.js';
import { parseIntegerQuery } from './security.js';
import {
  baseUrlFromRequest,
  route,
  sendJson
} from './runtime.js';
import { getSearchAdWriteRuntime, requiredSearchAdIdempotencyKey, requireSearchAdHttpWrites } from './searchad-write-runtime.js';
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

export function createSearchAdRoutes(context) {
  const { app, httpConfig, version } = context;
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

    route('POST', /^\/api\/v1\/searchad\/operations\/([^/]+)\/execute$/, async ({ req, res, match, body, requestId }) => {
      const gateway = requireGateway(app);
      const operationKey = decodeURIComponent(match[1]);
      const operation = gateway.get(operationKey);
      if (operation.sideEffect === false) {
        const result = await gateway.execute(operationKey, body);
        sendJson(req, res, 200, { ok: true, result });
        return;
      }
      requireSearchAdHttpWrites(context);
      const planId = String(body.planId || '').trim();
      if (!planId) {
        throw new HttpError(400, 'SEARCHAD_CHANGE_PLAN_REQUIRED', '공식 쓰기 실행에는 먼저 작성·승인한 변경 계획이 필요합니다.', {
          planEndpoint: '/api/v1/searchad/changes/plan'
        });
      }
      const allowedFields = new Set(['planId', 'customerId', 'executionToken', 'idempotencyKey']);
      const overrides = Object.keys(body).filter(key => !allowedFields.has(key));
      if (overrides.length) {
        throw new HttpError(400, 'SEARCHAD_APPROVED_PLAN_OVERRIDE_FORBIDDEN', '승인된 계획의 요청값은 실행 시 덮어쓸 수 없습니다.', { fields: overrides });
      }
      const runtime = getSearchAdWriteRuntime(context);
      const plan = await runtime.planService.get(planId);
      if (plan.mutation_operation_key !== operationKey) {
        throw new HttpError(409, 'SEARCHAD_CHANGE_OPERATION_MISMATCH', '변경 계획과 실행 operation이 일치하지 않습니다.');
      }
      if (plan.customer_id !== String(body.customerId || '').trim()) {
        throw new HttpError(403, 'SEARCHAD_CUSTOMER_SCOPE_MISMATCH', '변경 계획과 요청의 광고계정이 일치하지 않습니다.');
      }
      const result = await runtime.executionService.execute(planId, {
        ...body, idempotencyKey: requiredSearchAdIdempotencyKey(req, body)
      }, { requestId });
      sendJson(req, res, 200, { ok: true, result });
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
