import { HttpError } from './errors.js';
import { searchAdWriteOpenApi } from './openapi-searchad-write.js';
import { getSearchAdWriteRuntime as runtimeFor, requiredSearchAdIdempotencyKey as requiredIdempotencyKey, requireSearchAdHttpWrites } from './searchad-write-runtime.js';
import { sendJson } from './runtime.js';

function planId(match) {
  return decodeURIComponent(match?.groups?.planId || '');
}

function clampLimit(value) {
  const parsed = Number.parseInt(String(value ?? '100'), 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(500, parsed));
}

function principalCustomers(principal) {
  return Array.isArray(principal?.customerIds)
    ? [...new Set(principal.customerIds.map(value => String(value)).filter(Boolean))]
    : [];
}

function assertCustomer(principal, customerId) {
  const id = String(customerId || '').trim();
  if (!id || !principalCustomers(principal).includes(id)) {
    throw new HttpError(403, 'SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.');
  }
  return id;
}

function scopedPlan(runtime, id, principal) {
  const plan = runtime.repository.getPlan(id);
  if (!plan || !principalCustomers(principal).includes(String(plan.customer_id))) {
    throw new HttpError(404, 'SEARCHAD_CHANGE_PLAN_NOT_FOUND', 'SearchAd 변경 계획을 찾을 수 없습니다.');
  }
  return plan;
}

function listScopedPlans(runtime, principal, url) {
  const requestedCustomer = String(url.searchParams.get('customerId') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim() || undefined;
  const limit = clampLimit(url.searchParams.get('limit'));
  const allowedCustomers = principalCustomers(principal);
  const customers = requestedCustomer
    ? (allowedCustomers.includes(requestedCustomer) ? [requestedCustomer] : [])
    : allowedCustomers;
  const items = [];
  for (const customerId of customers) {
    items.push(...runtime.planService.list({ customerId, status, limit }));
  }
  items.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
  return items.slice(0, limit);
}

export function createSearchAdWriteRoutesV3(context) {
  return [
    {
      method: 'GET', pattern: /^\/openapi-searchad-write\.json$/, auth: false, write: false,
      handler: async ({ req, res }) => sendJson(req, res, 200, searchAdWriteOpenApi({ version: '0.7.0' }))
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/write\/status$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res }) => sendJson(req, res, 200, runtimeFor(context).status())
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/changes$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, url, principal }) => {
        const runtime = runtimeFor(context);
        sendJson(req, res, 200, { items: listScopedPlans(runtime, principal, url) });
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, match, principal }) => {
        const runtime = runtimeFor(context);
        const id = planId(match);
        scopedPlan(runtime, id, principal);
        sendJson(req, res, 200, runtime.planService.get(id));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/plan$/, auth: true, write: true, searchAdRole: 'operator',
      handler: async ({ req, res, body, requestId, principal }) => {
        const runtime = runtimeFor(context);
        const customerId = assertCustomer(principal, body?.customerId);
        const result = await runtime.planService.create({
          ...body,
          customerId,
          createdBy: principal.principalId
        }, {
          requestId,
          actor: principal.principalId
        });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/approve$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, principal }) => {
        const runtime = runtimeFor(context);
        const id = planId(match);
        scopedPlan(runtime, id, principal);
        const result = runtime.approvalService.approve(id, {
          ...body,
          actor: principal.principalId
        });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/execute$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, requestId, principal }) => {
        requireSearchAdHttpWrites(context);
        const runtime = runtimeFor(context);
        const id = planId(match);
        const plan = scopedPlan(runtime, id, principal);
        const result = await runtime.executionService.execute(id, {
          executionToken: body.executionToken,
          customerId: plan.customer_id,
          idempotencyKey: requiredIdempotencyKey(req, body)
        }, { requestId, principal });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/reconcile$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, requestId, principal }) => {
        const runtime = runtimeFor(context);
        const id = planId(match);
        scopedPlan(runtime, id, principal);
        const result = await runtime.executionService.reconcile(id, body, { requestId, principal });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/rollback$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, requestId, principal }) => {
        requireSearchAdHttpWrites(context);
        const runtime = runtimeFor(context);
        const id = planId(match);
        scopedPlan(runtime, id, principal);
        const result = await runtime.executionService.rollback(id, {
          confirmation: body.confirmation,
          idempotencyKey: requiredIdempotencyKey(req, body)
        }, { requestId, principal });
        sendJson(req, res, 200, result);
      }
    }
  ];
}

export const _internal = { planId, clampLimit, principalCustomers, assertCustomer, scopedPlan, listScopedPlans };
