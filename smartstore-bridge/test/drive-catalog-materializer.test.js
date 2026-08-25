import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DriveCatalogMaterializer } from '../src/drive/catalog-materializer.js';
import { DriveServiceError } from '../src/drive/service.js';

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
    driveService: {
      client,
      boundary: {
        async assertDestination() {},
        async assertInsideRoot() {}
      }
    },
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

test('Drive catalog rejects an image name that escapes the local cache root', async () => {
  // Given
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-drive-catalog-escape-'));
  const escapedName = `${path.basename(cacheRoot)}-escaped.txt`;
  const remoteName = ['..', '..', '..', '..', escapedName].join(path.sep);
  const escapedPath = path.join(path.dirname(cacheRoot), escapedName);
  const client = {
    async downloadFile(fileId) {
      if (fileId === 'product_json_123') {
        return Buffer.from(JSON.stringify({ product_id: '1895', downloaded_images: [remoteName] }));
      }
      return Buffer.from('escaped');
    }
  };
  const materializer = new DriveCatalogMaterializer({
    driveService: {
      client,
      boundary: {
        async assertDestination() {},
        async assertInsideRoot() {}
      }
    },
    cacheRoot,
    catalogFolderId: 'catalog_root_123',
    cacheTtlSeconds: 0
  });
  materializer.ensureManifest = async () => ({ products: {} });
  materializer.getEntry = async () => ({ product_id: '1895', local_folder: `귀걸이${path.sep}상품` });
  materializer.resolveProductFolder = async () => ({ folderId: 'product_folder_123', parts: ['귀걸이', '상품'] });
  materializer.findChild = async (_parentId, name) => {
    if (name === 'product_info.json') {
      return { id: 'product_json_123', name, modifiedTime: '2026-08-25T00:00:00Z', size: '100' };
    }
    if (name === 'product_info.txt') return null;
    return { id: 'images_folder_123', name: 'images', mimeType: FOLDER_MIME };
  };
  materializer.listAllChildren = async () => [{
    id: 'image_file_123',
    name: remoteName,
    modifiedTime: '2026-08-25T00:00:00Z',
    size: '7'
  }];

  // When / Then
  try {
    await assert.rejects(
      () => materializer.ensureProduct('1895', { includeImages: true }),
      error => error.code === 'DRIVE_CATALOG_INVALID_FILE_NAME'
    );
    assert.equal(fs.existsSync(escapedPath), false);
  } finally {
    fs.rmSync(escapedPath, { force: true });
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('Drive catalog validates its configured folder against the allowed root before searching', async () => {
  // Given
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-drive-catalog-root-'));
  let searched = false;
  const client = {
    async searchByName() {
      searched = true;
      return { files: [{ id: 'manifest_file_123', modifiedTime: '2026-08-25T00:00:00Z', size: '2' }] };
    },
    async downloadFile() { return Buffer.from('{}'); }
  };
  const materializer = new DriveCatalogMaterializer({
    driveService: {
      client,
      boundary: {
        async assertDestination() {
          throw new DriveServiceError('DRIVE_PATH_OUTSIDE_ALLOWED_ROOT', 'outside');
        },
        async assertInsideRoot() {}
      }
    },
    cacheRoot,
    catalogFolderId: 'outside_catalog_123',
    cacheTtlSeconds: 0
  });

  // When / Then
  try {
    await assert.rejects(
      () => materializer.ensureManifest({ force: true }),
      error => error.code === 'DRIVE_PATH_OUTSIDE_ALLOWED_ROOT'
    );
    assert.equal(searched, false);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});
