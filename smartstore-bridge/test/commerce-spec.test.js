import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommerceManifest, parseCommerceLlmsIndex } from '../src/naver/commerce/spec.js';

test('bundled Naver Commerce manifest classifies all 116 official operations', () => {
  const manifest = loadCommerceManifest('./specs/naver-commerce/current.json');
  assert.equal(manifest.totalOperations, 116);
  assert.equal(manifest.operations.length, 116);
  assert.equal(new Set(manifest.operations.map(item => item.operationId)).size, 116);
  assert.deepEqual(manifest.domains, {
    N배송: 4,
    문의: 6,
    상품: 64,
    인증: 1,
    정산: 5,
    주문: 20,
    커머스솔루션: 8,
    판매자정보: 8
  });
  assert.equal(manifest.operations.filter(item => item.sideEffect).length, 54);
  assert.equal(manifest.operations.filter(item => item.readOnly && !item.internal).length, 61);
});

test('llms index parser creates stable operation ids and risk metadata', () => {
  const manifest = parseCommerceLlmsIndex(`
## 상품
- [GET /v2/products/channel-products/{channelProductNo} - 채널 상품 조회](https://apicenter.commerce.naver.com/llms/get-v2-products-channel-products-channelProductNo.md): x
- [DELETE /v2/products/channel-products/{channelProductNo} - 채널 상품 삭제](https://apicenter.commerce.naver.com/llms/delete-v2-products-channel-products-channelProductNo.md): x
`);
  assert.equal(manifest.totalOperations, 2);
  assert.equal(manifest.operations[0].operationId, 'get_v2_products_channel_products_by_channel_product_no');
  assert.equal(manifest.operations[0].readOnly, true);
  assert.equal(manifest.operations[1].confirmation, 'DELETE_COMMERCE_RESOURCE');
  assert.equal(manifest.operations[1].destructive, true);
});
