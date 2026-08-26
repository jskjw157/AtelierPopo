const errorResponses = {
  '400': { description: '잘못된 상품소스 또는 채널 요청' },
  '401': { description: 'API Key 인증 실패' },
  '404': { description: '상품소스·상품·채널 없음' },
  '409': { description: '상품소스 또는 채널 식별자 충돌' },
  '500': { description: '내부 오류' },
  '503': { description: 'Provider 미설정 또는 준비되지 않음' }
};

export function buildMultiSourceCatalogOpenApi({ serverUrl, version = '0.5.1' }) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'HAAR Multi-source Catalog API',
      version,
      description: '퀸실버를 포함한 여러 공급처, 수동 상품, 판매 채널을 HAAR 기준 상품 체계로 연결하기 위한 상품소스 조회 API입니다. HAAR 자사몰과 Cafe24는 하나의 판매 채널로 모델링됩니다.'
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Catalog Sources' },
      { name: 'Sales Channels' }
    ],
    paths: {
      '/api/v1/catalog/multi-source/status': {
        get: { operationId: 'getMultiSourceCatalogStatus', tags: ['Catalog Sources'], responses: { '200': { description: '상태' }, ...errorResponses } }
      },
      '/api/v1/catalog/sources': {
        get: { operationId: 'listCatalogSources', tags: ['Catalog Sources'], responses: { '200': { description: '상품소스 목록' }, ...errorResponses } }
      },
      '/api/v1/catalog/sources/{sourceId}': {
        get: {
          operationId: 'getCatalogSourceStatus', tags: ['Catalog Sources'],
          parameters: [{ name: 'sourceId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '상품소스 상태' }, ...errorResponses }
        }
      },
      '/api/v1/catalog/sources/{sourceId}/products': {
        get: {
          operationId: 'listCatalogSourceProducts', tags: ['Catalog Sources'],
          parameters: [
            { name: 'sourceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
            { name: 'force', in: 'query', schema: { type: 'boolean', default: false } }
          ],
          responses: { '200': { description: '상품 변경 목록' }, ...errorResponses }
        }
      },
      '/api/v1/catalog/sources/{sourceId}/products/{sourceProductId}': {
        get: {
          operationId: 'getCatalogSourceProduct', tags: ['Catalog Sources'],
          parameters: [
            { name: 'sourceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'sourceProductId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeRaw', in: 'query', schema: { type: 'boolean', default: false } },
            { name: 'force', in: 'query', schema: { type: 'boolean', default: false } }
          ],
          responses: { '200': { description: '정규화된 공급처 상품' }, ...errorResponses }
        }
      },
      '/api/v1/catalog/sources/{sourceId}/products/{sourceProductId}/hydrate': {
        post: {
          operationId: 'hydrateCatalogSourceProductAssets', tags: ['Catalog Sources'],
          parameters: [
            { name: 'sourceId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'sourceProductId', in: 'path', required: true, schema: { type: 'string' } }
          ],
          requestBody: {
            required: false,
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                imageNames: { type: 'array', items: { type: 'string' }, maxItems: 200 },
                force: { type: 'boolean', default: false }
              }
            } } }
          },
          responses: { '200': { description: '로컬 캐시 Hydration 결과' }, ...errorResponses }
        }
      },
      '/api/v1/sales-channels': {
        get: { operationId: 'listHaarSalesChannels', tags: ['Sales Channels'], responses: { '200': { description: '판매 채널 목록' }, ...errorResponses } }
      },
      '/api/v1/sales-channels/{channelId}': {
        get: {
          operationId: 'getHaarSalesChannel', tags: ['Sales Channels'],
          parameters: [{ name: 'channelId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '판매 채널' }, ...errorResponses }
        }
      }
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }
    }
  };
}
