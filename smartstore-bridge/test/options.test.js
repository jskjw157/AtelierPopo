import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptionLabel, buildOptionInfo } from '../src/domain/options.js';

test('옵션 추가금을 분리한다', () => {
  assert.deepEqual(parseOptionLabel('로즈골드 (+2,000원)'), { name: '로즈골드', extraPrice: 2000 });
  assert.deepEqual(parseOptionLabel('실버'), { name: '실버', extraPrice: 0 });
});

test('퀸실버 색상 옵션을 네이버 조합형 옵션으로 변환한다', () => {
  const result = buildOptionInfo([{ name: '색상', values: [
    { name: '실버', value: 'A', sold_out: false },
    { name: '골드 (+2,000원)', value: 'B', sold_out: true }
  ] }], { stockQuantity: 9, sellerCode: 'QUEEN-1905' });
  assert.equal(result.optionCombinationGroupNames.optionGroupName1, '색상');
  assert.equal(result.optionCombinations[0].price, 0);
  assert.equal(result.optionCombinations[0].stockQuantity, 9);
  assert.equal(result.optionCombinations[1].price, 2000);
  assert.equal(result.optionCombinations[1].stockQuantity, 0);
  assert.equal(result.optionCombinations[1].usable, false);
});
