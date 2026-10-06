const ROLES = new Set(['reader', 'operator', 'executor', 'admin']);

const customerId = () => ({ type: 'string', pattern: '^\\d{1,30}$' });
const localId = () => ({ type: 'string', format: 'uuid' });

function bodySchema(required, properties) {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties
  };
}

function requestBody(schema) {
  return {
    required: true,
    content: { 'application/json': { schema } }
  };
}

function pathParameters(names) {
  return names.map(name => ({
    name,
    in: 'path',
    required: true,
    schema: localId()
  }));
}

function response(description = 'Hierarchy lifecycle result') {
  return {
    200: {
      description,
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: true }
        }
      }
    },
    400: { description: 'Request shape is not the bounded documented contract' },
    403: { description: 'Admin role or explicit Customer scope is required' },
    409: { description: 'Current hierarchy state, authority, or safety proof blocks the action' }
  };
}

function prepareCampaignSchema() {
  return bodySchema(
    ['customerId', 'activationId'],
    { customerId: customerId(), activationId: localId() }
  );
}

function childPrepareSchema() {
  return bodySchema(
    ['customerId', 'hierarchyRunId', 'parentObjectId', 'activationId'],
    {
      customerId: customerId(),
      hierarchyRunId: localId(),
      parentObjectId: localId(),
      activationId: localId()
    }
  );
}

function leafPrepareSchema() {
  return bodySchema(
    ['customerId', 'hierarchyRunId', 'hierarchyObjectId', 'activationId'],
    {
      customerId: customerId(),
      hierarchyRunId: localId(),
      hierarchyObjectId: localId(),
      activationId: localId()
    }
  );
}

function executeSchema() {
  return bodySchema(
    ['customerId', 'executionToken'],
    {
      customerId: customerId(),
      executionToken: { type: 'string', writeOnly: true }
    }
  );
}

function cleanupExecuteSchema() {
  return bodySchema(
    ['customerId', 'executionToken', 'confirmation', 'secondConfirmation'],
    {
      customerId: customerId(),
      executionToken: { type: 'string', writeOnly: true },
      confirmation: { type: 'string' },
      secondConfirmation: { type: 'string' }
    }
  );
}

function cleanupReconcileSchema() {
  return bodySchema(['customerId'], { customerId: customerId() });
}

function inventorySchema() {
  return bodySchema(
    ['customerId', 'hierarchyRunId', 'parentObjectId', 'childType'],
    {
      customerId: customerId(),
      hierarchyRunId: localId(),
      parentObjectId: localId(),
      childType: { type: 'string', enum: ['keyword', 'creative', 'adgroup'] }
    }
  );
}

function reconcileSchema() {
  return bodySchema(
    ['customerId', 'hierarchyRunId', 'hierarchyObjectId'],
    {
      customerId: customerId(),
      hierarchyRunId: localId(),
      hierarchyObjectId: localId()
    }
  );
}

function adminPaths() {
  return {
    '/api/v1/searchad/hierarchy/campaigns/prepare': {
      post: {
        summary: 'Prepare one server-owned root campaign creation plan locally',
        security: [{ bearerAuth: [] }],
        requestBody: requestBody(prepareCampaignSchema()),
        responses: { ...response('Prepared campaign plan'), 201: response('Prepared campaign plan')[200] }
      }
    },
    '/api/v1/searchad/hierarchy/campaigns/{hierarchyRunId}/{hierarchyObjectId}/{planId}/execute': {
      post: {
        summary: 'Execute one separately approved root campaign creation plan',
        security: [{ bearerAuth: [] }],
        parameters: pathParameters(['hierarchyRunId', 'hierarchyObjectId', 'planId']),
        requestBody: requestBody(executeSchema()),
        responses: response()
      }
    },
    '/api/v1/searchad/hierarchy/adgroups/prepare': {
      post: {
        summary: 'Prepare one server-owned adgroup creation plan locally',
        security: [{ bearerAuth: [] }],
        requestBody: requestBody(childPrepareSchema()),
        responses: { ...response('Prepared adgroup plan'), 201: response('Prepared adgroup plan')[200] }
      }
    },
    '/api/v1/searchad/hierarchy/adgroups/{hierarchyRunId}/{parentObjectId}/{hierarchyObjectId}/{planId}/execute': {
      post: {
        summary: 'Execute one separately approved adgroup creation plan',
        security: [{ bearerAuth: [] }],
        parameters: pathParameters(['hierarchyRunId', 'parentObjectId', 'hierarchyObjectId', 'planId']),
        requestBody: requestBody(executeSchema()),
        responses: response()
      }
    },
    '/api/v1/searchad/hierarchy/keywords/prepare': {
      post: {
        summary: 'Prepare the bounded server-owned keyword batch plan locally',
        description: 'The public request supplies only local hierarchy scope and activation authority; keyword content remains server-owned.',
        security: [{ bearerAuth: [] }],
        requestBody: requestBody(childPrepareSchema()),
        responses: { ...response('Prepared keyword plan'), 201: response('Prepared keyword plan')[200] }
      }
    },
    '/api/v1/searchad/hierarchy/keywords/{hierarchyRunId}/{parentObjectId}/{planId}/execute': {
      post: {
        summary: 'Execute one separately approved bounded keyword batch plan',
        security: [{ bearerAuth: [] }],
        parameters: pathParameters(['hierarchyRunId', 'parentObjectId', 'planId']),
        requestBody: requestBody(executeSchema()),
        responses: response()
      }
    },
    '/api/v1/searchad/hierarchy/creatives/prepare': {
      post: {
        summary: 'Prepare the bounded server-owned creative plan locally',
        description: 'The public request supplies only local hierarchy scope and activation authority; creative content remains server-owned.',
        security: [{ bearerAuth: [] }],
        requestBody: requestBody(childPrepareSchema()),
        responses: { ...response('Prepared creative plan'), 201: response('Prepared creative plan')[200] }
      }
    },
    '/api/v1/searchad/hierarchy/creatives/{hierarchyRunId}/{parentObjectId}/{planId}/execute': {
      post: {
        summary: 'Execute one separately approved bounded creative plan',
        security: [{ bearerAuth: [] }],
        parameters: pathParameters(['hierarchyRunId', 'parentObjectId', 'planId']),
        requestBody: requestBody(executeSchema()),
        responses: response()
      }
    },
    '/api/v1/searchad/hierarchy/leaves/cleanup/prepare': {
      post: {
        summary: 'Prepare one bounded keyword or creative leaf cleanup plan locally',
        security: [{ bearerAuth: [] }],
        requestBody: requestBody(leafPrepareSchema()),
        responses: { ...response('Prepared leaf cleanup plan'), 201: response('Prepared leaf cleanup plan')[200] }
      }
    },
    '/api/v1/searchad/hierarchy/leaves/cleanup/{hierarchyRunId}/{hierarchyObjectId}/{planId}/execute': {
      post: {
        summary: 'Execute one separately approved leaf cleanup attempt',
        security: [{ bearerAuth: [] }],
        parameters: pathParameters(['hierarchyRunId', 'hierarchyObjectId', 'planId']),
        requestBody: requestBody(cleanupExecuteSchema()),
        responses: response()
      }
    },
    '/api/v1/searchad/hierarchy/leaves/cleanup/{hierarchyRunId}/{hierarchyObjectId}/{planId}/reconcile': {
      post: {
        summary: 'Perform plan-bound GET-only leaf cleanup recovery without replaying deletion',
        security: [{ bearerAuth: [] }],
        parameters: pathParameters(['hierarchyRunId', 'hierarchyObjectId', 'planId']),
        requestBody: requestBody(cleanupReconcileSchema()),
        responses: response('Read-only cleanup recovery result')
      }
    },
    '/api/v1/searchad/hierarchy/inventory/scan': {
      post: {
        summary: 'Perform a read-only descendant inventory scan without granting cleanup authority',
        description: 'Observation only. Empty responses remain unproven absence and do not authorize parent cleanup.',
        security: [{ bearerAuth: [] }],
        requestBody: requestBody(inventorySchema()),
        responses: response('Sanitized inventory observation')
      }
    },
    '/api/v1/searchad/hierarchy/reconcile': {
      post: {
        summary: 'Perform plan-safe GET-only hierarchy recovery for non-cleanup unknown outcomes',
        description: 'Dedicated cleanup-plan targets remain owned by their plan-bound recovery coordinator. This endpoint never retries a remote mutation.',
        security: [{ bearerAuth: [] }],
        requestBody: requestBody(reconcileSchema()),
        responses: response('GET-only hierarchy recovery result')
      }
    }
  };
}

export function searchAdHierarchyOpenApi({ role = 'reader', version = '0.8.0' } = {}) {
  const normalizedRole = String(role).toLowerCase();
  if (!ROLES.has(normalizedRole)) throw new TypeError(`Unsupported SearchAd OpenAPI role: ${normalizedRole}`);
  return {
    openapi: '3.0.3',
    info: {
      title: `HAAR SearchAd Hierarchy Lifecycle (${normalizedRole})`,
      version,
      description: 'Role-scoped bounded hierarchy lifecycle surface. Parent campaign/adgroup deletion remains intentionally unavailable.'
    },
    paths: normalizedRole === 'admin' ? adminPaths() : {},
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'SearchAd role bearer credential'
        }
      }
    }
  };
}

export const _internal = {
  bodySchema,
  prepareCampaignSchema,
  childPrepareSchema,
  leafPrepareSchema,
  executeSchema,
  cleanupExecuteSchema,
  cleanupReconcileSchema,
  inventorySchema,
  reconcileSchema,
  adminPaths
};
