import { HttpError } from './errors.js';
import { sendJson } from './runtime.js';
import { searchAdCanaryOpenApi } from './openapi-searchad-canary.js';

const TERMINAL_PUBLIC_ERROR_KEYS = ['code', 'status'];

function runId(match) {
  return decodeURIComponent(match?.groups?.canaryRunId || '');
}

function clampLimit(value) {
  const parsed = Number.parseInt(String(value ?? '100'), 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(100, parsed));
}

function runtimeFor(context) {
  const runtime = context?.app?.searchAdActiveCanaryRuntime;
  const status = runtime?.status?.();
  if (!runtime || !status?.ready || !runtime.repository || !runtime.service) {
    throw new HttpError(503, 'SEARCHAD_CANARY_NOT_READY', 'SearchAd Active Canary runtime is not ready.');
  }
  return runtime;
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

async function scopedRun(runtime, canaryRunId, principal) {
  const run = await runtime.repository.getRun(canaryRunId);
  if (!run || !principalCustomers(principal).includes(String(run.customerId))) {
    throw new HttpError(404, 'SEARCHAD_CANARY_NOT_FOUND', 'Active Canary run was not found.');
  }
  return run;
}

function publicLastError(lastError) {
  if (!lastError || typeof lastError !== 'object') return null;
  const result = {};
  for (const key of TERMINAL_PUBLIC_ERROR_KEYS) {
    if (lastError[key] !== undefined && lastError[key] !== null) result[key] = lastError[key];
  }
  return Object.keys(result).length ? result : null;
}

export function publicCanaryRun(run) {
  if (!run) return null;
  return {
    canaryRunId: run.canaryRunId,
    customerId: run.customerId,
    passiveEvidenceId: run.passiveEvidenceId,
    recipeId: run.recipeId,
    status: run.status,
    startedByPrincipalId: run.startedByPrincipalId,
    specSha: run.specSha,
    upstreamBaseUrl: run.upstreamBaseUrl,
    verifiedOperationScope: run.verifiedOperationScope || {},
    startedAt: run.startedAt,
    beforeSpend: run.beforeSpend ?? null,
    afterSpend: run.afterSpend ?? null,
    spendDelta: run.spendDelta ?? null,
    remoteId: run.remoteId ?? null,
    cleanupVerifiedAt: run.cleanupVerifiedAt ?? null,
    evidenceId: run.evidenceId ?? null,
    completedAt: run.completedAt ?? null,
    lastError: publicLastError(run.lastError)
  };
}

function openApiRoute(role) {
  return {
    method: 'GET',
    pattern: new RegExp(`^/openapi-searchad-canary-${role}\\.json$`),
    auth: false,
    write: false,
    handler: async ({ req, res }) => sendJson(req, res, 200, searchAdCanaryOpenApi({ role }))
  };
}

export function createSearchAdCanaryRoutes(context) {
  return [
    ...['reader', 'operator', 'executor', 'admin'].map(openApiRoute),
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/canary\/runs$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, url, principal }) => {
        const runtime = runtimeFor(context);
        const requestedCustomer = String(url.searchParams.get('customerId') || '').trim();
        const status = String(url.searchParams.get('status') || '').trim() || undefined;
        const limit = clampLimit(url.searchParams.get('limit'));
        const customers = requestedCustomer
          ? [assertCustomer(principal, requestedCustomer)]
          : principalCustomers(principal);
        const chunks = [];
        for (const customerId of customers) {
          const rows = await runtime.repository.listRuns({ customerId, status, limit });
          chunks.push(...rows);
        }
        chunks.sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));
        sendJson(req, res, 200, { items: chunks.slice(0, limit).map(publicCanaryRun) });
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/canary\/runs\/(?<canaryRunId>[^/]+)$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, match, principal }) => {
        const runtime = runtimeFor(context);
        const run = await scopedRun(runtime, runId(match), principal);
        sendJson(req, res, 200, publicCanaryRun(run));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/canary\/runs$/, auth: true, write: true, searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        const runtime = runtimeFor(context);
        assertCustomer(principal, body?.customerId);
        const run = await runtime.service.start(body, { principal, requestId });
        sendJson(req, res, 201, publicCanaryRun(run));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/canary\/runs\/(?<canaryRunId>[^/]+)\/reconcile$/, auth: true, write: true, searchAdRole: 'admin',
      handler: async ({ req, res, match, principal, requestId }) => {
        const runtime = runtimeFor(context);
        const id = runId(match);
        await scopedRun(runtime, id, principal);
        const run = await runtime.service.reconcile(id, { principal, requestId });
        sendJson(req, res, 200, publicCanaryRun(run));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/canary\/runs\/(?<canaryRunId>[^/]+)\/cleanup$/, auth: true, write: true, searchAdRole: 'admin',
      handler: async ({ req, res, match, principal, requestId }) => {
        const runtime = runtimeFor(context);
        const id = runId(match);
        await scopedRun(runtime, id, principal);
        const run = await runtime.service.cleanup(id, { principal, requestId });
        sendJson(req, res, 200, publicCanaryRun(run));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/canary\/runs\/(?<canaryRunId>[^/]+)\/verify-spend$/, auth: true, write: true, searchAdRole: 'admin',
      handler: async ({ req, res, match, principal, requestId }) => {
        const runtime = runtimeFor(context);
        const id = runId(match);
        await scopedRun(runtime, id, principal);
        const run = await runtime.service.verifySpend(id, { principal, requestId });
        sendJson(req, res, 200, publicCanaryRun(run));
      }
    }
  ];
}

export const _internal = { runtimeFor, principalCustomers, assertCustomer, scopedRun, clampLimit };
