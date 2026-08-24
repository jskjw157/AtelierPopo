import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DriveCatalogMaterializer } from '../src/drive/catalog-materializer.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

test('Drive catalog materializer downloads manifest, product JSON and selected images', async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-drive-catalog-'));
  const nodes = new Map();
  const content = new Map();
  const add = (file, data) => {
    nodes.set(file.id, file);
    if (data !== undefined) content.set(file.id, Buffer.from(data));
  };
  add({ id: 'catalog_root_123', name: 'catalog', mimeType: FOLDER_MIME, parents: [] });
  add({ id: 'manifest_file_123', name: 'catalog_manifest.json', mimeType: 'application/json', parents: ['catalog_root_123'], modifiedTime: '2026-08-24T00:00:00Z', size: '200' }, JSON.stringify({
    total_products: 1,
    products: {
      '1895': { product_id: '1895', local_folder: '귀걸이\\1895_925 실버 미니 물방울 귀걸이' }
    }
  }));
  add({ id: 'category_folder_123', name: '귀걸이', mimeType: FOLDER_MIME, parents: ['catalog_root_123'] });
  add({ id: 'product_folder_123', name: '1895_925 실버 미니 물방울 귀걸이', mimeType: FOLDER_MIME, parents: ['category_folder_123'] });
  add({ id: 'product_json_123', name: 'product_info.json', mimeType: 'application/json', parents: ['product_folder_123'], modifiedTime: '2026-08-24T00:00:00Z', size: '200' }, JSON.stringify({
    product_id: '1895',
    name: '925 실버 미니 물방울 귀걸이',
    downloaded_images: ['001_a.jpg']
  }));
  add({ id: 'images_folder_123', name: 'images', mimeType: FOLDER_MIME, parents: ['product_folder_123'] });
  add({ id: 'image_file_123', name: '001_a.jpg', mimeType: 'image/jpeg', parents: ['images_folder_123'], modifiedTime: '2026-08-24T00:00:00Z', size: '4' }, Buffer.from([1, 2, 3, 4]));

  const children = parentId => [...nodes.values()].filter(file => file.parents?.includes(parentId));
  const client = {
    async searchByName(name, { parentId, mimeType }) {
      return { files: children(parentId).filter(file => file.name === name && (!mimeType || file.mimeType === mimeType)) };
    },
    async listChildren(parentId) { return { files: children(parentId) }; },
    async downloadFile(fileId) { return content.get(fileId); }
  };
  const materializer = new DriveCatalogMaterializer({
    driveService: { client },
    cacheRoot,
    catalogFolderId: 'catalog_root_123',
    cacheTtlSeconds: 0
  });
  const result = await materializer.ensureProduct('1895', { includeImages: true });
  assert.equal(result.productId, '1895');
  assert.equal(fs.existsSync(result.productPath), true);
  assert.deepEqual(
    fs.readFileSync(path.join(result.localDir, 'images', '001_a.jpg')),
    Buffer.from([1, 2, 3, 4])
  );
  assert.equal(materializer.status().totalProducts, 1);
});
