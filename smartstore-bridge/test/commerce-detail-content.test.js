import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DetailContentService } from '../src/application/commerce/detail-content-service.js';

function remote(detailContent) {
  return {
    originProduct: {
      originProductNo: 10,
      statusType: 'SALE',
      leafCategoryId: '50000000',
      name: '상품',
      detailContent,
      salePrice: 10000,
      stockQuantity: 10,
      detailAttribute: { naverShoppingSearchInfo: { catalogMatchingYn: true, matchedCatalogId: 3 } }
    },
    smartstoreChannelProduct: {
      channelProductNo: 20,
      naverShoppingRegistration: true,
      channelProductDisplayStatusType: 'ON'
    }
  };
}

test('detail content service backs up, updates, verifies and rolls back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-backup-'));
  let state = remote('<p>old</p>');
  const payloads = [];
  const service = new DetailContentService({
    backupDir: dir,
    productsApi: {
      async getChannelProduct() { return structuredClone(state); },
      async updateChannelProduct(_no, payload) {
        payloads.push(structuredClone(payload));
        state.originProduct.detailContent = payload.originProduct.detailContent;
        return { ok: true };
      }
    }
  });
  try {
    const preview = await service.previewChannelUpdate('20', '<p>new</p>');
    assert.equal(preview.changed, true);
    assert.equal(preview.payload.originProduct.originProductNo, undefined);
    assert.equal(preview.payload.smartstoreChannelProduct.channelProductNo, undefined);
    assert.equal(preview.payload.originProduct.detailAttribute.naverShoppingSearchInfo.matchedCatalogId, undefined);

    const updated = await service.updateChannelDetail('20', '<p>new</p>');
    assert.equal(updated.status, 'updated');
    assert.equal(state.originProduct.detailContent, '<p>new</p>');
    assert.ok(fs.existsSync(path.join(dir, `${updated.backupId}.json`)));

    const rolledBack = await service.rollbackChannelDetail(updated.backupId);
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(state.originProduct.detailContent, '<p>old</p>');
    assert.equal(payloads.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
