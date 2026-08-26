import { MultiSourceCatalogError } from './errors.js';

function firstCategory(sourceProduct) {
  return Array.isArray(sourceProduct?.sourceCategoryPath) && sourceProduct.sourceCategoryPath.length
    ? String(sourceProduct.sourceCategoryPath[0])
    : null;
}

export class HaarProductService {
  constructor({ registry, persistence }) {
    if (!registry || !persistence) throw new Error('HaarProductService에는 registry와 persistence가 필요합니다.');
    this.registry = registry;
    this.persistence = persistence;
  }

  async createProduct(input = {}) {
    return this.persistence.createHaarProduct(input);
  }

  async listProducts(filters = {}) {
    return this.persistence.listHaarProducts(filters);
  }

  async getProduct(haarProductId, { includeSourceLinks = true } = {}) {
    const product = await this.persistence.getHaarProduct(String(haarProductId));
    if (!product) throw new MultiSourceCatalogError('HAAR_PRODUCT_NOT_FOUND', 'HAAR 상품을 찾을 수 없습니다.', { status: 404 });
    const sourceLinks = includeSourceLinks ? await this.persistence.listSourceLinks(product.haarProductId) : undefined;
    return { product, ...(includeSourceLinks ? { sourceLinks } : {}) };
  }

  async ensureSourceProduct(sourceId, sourceProductId, { force = false } = {}) {
    const persisted = await this.persistence.getSourceProduct(sourceId, sourceProductId);
    if (persisted && !force) return persisted;
    const fetched = await this.registry.getSourceProduct(sourceId, sourceProductId, {
      includeRaw: true,
      force: Boolean(force)
    });
    const stored = await this.persistence.upsertSourceProduct(fetched.sourceProduct, {
      rawProduct: fetched.rawProduct || fetched.sourceProduct
    });
    return stored.product;
  }

  async createFromSource({
    sourceId,
    sourceProductId,
    internalSku = null,
    productName = null,
    brandName = 'HAAR',
    productCategory = null,
    productType = null,
    status = 'draft',
    canonicalAttributes = {},
    canonicalContent = {},
    relationType = 'supplier_listing',
    priority = 100,
    isPrimary = true,
    verifiedBy = null,
    forceSourceRefresh = false
  } = {}) {
    const normalizedSourceId = String(sourceId || '').trim().toLowerCase();
    const normalizedSourceProductId = String(sourceProductId || '').trim();
    if (!normalizedSourceId || !normalizedSourceProductId) {
      throw new MultiSourceCatalogError('HAAR_SOURCE_PRODUCT_REQUIRED', 'sourceId와 sourceProductId가 필요합니다.');
    }
    const sourceProduct = await this.ensureSourceProduct(normalizedSourceId, normalizedSourceProductId, {
      force: Boolean(forceSourceRefresh)
    });
    const product = await this.persistence.createHaarProduct({
      internalSku,
      productName: String(productName || sourceProduct.sourceProductName || '').trim(),
      brandName,
      productCategory: productCategory || firstCategory(sourceProduct),
      productType,
      status,
      canonicalAttributes: {
        sourceStatus: sourceProduct.sourceStatus,
        sourceCategoryPath: sourceProduct.sourceCategoryPath,
        optionGroups: sourceProduct.optionGroups,
        ...canonicalAttributes
      },
      canonicalContent: {
        sourceUrl: sourceProduct.sourceUrl,
        assets: sourceProduct.assets,
        ...canonicalContent
      }
    });
    const sourceLink = await this.persistence.linkSourceProduct({
      haarProductId: product.haarProductId,
      sourceId: normalizedSourceId,
      sourceProductId: normalizedSourceProductId,
      relationType,
      priority,
      isPrimary,
      verifiedBy,
      metadata: { createdFromSource: true }
    });
    return { product, sourceLink, sourceProduct };
  }

  async linkSourceProduct(haarProductId, input = {}) {
    const normalizedId = String(haarProductId || '').trim();
    if (!normalizedId) throw new MultiSourceCatalogError('HAAR_PRODUCT_ID_REQUIRED', 'haarProductId가 필요합니다.');
    const sourceId = String(input.sourceId || '').trim().toLowerCase();
    const sourceProductId = String(input.sourceProductId || '').trim();
    if (!sourceId || !sourceProductId) {
      throw new MultiSourceCatalogError('HAAR_SOURCE_PRODUCT_REQUIRED', 'sourceId와 sourceProductId가 필요합니다.');
    }
    await this.ensureSourceProduct(sourceId, sourceProductId, { force: Boolean(input.forceSourceRefresh) });
    return this.persistence.linkSourceProduct({
      haarProductId: normalizedId,
      sourceId,
      sourceProductId,
      relationType: input.relationType || 'manual_link',
      priority: input.priority || 100,
      isPrimary: Boolean(input.isPrimary),
      verifiedBy: input.verifiedBy || null,
      metadata: input.metadata || {}
    });
  }
}
