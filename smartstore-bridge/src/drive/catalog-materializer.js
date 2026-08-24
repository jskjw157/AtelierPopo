import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeSourceFolder } from '../domain/queensilver.js';
import { GOOGLE_FOLDER_MIME } from './client.js';
import { DriveServiceError } from './service.js';

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, filePath);
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function safeRelativeParts(localFolder) {
  const parts = normalizeSourceFolder(localFolder);
  if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes('\0'))) {
    throw new DriveServiceError('DRIVE_CATALOG_INVALID_LOCAL_FOLDER', '카탈로그 local_folder 경로가 올바르지 않습니다.', {
      localFolder
    });
  }
  return parts;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

export class DriveCatalogMaterializer {
  constructor({ driveService, cacheRoot, catalogFolderId, cacheTtlSeconds = 3600, downloadConcurrency = 4 }) {
    if (!driveService?.client) throw new Error('DriveCatalogMaterializer에는 driveService가 필요합니다.');
    this.driveService = driveService;
    this.client = driveService.client;
    this.cacheRoot = path.resolve(cacheRoot);
    this.catalogFolderId = catalogFolderId;
    this.cacheTtlMs = Math.max(0, Number(cacheTtlSeconds || 0) * 1000);
    this.downloadConcurrency = Math.max(1, Math.min(12, Number(downloadConcurrency || 4)));
    this.manifestFileId = null;
    this.manifestCache = null;
    this.folderIdCache = new Map();
    fs.mkdirSync(this.cacheRoot, { recursive: true });
  }

  manifestPath() {
    return path.join(this.cacheRoot, 'catalog_manifest.json');
  }

  statePath() {
    return path.join(this.cacheRoot, '.drive-catalog-state.json');
  }

  isFresh(filePath) {
    if (!fs.existsSync(filePath)) return false;
    if (this.cacheTtlMs === 0) return false;
    return Date.now() - fs.statSync(filePath).mtimeMs < this.cacheTtlMs;
  }

  async findChild(parentId, name, { mimeType, required = true } = {}) {
    const key = `${parentId}:${mimeType || '*'}:${name}`;
    if (this.folderIdCache.has(key)) return this.folderIdCache.get(key);
    const response = await this.client.searchByName(name, {
      parentId,
      mimeType,
      exact: true,
      pageSize: 100,
      orderBy: 'modifiedTime desc'
    });
    const files = response.files || [];
    if (!files.length) {
      if (!required) return null;
      throw new DriveServiceError('DRIVE_CATALOG_CHILD_NOT_FOUND', `Google Drive에서 ${name}을(를) 찾을 수 없습니다.`, {
        parentId,
        name,
        mimeType: mimeType || null
      });
    }
    if (files.length > 1) {
      throw new DriveServiceError('DRIVE_CATALOG_DUPLICATE_CHILD', `동일한 이름의 항목이 여러 개입니다: ${name}`, {
        parentId,
        name,
        fileIds: files.map(file => file.id)
      });
    }
    this.folderIdCache.set(key, files[0]);
    return files[0];
  }

  async downloadIfChanged(remoteFile, localPath, state, stateKey) {
    const previous = state.files?.[stateKey];
    const unchanged = previous
      && previous.fileId === remoteFile.id
      && previous.modifiedTime === remoteFile.modifiedTime
      && String(previous.size || '') === String(remoteFile.size || '')
      && fs.existsSync(localPath);
    if (unchanged) return { downloaded: false, localPath };
    const buffer = await this.client.downloadFile(remoteFile.id);
    atomicWrite(localPath, buffer);
    state.files ||= {};
    state.files[stateKey] = {
      fileId: remoteFile.id,
      modifiedTime: remoteFile.modifiedTime || null,
      size: remoteFile.size || String(buffer.length),
      downloadedAt: new Date().toISOString()
    };
    return { downloaded: true, localPath, size: buffer.length };
  }

  async ensureManifest({ force = false } = {}) {
    const localPath = this.manifestPath();
    if (!force && this.manifestCache && this.isFresh(localPath)) return this.manifestCache;
    if (!force && this.isFresh(localPath)) {
      this.manifestCache = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      return this.manifestCache;
    }

    const remote = await this.findChild(this.catalogFolderId, 'catalog_manifest.json', {
      mimeType: 'application/json'
    });
    const state = readJsonIfExists(this.statePath(), { files: {} });
    await this.downloadIfChanged(remote, localPath, state, 'catalog_manifest.json');
    state.catalogFolderId = this.catalogFolderId;
    state.manifestFileId = remote.id;
    state.updatedAt = new Date().toISOString();
    atomicWrite(this.statePath(), JSON.stringify(state, null, 2));
    this.manifestFileId = remote.id;
    this.manifestCache = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    return this.manifestCache;
  }

  async getEntry(productId) {
    const manifest = await this.ensureManifest();
    const id = String(productId || '').trim();
    const entry = manifest.products?.[id]
      || Object.values(manifest.products || {}).find(item => String(item.product_id) === id);
    if (!entry) {
      throw new DriveServiceError('DRIVE_CATALOG_PRODUCT_NOT_FOUND', `Drive 카탈로그에서 상품을 찾을 수 없습니다: ${id}`, {
        productId: id
      });
    }
    return entry;
  }

  async resolveProductFolder(entry) {
    const parts = safeRelativeParts(entry.local_folder);
    if (parts.length < 2) {
      throw new DriveServiceError('DRIVE_CATALOG_INVALID_LOCAL_FOLDER', '상품 local_folder에는 카테고리와 상품 폴더가 필요합니다.', {
        localFolder: entry.local_folder
      });
    }
    let parentId = this.catalogFolderId;
    for (const part of parts) {
      const folder = await this.findChild(parentId, part, { mimeType: GOOGLE_FOLDER_MIME });
      parentId = folder.id;
    }
    return { folderId: parentId, parts };
  }

  async listAllChildren(folderId) {
    const files = [];
    let pageToken;
    do {
      const response = await this.client.listChildren(folderId, { pageSize: 1000, pageToken });
      files.push(...(response.files || []));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return files;
  }

  async ensureProduct(productId, { includeImages = true, imageNames, force = false } = {}) {
    await this.ensureManifest({ force: false });
    const entry = await this.getEntry(productId);
    const { folderId, parts } = await this.resolveProductFolder(entry);
    const localDir = path.join(this.cacheRoot, ...parts);
    const imagesDir = path.join(localDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const statePath = path.join(localDir, '.drive-state.json');
    const state = readJsonIfExists(statePath, { files: {}, productId: String(entry.product_id) });

    const productInfoRemote = await this.findChild(folderId, 'product_info.json', { mimeType: 'application/json' });
    if (force) delete state.files?.['product_info.json'];
    const infoResult = await this.downloadIfChanged(
      productInfoRemote,
      path.join(localDir, 'product_info.json'),
      state,
      'product_info.json'
    );
    const product = JSON.parse(fs.readFileSync(path.join(localDir, 'product_info.json'), 'utf8'));

    const textRemote = await this.findChild(folderId, 'product_info.txt', { required: false });
    if (textRemote) {
      if (force) delete state.files?.['product_info.txt'];
      await this.downloadIfChanged(textRemote, path.join(localDir, 'product_info.txt'), state, 'product_info.txt');
    }

    const requestedNames = includeImages
      ? [...new Set((imageNames?.length ? imageNames : product.downloaded_images || []).map(String))]
      : [];
    let downloadedImages = 0;
    let reusedImages = 0;
    let missingImages = [];

    if (requestedNames.length) {
      const imagesFolder = await this.findChild(folderId, 'images', { mimeType: GOOGLE_FOLDER_MIME });
      const remoteImages = await this.listAllChildren(imagesFolder.id);
      const byName = new Map(remoteImages.map(file => [file.name, file]));
      missingImages = requestedNames.filter(name => !byName.has(name));
      if (missingImages.length) {
        throw new DriveServiceError('DRIVE_CATALOG_IMAGE_NOT_FOUND', 'Drive 상품 폴더에서 일부 이미지를 찾을 수 없습니다.', {
          productId: String(entry.product_id),
          missingImages
        });
      }
      const results = await mapWithConcurrency(requestedNames, this.downloadConcurrency, async name => {
        if (force) delete state.files?.[`images/${name}`];
        return this.downloadIfChanged(byName.get(name), path.join(imagesDir, name), state, `images/${name}`);
      });
      downloadedImages = results.filter(item => item.downloaded).length;
      reusedImages = results.length - downloadedImages;
    }

    state.productId = String(entry.product_id);
    state.driveFolderId = folderId;
    state.localFolder = entry.local_folder;
    state.updatedAt = new Date().toISOString();
    atomicWrite(statePath, JSON.stringify(state, null, 2));

    return {
      productId: String(entry.product_id),
      productPath: path.join(localDir, 'product_info.json'),
      localDir,
      driveFolderId: folderId,
      productInfoDownloaded: Boolean(infoResult.downloaded),
      requestedImageCount: requestedNames.length,
      downloadedImages,
      reusedImages,
      missingImages
    };
  }

  async syncCatalog({
    productIds = [],
    includeImages = false,
    limit = 20,
    force = false,
    concurrency = this.downloadConcurrency,
    resultLimit = 200
  } = {}) {
    const manifest = await this.ensureManifest({ force });
    const allIds = productIds.length
      ? [...new Set(productIds.map(value => String(value).trim()).filter(Boolean))]
      : Object.keys(manifest.products || {});
    const safeLimit = Math.max(1, Math.min(Number(limit || 20), 2000));
    const selected = allIds.slice(0, safeLimit);
    const safeConcurrency = Math.max(1, Math.min(Number(concurrency || this.downloadConcurrency), 8));
    const results = await mapWithConcurrency(selected, safeConcurrency, async productId => {
      try {
        return { ok: true, ...(await this.ensureProduct(productId, { includeImages, force })) };
      } catch (error) {
        return {
          ok: false,
          productId: String(productId),
          error: { code: error.code || 'DRIVE_CATALOG_SYNC_FAILED', message: error.message }
        };
      }
    });
    const failures = results.filter(item => !item.ok);
    const safeResultLimit = Math.max(0, Math.min(Number(resultLimit ?? 200), 2000));
    return {
      totalAvailable: allIds.length,
      requested: selected.length,
      succeeded: results.length - failures.length,
      failed: failures.length,
      includeImages: Boolean(includeImages),
      force: Boolean(force),
      concurrency: safeConcurrency,
      truncated: results.length > safeResultLimit,
      results: safeResultLimit ? results.slice(0, safeResultLimit) : [],
      failures: failures.slice(0, Math.min(200, safeResultLimit || 200))
    };
  }

  status() {
    const manifest = readJsonIfExists(this.manifestPath(), null);
    const state = readJsonIfExists(this.statePath(), null);
    return {
      cacheRoot: this.cacheRoot,
      catalogFolderId: this.catalogFolderId,
      manifestExists: fs.existsSync(this.manifestPath()),
      manifestFileId: state?.manifestFileId || this.manifestFileId || null,
      totalProducts: Number(manifest?.total_products || Object.keys(manifest?.products || {}).length || 0),
      stateUpdatedAt: state?.updatedAt || null,
      cacheTtlMs: this.cacheTtlMs
    };
  }

  cleanupCache({ maxAgeSeconds = this.cacheTtlMs / 1000 } = {}) {
    const cutoff = Date.now() - Math.max(0, Number(maxAgeSeconds || 0)) * 1000;
    let removed = 0;
    let bytes = 0;
    const preserve = new Set([this.manifestPath(), this.statePath()]);

    function walk(directory) {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (preserve.has(absolute)) continue;
        if (entry.isDirectory()) {
          walk(absolute);
          if (fs.existsSync(absolute) && fs.readdirSync(absolute).length === 0) fs.rmdirSync(absolute);
        } else {
          const stat = fs.statSync(absolute);
          if (stat.mtimeMs < cutoff && !entry.name.startsWith('.drive-state')) {
            bytes += stat.size;
            fs.unlinkSync(absolute);
            removed += 1;
          }
        }
      }
    }
    walk(this.cacheRoot);
    return { removedFiles: removed, removedBytes: bytes, maxAgeSeconds };
  }
}
