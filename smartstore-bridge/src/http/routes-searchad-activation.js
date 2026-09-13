import { HttpError } from './errors.js';
import { sendJson } from './runtime.js';
import { searchAdActivationOpenApi } from './openapi-searchad-activation.js';

const SENSITIVE_KEY = /(credential.?fingerprint|secret|access.?license|signature|authorization|api.?key|token)/i;

function runtimeFor(context) {
  const runtime = context?.app?.searchAdActivationRuntime;
  const status = runtime?.status?.();
  if (!runtime || !status?.ready || !runtime.repository || !runtime.passiveEvidenceService ||
      !runtime.activationService || !runtime.accountControlService) {
    throw new HttpError(503, 'SEARCHAD_ACTIVATION_NOT_READY', 'SearchAd activation runtime is not ready.');
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

function clampLimit(value) {
  const parsed = Number.parseInt(String(value ?? '100'), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 100;
}

function cleanValue(value) {
  if (Array.isArray(value)) return value.map(cleanValue);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = cleanValue(nested);
  }
  return result;
}

export function publicEvidence(row) {
  if (!row) return null;
  return {
    evidenceId: row.evidenceId,
    evidenceType: row.evidenceType,
    customerId: row.customerId,
    operationKeys: Array.isArray(row.operationKeys) ? [...row.operationKeys] : [],
    fieldScope: Array.isArray(row.fieldScope) ? [...row.fieldScope] : [],
    result: row.result,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    details: cleanValue(row.details || {})
  };
}

export function publicActivation(row) {
  if (!row) return null;
  return {
    activationId: row.activationId,
    evidenceId: row.evidenceId,
    evidenceType: row.evidenceType,
    customerId: row.customerId,
    operationKeys: Array.isArray(row.operationKeys) ? [...row.operationKeys] : [],
    fieldScope: Array.isArray(row.fieldScope) ? [...row.fieldScope] : [],
    activatedByPrincipalId: row.activatedByPrincipalId,
    activatedAt: row.activatedAt,
    expiresAt: row.expiresAt
  };
}

export function publicAccount(row) {
  if (!row) return null;
  return { customerId: row.customerId, suspended: Boolean(row.suspended), updatedAt: row.updatedAt };
}

function exactBody(body, allowed, code, message) {
  const keys = Object.keys(body || {});
  const extra = keys.filter(key => !allowed.has(key));
  if (extra.length) throw new HttpError(400, code, message, { rejectedFields: extra });
}

async function scopedEvidence(runtime, evidenceId, principal) {
  const row = await runtime.repository.getEvidence(evidenceId);
  if (!row || !principalCustomers(principal).includes(String(row.customerId))) {
    throw new HttpError(404, 'SEARCHAD_EVIDENCE_NOT_FOUND', 'SearchAd evidence was not found.');
  }
  return row;
}

async function scopedActivation(runtime, activationId, principal) {
  const row = await runtime.repository.getActivation(activationId);
  if (!row || !principalCustomers(principal).includes(String(row.customerId))) {
    throw new HttpError(404, 'SEARCHAD_ACTIVATION_NOT_FOUND', 'SearchAd activation was not found.');
  }
  return row;
}

function idFrom(match, name) {
  return decodeURIComponent(match?.groups?.[name] || '');
}

function openApiRoute(role) {
  return {
    method: 'GET', pattern: new RegExp(`^/openapi-searchad-activation-${role}\\.json$`), auth: false, write: false,
    handler: async ({ req, res }) => sendJson(req, res, 200, searchAdActivationOpenApi({ role }))
  };
}

export function createSearchAdActivationRoutes(context) {
  return [
    ...['reader', 'operator', 'executor', 'admin'].map(openApiRoute),
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/evidence$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, url, principal }) => {
        const runtime = runtimeFor(context);
        const requestedCustomer = String(url.searchParams.get('customerId') || '').trim();
        const customerIds = requestedCustomer ? [assertCustomer(principal, requestedCustomer)] : principalCustomers(principal);
        const rows = await runtime.repository.listEvidence({
          customerIds,
          evidenceType: String(url.searchParams.get('evidenceType') || '').trim() || undefined,
          limit: clampLimit(url.searchParams.get('limit'))
        });
        sendJson(req, res, 200, { items: rows.map(publicEvidence) });
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/evidence\/(?<evidenceId>[^/]+)$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, match, principal }) => {
        const runtime = runtimeFor(context);
        const row = await scopedEvidence(runtime, idFrom(match, 'evidenceId'), principal);
        sendJson(req, res, 200, publicEvidence(row));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/capabilities\/passive-evidence$/, auth: true, write: true, searchAdRole: 'operator',
      handler: async ({ req, res, body, principal, requestId }) => {
        const runtime = runtimeFor(context);
        exactBody(body, new Set(['customerId']), 'SEARCHAD_PASSIVE_EVIDENCE_INPUT_INVALID', 'Trusted Passive evidence accepts only customerId.');
        assertCustomer(principal, body?.customerId);
        const row = await runtime.passiveEvidenceService.issue(body, { principal, requestId });
        sendJson(req, res, 201, publicEvidence(row));
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/activations$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, url, principal }) => {
        const runtime = runtimeFor(context);
        const requestedCustomer = String(url.searchParams.get('customerId') || '').trim();
        const customerIds = requestedCustomer ? [assertCustomer(principal, requestedCustomer)] : principalCustomers(principal);
        const rows = await runtime.repository.listActivations({
          customerIds,
          evidenceType: String(url.searchParams.get('evidenceType') || '').trim() || undefined,
          limit: clampLimit(url.searchParams.get('limit'))
        });
        sendJson(req, res, 200, { items: rows.map(publicActivation) });
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/activations\/(?<activationId>[^/]+)$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, match, principal }) => {
        const runtime = runtimeFor(context);
        const row = await scopedActivation(runtime, idFrom(match, 'activationId'), principal);
        sendJson(req, res, 200, publicActivation(row));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/activations$/, auth: true, write: true, searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        const runtime = runtimeFor(context);
        exactBody(body, new Set(['evidenceId']), 'SEARCHAD_ACTIVATION_INPUT_INVALID', 'SearchAd activation accepts only evidenceId.');
        const row = await runtime.activationService.activate(body, { principal, requestId });
        sendJson(req, res, 201, publicActivation(row));
      }
    },
    {
      method: 'GET', pattern: /^\/api\/v1\/searchad\/accounts\/control-status$/, auth: true, write: false, searchAdRole: 'reader',
      handler: async ({ req, res, principal, requestId }) => {
        const runtime = runtimeFor(context);
        const rows = await runtime.accountControlService.list({ principal, requestId });
        sendJson(req, res, 200, { items: rows.map(publicAccount) });
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/accounts\/(?<customerId>[^/]+)\/suspend$/, auth: true, write: true, searchAdRole: 'admin',
      handler: async ({ req, res, match, principal, requestId }) => {
        const runtime = runtimeFor(context);
        const customerId = assertCustomer(principal, idFrom(match, 'customerId'));
        const row = await runtime.accountControlService.suspend(customerId, { principal, requestId });
        sendJson(req, res, 200, publicAccount(row));
      }
    },
    {
      method: 'POST', pattern: /^\/api\/v1\/searchad\/accounts\/(?<customerId>[^/]+)\/resume$/, auth: true, write: true, searchAdRole: 'admin',
      handler: async ({ req, res, match, principal, requestId }) => {
        const runtime = runtimeFor(context);
        const customerId = assertCustomer(principal, idFrom(match, 'customerId'));
        const row = await runtime.accountControlService.resume(customerId, { principal, requestId });
        sendJson(req, res, 200, publicAccount(row));
      }
    }
  ];
}

export const _internal = {
  runtimeFor, principalCustomers, assertCustomer, clampLimit, cleanValue, exactBody, scopedEvidence, scopedActivation
};
