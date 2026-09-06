const errorResponses = {
  '400': { description: '잘못된 요청' },
  '401': { description: 'API Key 인증 실패' },
  '403': { description: '권한 또는 SearchAd gate 차단' },
  '404': { description: 'operation 또는 리소스 없음' },
  '409': { description: '멱등성 또는 상태 충돌' },
  '429': { description: '호출 제한' },
  '500': { description: '내부 오류' },
  '502': { description: 'SearchAd upstream 오류' },
  '503': { description: 'SearchAd 미설정 또는 준비되지 않음' }
};

export function buildSearchAdOpenApi({ serverUrl, version = '0.5.0' }) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'HAAR Naver SearchAd Foundation API',
      version,
      description: '공식 SearchAd operation manifest, HMAC 인증, 조회 및 승인 계획 기반 쓰기 실행을 제공합니다. 최초 실계정 Capability·Canary 검증 전까지만 원격 실행 gate를 임시 비활성화합니다.'
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'SearchAd' },
      { name: 'SearchAd Operations' },
      { name: 'SearchAd Capability' }
    ],
    paths: {
      '/api/v1/searchad/status': {
        get: { operationId: 'getSearchAdStatus', tags: ['SearchAd'], responses: { '200': { description: '상태' }, ...errorResponses } }
      },
      '/api/v1/searchad/accounts': {
        get: { operationId: 'listSearchAdAccounts', tags: ['SearchAd'], responses: { '200': { description: '연결 광고계정' }, ...errorResponses } }
      },
      '/api/v1/searchad/operations': {
        get: {
          operationId: 'listSearchAdOperations', tags: ['SearchAd Operations'],
          parameters: [
            { name: 'sourceId', in: 'query', schema: { type: 'string' } },
            { name: 'domain', in: 'query', schema: { type: 'string' } },
            { name: 'method', in: 'query', schema: { type: 'string' } },
            { name: 'state', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'runtimeOnly', in: 'query', schema: { type: 'boolean' } },
            { name: 'query', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }
          ],
          responses: { '200': { description: 'operation 목록' }, ...errorResponses }
        }
      },
      '/api/v1/searchad/operations/{operationKey}': {
        get: {
          operationId: 'getSearchAdOperation', tags: ['SearchAd Operations'],
          parameters: [{ name: 'operationKey', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'operation 정의' }, ...errorResponses }
        }
      },
      '/api/v1/searchad/operations/{operationKey}/preview': {
        post: {
          operationId: 'previewSearchAdOperation', tags: ['SearchAd Operations'],
          parameters: [{ name: 'operationKey', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchAdOperationInput' } } } },
          responses: { '200': { description: '호출 미리보기' }, ...errorResponses }
        }
      },
      '/api/v1/searchad/operations/{operationKey}/execute': {
        post: {
          operationId: 'executeSearchAdOperation', tags: ['SearchAd Operations'],
          description: '조회 operation은 직접 실행합니다. 쓰기 operation은 /api/v1/searchad/changes/plan에서 작성·승인한 planId와 1회용 executionToken으로 동일한 검증 실행 계층을 사용합니다. 승인된 요청값의 덮어쓰기는 허용하지 않습니다.',
          parameters: [
            { name: 'operationKey', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Idempotency-Key', in: 'header', schema: { type: 'string', minLength: 1, maxLength: 200 } }
          ],
          requestBody: { required: true, content: { 'application/json': { schema: { anyOf: [
            { $ref: '#/components/schemas/SearchAdOperationInput' },
            { $ref: '#/components/schemas/SearchAdApprovedPlanInput' }
          ] } } } },
          responses: { '200': { description: '조회 결과 또는 원격 재검증된 변경 계획 실행 결과' }, ...errorResponses }
        }
      },
      '/api/v1/searchad/capabilities/passive-probe': {
        post: {
          operationId: 'runSearchAdPassiveCapabilityProbe', tags: ['SearchAd Capability'],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['customerId'], properties: {
            customerId: { type: 'string' },
            operations: { type: 'array', items: { type: 'string' }, maxItems: 50 },
            inputs: { type: 'object' },
            limit: { type: 'integer', minimum: 1, maximum: 50 }
          } } } } },
          responses: { '200': { description: 'Capability 증거' }, ...errorResponses }
        }
      }
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas: {
        SearchAdApprovedPlanInput: {
          type: 'object', additionalProperties: false,
          required: ['planId', 'customerId', 'executionToken'],
          description: '쓰기 전용. Idempotency-Key 헤더 또는 idempotencyKey가 필요합니다.',
          properties: {
            planId: { type: 'string', minLength: 1 },
            customerId: { type: 'string', minLength: 1 },
            executionToken: { type: 'string', writeOnly: true },
            idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 }
          }
        },
        SearchAdOperationInput: {
          type: 'object',
          required: ['customerId'],
          properties: {
            customerId: { type: 'string' },
            pathParams: { type: 'object' },
            query: { type: 'object' },
            body: {},
            responseType: { type: 'string', enum: ['auto', 'json', 'text', 'arrayBuffer'] },
            confirmation: { type: 'string' },
            secondConfirmation: { type: 'string' },
            idempotencyKey: { type: 'string' }
          }
        }
      }
    }
  };
}
