import { ChannelImportError } from './errors.js';
import { normalizeChannelProductDraft, normalizeExactIdentifier } from './normalization.js';

const SEARCH_OPERATION_ID = 'post_v1_products_search';
const DETAIL_OPERATION_ID = 'get_v2_products_channel_products_by_channel_product_no';

function asPositiveInteger(value, fallback, max = 500) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function asText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unwrap(result) {
  if (result && typeof result === 'object' && Object.hasOwn(result, 'data')) return result.data;
  return result;
}

function operationsFromGateway(gateway) {
  if (Array.isArray(gateway?.manifest?.operations)) return gateway.manifest.operations;
  if (Array.isArray(gateway?.registry?.manifest?.operations)) return gateway.registry.manifest.operations;
  if (Array.isArray(gateway?.registry?.operations)) return gateway.registry.operations;
  return [];
}

function assertPinnedReadOperation(gateway, operationId) {
  const operation = operationsFromGateway(gateway)
    .find(item => item.operationId === operationId);
  if (!operation) {
    throw new ChannelImportError(
      'NAVER_IMPORT_OPERATION_MISSING',
      `네이버 가져오기에 필요한 operation이 없습니다: ${operationId}`,
      { status: 503, details: { operationId } }
    );
  }
  if (operation.readOnly !== true || operation.sideEffect === true) {
    throw new ChannelImportError(
      'NAVER_IMPORT_OPERATION_NOT_READ_ONLY',
      `네이버 가져오기 operation은 readOnly여야 합니다: ${operationId}`,
      { status: 503, details: { operationId, readOnly: operation.readOnly, sideEffect: operation.sideEffect } }
    );
  }
  return operation;
}

function searchContents(payload) {
  const value = unwrap(payload) || {};
  for (const candidate of [value.contents, value.content, value.products, value.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function flattenSearchRows(payload) {
  const rows = [];
  for (const parent of searchContents(payload)) {
    const channelProducts = asArray(
      parent?.channelProducts ?? parent?.channel_products ?? parent?.channels
    );
    if (channelProducts.length) {
      for (const channelProduct of channelProducts) rows.push({ parent, channelProduct });
      continue;
    }
    if (parent?.channelProductNo ?? parent?.channel_product_no ?? parent?.productNo) {
      rows.push({ parent, channelProduct: parent });
    }
  }
  return rows;
}

function pageMeta(payload, requestedPage, pageSize) {
  const value = unwrap(payload) || {};
  const total = Number(
    value.totalElements ?? value.total_elements ?? value.totalCount ?? value.total_count ?? value.total ?? 0
  );
  const totalPagesRaw = Number(value.totalPages ?? value.total_pages ?? 0);
  const totalPages = Number.isFinite(totalPagesRaw) && totalPagesRaw > 0
    ? totalPagesRaw
    : (total > 0 ? Math.ceil(total / pageSize) : 0);
  const responsePage = Number(value.page ?? value.pageNumber ?? value.page_number ?? requestedPage);
  const currentPage = Number.isFinite(responsePage) && responsePage > 0 ? responsePage : requestedPage;
  const last = typeof value.last === 'boolean' ? value.last : null;
  return { total, totalPages, currentPage, last };
}

function channelProductNo(row) {
  return asText(
    row?.channelProduct?.channelProductNo
      ?? row?.channelProduct?.channel_product_no
      ?? row?.channelProduct?.productNo
      ?? row?.parent?.channelProductNo
  );
}

function originProductNo(row, detailData) {
  const origin = detailData?.originProduct ?? detailData?.origin_product ?? {};
  const channel = detailData?.smartstoreChannelProduct
    ?? detailData?.smartStoreChannelProduct
    ?? detailData?.channelProduct
    ?? detailData?.channel_product
    ?? {};
  return asText(
    channel.originProductNo
      ?? origin.originProductNo
      ?? row?.channelProduct?.originProductNo
      ?? row?.parent?.originProductNo
  );
}

function optionArrays(detailData) {
  const origin = detailData?.originProduct ?? detailData?.origin_product ?? detailData?.product ?? {};
  const channel = detailData?.smartstoreChannelProduct
    ?? detailData?.smartStoreChannelProduct
    ?? detailData?.channelProduct
    ?? detailData?.channel_product
    ?? {};
  const optionInfo = origin?.detailAttribute?.optionInfo
    ?? origin?.detail_attribute?.option_info
    ?? origin?.optionInfo
    ?? origin?.option_info
    ?? {};
  return [
    optionInfo.optionCombinations,
    optionInfo.option_combinations,
    optionInfo.simpleOptions,
    optionInfo.simple_options,
    origin.variants,
    origin.options,
    channel.variants,
    channel.options,
    detailData?.variants,
    detailData?.options
  ].filter(Array.isArray);
}

function variantSku(value) {
  return asText(
    value?.sellerManagerCode
      ?? value?.sellerManagementCode
      ?? value?.seller_manager_code
      ?? value?.seller_management_code
      ?? value?.manageCode
      ?? value?.manage_code
      ?? value?.sku
      ?? value?.optionCode
      ?? value?.option_code
  );
}

function variantReference(value, index) {
  return asText(
    value?.id
      ?? value?.optionId
      ?? value?.option_id
      ?? value?.combinationId
      ?? value?.combination_id
      ?? index
  ) ?? String(index);
}

function extractVariants(detailData) {
  const variants = [];
  const seen = new Set();
  let index = 0;
  for (const collection of optionArrays(detailData)) {
    for (const rawVariant of collection) {
      const reference = variantReference(rawVariant, index++);
      const sku = variantSku(rawVariant);
      const key = `${reference}\u0000${sku ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({
        ...structuredClone(rawVariant),
        remoteVariantId: reference,
        variantReference: reference,
        sku
      });
    }
  }
  return variants;
}

function detailParts(detailData) {
  return {
    origin: detailData?.originProduct ?? detailData?.origin_product ?? detailData?.product ?? {},
    channel: detailData?.smartstoreChannelProduct
      ?? detailData?.smartStoreChannelProduct
      ?? detailData?.channelProduct
      ?? detailData?.channel_product
      ?? {}
  };
}

function firstValue(...values) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return null;
}

function toDraft(row, detailPayload) {
  const detailData = unwrap(detailPayload) || {};
  const { origin, channel } = detailParts(detailData);
  const remoteProductId = channelProductNo(row);
  if (!remoteProductId) {
    throw new ChannelImportError('NAVER_CHANNEL_PRODUCT_NO_MISSING', '검색 결과에 channelProductNo가 없습니다.', {
      details: { searchRow: row }
    });
  }
  const sellerManagementCode = firstValue(
    channel.sellerManagementCode,
    channel.seller_management_code,
    origin.sellerManagementCode,
    origin.seller_management_code,
    row?.channelProduct?.sellerManagementCode,
    row?.channelProduct?.seller_management_code,
    row?.parent?.sellerManagementCode
  );
  const originNo = originProductNo(row, detailData);
  const productName = firstValue(
    channel.channelProductName,
    channel.channel_product_name,
    channel.name,
    origin.name,
    origin.productName,
    row?.channelProduct?.channelProductName,
    row?.channelProduct?.name,
    row?.parent?.name,
    `네이버 상품 ${remoteProductId}`
  );
  const channelStatus = firstValue(
    channel.channelProductDisplayStatusType,
    channel.channel_product_display_status_type,
    channel.channelProductStatusType,
    channel.statusType,
    origin.statusType,
    row?.channelProduct?.statusType
  );
  const channelUrl = firstValue(
    channel.channelProductUrl,
    channel.channel_product_url,
    channel.productUrl,
    row?.channelProduct?.channelProductUrl,
    row?.channelProduct?.productUrl
  );
  const sourceModifiedAt = firstValue(
    channel.modifiedDate,
    channel.modifiedAt,
    channel.lastModifiedDate,
    origin.modifiedDate,
    origin.modifiedAt,
    row?.channelProduct?.modifiedDate,
    row?.parent?.modifiedDate
  );
  const variants = extractVariants(detailData);
  const identifiers = [];
  if (sellerManagementCode) {
    identifiers.push({
      type: 'seller_management_code',
      value: sellerManagementCode,
      normalizedValue: normalizeExactIdentifier(sellerManagementCode),
      scope: 'product',
      variantReference: '',
      eligibleForExactMatch: true
    });
  }
  if (originNo) {
    identifiers.push({
      type: 'origin_product_no',
      value: originNo,
      normalizedValue: normalizeExactIdentifier(originNo),
      scope: 'product',
      variantReference: '',
      eligibleForExactMatch: false
    });
  }
  identifiers.push({
    type: 'channel_product_no',
    value: remoteProductId,
    normalizedValue: normalizeExactIdentifier(remoteProductId),
    scope: 'product',
    variantReference: '',
    eligibleForExactMatch: false
  });
  for (const variant of variants) {
    if (!variant.sku) continue;
    identifiers.push({
      type: 'variant_sku',
      value: variant.sku,
      normalizedValue: normalizeExactIdentifier(variant.sku),
      scope: 'variant',
      variantReference: variant.variantReference,
      eligibleForExactMatch: true
    });
  }

  return normalizeChannelProductDraft({
    channelId: 'haar_naver_smartstore',
    remoteProductId,
    originProductNo: originNo,
    sellerManagementCode,
    productName,
    channelStatus,
    channelUrl,
    sourceModifiedAt,
    identifiers,
    variants,
    raw: {
      search: structuredClone({ parent: row.parent, channelProduct: row.channelProduct }),
      detail: structuredClone(detailData)
    }
  });
}

export class NaverChannelProductImporter {
  constructor({ commerceGateway, pageSize = 100, searchBody = {} } = {}) {
    if (!commerceGateway || typeof commerceGateway.execute !== 'function') {
      throw new ChannelImportError('NAVER_IMPORT_GATEWAY_REQUIRED', 'CommerceOperationGateway가 필요합니다.');
    }
    assertPinnedReadOperation(commerceGateway, SEARCH_OPERATION_ID);
    assertPinnedReadOperation(commerceGateway, DETAIL_OPERATION_ID);
    this.commerceGateway = commerceGateway;
    this.pageSize = asPositiveInteger(pageSize, 100, 500);
    this.searchBody = searchBody && typeof searchBody === 'object' && !Array.isArray(searchBody)
      ? structuredClone(searchBody)
      : {};
  }

  async searchPage(page, size = this.pageSize) {
    const result = await this.commerceGateway.execute(SEARCH_OPERATION_ID, {
      body: {
        ...structuredClone(this.searchBody),
        page,
        size,
        orderType: this.searchBody.orderType || 'NO'
      }
    });
    return unwrap(result);
  }

  async preview() {
    const payload = await this.searchPage(1, 1);
    const meta = pageMeta(payload, 1, this.pageSize);
    return {
      remoteCount: meta.total,
      totalPages: meta.total > 0 ? Math.ceil(meta.total / this.pageSize) : meta.totalPages,
      pageSize: this.pageSize
    };
  }

  async *iterate({ checkpoint = null } = {}) {
    let page = asPositiveInteger(checkpoint?.page, 1, Number.MAX_SAFE_INTEGER);
    while (true) {
      const searchPayload = await this.searchPage(page, this.pageSize);
      const rows = flattenSearchRows(searchPayload);
      const meta = pageMeta(searchPayload, page, this.pageSize);
      const items = [];
      for (const row of rows) {
        const remoteProductId = channelProductNo(row);
        if (!remoteProductId) {
          throw new ChannelImportError('NAVER_CHANNEL_PRODUCT_NO_MISSING', '검색 결과에 channelProductNo가 없습니다.');
        }
        const detailResult = await this.commerceGateway.execute(DETAIL_OPERATION_ID, {
          pathParams: { channelProductNo: remoteProductId }
        });
        items.push(toDraft(row, unwrap(detailResult)));
      }

      const inferredMore = meta.totalPages > 0
        ? page < meta.totalPages
        : rows.length >= this.pageSize;
      const hasMore = meta.last === true ? false : (meta.last === false ? true : inferredMore);
      yield {
        page,
        pageSize: this.pageSize,
        remoteCount: meta.total,
        totalPages: meta.totalPages,
        hasMore,
        nextCheckpoint: hasMore ? { page: page + 1 } : null,
        items
      };
      if (!hasMore || rows.length === 0) break;
      page += 1;
    }
  }
}

export const _internal = {
  SEARCH_OPERATION_ID,
  DETAIL_OPERATION_ID,
  assertPinnedReadOperation,
  flattenSearchRows,
  pageMeta,
  extractVariants,
  toDraft
};
