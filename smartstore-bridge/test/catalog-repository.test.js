import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CatalogRepository } from '../src/application/catalog-repository.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-catalog-'));
  const productDir = path.join(root, '귀걸이', '1905_샘플');
  fs.mkdirSync(productDir, { recursive: true });
  fs.writeFileSync(path.join(productDir, 'product_info.json'), JSON.stringify({ product_id: '1905' }));
  fs.writeFileSync(path.join(root, 'catalog_manifest.json'), JSON.stringify({
    source: 'fixture',
    total_products: 1,
    total_completed: 1,
    products: {
      '1905': {
        product_id: '1905',
        name: '925 실버 물방울 귀걸이',
        categories: ['귀걸이'],
        sale_price_display: '14,500원',
        option_count: 3,
        image_count: 16,
        local_folder: '귀걸이\\1905_샘플',
        completed: true
      }
    }
  }));
  return root;
}

test('상품번호로 안전하게 product_info.json 경로를 찾는다', () => {
  const root = fixture();
  try {
    const repository = new CatalogRepository(root);
    assert.equal(repository.getSummary('1905').name, '925 실버 물방울 귀걸이');
    assert.equal(repository.resolveProductPath('1905'), path.join(root, '귀걸이', '1905_샘플', 'product_info.json'));
    assert.equal(repository.stats().totalProducts, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('상품명과 카테고리로 검색한다', () => {
  const root = fixture();
  try {
    const repository = new CatalogRepository(root);
    const result = repository.search({ query: '물방울', category: '귀걸이', limit: 20 });
    assert.equal(result.total, 1);
    assert.equal(result.items[0].productId, '1905');
    assert.equal(repository.search({ query: '반지' }).total, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
