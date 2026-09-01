import { createProductionSearchAdWriteRuntime } from '../naver/searchad/write/runtime-production.js';
import { searchAdWriteOpenApi } from './openapi-searchad-write.js';
import { HttpError } from './errors.js';
import { sendJson } from './runtime.js';

function requiredIdempotencyKey(req, body = {}) {
  const value = String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || body.idempotencyKey || '').trim();
  if (!value) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 헤더 또는 idempotencyKey가 필요합니다.');
  if (value.length > 200) throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey는 200자 이하여야 합니다.');
  return value;
}

function runtimeFor(context) {
  const { app, env = process.env } = context;
  if (!app.searchAdGateway) {
    throw new HttpError(503, 'SEARCHAD_NOT_READY', 'SearchAd gateway가 준비되지 않았습니다.');
  }
  if (!app.searchAdWriteRuntime) {
    app.searchAdWriteRuntime = createProductionSearchAdWriteRuntime({
      gateway: app.searchAdGateway,
      env,
      baseDir: app.config?.workDir || process.cwd()
    });
  }
  return app.searchAdWriteRuntime;
}

function planId(match) {
  return decodeURIComponent(match?.groups?.planId || '');
}

function filters(url) {
  return {
    customerId: url.searchParams.get('customerId') || undefined,
    status: url.searchParams.get('status') || undefined,
    limit: Number(url.searchParams.get('limit') || 100)
  };
}

export function createSearchAdWriteRoutesV3(context) {
  return [
    {
      method: 'GET', pattern: /^\/openapi-searchad-write\.json$/, auth: false, write: false,
      handler: async ({ req, res }) => sendJson(req, res, 200, searchAdWriteOpenApi({ version: '0.7.0' }))
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/write\/status$/, auth: true, write: false,
      handler: async ({ req, res }) => sendJson(req, res, 200, runtimeFor(context).status())
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/changes$/, auth: true, write: false,
      handler: async ({ req, res, url }) => sendJson(req, res, 200, {
        items: runtimeFor(context).planService.list(filters(url))
      })
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)$/, auth: true, write: false,
      handler: async ({ req, res, match }) => sendJson(req, res, 200, runtimeFor(context).planService.get(planId(match)))
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/plan$/, auth: true, write: true,
      handler: async ({ req, res, body, requestId }) => {
        const result = await runtimeFor(context).planService.create(body, {
          requestId,
          actor: body.createdBy
        });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/approve$/, auth: true, write: true,
      handler: async ({ req, res, match, body }) => sendJson(req, res, 200,
        runtimeFor(context).approvalService.approve(planId(match), body)
      )
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/execute$/, auth: true, write: true,
      handler: async ({ req, res, match, body, requestId }) => {
        const result = await runtimeFor(context).executionService.execute(planId(match), {
          ...body,
          idempotencyKey: requiredIdempotencyKey(req, body)
        }, { requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/reconcile$/, auth: true, write: true,
      handler: async ({ req, res, match, body, requestId }) => {
        const result = await runtimeFor(context).executionService.reconcile(planId(match), body, { requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/rollback$/, auth: true, write: true,
      handler: async ({ req, res, match, body, requestId }) => {
        const result = await runtimeFor(context).executionService.rollback(planId(match), {
          ...body,
          idempotencyKey: requiredIdempotencyKey(req, body)
        }, { requestId });
        sendJson(req, res, 200, result);
      }
    }
  ];
}
