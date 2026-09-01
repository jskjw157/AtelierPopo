import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExactIdentifier,
  normalizeVariantSkuSet,
  normalizeChannelProductDraft
} from '../src/catalog/channel-import/normalization.js';

test('normalizes approved presentation differences only', () => {
  assert.equal(normalizeExactIdentifier('  haar_ear 0012  '), 'HAAR-EAR-0012');
  assert.equal(normalizeExactIdentifier('ＨＡＡＲ－００１２'), 'HAAR-0012');
  assert.equal(normalizeExactIdentifier(''), null);
  assert.equal(normalizeExactIdentifier('PREFIX-0007-SUFFIX'), 'PREFIX-0007-SUFFIX');
  assert.notEqual(normalizeExactIdentifier('PREFIX-0007'), normalizeExactIdentifier('0007'));
});

test('variant set is order-independent and rejects normalized duplicates', () => {
  const left = normalizeVariantSkuSet([{ normalizedSku: 'A' }, { normalizedSku: 'B' }]);
  const right = normalizeVariantSkuSet([{ normalizedSku: 'B' }, { normalizedSku: 'A' }]);
  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
  assert.equal(normalizeVariantSkuSet([{ normalizedSku: 'A' }, { normalizedSku: 'A' }]), null);
  assert.equal(normalizeVariantSkuSet([{ normalizedSku: 'A_B' }, { normalizedSku: 'A-B' }]), null);
});

test('name price image and category never become exact identifiers', () => {
  const draft = normalizeChannelProductDraft({
    channelId: 'haar_own_mall',
    remoteProductId: 421,
    productName: '같은 이름',
    price: 19900,
    imageUrl: 'https://example.com/a.jpg',
    category: '귀걸이',
    identifiers: []
  });
  assert.deepEqual(draft.identifiers, []);
  assert.equal(draft.channelProductKey, 'haar_own_mall:421');
  assert.equal(draft.normalized.productName, '같은 이름');
});

test('only explicit exact identifiers are normalized and retained', () => {
  const draft = normalizeChannelProductDraft({
    channelId: 'HAAR_NAVER_SMARTSTORE',
    remoteProductId: '13732645378',
    productName: '네이버 전용 상품명',
    sellerManagementCode: ' haar_ear 0012 ',
    identifiers: [{
      type: 'seller_management_code',
      value: ' haar_ear 0012 ',
      scope: 'product',
      eligibleForExactMatch: true
    }],
    variants: [
      { remoteVariantId: 'v1', sku: 'silver_01' },
      { remoteVariantId: 'v2', sku: 'gold-01' }
    ],
    raw: { channelProductNo: '13732645378' }
  });
  assert.equal(draft.channelId, 'haar_naver_smartstore');
  assert.equal(draft.identifiers[0].normalizedValue, 'HAAR-EAR-0012');
  assert.equal(draft.identifiers.some(item => item.type === 'variant_sku_set'), true);
  assert.equal(draft.raw.channelProductNo, '13732645378');
});
