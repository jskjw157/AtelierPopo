import { SearchAdWriteError } from '../naver/searchad/write/errors.js';

function fail(code, message, details = {}, status = 400) {
  throw new SearchAdWriteError(code, message, details, status);
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function principalCustomerIds(principal = {}) {
  return [...new Set((principal?.customerIds || []).map(String).filter(Boolean))];
}

function assertCustomerAccess(principal, customerId) {
  const id = String(customerId || '').trim();
  if (!id || !principalCustomerIds(principal).includes(id)) {
    fail('SEARCHAD_CUSTOMER_FORBIDDEN', 'This SearchAd principal cannot access the requested Customer.', { customerId: id || null }, 403);
  }
  return id;
}

function assertExactBody(body, allowedKeys, requiredKeys = []) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('SEARCHAD_LIFECYCLE_HTTP_INPUT_INVALID', 'Lifecycle request body must be a JSON object.', {}, 400);
  }
  const allowed = new Set(allowedKeys);
  const extra = Object.keys(body).filter(key => !allowed.has(key));
  const missing = requiredKeys.filter(key => String(body?.[key] ?? '').trim() === '');
  if (extra.length || missing.length) {
    fail('SEARCHAD_LIFECYCLE_HTTP_INPUT_INVALID', 'Lifecycle request body contains unsupported or missing fields.', {
      rejectedFields: extra.sort(),
      missingFields: missing.sort()
    }, 400);
  }
}

function publicError(error) {
  if (!error) return null;
  return {
    name: error.name || undefined,
    code: error.code || null,
    status: Number(error.status || error.statusCode || 0) || undefined
  };
}

export function publicLifecycleRun(run) {
  if (!run) return null;
  return {
    hierarchyRunId: run.hierarchyRunId,
    customerId: run.customerId,
    recipeId: run.recipeId,
    status: run.status,
    startedByPrincipalId: run.startedByPrincipalId,
    specSha: run.specSha,
    upstreamBaseUrl: run.upstreamBaseUrl,
    activationId: run.activationId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    lastError: publicError(run.lastError)
  };
}

export function publicLifecycleObject(object) {
  if (!object) return null;
  return {
    hierarchyObjectId: object.hierarchyObjectId,
    hierarchyRunId: object.hierarchyRunId,
    customerId: object.customerId,
    objectType: object.objectType,
    parentObjectId: object.parentObjectId,
    remoteId: object.remoteId,
    state: object.state,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    deletedAt: object.deletedAt
  };
}

export function publicLifecycleEvent(event) {
  if (!event) return null;
  return {
    eventId: event.eventId,
    hierarchyRunId: event.hierarchyRunId,
    hierarchyObjectId: event.hierarchyObjectId,
    customerId: event.customerId,
    phase: event.phase,
    status: event.status,
    operationKey: event.operationKey,
    lifecycleKind: event.lifecycleKind,
    requestId: event.requestId,
    error: publicError(event.error),
    createdAt: event.createdAt
  };
}

function publicResult(result) {
  if (!result) return result;
  if (result.hierarchyRunId) return publicLifecycleRun(result);
  return {
    ...(result.run ? { run: publicLifecycleRun(result.run) } : {}),
    ...(result.object !== undefined ? { object: publicLifecycleObject(result.object) } : {}),
    ...(Array.isArray(result.objects) ? { objects: result.objects.map(publicLifecycleObject) } : {})
  };
}

function runtimeFor(app) {
  const runtime = app?.searchAdLifecycleRuntime;
  if (!runtime?.repository || !runtime?.service || runtime?.status?.()?.ready !== true) {
    fail('SEARCHAD_LIFECYCLE_NOT_READY', 'SearchAd lifecycle runtime is not ready.', {}, 503);
  }
  return runtime;
}

async function findRunForPrincipal(repository, hierarchyRunId, principal) {
  for (const customerId of principalCustomerIds(principal)) {
    const run = await repository.getRun(String(hierarchyRunId), customerId);
    if (run) return run;
  }
  fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy Canary run was not found.', { hierarchyRunId: String(hierarchyRunId) }, 404);
}

function context(principal, requestId) {
  return { principal, requestId: requestId || null };
}

export function createSearchAdLifecycleRoutes({ app } = {}) {
  return [
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/lifecycle\/runs$/, searchAdRole: 'reader',
      async handler({ res, principal, url }) {
        const runtime = runtimeFor(app);
        const ids = principalCustomerIds(principal);
        const requested = String(url.searchParams.get('customerId') || '').trim();
        const customerIds = requested ? [assertCustomerAccess(principal, requested)] : ids;
        const status = String(url.searchParams.get('status') || '').trim();
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 100));
        const rows = await runtime.repository.listRuns({ customerIds, statuses: status ? [status] : [], limit });
        json(res, 200, { items: rows.map(publicLifecycleRun) });
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/lifecycle\/runs\/([^/]+)$/, searchAdRole: 'reader',
      async handler({ res, principal, match }) {
        const runtime = runtimeFor(app);
        const run = await findRunForPrincipal(runtime.repository, match[1], principal);
        const [objects, events] = await Promise.all([
          runtime.repository.listObjects(run.hierarchyRunId, run.customerId),
          runtime.repository.listEvents(run.hierarchyRunId, run.customerId)
        ]);
        json(res, 200, {
          run: publicLifecycleRun(run),
          objects: objects.map(publicLifecycleObject),
          events: events.map(publicLifecycleEvent)
        });
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/lifecycle\/runs$/, searchAdRole: 'admin',
      async handler({ res, principal, body, requestId }) {
        const runtime = runtimeFor(app);
        assertExactBody(body, ['customerId', 'planId', 'executionToken'], ['customerId', 'planId', 'executionToken']);
        assertCustomerAccess(principal, body.customerId);
        const result = await runtime.service.start({ ...body }, context(principal, requestId));
        json(res, 201, publicResult(result));
      }
    },
    ...[
      ['adgroups', 'createAdgroup'],
      ['keywords', 'createKeywords'],
      ['creative', 'createCreative']
    ].map(([segment, method]) => ({
      method: 'POST', pattern: new RegExp(`^/api/v1/searchad/lifecycle/runs/([^/]+)/${segment}$`), searchAdRole: 'admin',
      async handler({ res, principal, body, match, requestId }) {
        const runtime = runtimeFor(app);
        assertExactBody(body, ['parentObjectId', 'planId', 'executionToken'], ['parentObjectId', 'planId', 'executionToken']);
        const run = await findRunForPrincipal(runtime.repository, match[1], principal);
        const result = await runtime.service[method]({
          hierarchyRunId: run.hierarchyRunId,
          parentObjectId: body.parentObjectId,
          planId: body.planId,
          executionToken: body.executionToken
        }, context(principal, requestId));
        json(res, 201, publicResult(result));
      }
    })),
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/lifecycle\/runs\/([^/]+)\/cleanup-next$/, searchAdRole: 'admin',
      async handler({ res, principal, body, match, requestId }) {
        const runtime = runtimeFor(app);
        assertExactBody(body, ['planId', 'executionToken'], ['planId', 'executionToken']);
        const run = await findRunForPrincipal(runtime.repository, match[1], principal);
        const result = await runtime.service.cleanupNext({
          hierarchyRunId: run.hierarchyRunId,
          planId: body.planId,
          executionToken: body.executionToken
        }, context(principal, requestId));
        json(res, 200, publicResult(result));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/lifecycle\/runs\/([^/]+)\/reconcile$/, searchAdRole: 'admin',
      async handler({ res, principal, body, match, requestId }) {
        const runtime = runtimeFor(app);
        assertExactBody(body || {}, [], []);
        const run = await findRunForPrincipal(runtime.repository, match[1], principal);
        const result = await runtime.service.reconcile(run.hierarchyRunId, context(principal, requestId));
        json(res, 200, publicResult(result));
      }
    }
  ];
}

export const _internal = { assertExactBody, assertCustomerAccess, findRunForPrincipal, publicError, publicResult };
