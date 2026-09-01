export function searchAdWriteOpenApi({ version = '0.7.0' } = {}) {
  const operationDescriptor = {
    type: 'object',
    required: ['operationKey'],
    properties: {
      operationKey: { type: 'string', description: '공식 SearchAd operation manifest key' },
      pathParams: { type: 'object', additionalProperties: true },
      query: { type: 'object', additionalProperties: true },
      body: { nullable: true },
      confirmation: { type: 'string' },
      secondConfirmation: { type: 'string' }
    },
    additionalProperties: false
  };
  const commonResponses = {
    400: { description: '잘못된 요청' },
    401: { description: '인증 실패' },
    403: { description: '권한 또는 검증 전 게이트' },
    409: { description: '상태·Drift·토큰 충돌' }
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'HAAR SearchAd Write Execution API',
      version,
      description: '공식 SearchAd 쓰기 전체 활성화를 위한 변경계획·승인·실행·재검증·reconcile·롤백 API. 최초 실계정 Capability·Canary 검증 전까지만 실행 게이트가 임시 비활성화된다.'
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: { OperationDescriptor: operationDescriptor }
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/searchad/write/status': {
        get: { operationId: 'getSearchAdWriteStatus', responses: { 200: { description: '쓰기 런타임 상태' } } }
      },
      '/api/v1/searchad/changes': {
        get: { operationId: 'listSearchAdChangePlans', responses: { 200: { description: '변경 계획 목록' } } }
      },
      '/api/v1/searchad/changes/{planId}': {
        get: {
          operationId: 'getSearchAdChangePlan',
          parameters: [{ in: 'path', name: 'planId', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '변경 계획' }, 404: { description: '없음' } }
        }
      },
      '/api/v1/searchad/changes/plan': {
        post: {
          operationId: 'createSearchAdChangePlan',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object', required: ['customerId', 'mutation', 'verification', 'reason', 'createdBy'],
              properties: {
                customerId: { type: 'string' },
                mutation: operationDescriptor,
                verification: { type: 'object', required: ['read'], properties: {
                  read: operationDescriptor,
                  extractPath: { type: 'string' },
                  expectedAfter: {},
                  expectedPatch: {}
                } },
                rollback: { type: 'object', properties: {
                  mutation: operationDescriptor,
                  bodyFromBefore: { type: 'object', additionalProperties: { type: 'string' } },
                  expectedBefore: {}
                } },
                reason: { type: 'string' }, createdBy: { type: 'string' }, expiresInSeconds: { type: 'integer' }
              }
            } } }
          },
          responses: { 201: { description: '계획 생성' }, ...commonResponses }
        }
      },
      '/api/v1/searchad/changes/{planId}/approve': {
        post: {
          operationId: 'approveSearchAdChangePlan',
          parameters: [{ in: 'path', name: 'planId', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['actor', 'confirmation'], properties: {
              actor: { type: 'string' }, confirmation: { type: 'string', const: 'APPROVE_SEARCHAD_CHANGE' }
            }
          } } } },
          responses: { 200: { description: '10분 기본 유효 1회용 실행 토큰' }, ...commonResponses }
        }
      },
      '/api/v1/searchad/changes/{planId}/execute': {
        post: {
          operationId: 'executeSearchAdChangePlan',
          parameters: [{ in: 'path', name: 'planId', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['executionToken', 'idempotencyKey'], properties: {
              executionToken: { type: 'string' }, idempotencyKey: { type: 'string' }, customerId: { type: 'string' }
            }
          } } } },
          responses: { 200: { description: '실행 및 원격 재검증 완료' }, ...commonResponses }
        }
      },
      '/api/v1/searchad/changes/{planId}/reconcile': {
        post: {
          operationId: 'reconcileSearchAdChangePlan',
          parameters: [{ in: 'path', name: 'planId', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '불명확한 원격 결과 재조정' }, ...commonResponses }
        }
      },
      '/api/v1/searchad/changes/{planId}/rollback': {
        post: {
          operationId: 'rollbackSearchAdChangePlan',
          parameters: [{ in: 'path', name: 'planId', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['confirmation', 'idempotencyKey'], properties: {
              confirmation: { type: 'string', const: 'ROLLBACK_SEARCHAD_CHANGE' },
              idempotencyKey: { type: 'string' }
            }
          } } } },
          responses: { 200: { description: 'Drift 검사 후 롤백 및 재검증' }, ...commonResponses }
        }
      }
    }
  };
}
