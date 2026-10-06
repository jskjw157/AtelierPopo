const ROLES = new Set(['reader', 'operator', 'executor', 'admin']);

function runSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      canaryRunId: { type: 'string' },
      customerId: { type: 'string' },
      passiveEvidenceId: { type: 'string' },
      recipeId: { type: 'string' },
      status: { type: 'string' },
      startedByPrincipalId: { type: 'string' },
      specSha: { type: 'string' },
      upstreamBaseUrl: { type: 'string' },
      verifiedOperationScope: { type: 'object', additionalProperties: true },
      startedAt: { type: 'string', format: 'date-time' },
      beforeSpend: { type: ['number', 'null'] },
      afterSpend: { type: ['number', 'null'] },
      spendDelta: { type: ['number', 'null'] },
      remoteId: { type: ['string', 'null'] },
      cleanupVerifiedAt: { type: ['string', 'null'], format: 'date-time' },
      evidenceId: { type: ['string', 'null'] },
      completedAt: { type: ['string', 'null'], format: 'date-time' },
      lastError: {
        anyOf: [
          { type: 'null' },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: { type: ['string', 'null'] },
              status: { type: ['number', 'null'] }
            }
          }
        ]
      }
    }
  };
}

function readPaths() {
  return {
    '/api/v1/searchad/canary/runs': {
      get: {
        summary: 'List Active Canary runs visible to the authenticated SearchAd principal',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'customerId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } }
        ],
        responses: {
          200: {
            description: 'Visible Canary runs',
            content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: runSchema() } } } } }
          },
          401: { description: 'Authentication required' },
          403: { description: 'Customer scope denied' }
        }
      }
    },
    '/api/v1/searchad/canary/runs/{canaryRunId}': {
      get: {
        summary: 'Get one visible Active Canary run',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'canaryRunId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Visible Canary run', content: { 'application/json': { schema: runSchema() } } },
          404: { description: 'Run is absent or not visible to this principal' }
        }
      }
    }
  };
}

function adminPaths(paths) {
  paths['/api/v1/searchad/canary/runs'].post = {
    summary: 'Start the server-fixed Active Canary recipe',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['customerId', 'passiveEvidenceId'],
            properties: {
              customerId: { type: 'string' },
              passiveEvidenceId: { type: 'string' }
            }
          }
        }
      }
    },
    responses: {
      201: { description: 'Canary run created', content: { 'application/json': { schema: runSchema() } } },
      403: { description: 'Admin role or Customer grant required' },
      409: { description: 'Safety gate or evidence condition blocked execution' }
    }
  };

  for (const [suffix, summary] of [
    ['reconcile', 'Perform read-only reconciliation of an unresolved Canary run'],
    ['cleanup', 'Perform one bounded returned-ID-only cleanup attempt'],
    ['verify-spend', 'Verify post-cleanup zero-spend evidence after the observation period']
  ]) {
    paths[`/api/v1/searchad/canary/runs/{canaryRunId}/${suffix}`] = {
      post: {
        summary,
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'canaryRunId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Updated Canary run', content: { 'application/json': { schema: runSchema() } } },
          404: { description: 'Run is absent or not visible to this principal' },
          409: { description: 'Current run state does not permit this action' }
        }
      }
    };
  }
  return paths;
}

export function searchAdCanaryOpenApi({ role = 'reader', version = '0.8.0' } = {}) {
  const normalizedRole = String(role).toLowerCase();
  if (!ROLES.has(normalizedRole)) throw new TypeError(`Unsupported SearchAd OpenAPI role: ${normalizedRole}`);
  const paths = readPaths();
  if (normalizedRole === 'admin') adminPaths(paths);
  return {
    openapi: '3.0.3',
    info: {
      title: `HAAR SearchAd Active Canary (${normalizedRole})`,
      version,
      description: 'Role-scoped interface for durable SearchAd Active Canary status and controlled operations.'
    },
    paths,
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
