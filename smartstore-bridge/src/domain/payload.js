import { clone, deepMerge, findSetupPlaceholders } from '../utils/json.js';

export function sellerManagementCode(config, productId) {
  const prefix = String(config.sellerCodePrefix || 'QUEEN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  return `${prefix}-${productId}`.slice(0, 100);
}

export function buildDetailContent(imageUrls, productName) {
  const escapedName = String(productName || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const images = imageUrls.map(url => `<p style="margin:0;text-align:center;"><img src="${url}" alt="${escapedName}" style="display:block;width:100%;max-width:860px;height:auto;margin:0 auto;" /></p>`).join('');
  return `<div style="width:100%;max-width:860px;margin:0 auto;">${images}</div>`;
}

export function buildProductPayload({
  template,
  config,
  product,
  categoryId,
  price,
  optionInfo,
  imageUrls
}) {
  const code = sellerManagementCode(config, product.product_id);
  const optionalUrls = imageUrls.optional.slice(0, Number(config.images?.maxOptionalImages ?? 9));
  const originOverlay = {
    statusType: 'SALE',
    saleType: 'NEW',
    leafCategoryId: String(categoryId),
    name: product.name,
    images: {
      representativeImage: { url: imageUrls.representative },
      optionalImages: optionalUrls.map(url => ({ url }))
    },
    detailContent: buildDetailContent(imageUrls.detail, product.name),
    salePrice: price.salePrice,
    stockQuantity: product.sold_out ? 0 : Number(config.defaultStockQuantity ?? 999),
    detailAttribute: {
      sellerCodeInfo: {
        sellerManagementCode: code
      },
      ...(optionInfo ? { optionInfo } : {})
    }
  };

  const smartstoreOverlay = {
    channelProductName: product.name,
    channelProductDisplayStatusType: config.channel?.channelProductDisplayStatusType || 'ON',
    naverShoppingRegistration: config.channel?.naverShoppingRegistration !== false,
    storeKeepExclusiveProduct: Boolean(config.channel?.storeKeepExclusiveProduct)
  };

  return deepMerge(template, {
    originProduct: originOverlay,
    smartstoreChannelProduct: smartstoreOverlay
  });
}

export function validateProductPayload(payload, { execute = false } = {}) {
  const errors = [];
  const origin = payload?.originProduct;
  if (!origin) errors.push('originProduct가 없습니다.');
  if (!payload?.smartstoreChannelProduct) errors.push('smartstoreChannelProduct가 없습니다.');
  if (!String(origin?.leafCategoryId || '').trim() || String(origin?.leafCategoryId).includes('REPLACE_WITH')) errors.push('유효한 leafCategoryId가 필요합니다.');
  const name = String(origin?.name || '').trim();
  if (!name) errors.push('상품명이 없습니다.');
  if (name.length > 100) errors.push(`상품명이 100자를 초과합니다: ${name.length}자`);
  if (!String(origin?.detailContent || '').trim()) errors.push('상품 상세 정보(detailContent)가 없습니다.');
  if (!Number.isInteger(origin?.salePrice) || origin.salePrice <= 0) errors.push('판매가는 1원 이상의 정수여야 합니다.');
  if (!Number.isInteger(origin?.stockQuantity) || origin.stockQuantity < 0) errors.push('재고 수량은 0 이상의 정수여야 합니다.');
  if (!origin?.images?.representativeImage?.url) errors.push('대표 이미지 URL이 없습니다.');
  if (!origin?.saleEndDate) errors.push('상품 등록에 필요한 saleEndDate가 없습니다. 기존 상품 템플릿을 추출하거나 직접 설정하세요.');
  if (!origin?.deliveryInfo) {
    errors.push('deliveryInfo가 없습니다.');
  } else {
    if (!origin.deliveryInfo.deliveryType) errors.push('deliveryInfo.deliveryType이 없습니다.');
    if (!origin.deliveryInfo.deliveryAttributeType) errors.push('deliveryInfo.deliveryAttributeType이 없습니다.');
    if (!origin.deliveryInfo.deliveryFee) errors.push('deliveryInfo.deliveryFee가 없습니다.');
  }
  const detailAttribute = origin?.detailAttribute;
  if (!detailAttribute) {
    errors.push('detailAttribute가 없습니다.');
  } else {
    if (!detailAttribute.afterServiceInfo?.afterServiceTelephoneNumber || !detailAttribute.afterServiceInfo?.afterServiceGuideContent) {
      errors.push('A/S 정보(afterServiceInfo)가 완성되지 않았습니다.');
    }
    if (!detailAttribute.originAreaInfo?.originAreaCode) errors.push('원산지 정보(originAreaInfo)가 없습니다.');
    if (typeof detailAttribute.minorPurchasable !== 'boolean') errors.push('minorPurchasable(boolean)이 없습니다.');
    const notice = detailAttribute.productInfoProvidedNotice;
    if (!notice?.productInfoProvidedNoticeType) {
      errors.push('상품정보제공고시(productInfoProvidedNotice)가 없습니다.');
    } else if (notice.productInfoProvidedNoticeType === 'FASHION_ITEMS' && !notice.fashionItems) {
      errors.push('FASHION_ITEMS 상품정보제공고시의 fashionItems 객체가 없습니다.');
    }
  }
  const channel = payload?.smartstoreChannelProduct;
  if (typeof channel?.naverShoppingRegistration !== 'boolean') errors.push('naverShoppingRegistration(boolean)이 없습니다.');
  if (!['ON', 'SUSPENSION'].includes(channel?.channelProductDisplayStatusType)) errors.push('채널 전시 상태는 ON 또는 SUSPENSION이어야 합니다.');
  const placeholders = findSetupPlaceholders(payload);
  if (placeholders.length) errors.push(`설정용 플레이스홀더가 남아 있습니다: ${placeholders.join(', ')}`);
  if (execute) {
    const urls = [origin?.images?.representativeImage?.url, ...(origin?.images?.optionalImages || []).map(item => item.url)];
    if (urls.some(url => String(url || '').startsWith('local://') || String(url || '').includes('__UPLOAD_REQUIRED__'))) {
      errors.push('실행 모드에는 네이버 이미지 업로드 후 반환된 URL만 사용할 수 있습니다.');
    }
  }
  return errors;
}

export function previewImageUrls(imagePlan) {
  const toLocal = file => `local://${encodeURI(file.path.replaceAll('\\', '/'))}`;
  return {
    representative: imagePlan.representative ? toLocal(imagePlan.representative) : '__UPLOAD_REQUIRED__',
    optional: imagePlan.detail.slice(1, 10).map(toLocal),
    detail: imagePlan.detail.map(toLocal)
  };
}

export function redactPayload(payload) {
  return clone(payload);
}
