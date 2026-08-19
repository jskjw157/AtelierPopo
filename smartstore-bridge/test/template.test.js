import test from 'node:test';
import assert from 'node:assert/strict';
import { templateFromChannelProductResponse } from '../src/domain/template.js';

test('기존 채널 상품 응답에서 동적/조회 전용 값을 제거한다', () => {
  const template = templateFromChannelProductResponse({
    originProduct: {
      originProductNo: 123,
      name: '기존 상품',
      leafCategoryId: '500',
      images: { representativeImage: { url: 'x' } },
      detailContent: '<p>x</p>',
      salePrice: 10000,
      stockQuantity: 10,
      saleEndDate: '2099-12-31T23:59:59.000+09:00',
      deliveryInfo: { deliveryType: 'DELIVERY' },
      detailAttribute: {
        optionInfo: { optionCombinations: [] },
        sellerCodeInfo: { sellerManagementCode: 'OLD' },
        naverShoppingSearchInfo: { catalogMatchingYn: true, matchedCatalogId: 1 },
        productInfoProvidedNotice: { productInfoProvidedNoticeType: 'FASHION_ITEMS' }
      }
    },
    smartstoreChannelProduct: {
      channelProductNo: 999,
      channelProductName: '기존 상품',
      naverShoppingRegistration: true,
      channelProductDisplayStatusType: 'ON',
      storeKeepExclusiveProduct: false
    }
  });
  assert.equal(template.originProduct.name, undefined);
  assert.equal(template.originProduct.detailAttribute.optionInfo, undefined);
  assert.equal(template.originProduct.detailAttribute.naverShoppingSearchInfo, undefined);
  assert.equal(template.originProduct.saleEndDate, '2099-12-31T23:59:59.000+09:00');
  assert.equal(template.smartstoreChannelProduct.channelProductNo, undefined);
});
