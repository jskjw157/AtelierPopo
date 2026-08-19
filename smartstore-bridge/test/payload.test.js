import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductPayload } from '../src/domain/payload.js';

function validPayload() {
  return {
    originProduct: {
      statusType: 'SALE',
      saleType: 'NEW',
      leafCategoryId: '500001',
      name: '925 실버 미니 귀걸이',
      detailContent: '<div>detail</div>',
      images: { representativeImage: { url: 'https://example.com/a.jpg' }, optionalImages: [] },
      saleEndDate: '2099-12-31T23:59:59.000+09:00',
      salePrice: 29900,
      stockQuantity: 9,
      deliveryInfo: {
        deliveryType: 'DELIVERY',
        deliveryAttributeType: 'NORMAL',
        deliveryFee: { deliveryFeeType: 'FREE' }
      },
      detailAttribute: {
        afterServiceInfo: { afterServiceTelephoneNumber: '0000', afterServiceGuideContent: '문의' },
        originAreaInfo: { originAreaCode: '04', content: '상세페이지 참조' },
        minorPurchasable: true,
        productInfoProvidedNotice: {
          productInfoProvidedNoticeType: 'FASHION_ITEMS',
          fashionItems: { material: '상세페이지 참조' }
        }
      }
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductDisplayStatusType: 'ON',
      storeKeepExclusiveProduct: false
    }
  };
}

test('등록 전 핵심 필드를 통과시킨다', () => {
  assert.deepEqual(validateProductPayload(validPayload(), { execute: true }), []);
});

test('설정 플레이스홀더와 로컬 URL을 실제 실행에서 차단한다', () => {
  const payload = validPayload();
  payload.originProduct.deliveryInfo.__SETUP_REQUIRED__ = 'replace';
  payload.originProduct.images.representativeImage.url = 'local://a.jpg';
  const errors = validateProductPayload(payload, { execute: true });
  assert.equal(errors.some(item => item.includes('플레이스홀더')), true);
  assert.equal(errors.some(item => item.includes('업로드 후 반환된 URL')), true);
});
