import { sha256Json } from './canonical-json.js';
import { ChannelImportError } from './errors.js';

function asText(value) {
  return String(value ?? '');
}

function normalizeChannelId(value) {
  const normalized = asText(value).trim().toLowerCase();
  if (!normalized) {
    throw new ChannelImportError('CHANNEL_ID_REQUIRED', 'channelId가 필요합니다.');
  }
  return normalized;
}

function normalizeRemoteProductId(value) {
  const normalized = asText(value).trim();
  if (!normalized) {
    throw new ChannelImportError('REMOTE_PRODUCT_ID_REQUIRED', 'remoteProductId가 필요합니다.');
  }
  return normalized;
}

export function normalizeExactIdentifier(value) {
  const normalized = asText(value)
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '-');
  return normalized || null;
}

function variantCode(variant) {
  if (variant && typeof variant === 'object') {
    return variant.normalizedSku ?? variant.sku ?? variant.variantSku ?? variant.code ?? variant.value;
  }
  return variant;
}

export function normalizeVariantSkuSet(variants) {
  const normalized = (Array.isArray(variants) ? variants : [])
    .map(variantCode)
    .map(normalizeExactIdentifier)
    .filter(Boolean);
  if (!normalized.length) return null;
  if (new Set(normalized).size !== normalized.length) return null;
  normalized.sort();
  return sha256Json(normalized);
}

function normalizeIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'object') return null;
  const value = identifier.value ?? identifier.identifierValue ?? identifier.normalizedValue;
  const normalizedValue = normalizeExactIdentifier(identifier.normalizedValue ?? value);
  if (!normalizedValue) return null;
  const type = asText(identifier.type ?? identifier.identifierType).trim().toLowerCase();
  if (!type) return null;
  const scope = asText(identifier.scope || 'product').trim().toLowerCase();
  if (!['product', 'variant'].includes(scope)) {
    throw new ChannelImportError('CHANNEL_IDENTIFIER_SCOPE_INVALID', 'identifier scope는 product 또는 variant여야 합니다.', {
      details: { scope }
    });
  }
  return {
    type,
    value: asText(value),
    normalizedValue,
    scope,
    variantReference: asText(identifier.variantReference).trim(),
    eligibleForExactMatch: identifier.eligibleForExactMatch !== false
  };
}

export function normalizeChannelProductDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ChannelImportError('CHANNEL_PRODUCT_DRAFT_INVALID', '채널 상품 입력은 객체여야 합니다.');
  }
  const channelId = normalizeChannelId(input.channelId);
  const remoteProductId = normalizeRemoteProductId(input.remoteProductId);
  const productName = asText(input.productName).trim();
  if (!productName) {
    throw new ChannelImportError('CHANNEL_PRODUCT_NAME_REQUIRED', 'productName이 필요합니다.');
  }

  const variants = (Array.isArray(input.variants) ? input.variants : []).map((variant, index) => {
    const raw = variant && typeof variant === 'object' ? structuredClone(variant) : { value: variant };
    const normalizedSku = normalizeExactIdentifier(variantCode(raw));
    return {
      ...raw,
      variantReference: asText(raw.variantReference ?? raw.remoteVariantId ?? raw.id ?? index).trim(),
      normalizedSku
    };
  });

  const identifiers = [];
  const identifierKeys = new Set();
  for (const candidate of Array.isArray(input.identifiers) ? input.identifiers : []) {
    const identifier = normalizeIdentifier(candidate);
    if (!identifier) continue;
    const key = [identifier.type, identifier.normalizedValue, identifier.scope, identifier.variantReference].join('\u0000');
    if (identifierKeys.has(key)) continue;
    identifierKeys.add(key);
    identifiers.push(identifier);
  }

  const completeVariantSet = variants.length > 0 && variants.every(variant => variant.normalizedSku);
  const variantSkuSetHash = completeVariantSet ? normalizeVariantSkuSet(variants) : null;
  if (variantSkuSetHash) {
    identifiers.push({
      type: 'variant_sku_set',
      value: variantSkuSetHash,
      normalizedValue: variantSkuSetHash,
      scope: 'product',
      variantReference: '',
      eligibleForExactMatch: true
    });
  }

  const normalized = {
    channelId,
    remoteProductId,
    productName,
    originProductNo: input.originProductNo == null ? null : asText(input.originProductNo).trim(),
    sellerManagementCode: input.sellerManagementCode == null ? null : asText(input.sellerManagementCode).trim(),
    channelStatus: input.channelStatus == null ? null : asText(input.channelStatus).trim(),
    channelUrl: input.channelUrl == null ? null : asText(input.channelUrl).trim(),
    sourceModifiedAt: input.sourceModifiedAt == null ? null : asText(input.sourceModifiedAt).trim(),
    identifiers,
    variants,
    variantSkuSetHash
  };

  return {
    ...structuredClone(input),
    channelId,
    remoteProductId,
    channelProductKey: `${channelId}:${remoteProductId}`,
    productName,
    identifiers,
    variants,
    variantSkuSetHash,
    raw: structuredClone(input.raw ?? input),
    normalized
  };
}

export const _internal = {
  normalizeChannelId,
  normalizeRemoteProductId,
  normalizeIdentifier,
  variantCode
};
