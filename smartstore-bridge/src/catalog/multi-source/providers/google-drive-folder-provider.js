import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { GOOGLE_FOLDER_MIME } from '../../../drive/client.js';
import { MultiSourceCatalogError } from '../errors.js';

function atomicWrite(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, filePath);
}

function safeFileName(value) {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new MultiSourceCatalogError('DRIVE_FOLDER_SOURCE_INVALID_FILE_NAME', 'Drive 상품 파일명이 올바르지 않습니다.', {
      details: { name }
    });
  }
  return name;
}

function parseCost(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function statusOf(product) {
  if (product?.sold_out === true || product?.soldOut === true) return 'sold_out';
  return String(product?.sourceStatus || product?.status || product?.availability || 'active').toLowerCase();
}

export class GoogleDriveFolderCatalogProvider {
  constructor({ source, driveService, cacheRoot }) {
    if (!source || !driveService?.client || !driveService?.boundary) {
      throw new Error('GoogleDriveFolderCatalogProvider에는 source와 driveService가 필요합니다.');
    }
    this.source = source;
    this.driveService = driveService;
    this.client = driveService.client;
    this.cacheRoot = path.resolve(cacheRoot);
    fs.mkdirSync(this.cacheRoot, { recursive: true });
  }

  async assertSourceRoot() {
    await this.driveService.boundary.assertDestination(this.source.rootReference, {
      operation: 'multi-source-folder-root',
      fresh: true
    });
  }

  async status() {
    await this.assertSourceRoot();
    const page = await this.client.listChildren(this.source.rootReference, {
      pageSize: 1,
      q: `mimeType = '${GOOGLE_FOLDER_MIME}'`,
      orderBy: 'modifiedTime desc'
    });
    return {
      ready: true,
      providerType: 'google_drive_folder',
      sourceId: this.source.sourceId,
      rootFolderId: this.source.rootReference,
      hasProducts: Boolean(page.files?.length),
      hasMore: Boolean(page.nextPageToken)
    };
  }

  async listChanges({ cursor = null, limit = 100 } = {}) {
    await this.assertSourceRoot();
    const response = await this.client.listChildren(this.source.rootReference, {
      pageSize: Math.min(500, Math.max(1, Number(limit || 100))),
      pageToken: cursor || undefined,
      q: `mimeType = '${GOOGLE_FOLDER_MIME}'`,
      orderBy: 'modifiedTime,name_natural'
    });
    const folders = (response.files || []).filter(file => file.mimeType === GOOGLE_FOLDER_MIME);
    return {
      cursor: cursor || null,
      nextCursor: response.nextPageToken || null,
      hasMore: Boolean(response.nextPageToken),
      totalAvailable: null,
      items: folders.map(folder => ({
        sourceId: this.source.sourceId,
        sourceProductId: folder.id,
        name: folder.name,
        categories: [],
        sourcePriceDisplay: null,
        optionCount: 0,
        imageCount: 0,
        completed: true,
        sourceUrl: folder.webViewLink || null,
        sourceModifiedAt: folder.modifiedTime || null
      }))
    };
  }

  async getProductFolder(sourceProductId) {
    const id = String(sourceProductId || '').trim();
    if (!id) throw new MultiSourceCatalogError('MULTI_SOURCE_PRODUCT_ID_REQUIRED', 'sourceProductId가 필요합니다.');
    await this.driveService.boundary.assertInsideRoot(id, { operation: 'multi-source-folder-product', fresh: true });
    const folder = await this.client.getFile(id);
    if (folder.mimeType !== GOOGLE_FOLDER_MIME || !(folder.parents || []).includes(this.source.rootReference)) {
      throw new MultiSourceCatalogError(
        'DRIVE_FOLDER_SOURCE_PRODUCT_NOT_DIRECT_CHILD',
        '상품 폴더는 설정한 Source 루트의 직접 하위 폴더여야 합니다.',
        { status: 400, details: { sourceId: this.source.sourceId, sourceProductId: id } }
      );
    }
    return folder;
  }

  async findProductInfo(folderId) {
    const response = await this.client.searchByName('product_info.json', {
      parentId: folderId,
      mimeType: 'application/json',
      exact: true,
      pageSize: 20,
      orderBy: 'modifiedTime desc'
    });
    const files = response.files || [];
    if (!files.length) {
      throw new MultiSourceCatalogError(
        'DRIVE_FOLDER_SOURCE_PRODUCT_INFO_MISSING',
        '상품 폴더에 product_info.json이 없습니다.',
        { status: 404, details: { sourceId: this.source.sourceId, sourceProductId: folderId } }
      );
    }
    if (files.length > 1) {
      throw new MultiSourceCatalogError(
        'DRIVE_FOLDER_SOURCE_PRODUCT_INFO_DUPLICATE',
        '상품 폴더에 product_info.json이 여러 개 있습니다.',
        { status: 409, details: { sourceProductId: folderId, fileIds: files.map(file => file.id) } }
      );
    }
    return files[0];
  }

  async getSourceProduct(sourceProductId) {
    const folder = await this.getProductFolder(sourceProductId);
    const infoFile = await this.findProductInfo(folder.id);
    await this.driveService.boundary.assertInsideRoot(infoFile.id, { operation: 'multi-source-folder-info', fresh: true });
    const buffer = await this.client.downloadFile(infoFile.id);
    let product;
    try {
      product = JSON.parse(buffer.toString('utf8'));
    } catch (error) {
      throw new MultiSourceCatalogError(
        'DRIVE_FOLDER_SOURCE_PRODUCT_JSON_INVALID',
        'product_info.json이 올바른 JSON이 아닙니다.',
        { status: 400, details: { sourceProductId: folder.id, fileId: infoFile.id }, cause: error }
      );
    }
    return {
      ...product,
      __sourceContext: {
        sourceId: this.source.sourceId,
        sourceProductId: folder.id,
        providerType: this.source.providerType,
        driveFolderId: folder.id,
        driveFolderName: folder.name,
        productInfoFileId: infoFile.id,
        sourceModifiedAt: infoFile.modifiedTime || folder.modifiedTime || null,
        sourceUrl: folder.webViewLink || null
      }
    };
  }

  async hydrateAssets(sourceProductId, { imageNames, force = false } = {}) {
    const folder = await this.getProductFolder(sourceProductId);
    const imagesSearch = await this.client.searchByName('images', {
      parentId: folder.id,
      mimeType: GOOGLE_FOLDER_MIME,
      exact: true,
      pageSize: 20
    });
    const imageFolders = imagesSearch.files || [];
    if (!imageFolders.length) {
      return {
        sourceId: this.source.sourceId,
        sourceProductId: folder.id,
        requestedImageCount: 0,
        downloadedImages: 0,
        reusedImages: 0,
        missingImages: [],
        cacheFiles: [],
        note: 'images_folder_not_found'
      };
    }
    if (imageFolders.length > 1) {
      throw new MultiSourceCatalogError('DRIVE_FOLDER_SOURCE_IMAGES_DUPLICATE', 'images 폴더가 여러 개입니다.', {
        status: 409,
        details: { sourceProductId: folder.id, folderIds: imageFolders.map(item => item.id) }
      });
    }
    const imagesFolder = imageFolders[0];
    await this.driveService.boundary.assertInsideRoot(imagesFolder.id, { operation: 'multi-source-folder-images', fresh: true });
    const children = await this.client.listAllFiles({
      q: `'${String(imagesFolder.id).replaceAll("'", "\\'")}' in parents and trashed = false`,
      pageSize: 1000,
      orderBy: 'name_natural'
    });
    const files = children.filter(file => file.mimeType !== GOOGLE_FOLDER_MIME);
    const requested = Array.isArray(imageNames) && imageNames.length
      ? [...new Set(imageNames.map(safeFileName))]
      : files.map(file => safeFileName(file.name));
    const byName = new Map(files.map(file => [file.name, file]));
    const missingImages = requested.filter(name => !byName.has(name));
    const productCache = path.join(this.cacheRoot, this.source.sourceId, folder.id, 'images');
    let downloadedImages = 0;
    let reusedImages = 0;
    const cacheFiles = [];
    for (const name of requested) {
      const remote = byName.get(name);
      if (!remote) continue;
      await this.driveService.boundary.assertInsideRoot(remote.id, { operation: 'multi-source-folder-image', fresh: true });
      const localPath = path.join(productCache, name);
      const metaPath = `${localPath}.remote.json`;
      let reusable = false;
      if (!force && fs.existsSync(localPath) && fs.existsSync(metaPath)) {
        try {
          const state = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          reusable = state.fileId === remote.id && state.modifiedTime === (remote.modifiedTime || null) && String(state.size || '') === String(remote.size || '');
        } catch {}
      }
      if (reusable) {
        reusedImages += 1;
      } else {
        const buffer = await this.client.downloadFile(remote.id);
        atomicWrite(localPath, buffer);
        atomicWrite(metaPath, Buffer.from(JSON.stringify({
          fileId: remote.id,
          modifiedTime: remote.modifiedTime || null,
          size: remote.size || String(buffer.length),
          downloadedAt: new Date().toISOString()
        }, null, 2)));
        downloadedImages += 1;
      }
      cacheFiles.push(path.relative(this.cacheRoot, localPath).split(path.sep).join('/'));
    }
    return {
      sourceId: this.source.sourceId,
      sourceProductId: folder.id,
      requestedImageCount: requested.length,
      downloadedImages,
      reusedImages,
      missingImages,
      cacheFiles
    };
  }

  async normalize(product) {
    const context = product?.__sourceContext || {};
    const sourceProductId = String(context.sourceProductId || product?.sourceProductId || product?.product_id || '').trim();
    const sourceProductName = String(product?.name || product?.product_name || context.driveFolderName || '').trim();
    if (!sourceProductId || !sourceProductName) {
      throw new MultiSourceCatalogError('DRIVE_FOLDER_SOURCE_REQUIRED_FIELDS', 'Drive 상품에 식별자와 상품명이 필요합니다.');
    }
    const imageNames = Array.isArray(product.downloaded_images)
      ? product.downloaded_images.map(String)
      : Array.isArray(product.images) ? product.images.map(item => typeof item === 'string' ? item : item?.name).filter(Boolean) : [];
    return {
      sourceId: this.source.sourceId,
      sourceProductId,
      supplierSku: product.sku || product.supplier_sku || null,
      sourceProductName,
      sourceCategoryPath: Array.isArray(product.categories) ? product.categories.map(String) : [],
      sourceUrl: product.url || product.product_url || context.sourceUrl || null,
      sourceStatus: statusOf(product),
      supplyCost: parseCost(product.supply_cost ?? product.supplyCost ?? product.sale_price_display ?? product.price),
      currency: this.source.defaultCurrency || 'KRW',
      optionGroups: Array.isArray(product.options) ? structuredClone(product.options) : [],
      assets: {
        imageNames,
        imageCount: imageNames.length,
        originalImageUrls: Array.isArray(product.image_urls) ? product.image_urls.map(String) : [],
        driveFolderId: context.driveFolderId || sourceProductId
      },
      sourceModifiedAt: context.sourceModifiedAt || product.updated_at || product.modified_at || null,
      sourceHash: product.source_hash || null,
      providerType: this.source.providerType
    };
  }
}

export const _internal = { safeFileName, parseCost, statusOf };
