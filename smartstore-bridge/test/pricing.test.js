import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSalePrice, roundWithEnding } from '../src/domain/pricing.js';

test('900 끝자리로 올림한다', () => {
  assert.equal(roundWithEnding(35100, 1000, 900), 35900);
  assert.equal(roundWithEnding(35900, 1000, 900), 35900);
  assert.equal(roundWithEnding(35901, 1000, 900), 36900);
});

test('부가세 별도 공급가를 판매가로 계산한다', () => {
  const result = calculateSalePrice('14,500원 (부가세별도)', {
    mode: 'markup', sourcePriceIncludesVat: false, vatRate: 0.1,
    multiplier: 2.2, flatFee: 0, minimumPrice: 19900,
    roundUnit: 1000, ending: 900
  });
  assert.equal(result.sourceNetPrice, 14500);
  assert.equal(result.grossSourcePrice, 15950);
  assert.equal(result.salePrice, 35900);
});
