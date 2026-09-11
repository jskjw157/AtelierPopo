function bodySchema(properties, required = []) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {})
  };
}

const STRING = { type: 'string', minLength: 1 };
const START_BODY = bodySchema({ customerId: STRING, planId: STRING, executionToken: STRING }, ['customerId', 'planId', 'executionToken']);
const CHILD_BODY = bodySchema({ parentObjectId: STRING, planId: STRING, executionToken: STRING }, ['parentObjectId', 'planId', 'executionToken']);
const CLEANUP_BODY = bodySchema({ planId: STRING, executionToken: STRING }, ['planId', 'executionToken']);
const EMPTY_BODY = bodySchema({}, []);

function response(description) {
  return { description, content: { 'application/json': { schema: { type: 'object' } } } };
}

function request(schema) {
  return { required: true, content: { 'application/json': { schema } } };
}

function readPaths() {
  return {
    '/api/v1/searchad/lifecycle/runs': {
      get: {
        operationId: 'searchAdLifecycleListRuns',
        summary: 'List SearchAd hierarchy lifecycle runs within granted Customers',
        parameters: [
          { name: 'customerId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500 } }
        ],
        responses: { 200: response('Lifecycle run list') }
      }
    },
    '/api/v1/searchad/lifecycle/runs/{hierarchyRunId}': {
      get: {
        operationId: 'searchAdLifecycleGetRun',
        summary: 'Get one Customer-scoped hierarchy lifecycle run with sanitized objects/events',
        parameters: [{ name: 'hierarchyRunId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: response('Lifecycle run'), 404: response('Not found') }
      }
    }
  };
}

function mutationPaths() {
  return {
    '/api/v1/searchad/lifecycle/runs': {
      post: {
        operationId: 'searchAdLifecycleStartRun',
        summary: 'Start a server-owned hierarchy lifecycle Canary using an established one-time approval',
        requestBody: request(START_BODY),
        responses: { 201: response('Lifecycle run started'), 400: response('Invalid input'), 403: response('Disabled or forbidden') }
      }
    },
    '/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/adgroups': {
      post: {
        operationId: 'searchAdLifecycleCreateAdgroup',
        summary: 'Create a hierarchy Canary adgroup under a persisted owned campaign',
        parameters: [{ name: 'hierarchyRunId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: request(CHILD_BODY),
        responses: { 201: response('Adgroup created') }
      }
    },
    '/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/keywords': {
      post: {
        operationId: 'searchAdLifecycleCreateKeywords',
        summary: 'Create the server-owned hierarchy Canary keyword batch',
        parameters: [{ name: 'hierarchyRunId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: request(CHILD_BODY),
        responses: { 201: response('Keyword batch created') }
      }
    },
    '/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/creative': {
      post: {
        operationId: 'searchAdLifecycleCreateCreative',
        summary: 'Create the server-owned TEXT_45 hierarchy Canary creative',
        parameters: [{ name: 'hierarchyRunId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: request(CHILD_BODY),
        responses: { 201: response('Creative created') }
      }
    },
    '/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/cleanup-next': {
      post: {
        operationId: 'searchAdLifecycleCleanupNext',
        summary: 'Delete the deepest persisted owned Canary object only',
        parameters: [{ name: 'hierarchyRunId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: request(CLEANUP_BODY),
        responses: { 200: response('One cleanup step completed') }
      }
    },
    '/api/v1/searchad/lifecycle/runs/{hierarchyRunId}/reconcile': {
      post: {
        operationId: 'searchAdLifecycleReconcile',
        summary: 'Run read-only reconciliation for ambiguous hierarchy state',
        parameters: [{ name: 'hierarchyRunId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: request(EMPTY_BODY),
        responses: { 200: response('Reconciliation result') }
      }
    }
  };
}

function mergePaths(base, additions) {
  const out = structuredClone(base);
  for (const [path, methods] of Object.entries(additions)) {
    out[path] = { ...(out[path] || {}), ...methods };
  }
  return out;
}

export function searchAdLifecycleOpenApi({ role = 'reader' } = {}) {
  const normalizedRole = String(role || 'reader').toLowerCase();
  const paths = normalizedRole === 'admin'
    ? mergePaths(readPaths(), mutationPaths())
    : readPaths();
  return {
    openapi: '3.1.0',
    info: { title: 'HAAR SearchAd Lifecycle API', version: '0.1.0' },
    paths
  };
}

export const _internal = { START_BODY, CHILD_BODY, CLEANUP_BODY, EMPTY_BODY, bodySchema, mergePaths };
