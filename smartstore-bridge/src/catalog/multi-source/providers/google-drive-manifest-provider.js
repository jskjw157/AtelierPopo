import fs from 'node:fs';
import { parseWon } from '../../../domain/queensilver.js';
import { MultiSourceCatalogError } from '../errors.js';

function asPositiveInteger(value, fallback, max = 500) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function compareProductIds(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
  return a.localeCompare(b, 'ko');
}

function sourceStatus(product) {
  if (product?.sold_out === true || product?.soldOut === true) return 'sold_out';
  const status = String(product?.status || product?.availability || '').trim().toLowerCase();
  if (status) return status;
  return 'active';
}

function supplyCost(product) {
  for (const candidate of [
    product?.supply_cost,
    product?.supplyCost,
    product?.sale_price,
    product?.sale_price_display,
    product?.price
  ]) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    try { return parseWon(candidate); } catch {}
  }
  return null;
}

function publicManifestEntry(sourceId, entry) {
  return {
    sourceId,
    sourceProductId: String(entry.product_id ?? ''),
    name: entry.name || entry.title_hint || '',
    categories: Array.isArray(entry.categories) ? entry.categories : [],
    sourcePriceDisplay: entry.sale_price_display || null,
    optionCount: Number(entry.option_count || 0),
    imageCount: Number(entry.image_count || 0),
    completed: entry.completed !== false,
    sourceUrl: entry.url || null,
    sourceModifiedAt: entry.modified_at || entry.updated_at || null
  };
}

export class GoogleDriveManifestCatalogProvider {
  constructor({ source, materializer }) {
    if (!source) throw new Error('GoogleDriveManifestCatalogProvider에는 source가 필요합니다.');
    if (!materializer) throw new Error('GoogleDriveManifestCatalogProvider에는 materializer가 필요합니다.');
    this.source = source;
    this.materializer = materializer;
  }

  async status() {
    const state = this.materializer.status();
    return {
      ready: Boolean(state.manifestExists),
      providerType: 'google_drive_manifest',
      sourceId: this.source.sourceId,
      catalogFolderId: this.source.rootReference,
      totalProducts: Number(state.totalProducts || 0),
      stateUpdatedAt: state.stateUpdatedAt || null,
      cacheTtlMs: state.cacheTtlMs
    };
  }

  async listChanges({ cursor = null, limit = 100, force = false } = {}) {
    const manifest = await this.materializer.ensureManifest({ force: Boolean(force) });
    const entries = Object.values(manifest.products || {})
      .filter(entry => entry.completed !== false)
      .sort((a, b) => compareProductIds(a.product_id, b.product_id));
    const normalizedCursor = String(cursor || '').trim();
    let startIndex = 0;
    if (normalizedCursor) {
      const exactIndex = entries.findIndex(entry => String(entry.product_id) === normalizedCursor);
      startIndex = exactIndex >= 0
        ? exactIndex + 1
        : entries.findIndex(entry => compareProductIds(entry.product_id, normalizedCursor) > 0);
      if (startIndex < 0) startIndex = entries.length;
    }
    const safeLimit = asPositiveInteger(limit, 100, 500);
    const selected = entries.slice(startIndex, startIndex + safeLimit);
    const last = selected.at(-1);
    return {
      cursor: normalizedCursor || null,
      nextCursor: last && startIndex + selected.length < entries.length ? String(last.product_id) : null,
      hasMore: startIndex + selected.length < entries.length,
      totalAvailable: entries.length,
      items: selected.map(entry => publicManifestEntry(this.source.sourceId, entry))
    };
  }

  async getSourceProduct(sourceProductId, { force = false } = {}) {
    const id = String(sourceProductId || '').trim();
    if (!id) {
      throw new MultiSourceCatalogError('MULTI_SOURCE_PRODUCT_ID_REQUIRED', 'sourceProductId가 필요합니다.');
    }
    const materialized = await this.materializer.ensureProduct(id, {
      includeImages: false,
      force: Boolean(force)
    });
    let product;
    try {
      product = JSON.parse(fs.readFileSync(materialized.productPath, 'utf8'));
    } catch (error) {
      throw new MultiSourceCatalogError(
        'MULTI_SOURCE_PRODUCT_JSON_INVALID',
        `상품 JSON을 읽을 수 없습니다: ${id}`,
        { status: 500, details: { sourceId: this.source.sourceId, sourceProductId: id }, cause: error }
      );
    }
    return {
      ...product,
      __sourceContext: {
        sourceId: this.source.sourceId,
        sourceProductId: id,
        providerType: this.source.providerType,
        driveFolderId: materialized.driveFolderId,
        productInfoDownloaded: materialized.productInfoDownloaded
      }
    };
  }

  async hydrateAssets(sourceProductId, { imageNames, force = false } = {}) {
    const id = String(sourceProductId || '').trim();
    if (!id) {
      throw new MultiSourceCatalogError('MULTI_SOURCE_PRODUCT_ID_REQUIRED', 'sourceProductId가 필요합니다.');
    }
    const result = await this.materializer.ensureProduct(id, {
      includeImages: true,
      imageNames: Array.isArray(imageNames) ? imageNames : undefined,
      force: Boolean(force)
    });
    return {
      sourceId: this.source.sourceId,
      sourceProductId: id,
      driveFolderId: result.driveFolderId,
      requestedImageCount: result.requestedImageCount,
      downloadedImages: result.downloadedImages,
      reusedImages: result.reusedImages,
      missingImages: result.missingImages,
      productInfoDownloaded: result.productInfoDownloaded
    };
  }

  async normalize(product) {
    const sourceProductId = String(
      product?.__sourceContext?.sourceProductId || product?.product_id || product?.productId || ''
    ).trim();
    if (!sourceProductId) {
      throw new MultiSourceCatalogError('MULTI_SOURCE_PRODUCT_ID_REQUIRED', '상품 원본에 product_id가 없습니다.');
    }
    const downloadedImages = Array.isArray(product.downloaded_images)
      ? product.downloaded_images.map(String)
      : [];
    return {
      sourceId: this.source.sourceId,
      sourceProductId,
      supplierSku: product.sku || product.supplier_sku || null,
      sourceProductName: String(product.name || product.product_name || '').trim(),
      sourceCategoryPath: Array.isArray(product.categories) ? product.categories.map(String) : [],
      sourceUrl: product.url || product.product_url || null,
      sourceStatus: sourceStatus(product),
      supplyCost: supplyCost(product),
      currency: this.source.defaultCurrency || 'KRW',
      optionGroups: Array.isArray(product.options) ? structuredClone(product.options) : [],
      assets: {
        imageNames: downloadedImages,
        imageCount: downloadedImages.length,
        originalImageUrls: Array.isArray(product.image_urls) ? product.image_urls.map(String) : []
      },
      sourceModifiedAt: product.updated_at || product.modified_at || null,
      sourceHash: product.source_hash || null,
      providerType: this.source.providerType
    };
  }
}

export const _internal = { compareProductIds, sourceStatus, supplyCost, publicManifestEntry };
