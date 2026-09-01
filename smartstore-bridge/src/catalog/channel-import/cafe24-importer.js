import { ChannelImportError } from './errors.js';
import { normalizeChannelProductDraft, normalizeExactIdentifier } from './normalization.js';

function asPositiveInteger(value, fallback, max = 1000) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function asNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function asText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function unwrap(result) {
  if (result && typeof result === 'object' && Object.hasOwn(result, 'data')) return result.data;
  return result;
}

function payloadArray(payload, key) {
  const value = unwrap(payload) || {};
  if (Array.isArray(value[key])) return value[key];
  if (Array.isArray(value.data?.[key])) return value.data[key];
  return [];
}

function payloadCount(payload, fallback = 0) {
  const value = unwrap(payload) || {};
  const candidate = value.count ?? value.total_count ?? value.totalCount
    ?? value.data?.count ?? value.data?.total_count ?? value.data?.totalCount;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function truthyFlag(value) {
  if (typeof value === 'boolean') return value;
  return ['T', 'TRUE', 'Y', 'YES', 'ON', '1'].includes(String(value ?? '').trim().toUpperCase());
}

function cafe24Status(product) {
  const displayed = truthyFlag(product?.display ?? product?.displayed ?? product?.is_display);
  const selling = truthyFlag(product?.selling ?? product?.selling_status ?? product?.is_selling);
  if (displayed && selling) return 'SALE';
  if (displayed) return 'DISPLAY_ONLY';
  return 'STOPPED';
}

function productNumber(product) {
  return asText(product?.product_no ?? product?.productNo ?? product?.id);
}

function productName(product, remoteProductId) {
  return asText(product?.product_name ?? product?.productName ?? product?.name)
    ?? `Cafe24 상품 ${remoteProductId}`;
}

function productUrl(product) {
  return asText(
    product?.product_detail_url
      ?? product?.productDetailUrl
      ?? product?.detail_url
      ?? product?.mobile_product_detail_url
  );
}

function sourceModifiedAt(product) {
  return asText(
    product?.updated_date
      ?? product?.updatedDate
      ?? product?.modified_date
      ?? product?.modifiedDate
      ?? product?.created_date
  );
}

function customProductCode(product) {
  return asText(product?.custom_product_code ?? product?.customProductCode);
}

function standardProductCode(product) {
  return asText(product?.product_code ?? product?.productCode);
}

function variantReference(variant, index) {
  return asText(
    variant?.variant_code
      ?? variant?.variantCode
      ?? variant?.item_code
      ?? variant?.itemCode
      ?? variant?.id
      ?? index
  ) ?? String(index);
}

function customVariantCode(variant) {
  return asText(
    variant?.custom_variant_code
      ?? variant?.customVariantCode
      ?? variant?.custom_item_code
      ?? variant?.customItemCode
  );
}

function standardVariantCode(variant) {
  return asText(
    variant?.variant_code
      ?? variant?.variantCode
      ?? variant?.item_code
      ?? variant?.itemCode
  );
}

function toDraft(product, variants) {
  const remoteProductId = productNumber(product);
  if (!remoteProductId) {
    throw new ChannelImportError('CAFE24_PRODUCT_NO_MISSING', 'Cafe24 상품에 product_no가 없습니다.', {
      details: { product }
    });
  }
  const customCode = customProductCode(product);
  const standardCode = standardProductCode(product);
  const identifiers = [];
  if (customCode) {
    identifiers.push({
      type: 'custom_product_code',
      value: customCode,
      normalizedValue: normalizeExactIdentifier(customCode),
      scope: 'product',
      variantReference: '',
      eligibleForExactMatch: true
    });
  }
  if (standardCode) {
    identifiers.push({
      type: 'product_code',
      value: standardCode,
      normalizedValue: normalizeExactIdentifier(standardCode),
      scope: 'product',
      variantReference: '',
      eligibleForExactMatch: false
    });
  }

  const normalizedVariants = variants.map((variant, index) => {
    const reference = variantReference(variant, index);
    const exactCode = customVariantCode(variant);
    const remoteCode = standardVariantCode(variant);
    if (exactCode) {
      identifiers.push({
        type: 'custom_variant_code',
        value: exactCode,
        normalizedValue: normalizeExactIdentifier(exactCode),
        scope: 'variant',
        variantReference: reference,
        eligibleForExactMatch: true
      });
    }
    if (remoteCode) {
      identifiers.push({
        type: 'variant_code',
        value: remoteCode,
        normalizedValue: normalizeExactIdentifier(remoteCode),
        scope: 'variant',
        variantReference: reference,
        eligibleForExactMatch: false
      });
    }
    return {
      ...structuredClone(variant),
      remoteVariantId: reference,
      variantReference: reference,
      // Only custom_variant_code is an exact cross-channel SKU. Standard
      // Cafe24 variant_code stays stored but must not create a variant-set key.
      sku: exactCode
    };
  });

  return normalizeChannelProductDraft({
    channelId: 'haar_own_mall',
    remoteProductId,
    productName: productName(product, remoteProductId),
    channelStatus: cafe24Status(product),
    channelUrl: productUrl(product),
    sourceModifiedAt: sourceModifiedAt(product),
    sellerManagementCode: customCode,
    identifiers,
    variants: normalizedVariants,
    raw: {
      product: structuredClone(product),
      variants: structuredClone(variants)
    }
  });
}

export class Cafe24ChannelProductImporter {
  constructor({ client, shopNo = 1, pageSize = 100, variantPageSize = 100 } = {}) {
    if (!client || typeof client.get !== 'function') {
      throw new ChannelImportError('CAFE24_IMPORT_CLIENT_REQUIRED', 'GET 전용 Cafe24AdminClient가 필요합니다.');
    }
    this.client = client;
    this.shopNo = asPositiveInteger(shopNo, 1, Number.MAX_SAFE_INTEGER);
    this.pageSize = asPositiveInteger(pageSize, 100, 100);
    this.variantPageSize = asPositiveInteger(variantPageSize, 100, 100);
  }

  async remoteCount() {
    const result = await this.client.get('/admin/products/count', {
      query: { shop_no: this.shopNo }
    });
    return payloadCount(result, 0);
  }

  async preview() {
    return {
      remoteCount: await this.remoteCount(),
      pageSize: this.pageSize
    };
  }

  async loadVariants(remoteProductId) {
    const variants = [];
    let offset = 0;
    while (true) {
      const result = await this.client.get(`/admin/products/${encodeURIComponent(remoteProductId)}/variants`, {
        query: {
          shop_no: this.shopNo,
          limit: this.variantPageSize,
          offset
        }
      });
      const page = payloadArray(result, 'variants');
      variants.push(...page);
      const count = payloadCount(result, variants.length);
      const hasMore = page.length > 0 && (offset + page.length < count || page.length >= this.variantPageSize);
      if (!hasMore) break;
      offset += page.length;
    }
    return variants;
  }

  async *iterate({ checkpoint = null } = {}) {
    const remoteCount = await this.remoteCount();
    let offset = asNonNegativeInteger(checkpoint?.offset, 0);
    while (true) {
      const result = await this.client.get('/admin/products', {
        query: {
          shop_no: this.shopNo,
          limit: this.pageSize,
          offset
        }
      });
      const products = payloadArray(result, 'products');
      const items = [];
      for (const product of products) {
        const remoteProductId = productNumber(product);
        if (!remoteProductId) {
          throw new ChannelImportError('CAFE24_PRODUCT_NO_MISSING', 'Cafe24 상품에 product_no가 없습니다.');
        }
        const variants = await this.loadVariants(remoteProductId);
        items.push(toDraft(product, variants));
      }
      const nextOffset = offset + products.length;
      const hasMore = products.length > 0 && (nextOffset < remoteCount || products.length >= this.pageSize);
      yield {
        offset,
        pageSize: this.pageSize,
        remoteCount,
        hasMore,
        nextCheckpoint: hasMore ? { offset: nextOffset } : null,
        items
      };
      if (!hasMore || products.length === 0) break;
      offset = nextOffset;
    }
  }
}

export const _internal = {
  payloadArray,
  payloadCount,
  truthyFlag,
  cafe24Status,
  productNumber,
  customProductCode,
  standardProductCode,
  customVariantCode,
  standardVariantCode,
  toDraft
};
