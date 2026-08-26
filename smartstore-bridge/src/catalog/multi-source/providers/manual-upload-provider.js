import { randomUUID } from 'node:crypto';
import { MultiSourceCatalogError } from '../errors.js';

function decodeCursor(cursor) {
  const match = String(cursor || '').match(/^offset:(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function normalizeManualInput(source, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new MultiSourceCatalogError('MANUAL_SOURCE_PRODUCT_INVALID', '수동 상품 입력은 객체여야 합니다.');
  }
  const sourceProductName = String(input.sourceProductName || input.productName || input.name || '').trim();
  if (!sourceProductName) throw new MultiSourceCatalogError('MANUAL_SOURCE_PRODUCT_NAME_REQUIRED', '수동 상품명이 필요합니다.');
  const sourceProductId = String(input.sourceProductId || input.productId || `manual-${randomUUID()}`).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sourceProductId)) {
    throw new MultiSourceCatalogError(
      'MANUAL_SOURCE_PRODUCT_ID_INVALID',
      '수동 sourceProductId는 영문, 숫자, 점, 밑줄, 하이픈, 콜론만 사용할 수 있습니다.'
    );
  }
  const supplyCost = input.supplyCost === null || input.supplyCost === undefined || input.supplyCost === ''
    ? null
    : Number(input.supplyCost);
  if (supplyCost !== null && (!Number.isFinite(supplyCost) || supplyCost < 0)) {
    throw new MultiSourceCatalogError('MANUAL_SOURCE_COST_INVALID', '공급가는 0 이상의 숫자여야 합니다.');
  }
  return {
    sourceId: source.sourceId,
    sourceProductId,
    supplierSku: input.supplierSku ? String(input.supplierSku).trim() : null,
    sourceProductName,
    sourceCategoryPath: Array.isArray(input.sourceCategoryPath || input.categories)
      ? (input.sourceCategoryPath || input.categories).map(String)
      : [],
    sourceUrl: input.sourceUrl || input.url || null,
    sourceStatus: String(input.sourceStatus || input.status || 'active').toLowerCase(),
    supplyCost,
    currency: String(input.currency || source.defaultCurrency || 'KRW').toUpperCase(),
    optionGroups: Array.isArray(input.optionGroups || input.options)
      ? structuredClone(input.optionGroups || input.options)
      : [],
    assets: input.assets && typeof input.assets === 'object' && !Array.isArray(input.assets)
      ? structuredClone(input.assets)
      : {
          imageUrls: Array.isArray(input.imageUrls) ? input.imageUrls.map(String) : [],
          driveFileIds: Array.isArray(input.driveFileIds) ? input.driveFileIds.map(String) : []
        },
    sourceModifiedAt: new Date().toISOString(),
    providerType: source.providerType,
    rawProduct: structuredClone(input)
  };
}

export class ManualUploadCatalogProvider {
  constructor({ source, persistence }) {
    if (!source || !persistence) throw new Error('ManualUploadCatalogProvider에는 source와 persistence가 필요합니다.');
    this.source = source;
    this.persistence = persistence;
  }

  async status() {
    const stored = await this.persistence.listSourceProducts({ sourceId: this.source.sourceId, limit: 1, offset: 0 });
    return {
      ready: true,
      providerType: 'manual_upload',
      sourceId: this.source.sourceId,
      totalProducts: stored.total,
      durable: Boolean((await this.persistence.status()).durable)
    };
  }

  async createProduct(input) {
    const normalized = normalizeManualInput(this.source, input);
    const stored = await this.persistence.upsertSourceProduct(normalized, { rawProduct: normalized.rawProduct });
    return stored;
  }

  async listChanges({ cursor = null, limit = 100 } = {}) {
    const offset = decodeCursor(cursor);
    const result = await this.persistence.listSourceProducts({
      sourceId: this.source.sourceId,
      limit: Math.min(500, Math.max(1, Number(limit || 100))),
      offset
    });
    const nextOffset = offset + result.items.length;
    return {
      cursor: cursor || null,
      nextCursor: nextOffset < result.total ? `offset:${nextOffset}` : null,
      hasMore: nextOffset < result.total,
      totalAvailable: result.total,
      items: result.items.map(product => ({
        sourceId: product.sourceId,
        sourceProductId: product.sourceProductId,
        name: product.sourceProductName,
        categories: product.sourceCategoryPath,
        sourcePriceDisplay: product.supplyCost,
        optionCount: product.optionGroups.length,
        imageCount: Number(product.assets?.imageUrls?.length || product.assets?.driveFileIds?.length || 0),
        completed: true,
        sourceUrl: product.sourceUrl,
        sourceModifiedAt: product.sourceModifiedAt || product.updatedAt
      }))
    };
  }

  async getSourceProduct(sourceProductId) {
    const product = await this.persistence.getSourceProduct(this.source.sourceId, String(sourceProductId));
    if (!product) {
      throw new MultiSourceCatalogError('MANUAL_SOURCE_PRODUCT_NOT_FOUND', `수동 상품을 찾을 수 없습니다: ${sourceProductId}`, {
        status: 404,
        details: { sourceId: this.source.sourceId, sourceProductId: String(sourceProductId) }
      });
    }
    return product;
  }

  async hydrateAssets(sourceProductId) {
    const product = await this.getSourceProduct(sourceProductId);
    return {
      sourceId: this.source.sourceId,
      sourceProductId: product.sourceProductId,
      hydrated: false,
      reason: 'manual_assets_are_references',
      assets: product.assets
    };
  }

  async normalize(product) {
    if (product?.sourceId === this.source.sourceId && product?.sourceProductId) return structuredClone(product);
    return normalizeManualInput(this.source, product);
  }
}

export const _internal = { decodeCursor, normalizeManualInput };
