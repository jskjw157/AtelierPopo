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
      description: '공식 SearchAd operation manifest, HMAC 인증, 읽기 gateway, Passive Capability Probe를 제공합니다. 쓰기 gate는 기본 비활성입니다.'
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
          parameters: [{ name: 'operationKey', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchAdOperationInput' } } } },
          responses: { '200': { description: '읽기 실행 결과' }, '202': { description: '쓰기 작업 접수' }, ...errorResponses }
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
