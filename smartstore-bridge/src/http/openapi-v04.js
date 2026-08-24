import { buildOpenApiSpec as buildOpenApiSpecV03 } from './openapi-v03.js';

const errorResponses = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { description: '상태 또는 멱등성 충돌', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
  '429': { $ref: '#/components/responses/RateLimited' },
  '500': { $ref: '#/components/responses/InternalError' }
};

export function buildOpenApiSpecV04({ serverUrl, version = '0.4.0' }) {
  const spec = buildOpenApiSpecV03({ serverUrl, version });
  spec.info.title = 'HAAR SmartStore, Naver Commerce and Google Drive Bridge API';
  spec.info.description = '네이버 커머스API 공식 operation 115개, 기존 상품 상세페이지 수정/롤백, Google Drive 전체 쓰기, 퀸실버 카탈로그를 통합하는 HTTP API입니다.';
  spec.tags.push(
    { name: 'Commerce' },
    { name: 'Commerce Products' },
    { name: 'Commerce Capability' }
  );

  spec.paths['/api/v1/commerce/status'] = {
    get: {
      operationId: 'getCommerceGatewayStatus',
      tags: ['Commerce'],
      summary: '네이버 커머스API 전체 gateway 및 쓰기 gate 상태 조회',
      responses: { '200': { description: '상태', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/operations'] = {
    get: {
      operationId: 'listNaverCommerceOperations',
      tags: ['Commerce'],
      summary: '공식 네이버 커머스API operation 목록 검색',
      parameters: [
        { name: 'domain', in: 'query', schema: { type: 'string' } },
        { name: 'method', in: 'query', schema: { type: 'string' } },
        { name: 'risk', in: 'query', schema: { type: 'string' } },
        { name: 'query', in: 'query', schema: { type: 'string' } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
        { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
      ],
      responses: { '200': { description: 'operation 목록', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/operations/{operationId}'] = {
    get: {
      operationId: 'getNaverCommerceOperation',
      tags: ['Commerce'],
      summary: '네이버 커머스API operation 정의 조회',
      parameters: [{ $ref: '#/components/parameters/CommerceOperationId' }],
      responses: { '200': { description: 'operation 정의', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/operations/{operationId}/preview'] = {
    post: {
      operationId: 'previewNaverCommerceOperation',
      tags: ['Commerce'],
      summary: '공식 operation 경로·위험도·확인문구·요청 fingerprint 미리보기',
      parameters: [{ $ref: '#/components/parameters/CommerceOperationId' }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CommerceOperationInput' } } } },
      responses: { '200': { description: '미리보기', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/operations/{operationId}/execute'] = {
    post: {
      operationId: 'executeNaverCommerceOperation',
      tags: ['Commerce'],
      summary: '공식 manifest에 등록된 네이버 커머스API operation 실행',
      description: '읽기 operation은 즉시 실행합니다. 쓰기 operation은 idempotencyKey와 operation별 confirmation이 필요하며 202 비동기 작업을 반환합니다.',
      parameters: [{ $ref: '#/components/parameters/CommerceOperationId' }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CommerceOperationInput' } } } },
      responses: {
        '200': { description: '읽기 결과 또는 기존 멱등 작업', content: { 'application/json': { schema: { type: 'object' } } } },
        '202': { description: '쓰기 작업 접수', content: { 'application/json': { schema: { type: 'object' } } } },
        ...errorResponses
      }
    }
  };
  spec.paths['/api/v1/commerce/capabilities/probe'] = {
    post: {
      operationId: 'probeNaverCommerceCapabilities',
      tags: ['Commerce Capability'],
      summary: '선택한 읽기 operation으로 실제 계정 API 권한 확인',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['operations'],
              properties: {
                operations: {
                  type: 'array', minItems: 1, maxItems: 20,
                  items: { $ref: '#/components/schemas/CommerceOperationInputWithId' }
                }
              }
            }
          }
        }
      },
      responses: { '200': { description: '권한 확인 결과', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/products/channel/{channelProductNo}'] = {
    get: {
      operationId: 'getNaverChannelProduct',
      tags: ['Commerce Products'],
      summary: '기존 스마트스토어 채널상품 전체 조회',
      parameters: [{ $ref: '#/components/parameters/ChannelProductNo' }],
      responses: { '200': { description: '상품', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/products/origin/{originProductNo}'] = {
    get: {
      operationId: 'getNaverOriginProduct',
      tags: ['Commerce Products'],
      summary: '기존 네이버 원상품 전체 조회',
      parameters: [{ $ref: '#/components/parameters/OriginProductNo' }],
      responses: { '200': { description: '원상품', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/products/channel/{channelProductNo}/detail/preview'] = {
    post: {
      operationId: 'previewExistingProductDetailUpdate',
      tags: ['Commerce Products'],
      summary: '기존 상품 상세페이지 HTML 교체 전 해시 비교',
      parameters: [{ $ref: '#/components/parameters/ChannelProductNo' }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['detailContent'], properties: { detailContent: { type: 'string' } } } } } },
      responses: { '200': { description: '미리보기', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/products/channel/{channelProductNo}/detail/update'] = {
    post: {
      operationId: 'updateExistingProductDetail',
      tags: ['Commerce Products'],
      summary: '기존 상품 상세페이지 HTML 백업 후 교체',
      parameters: [{ $ref: '#/components/parameters/ChannelProductNo' }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductDetailUpdateRequest' } } } },
      responses: { '202': { description: '수정 작업 접수', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };
  spec.paths['/api/v1/commerce/products/channel/{channelProductNo}/detail/rollback'] = {
    post: {
      operationId: 'rollbackExistingProductDetail',
      tags: ['Commerce Products'],
      summary: '상세페이지 백업으로 롤백',
      parameters: [{ $ref: '#/components/parameters/ChannelProductNo' }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductDetailRollbackRequest' } } } },
      responses: { '202': { description: '롤백 작업 접수', content: { 'application/json': { schema: { type: 'object' } } } }, ...errorResponses }
    }
  };

  spec.components.parameters.CommerceOperationId = {
    name: 'operationId', in: 'path', required: true,
    schema: { type: 'string', pattern: '^[a-z0-9_]{5,240}$' }
  };
  spec.components.parameters.ChannelProductNo = {
    name: 'channelProductNo', in: 'path', required: true,
    schema: { type: 'string', pattern: '^\\d{1,30}$' }
  };
  spec.components.parameters.OriginProductNo = {
    name: 'originProductNo', in: 'path', required: true,
    schema: { type: 'string', pattern: '^\\d{1,30}$' }
  };
  spec.components.schemas.CommerceOperationInput = {
    type: 'object',
    properties: {
      pathParams: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
      query: { type: 'object', additionalProperties: true },
      body: {},
      files: {
        type: 'array', maxItems: 20,
        items: {
          type: 'object', required: ['fileName', 'contentBase64'],
          properties: {
            fileName: { type: 'string' },
            mimeType: { type: 'string' },
            contentBase64: { type: 'string' }
          }
        }
      },
      confirmation: { type: 'string' },
      secondConfirmation: { type: 'string' },
      idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 }
    },
    additionalProperties: false
  };
  spec.components.schemas.CommerceOperationInputWithId = {
    allOf: [
      { $ref: '#/components/schemas/CommerceOperationInput' },
      { type: 'object', required: ['operationId'], properties: { operationId: { type: 'string' } } }
    ]
  };
  spec.components.schemas.ProductDetailUpdateRequest = {
    type: 'object',
    required: ['detailContent', 'confirmation', 'secondConfirmation', 'idempotencyKey'],
    properties: {
      detailContent: { type: 'string' },
      confirmation: { type: 'string', enum: ['UPDATE_PRODUCT_DETAIL'] },
      secondConfirmation: { type: 'string', description: 'channelProductNo와 동일한 값' },
      idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 }
    },
    additionalProperties: false
  };
  spec.components.schemas.ProductDetailRollbackRequest = {
    type: 'object',
    required: ['backupId', 'confirmation', 'secondConfirmation', 'idempotencyKey'],
    properties: {
      backupId: { type: 'string' },
      confirmation: { type: 'string', enum: ['ROLLBACK_PRODUCT_DETAIL'] },
      secondConfirmation: { type: 'string', description: 'channelProductNo와 동일한 값' },
      idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 }
    },
    additionalProperties: false
  };
  return spec;
}
