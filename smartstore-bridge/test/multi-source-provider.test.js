import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleDriveManifestCatalogProvider } from '../src/catalog/multi-source/providers/google-drive-manifest-provider.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-source-provider-'));
  const manifest = {
    total_products: 3,
    products: {
      '1905': { product_id: 1905, name: '상품 1905', categories: ['목걸이'], completed: true, image_count: 2 },
      '10': { product_id: 10, name: '상품 10', categories: ['귀걸이'], completed: true, image_count: 1 },
      '20': { product_id: 20, name: '상품 20', categories: ['반지'], completed: true, image_count: 1 }
    }
  };
  const calls = [];
  const materializer = {
    status() {
      return { manifestExists: true, totalProducts: 3, stateUpdatedAt: '2026-08-26T00:00:00Z', cacheTtlMs: 1000 };
    },
    async ensureManifest() { return manifest; },
    async ensureProduct(productId, options) {
      calls.push({ productId: String(productId), options });
      const productPath = path.join(dir, `${productId}.json`);
      fs.writeFileSync(productPath, JSON.stringify({
        product_id: String(productId),
        name: `상품 ${productId}`,
        categories: ['귀걸이'],
        sale_price_display: '₩12,000',
        sold_out: false,
        options: [{ name: '색상', values: ['실버', '골드'] }],
        downloaded_images: ['001.jpg', '002.jpg'],
        url: `https://supplier.example/${productId}`
      }));
      return {
        productPath,
        driveFolderId: `folder-${productId}`,
        productInfoDownloaded: true,
        requestedImageCount: options.includeImages ? 2 : 0,
        downloadedImages: options.includeImages ? 2 : 0,
        reusedImages: 0,
        missingImages: [],
        localDir: dir
      };
    }
  };
  const source = {
    sourceId: 'queensilver_20260811',
    sourceName: '퀸실버',
    sourceType: 'supplier',
    providerType: 'google_drive_manifest',
    rootReference: 'drive-folder',
    defaultCurrency: 'KRW',
    canonical: false,
    status: 'active',
    metadata: {}
  };
  return { dir, calls, provider: new GoogleDriveManifestCatalogProvider({ source, materializer }) };
}

test('manifest source pagination uses source-scoped product ids', async () => {
  const { dir, provider } = fixture();
  try {
    const first = await provider.listChanges({ limit: 2 });
    assert.deepEqual(first.items.map(item => item.sourceProductId), ['10', '20']);
    assert.equal(first.nextCursor, '20');
    assert.equal(first.hasMore, true);

    const second = await provider.listChanges({ cursor: first.nextCursor, limit: 2 });
    assert.deepEqual(second.items.map(item => item.sourceProductId), ['1905']);
    assert.equal(second.nextCursor, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provider normalizes supplier product without turning it into a HAAR product id', async () => {
  const { dir, provider } = fixture();
  try {
    const raw = await provider.getSourceProduct('1905');
    const product = await provider.normalize(raw);
    assert.equal(product.sourceId, 'queensilver_20260811');
    assert.equal(product.sourceProductId, '1905');
    assert.equal(product.sourceProductName, '상품 1905');
    assert.equal(product.supplyCost, 12000);
    assert.equal(product.currency, 'KRW');
    assert.deepEqual(product.assets.imageNames, ['001.jpg', '002.jpg']);
    assert.equal('haarProductId' in product, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('asset hydration returns safe cache metadata without absolute server paths', async () => {
  const { dir, calls, provider } = fixture();
  try {
    const result = await provider.hydrateAssets('20', { imageNames: ['001.jpg'], force: true });
    assert.equal(result.sourceId, 'queensilver_20260811');
    assert.equal(result.sourceProductId, '20');
    assert.equal(result.driveFolderId, 'folder-20');
    assert.equal('localDir' in result, false);
    assert.deepEqual(calls.at(-1).options.imageNames, ['001.jpg']);
    assert.equal(calls.at(-1).options.force, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
