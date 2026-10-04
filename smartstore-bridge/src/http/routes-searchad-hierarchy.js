import { HttpError } from './errors.js';
import { sendJson } from './runtime.js';
import { requireSearchAdHttpWrites } from './searchad-write-runtime.js';

const CAMPAIGN_PREPARE_KEYS = new Set(['customerId', 'activationId']);
const ADGROUP_PREPARE_KEYS = new Set(['customerId', 'hierarchyRunId', 'parentObjectId', 'activationId']);
const SIBLING_PREPARE_KEYS = new Set(['customerId', 'hierarchyRunId', 'parentObjectId', 'activationId']);
const LEAF_CLEANUP_PREPARE_KEYS = new Set(['customerId', 'hierarchyRunId', 'hierarchyObjectId', 'activationId']);
const LEAF_CLEANUP_EXECUTE_KEYS = new Set(['customerId', 'executionToken', 'confirmation', 'secondConfirmation']);
const LEAF_RECONCILE_KEYS = new Set(['customerId']);
const INVENTORY_SCAN_KEYS = new Set(['customerId', 'hierarchyRunId', 'parentObjectId', 'childType']);
const RECONCILE_KEYS = new Set(['customerId', 'hierarchyRunId', 'hierarchyObjectId']);
const EXECUTE_KEYS = new Set(['customerId', 'executionToken']);

function runtimeFor(context) {
  const runtime = context?.app?.searchAdHierarchyRuntime;
  if (!runtime || runtime.status?.().ready !== true) {
    throw new HttpError(503, 'SEARCHAD_HIERARCHY_NOT_READY', 'SearchAd hierarchy lifecycle runtime is not ready.');
  }
  return runtime;
}

function serviceFor(context, name) {
  const service = runtimeFor(context)[name];
  if (!service) {
    throw new HttpError(503, 'SEARCHAD_HIERARCHY_NOT_READY', 'SearchAd hierarchy lifecycle runtime is not ready.');
  }
  return service;
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

function publicInventoryObservation(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    hierarchyRunId: result.hierarchyRunId,
    parentObjectId: result.parentObjectId,
    parentType: result.parentType,
    childType: result.childType,
    kind: result.kind,
    count: result.count,
    completeAbsence: result.completeAbsence,
    changed: result.changed,
    ...(result.scan ? { scan: structuredClone(result.scan) } : {})
  };
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
        exactBody(body, CAMPAIGN_PREPARE_KEYS);
        const result = await serviceFor(context, 'campaignCreateService').prepare(body, { principal, requestId });
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
        const result = await serviceFor(context, 'campaignCreateService').execute({
          customerId: body.customerId,
          hierarchyRunId: localId(match, 'hierarchyRunId'),
          hierarchyObjectId: localId(match, 'hierarchyObjectId'),
          planId: localId(match, 'planId'),
          executionToken: body.executionToken
        }, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/adgroups\/prepare$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        exactBody(body, ADGROUP_PREPARE_KEYS);
        const result = await serviceFor(context, 'adgroupCreateService').prepare(body, { principal, requestId });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/adgroups\/(?<hierarchyRunId>[^/]+)\/(?<parentObjectId>[^/]+)\/(?<hierarchyObjectId>[^/]+)\/(?<planId>[^/]+)\/execute$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, match, body, principal, requestId }) => {
        requireSearchAdHttpWrites(context);
        exactBody(body, EXECUTE_KEYS);
        const result = await serviceFor(context, 'adgroupCreateService').execute({
          customerId: body.customerId,
          hierarchyRunId: localId(match, 'hierarchyRunId'),
          parentObjectId: localId(match, 'parentObjectId'),
          hierarchyObjectId: localId(match, 'hierarchyObjectId'),
          planId: localId(match, 'planId'),
          executionToken: body.executionToken
        }, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/keywords\/prepare$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        exactBody(body, SIBLING_PREPARE_KEYS);
        const result = await serviceFor(context, 'siblingCreateService').prepareKeywords(body, { principal, requestId });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/keywords\/(?<hierarchyRunId>[^/]+)\/(?<parentObjectId>[^/]+)\/(?<planId>[^/]+)\/execute$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, match, body, principal, requestId }) => {
        requireSearchAdHttpWrites(context);
        exactBody(body, EXECUTE_KEYS);
        const result = await serviceFor(context, 'siblingCreateService').execute({
          customerId: body.customerId,
          hierarchyRunId: localId(match, 'hierarchyRunId'),
          parentObjectId: localId(match, 'parentObjectId'),
          planId: localId(match, 'planId'),
          executionToken: body.executionToken,
          kind: 'keywords'
        }, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/creatives\/prepare$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        exactBody(body, SIBLING_PREPARE_KEYS);
        const result = await serviceFor(context, 'siblingCreateService').prepareCreative(body, { principal, requestId });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/creatives\/(?<hierarchyRunId>[^/]+)\/(?<parentObjectId>[^/]+)\/(?<planId>[^/]+)\/execute$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, match, body, principal, requestId }) => {
        requireSearchAdHttpWrites(context);
        exactBody(body, EXECUTE_KEYS);
        const result = await serviceFor(context, 'siblingCreateService').execute({
          customerId: body.customerId,
          hierarchyRunId: localId(match, 'hierarchyRunId'),
          parentObjectId: localId(match, 'parentObjectId'),
          planId: localId(match, 'planId'),
          executionToken: body.executionToken,
          kind: 'creative'
        }, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/leaves\/cleanup\/prepare$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        exactBody(body, LEAF_CLEANUP_PREPARE_KEYS);
        const result = await serviceFor(context, 'leafCleanupService').prepare(body, { principal, requestId });
        sendJson(req, res, 201, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/leaves\/cleanup\/(?<hierarchyRunId>[^/]+)\/(?<hierarchyObjectId>[^/]+)\/(?<planId>[^/]+)\/execute$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, match, body, principal, requestId }) => {
        requireSearchAdHttpWrites(context);
        exactBody(body, LEAF_CLEANUP_EXECUTE_KEYS);
        const result = await serviceFor(context, 'leafCleanupService').execute({
          customerId: body.customerId,
          hierarchyRunId: localId(match, 'hierarchyRunId'),
          hierarchyObjectId: localId(match, 'hierarchyObjectId'),
          planId: localId(match, 'planId'),
          executionToken: body.executionToken,
          confirmation: body.confirmation,
          secondConfirmation: body.secondConfirmation
        }, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/leaves\/cleanup\/(?<hierarchyRunId>[^/]+)\/(?<hierarchyObjectId>[^/]+)\/(?<planId>[^/]+)\/reconcile$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, match, body, principal, requestId }) => {
        exactBody(body, LEAF_RECONCILE_KEYS);
        const result = await serviceFor(context, 'leafCleanupService').reconcile({
          customerId: body.customerId,
          hierarchyRunId: localId(match, 'hierarchyRunId'),
          hierarchyObjectId: localId(match, 'hierarchyObjectId'),
          planId: localId(match, 'planId')
        }, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/inventory\/scan$/,
      auth: true,
      write: false,
      searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        exactBody(body, INVENTORY_SCAN_KEYS);
        const result = await serviceFor(context, 'descendantInventoryService').scan(body, { principal, requestId });
        sendJson(req, res, 200, publicInventoryObservation(result));
      }
    },
    {
      method: 'POST',
      pattern: /^\/api\/v1\/searchad\/hierarchy\/reconcile$/,
      auth: true,
      write: true,
      searchAdRole: 'admin',
      handler: async ({ req, res, body, principal, requestId }) => {
        exactBody(body, RECONCILE_KEYS);
        const result = await serviceFor(context, 'hierarchyReconcileService').reconcile(body, { principal, requestId });
        sendJson(req, res, 200, result);
      }
    }
  ];
}

export const _internal = { runtimeFor, serviceFor, exactBody, localId, publicInventoryObservation };
