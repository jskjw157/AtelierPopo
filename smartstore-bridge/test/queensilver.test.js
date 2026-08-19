import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWon, sortDownloadedImages, validateSourceProduct } from '../src/domain/queensilver.js';

test('원화 표시를 정수로 읽는다', () => {
  assert.equal(parseWon('14,500원 (부가세별도)'), 14500);
});

test('이미지 파일을 숫자 접두사 순으로 정렬한다', () => {
  assert.deepEqual(sortDownloadedImages(['010_x.jpg', '002_x.webp', '001_x.webp']), ['001_x.webp', '002_x.webp', '010_x.jpg']);
});

test('최소 퀸실버 상품 구조를 검증한다', () => {
  const errors = validateSourceProduct({
    product_id: '1', name: '상품', categories: ['귀걸이'], sale_price_display: '10,000원', downloaded_images: ['001.jpg']
  });
  assert.deepEqual(errors, []);
});
