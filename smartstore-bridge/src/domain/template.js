import fs from 'node:fs';
import path from 'node:path';
import { clone } from '../utils/json.js';

function deleteKeys(target, keys) {
  if (!target || typeof target !== 'object') return;
  for (const key of keys) delete target[key];
}

export function templateFromChannelProductResponse(response, channelDefaults = {}) {
  if (!response?.originProduct || !response?.smartstoreChannelProduct) {
    throw new Error('채널 상품 조회 응답에 originProduct/smartstoreChannelProduct가 없습니다.');
  }
  const originProduct = clone(response.originProduct);
  const smartstoreChannelProduct = clone(response.smartstoreChannelProduct);

  // 상품마다 달라지는 값과 조회 전용 식별값을 제거합니다.
  deleteKeys(originProduct, [
    'originProductNo', 'name', 'leafCategoryId', 'images', 'detailContent',
    'salePrice', 'stockQuantity', 'regDate', 'modifiedDate'
  ]);
  if (originProduct.detailAttribute) {
    delete originProduct.detailAttribute.optionInfo;
    delete originProduct.detailAttribute.sellerCodeInfo;
    delete originProduct.detailAttribute.naverShoppingSearchInfo;
  }
  deleteKeys(smartstoreChannelProduct, [
    'channelProductNo', 'smartstoreChannelProductNo', 'originProductNo',
    'channelProductName', 'bbsSeq', 'regDate', 'modifiedDate'
  ]);

  return {
    originProduct,
    smartstoreChannelProduct: {
      ...smartstoreChannelProduct,
      ...channelDefaults
    }
  };
}

export function writeTemplate(template, outputPath) {
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return resolved;
}
