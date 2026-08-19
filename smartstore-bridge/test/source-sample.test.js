import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProductInfo, sortDownloadedImages } from '../src/domain/queensilver.js';
import { buildOptionInfo } from '../src/domain/options.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.resolve(here, '../examples/product_info.sample.json');

test('실제 퀸실버 product_info 샘플 구조를 읽는다', () => {
  const loaded = loadProductInfo(samplePath);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.product.product_id, '1905');
  assert.equal(loaded.product.categories[0], '귀걸이');
  assert.equal(sortDownloadedImages(loaded.product.downloaded_images)[0].startsWith('001_'), true);
  const options = buildOptionInfo(loaded.product.options, { sellerCode: 'QUEEN-1905' });
  assert.equal(options.optionCombinations.length, 3);
  assert.equal(options.optionCombinations[1].price, 2000);
});
