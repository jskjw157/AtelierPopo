import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExactCode,
  normalizeVariantSkuSet,
  makeChannelProductRef,
  hashChannelProduct,
  validateNormalizedChannelProduct
} from '../src/catalog/channel-import/model.js';

test('exact normalization changes formatting only', () => {
  assert.equal(normalizeExactCode('  haar＿ear  0012 '), 'HAAR-EAR-0012');
  assert.equal(normalizeExactCode('AB-0007'), 'AB-0007');
  assert.notEqual(normalizeExactCode('AB-0007'), normalizeExactCode('0007'));
});

test('variant set is normalized unique and sorted', () => {
  assert.deepEqual(
    normalizeVariantSkuSet([' gold_01 ', 'SILVER-01', 'gold-01']),
    ['GOLD-01', 'SILVER-01']
  );
});

test('channel ref is scoped and hash ignores object key order', () => {
  assert.equal(makeChannelProductRef('haar_own_mall', 421), 'haar_own_mall:421');
  assert.equal(hashChannelProduct({ b: 2, a: 1 }), hashChannelProduct({ a: 1, b: 2 }));
  assert.throws(
    () => makeChannelProductRef('', '421'),
    error => error.code === 'CHANNEL_PRODUCT_REF_REQUIRED'
  );
});

test('normalized draft validation preserves channel-specific values', () => {
  const draft = {
    channelId: 'haar_own_mall',
    remoteProductId: '421',
    channelProductRef: 'haar_own_mall:421',
    productName: 'Cafe24 전용 상품명',
    price: 19900,
    stock: 3,
    raw: { product_no: 421 }
  };
  assert.deepEqual(validateNormalizedChannelProduct(draft), draft);
  assert.throws(
    () => validateNormalizedChannelProduct({ ...draft, raw: null }),
    error => error.code === 'CHANNEL_PRODUCT_INVALID' && error.details.key === 'raw'
  );
});
