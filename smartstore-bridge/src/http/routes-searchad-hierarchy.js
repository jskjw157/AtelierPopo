import { HttpError } from './errors.js';
import { sendJson } from './runtime.js';
import { requireSearchAdHttpWrites } from './searchad-write-runtime.js';

const PREPARE_KEYS = new Set(['customerId', 'activationId']);
const EXECUTE_KEYS = new Set(['customerId', 'executionToken']);

function runtimeFor(context) {
  const runtime = context?.app?.searchAdHierarchyRuntime;
  if (!runtime || runtime.status?.().ready !== true || !runtime.campaignCreateService) {
    throw new HttpError(503, 'SEARCHAD_HIERARCHY_NOT_READY', 'SearchAd hierarchy lifecycle runtime is not ready.');
  }
  return runtime;
}

function exactBody(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== allowed.size ||
      Object.keys(body).some(key => !allowed.has(key))) {
    throw new HttpError(400, 'SEARCHAD_HIERARCHY_INPUT_INVALID', 'Only the documented hierarchy lifecycle fields are accepted.');
  }
}

function localId(match, name) {
  return decodeURIComponent(String(match?.groups?.[name] || ''));
}

export function createSearchAdHierarchyRoutes(context) {
  return [
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/campaigns\/prepare$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        exactBody(body, PREPARE_KEYS);
        const result = await runtimeFor(context).campaignCreateService.prepare(body, { principal, requestId });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/campaigns\/(?<hierarchyRunId>[^/]+)\/(?<hierarchyObjectId>[^/]+)\/(?<planId>[^/]+)\/execute$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, match, body, principal, requestId }) => {
        requireSearchAdHttpWrites(context);
        exactBody(body, EXECUTE_KEYS);
        const result = await runtimeFor(context).campaignCreateService.execute({
          customerId: body.customerId,
          hierarchyRunId: localId(match, 'hierarchyRunId'),
          hierarchyObjectId: localId(match, 'hierarchyObjectId'),
          planId: localId(match, 'planId'),
          executionToken: body.executionToken
        }, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    }
  ];
}

export const _internal = { runtimeFor, exactBody, localId };
