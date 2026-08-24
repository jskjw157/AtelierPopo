import { clone } from '../utils/json.js';

const ORIGIN_RESPONSE_ONLY = new Set([
  'originProductNo', 'regDate', 'modifiedDate', 'createdDate', 'updatedDate',
  'reviewAmount', 'purchaseReviewInfo', 'channelProducts', 'representativeChannelProductNo'
]);
const CHANNEL_RESPONSE_ONLY = new Set([
  'channelProductNo', 'smartstoreChannelProductNo', 'originProductNo', 'regDate', 'modifiedDate',
  'createdDate', 'updatedDate', 'bbsSeq', 'storeId', 'channelNo', 'channelName'
]);
const WINDOW_RESPONSE_ONLY = new Set([
  'channelProductNo', 'windowChannelProductNo', 'originProductNo', 'regDate', 'modifiedDate'
]);

function deleteKeys(target, keys) {
  if (!target || typeof target !== 'object') return;
  for (const key of keys) delete target[key];
}

function cleanupNaverShoppingSearchInfo(info) {
  if (!info || typeof info !== 'object') return;
  // 조회 시 네이버가 계산해 내려주는 매칭 결과는 수정 요청에서 제외합니다.
  deleteKeys(info, [
    'matchedCatalogId', 'catalogMatchingYn', 'catalogMatchingType', 'catalogMatchResult',
    'brandName', 'manufacturerName', 'modelName', 'attributeValueNames'
  ]);
}

export function productUpdatePayloadFromChannelResponse(response) {
  if (!response?.originProduct || !response?.smartstoreChannelProduct) {
    throw new Error('채널 상품 조회 응답에 originProduct/smartstoreChannelProduct가 없습니다.');
  }
  const payload = {
    originProduct: clone(response.originProduct),
    smartstoreChannelProduct: clone(response.smartstoreChannelProduct)
  };
  if (Array.isArray(response.windowChannelProducts)) {
    payload.windowChannelProducts = clone(response.windowChannelProducts);
  }

  deleteKeys(payload.originProduct, ORIGIN_RESPONSE_ONLY);
  deleteKeys(payload.smartstoreChannelProduct, CHANNEL_RESPONSE_ONLY);
  for (const windowProduct of payload.windowChannelProducts || []) deleteKeys(windowProduct, WINDOW_RESPONSE_ONLY);
  cleanupNaverShoppingSearchInfo(payload.originProduct?.detailAttribute?.naverShoppingSearchInfo);
  return payload;
}

export function productUpdatePayloadFromOriginResponse(response) {
  if (!response?.originProduct) throw new Error('원상품 조회 응답에 originProduct가 없습니다.');
  const payload = { originProduct: clone(response.originProduct) };
  if (response.smartstoreChannelProduct) payload.smartstoreChannelProduct = clone(response.smartstoreChannelProduct);
  if (Array.isArray(response.windowChannelProducts)) payload.windowChannelProducts = clone(response.windowChannelProducts);
  deleteKeys(payload.originProduct, ORIGIN_RESPONSE_ONLY);
  if (payload.smartstoreChannelProduct) deleteKeys(payload.smartstoreChannelProduct, CHANNEL_RESPONSE_ONLY);
  for (const windowProduct of payload.windowChannelProducts || []) deleteKeys(windowProduct, WINDOW_RESPONSE_ONLY);
  cleanupNaverShoppingSearchInfo(payload.originProduct?.detailAttribute?.naverShoppingSearchInfo);
  return payload;
}
