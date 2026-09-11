import { searchAdWriteOpenApi } from './openapi-searchad-write.js';
import { getSearchAdWriteRuntime as runtimeFor, requiredSearchAdIdempotencyKey as requiredIdempotencyKey, requireSearchAdHttpWrites } from './searchad-write-runtime.js';
import { sendJson } from './runtime.js';

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
      handler: async ({ req, res, url }) => {
        const items = await runtimeFor(context).planService.list(filters(url));
        sendJson(req, res, 200, { items });
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)$/, auth: true, write: false,
      handler: async ({ req, res, match }) => {
        const result = await runtimeFor(context).planService.get(planId(match));
        sendJson(req, res, 200, result);
      }
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
      handler: async ({ req, res, match, body }) => {
        const result = await runtimeFor(context).approvalService.approve(planId(match), body);
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/execute$/, auth: true, write: true,
      handler: async ({ req, res, match, body, requestId }) => {
        requireSearchAdHttpWrites(context);
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
        requireSearchAdHttpWrites(context);
        const result = await runtimeFor(context).executionService.rollback(planId(match), {
          ...body,
          idempotencyKey: requiredIdempotencyKey(req, body)
        }, { requestId });
        sendJson(req, res, 200, result);
      }
    }
  ];
}
