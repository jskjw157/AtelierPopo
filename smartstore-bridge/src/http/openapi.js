export function buildOpenApiSpec({ serverUrl, version = '0.2.0' }) {
  const operationRef = { $ref: '#/components/schemas/Operation' };
  const errorResponses = {
    '400': { $ref: '#/components/responses/BadRequest' },
    '401': { $ref: '#/components/responses/Unauthorized' },
    '404': { $ref: '#/components/responses/NotFound' },
    '429': { $ref: '#/components/responses/RateLimited' },
    '500': { $ref: '#/components/responses/InternalError' }
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Atelier Popo SmartStore Bridge API',
      version,
      description: '아뜰리에포포 퀸실버 상품 데이터를 검증하고 네이버 스마트스토어 상품 등록을 안전하게 실행하는 HTTP API입니다.'
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'System' },
      { name: 'Catalog' },
      { name: 'Products' },
      { name: 'Jobs' },
      { name: 'Operations' },
      { name: 'Batch' }
    ],
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          tags: ['System'],
          summary: '서비스 생존 상태 확인',
          security: [],
          responses: {
            '200': {
              description: '프로세스가 정상 실행 중임',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } }
            }
          }
        }
      },
      '/health/ready': {
        get: {
          operationId: 'getReadiness',
          tags: ['System'],
          summary: '서비스 설정 준비 상태 확인',
          security: [],
          responses: {
            '200': { description: '핵심 설정 준비 완료', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } },
            '503': { description: '설정 또는 저장소 준비 미완료', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } }
          }
        }
      },
      '/api/v1/status': {
        get: {
          operationId: 'getServiceStatus',
          tags: ['System'],
          summary: '카탈로그, 템플릿, 네이버 인증값, 쓰기 잠금 상태 확인',
          responses: {
            '200': { description: '상태', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/auth/test': {
        post: {
          operationId: 'testNaverAuthentication',
          tags: ['System'],
          summary: '네이버 커머스API 토큰 발급 테스트',
          responses: {
            '200': { description: '인증 성공', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/catalog/stats': {
        get: {
          operationId: 'getCatalogStats',
          tags: ['Catalog'],
          summary: '퀸실버 카탈로그 통계 조회',
          responses: {
            '200': { description: '카탈로그 통계', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/catalog/enqueue': {
        post: {
          operationId: 'enqueueCatalog',
          tags: ['Catalog'],
          summary: '전체 카탈로그를 로컬 작업 원장에 등록',
          responses: {
            '200': { description: '등록 결과', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/products': {
        get: {
          operationId: 'searchCatalogProducts',
          tags: ['Products'],
          summary: '상품번호, 상품명, 카테고리로 로컬 상품 검색',
          parameters: [
            { name: 'query', in: 'query', schema: { type: 'string' } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
          ],
          responses: {
            '200': { description: '검색 결과', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/products/{productId}': {
        get: {
          operationId: 'getCatalogProduct',
          tags: ['Products'],
          summary: '로컬 상품 요약과 작업 상태 조회',
          parameters: [{ $ref: '#/components/parameters/ProductId' }],
          responses: {
            '200': { description: '상품 정보', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/products/{productId}/validate': {
        post: {
          operationId: 'validateCatalogProduct',
          tags: ['Products'],
          summary: '퀸실버 원본 JSON 구조 검증',
          parameters: [{ $ref: '#/components/parameters/ProductId' }],
          responses: {
            '200': { description: '검증 결과', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/products/{productId}/preview': {
        post: {
          operationId: 'previewSmartStoreProduct',
          tags: ['Products'],
          summary: '네이버 상품 등록 페이로드 생성 및 검증. 실제 등록은 하지 않음',
          parameters: [
            { $ref: '#/components/parameters/ProductId' },
            { name: 'includePayload', in: 'query', schema: { type: 'boolean', default: false } }
          ],
          responses: {
            '200': { description: '상품 미리보기', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/products/{productId}/remote': {
        get: {
          operationId: 'findRemoteSmartStoreProduct',
          tags: ['Products'],
          summary: '판매자관리코드로 스마트스토어 중복 상품 조회',
          parameters: [{ $ref: '#/components/parameters/ProductId' }],
          responses: {
            '200': { description: '원격 조회 결과', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/products/{productId}/register': {
        post: {
          operationId: 'registerSmartStoreProduct',
          tags: ['Products'],
          summary: '상품 1개 등록 작업을 비동기로 시작',
          description: 'ATELIER_HTTP_ALLOW_WRITES=true, NAVER_ALLOW_WRITES=true, 정확한 확인 문구가 모두 필요합니다. 응답의 operationId로 진행 상태를 조회하세요.',
          parameters: [{ $ref: '#/components/parameters/ProductId' }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegisterRequest' }
              }
            }
          },
          responses: {
            '202': { description: '등록 작업 접수', content: { 'application/json': { schema: operationRef } } },
            '200': { description: '동일 멱등성 키로 이미 접수된 작업', content: { 'application/json': { schema: operationRef } } },
            '403': { $ref: '#/components/responses/Forbidden' },
            '409': { description: '멱등성 충돌', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/jobs': {
        get: {
          operationId: 'listProductJobs',
          tags: ['Jobs'],
          summary: '상품 작업 원장 목록 조회',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
          ],
          responses: {
            '200': { description: '작업 목록', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/jobs/{productId}': {
        get: {
          operationId: 'getProductJob',
          tags: ['Jobs'],
          summary: '상품번호별 작업 원장 상세 조회',
          parameters: [{ $ref: '#/components/parameters/ProductId' }],
          responses: {
            '200': { description: '작업 상세', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/operations': {
        get: {
          operationId: 'listApiOperations',
          tags: ['Operations'],
          summary: '비동기 등록 작업 목록 조회',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'operationType', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }
          ],
          responses: {
            '200': { description: '작업 목록', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/operations/{operationId}': {
        get: {
          operationId: 'getApiOperation',
          tags: ['Operations'],
          summary: '비동기 작업 진행 상태와 결과 조회',
          parameters: [{ name: 'operationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            '200': { description: '작업 상태', content: { 'application/json': { schema: operationRef } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/batches/preview': {
        post: {
          operationId: 'previewProductBatch',
          tags: ['Batch'],
          summary: '작업 원장의 상품을 최대 20개까지 dry-run',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', default: 'queued' },
                    limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: '배치 미리보기 결과', content: { 'application/json': { schema: { type: 'object' } } } },
            ...errorResponses
          }
        }
      },
      '/api/v1/batches/register': {
        post: {
          operationId: 'registerProductBatch',
          tags: ['Batch'],
          summary: '최대 20개 상품의 등록 작업을 비동기로 시작',
          description: 'ATELIER_HTTP_ALLOW_BATCH_WRITES=true가 추가로 필요합니다.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/RegisterRequest' },
                    {
                      type: 'object',
                      properties: {
                        status: { type: 'string', default: 'previewed' },
                        limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
                      }
                    }
                  ]
                }
              }
            }
          },
          responses: {
            '202': { description: '배치 등록 작업 접수', content: { 'application/json': { schema: operationRef } } },
            '200': { description: '동일 멱등성 키로 이미 접수된 작업', content: { 'application/json': { schema: operationRef } } },
            '403': { $ref: '#/components/responses/Forbidden' },
            ...errorResponses
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API key',
          description: 'Hostinger 환경변수 ATELIER_API_KEY 값'
        }
      },
      parameters: {
        ProductId: {
          name: 'productId',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }
        }
      },
      schemas: {
        Health: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            status: { type: 'string' },
            version: { type: 'string' },
            uptimeSeconds: { type: 'number' },
            readiness: { type: 'object' }
          }
        },
        RegisterRequest: {
          type: 'object',
          required: ['confirmation', 'idempotencyKey'],
          properties: {
            confirmation: { type: 'string', enum: ['REGISTER'] },
            idempotencyKey: {
              type: 'string',
              minLength: 8,
              maxLength: 128,
              pattern: '^[A-Za-z0-9._:-]+$',
              description: '재호출 시 동일 작업을 반환받기 위한 고유 키'
            }
          },
          additionalProperties: false
        },
        Operation: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            operation: {
              type: 'object',
              properties: {
                operationId: { type: 'string' },
                operationType: { type: 'string' },
                sourceProductId: { type: ['string', 'null'] },
                status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'interrupted'] },
                result: {},
                error: {}
              }
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', const: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                requestId: { type: 'string' }
              }
            }
          }
        }
      },
      responses: {
        BadRequest: { description: '잘못된 요청', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Unauthorized: { description: 'API 키 인증 실패', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Forbidden: { description: '쓰기 잠금 또는 권한으로 차단됨', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        NotFound: { description: '대상을 찾을 수 없음', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        RateLimited: { description: '호출량 제한 초과', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        InternalError: { description: '서버 또는 네이버 API 오류', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
      }
    },
    security: [{ bearerAuth: [] }]
  };
}
