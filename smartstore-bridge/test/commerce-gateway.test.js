import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommerceManifest } from '../src/naver/commerce/spec.js';
import { CommerceOperationGateway } from '../src/naver/commerce/gateway.js';

function config(overrides = {}) {
  return {
    enabled: true,
    allowReads: true,
    allowWrites: false,
    allowDeletes: false,
    allowOrders: false,
    allowClaims: false,
    allowInquiries: false,
    allowSolutions: false,
    allowSellerWrites: false,
    allowMultipartUploads: false,
    allowUnverifiedOperations: true,
    exposePersonalData: false,
    maxUploadFiles: 10,
    maxInlineUploadBytes: 10 * 1024 * 1024,
    ...overrides
  };
}

function fixture(overrides = {}) {
  const calls = [];
  const client = {
    async requestDetailed(method, apiPath, options) {
      calls.push({ method, apiPath, options });
      return {
        status: 200,
        data: overrides.data || {
          receiverName: '홍길동',
          ordererName: '김주문',
          ordererTel: '010-1234-5678',
          shippingAddress: { name: '박수령', tel1: '02-123-4567', baseAddress: '서울시' },
          productName: '실버 귀걸이'
        },
        traceId: 'trace-1',
        headers: { 'x-ratelimit-remaining': '9' },
        url: `https://api.commerce.naver.com/external${apiPath}`,
        method,
        attempts: 1,
        redirects: 0,
        responseTimeMs: 12
      };
    }
  };
  const gateway = new CommerceOperationGateway({
    client,
    config: config(overrides.config),
    manifest: loadCommerceManifest('./specs/naver-commerce/current.json')
  });
  return { gateway, calls };
}

test('gateway lists and previews all official operations without accepting arbitrary paths', () => {
  const { gateway } = fixture();
  assert.equal(gateway.list({ limit: 500 }).total, 116);
  const preview = gateway.preview('get_v2_products_channel_products_by_channel_product_no', {
    pathParams: { channelProductNo: '13732645378' }
  });
  assert.equal(preview.request.apiPath, '/v2/products/channel-products/13732645378');
  assert.equal(preview.operation.method, 'GET');
  assert.equal(preview.executable, true);
  assert.throws(() => gateway.get('delete_everything_raw'), /찾을 수 없습니다/);
});

test('read operation executes synchronously and redacts personal data', async () => {
  const { gateway, calls } = fixture();
  const result = await gateway.execute('get_v1_categories', { query: { last: true } }, {
    naverWritesEnabled: false,
    httpWritesEnabled: false
  });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].apiPath, '/v1/categories');
  assert.equal(calls[0].options.query.last, true);
  assert.notEqual(result.data.receiverName, '홍길동');
  assert.notEqual(result.data.ordererName, '김주문');
  assert.notEqual(result.data.ordererTel, '010-1234-5678');
  assert.notEqual(result.data.shippingAddress.name, '박수령');
  assert.notEqual(result.data.shippingAddress.tel1, '02-123-4567');
  assert.equal(result.data.productName, '실버 귀걸이');
});

test('write operation requires both gates and exact confirmation', async () => {
  const operationId = 'put_v1_products_origin_products_by_origin_product_no_change_status';
  const input = {
    pathParams: { originProductNo: '123' },
    body: { statusType: 'SUSPENSION' },
    confirmation: 'EXECUTE_COMMERCE_WRITE'
  };
  const disabled = fixture();
  assert.throws(
    () => disabled.gateway.assertExecutionAllowed(disabled.gateway.get(operationId), input, {
      naverWritesEnabled: true,
      httpWritesEnabled: true
    }),
    /gate가 비활성/
  );
  const enabled = fixture({ config: { allowWrites: true } });
  assert.throws(
    () => enabled.gateway.assertExecutionAllowed(enabled.gateway.get(operationId), { ...input, confirmation: 'WRONG' }, {
      naverWritesEnabled: true,
      httpWritesEnabled: true
    }),
    /confirmation/
  );
  const result = await enabled.gateway.execute(operationId, input, {
    naverWritesEnabled: true,
    httpWritesEnabled: true
  });
  assert.equal(result.upstream.status, 200);
  assert.equal(enabled.calls[0].method, 'PUT');
});

test('destructive operation requires resource-key second confirmation', () => {
  const { gateway } = fixture({ config: { allowWrites: true, allowDeletes: true } });
  const operationId = 'delete_v2_products_channel_products_by_channel_product_no';
  const base = {
    pathParams: { channelProductNo: '999' },
    confirmation: 'DELETE_COMMERCE_RESOURCE'
  };
  const preview = gateway.preview(operationId, base);
  assert.equal(preview.requiredSecondConfirmation, `${operationId}:channelProductNo=999`);
  assert.throws(() => gateway.assertExecutionAllowed(gateway.get(operationId), base, {
    naverWritesEnabled: true,
    httpWritesEnabled: true
  }), /secondConfirmation/);
});

test('commerce execution clamps caller-controlled upstream timeouts', async () => {
  // Given
  const { gateway, calls } = fixture();

  // When
  await gateway.execute('get_v1_categories', { timeoutMs: 1 }, {
    naverWritesEnabled: false,
    httpWritesEnabled: false
  });

  // Then
  assert.equal(calls[0].options.timeoutMs, 5_000);
});
