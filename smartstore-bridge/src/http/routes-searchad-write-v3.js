import { searchAdWriteOpenApi } from './openapi-searchad-write.js';
import { getSearchAdWriteRuntime as runtimeFor, requiredSearchAdIdempotencyKey as requiredIdempotencyKey, requireSearchAdHttpWrites } from './searchad-write-runtime.js';
import { assertSearchAdCustomerAccess, requireSearchAdPlanAccess, assertSearchAdPlanCustomer } from './searchad-write-access.js';
import { parseIntegerQuery } from './security.js';
import { sendJson } from './runtime.js';

function planId(match) {
  return decodeURIComponent(match?.groups?.planId || '');
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
        const requestedCustomer = url.searchParams.get('customerId');
        const customerIds = requestedCustomer
          ? [assertSearchAdCustomerAccess(principal, requestedCustomer)]
          : principal.customerIds;
        const limit = parseIntegerQuery(url.searchParams.get('limit'), 100, { min: 1, max: 500 });
        const runtime = runtimeFor(context);
        const scoped = await Promise.all(customerIds.map(customerId => runtime.planService.list({
          customerId, status: url.searchParams.get('status') || undefined, limit
        })));
        const items = scoped.flat().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
        sendJson(req, res, 200, { items });
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, match, principal }) => {
        const runtime = runtimeFor(context);
        await requireSearchAdPlanAccess(runtime, planId(match), principal);
        const result = await runtime.planService.get(planId(match));
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/plan$/, auth: true, write: true, searchAdRole: 'operator',
      handler: async ({ req, res, body, requestId, principal }) => {
        const customerId = assertSearchAdCustomerAccess(principal, body.customerId);
        const result = await runtimeFor(context).planService.create({
          ...body, customerId, createdBy: principal.principalId
        }, { requestId, actor: principal.principalId });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/approve$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, principal }) => {
        const runtime = runtimeFor(context);
        const plan = await requireSearchAdPlanAccess(runtime, planId(match), principal);
        assertSearchAdPlanCustomer(plan, body.customerId);
        const result = await runtime.approvalService.approve(planId(match), { ...body, actor: principal.principalId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/execute$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, requestId, principal }) => {
        requireSearchAdHttpWrites(context);
        const runtime = runtimeFor(context);
        const plan = await requireSearchAdPlanAccess(runtime, planId(match), principal);
        assertSearchAdPlanCustomer(plan, body.customerId);
        const result = await runtime.executionService.execute(planId(match), {
          executionToken: body.executionToken, customerId: plan.customer_id,
          idempotencyKey: requiredIdempotencyKey(req, body)
        }, { requestId, principal });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/reconcile$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, requestId, principal }) => {
        const runtime = runtimeFor(context);
        const plan = await requireSearchAdPlanAccess(runtime, planId(match), principal);
        assertSearchAdPlanCustomer(plan, body.customerId);
        const result = await runtime.executionService.reconcile(planId(match), {}, { requestId, principal });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/changes\/(?<planId>[^/]+)\/rollback$/, auth: true, write: true, searchAdRole: 'executor',
      handler: async ({ req, res, match, body, requestId, principal }) => {
        requireSearchAdHttpWrites(context);
        const runtime = runtimeFor(context);
        const plan = await requireSearchAdPlanAccess(runtime, planId(match), principal);
        assertSearchAdPlanCustomer(plan, body.customerId);
        const result = await runtime.executionService.rollback(planId(match), {
          confirmation: body.confirmation,
          idempotencyKey: requiredIdempotencyKey(req, body)
        }, { requestId, principal });
        sendJson(req, res, 200, result);
      }
    }
  ];
}
