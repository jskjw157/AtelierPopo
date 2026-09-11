import { SEARCHAD_ROLE_RANK } from './searchad-access-control.js';

const ROLES = new Set(Object.keys(SEARCHAD_ROLE_RANK));

function evidenceSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      evidenceId: { type: 'string' }, evidenceType: { type: 'string' }, customerId: { type: 'string' },
      operationKeys: { type: 'array', items: { type: 'string' } }, fieldScope: { type: 'array', items: { type: 'string' } },
      result: { type: 'string' }, details: { type: 'object', additionalProperties: true },
      createdAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }
    }
  };
}

function activationSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      activationId: { type: 'string' }, evidenceId: { type: 'string' }, evidenceType: { type: 'string' },
      customerId: { type: 'string' }, operationKeys: { type: 'array', items: { type: 'string' } },
      fieldScope: { type: 'array', items: { type: 'string' } }, activatedByPrincipalId: { type: 'string' },
      activatedAt: { type: 'string', format: 'date-time' }, expiresAt: { type: 'string', format: 'date-time' }
    }
  };
}

function accountSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      customerId: { type: 'string' }, suspended: { type: 'boolean' }, updatedAt: { type: 'string', format: 'date-time' }
    }
  };
}

function listResponse(schema, description) {
  return {
    200: {
      description,
      content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: schema } } } } }
    }
  };
}

function readPaths() {
  return {
    '/api/v1/searchad/evidence': {
      get: {
        summary: 'List verification evidence visible to the authenticated SearchAd principal', security: [{ bearerAuth: [] }],
        responses: listResponse(evidenceSchema(), 'Visible verification evidence')
      }
    },
    '/api/v1/searchad/evidence/{evidenceId}': {
      get: {
        summary: 'Get one visible verification evidence row', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'evidenceId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Visible evidence', content: { 'application/json': { schema: evidenceSchema() } } }, 404: { description: 'Evidence absent or not visible' } }
      }
    },
    '/api/v1/searchad/activations': {
      get: {
        summary: 'List activation grants visible to the authenticated SearchAd principal', security: [{ bearerAuth: [] }],
        responses: listResponse(activationSchema(), 'Visible activation grants')
      }
    },
    '/api/v1/searchad/activations/{activationId}': {
      get: {
        summary: 'Get one visible activation grant', security: [{ bearerAuth: [] }],
        parameters: [{ name: 'activationId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Visible activation grant', content: { 'application/json': { schema: activationSchema() } } }, 404: { description: 'Activation absent or not visible' } }
      }
    },
    '/api/v1/searchad/accounts/control-status': {
      get: {
        summary: 'List SearchAd account control status for granted Customers', security: [{ bearerAuth: [] }],
        responses: listResponse(accountSchema(), 'Granted account control status')
      }
    }
  };
}

function addOperatorPaths(paths) {
  paths['/api/v1/searchad/capabilities/passive-evidence'] = {
    post: {
      summary: 'Issue server-derived trusted Passive Capability evidence', security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: {
          type: 'object', additionalProperties: false, required: ['customerId'], properties: { customerId: { type: 'string' } }
        } } }
      },
      responses: { 201: { description: 'Trusted Passive evidence', content: { 'application/json': { schema: evidenceSchema() } } }, 403: { description: 'Operator role or Customer grant required' } }
    }
  };
}

function addAdminPaths(paths) {
  paths['/api/v1/searchad/activations'].post = {
    summary: 'Activate one immutable evidence row by ID', security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: {
        type: 'object', additionalProperties: false, required: ['evidenceId'], properties: { evidenceId: { type: 'string' } }
      } } }
    },
    responses: { 201: { description: 'Activation grant', content: { 'application/json': { schema: activationSchema() } } }, 400: { description: 'Only evidenceId is accepted' }, 404: { description: 'Evidence absent or not visible' } }
  };
  for (const [suffix, summary] of [['suspend', 'Suspend one granted SearchAd Customer'], ['resume', 'Resume one granted SearchAd Customer']]) {
    paths[`/api/v1/searchad/accounts/{customerId}/${suffix}`] = {
      post: {
        summary, security: [{ bearerAuth: [] }],
        parameters: [{ name: 'customerId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Updated account control status', content: { 'application/json': { schema: accountSchema() } } }, 403: { description: 'Admin role or Customer grant required' } }
      }
    };
  }
}

export function searchAdActivationOpenApi({ role = 'reader', version = '0.8.0' } = {}) {
  const normalizedRole = String(role).toLowerCase();
  if (!ROLES.has(normalizedRole)) throw new TypeError(`Unsupported SearchAd OpenAPI role: ${normalizedRole}`);
  const paths = readPaths();
  if (SEARCHAD_ROLE_RANK[normalizedRole] >= SEARCHAD_ROLE_RANK.operator) addOperatorPaths(paths);
  if (SEARCHAD_ROLE_RANK[normalizedRole] >= SEARCHAD_ROLE_RANK.admin) addAdminPaths(paths);
  return {
    openapi: '3.0.3',
    info: {
      title: `HAAR SearchAd Activation Control (${normalizedRole})`, version,
      description: 'Role-scoped trusted evidence, activation grant, and account suspension control plane.'
    },
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'SearchAd role bearer credential' } }
    }
  };
}
