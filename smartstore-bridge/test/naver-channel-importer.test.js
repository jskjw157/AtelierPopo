import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NaverChannelProductImporter } from '../src/catalog/channel-import/naver-importer.js';

const search = JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/naver-search-page.json', import.meta.url
), 'utf8'));
const detail = JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/naver-product-detail.json', import.meta.url
), 'utf8'));

function gateway(calls, { searchData = search.data, detailData = detail.data, detailReadOnly = true } = {}) {
  return {
    manifest: {
      operations: [
        { operationId: 'post_v1_products_search', readOnly: true, sideEffect: false },
        {
          operationId: 'get_v2_products_channel_products_by_channel_product_no',
          readOnly: detailReadOnly,
          sideEffect: !detailReadOnly
        }
      ]
    },
    async execute(id, input) {
      calls.push({ id, input: structuredClone(input) });
      if (id === 'post_v1_products_search') return { data: structuredClone(searchData) };
      if (id === 'get_v2_products_channel_products_by_channel_product_no') {
        return { data: structuredClone(detailData) };
      }
      throw new Error(`unexpected ${id}`);
    }
  };
}

test('emits seller and variant codes using only pinned read operations', async () => {
  const calls = [];
  const importer = new NaverChannelProductImporter({
    commerceGateway: gateway(calls),
    pageSize: 100
  });
  assert.deepEqual(await importer.preview(), {
    remoteCount: 1,
    totalPages: 1,
    pageSize: 100
  });

  const pages = [];
  for await (const page of importer.iterate()) pages.push(page);
  assert.equal(pages.length, 1);
  const item = pages[0].items[0];
  assert.equal(item.channelId, 'haar_naver_smartstore');
  assert.equal(item.remoteProductId, '13732645378');
  assert.equal(item.originProductNo, '9876543210');
  assert.equal(item.channelProductKey, 'haar_naver_smartstore:13732645378');
  assert.equal(item.identifiers.find(x => x.type === 'seller_management_code').normalizedValue, 'HAAR-EAR-0012');
  assert.deepEqual(
    item.identifiers.filter(x => x.type === 'variant_sku').map(x => x.normalizedValue).sort(),
    ['HAAR-EAR-0012-G', 'HAAR-EAR-0012-S']
  );
  assert.equal(item.identifiers.some(x => x.type === 'variant_sku_set'), true);
  assert.equal(item.raw.search.channelProduct.channelProductNo, 13732645378);
  assert.equal(item.raw.detail.smartstoreChannelProduct.channelProductNo, 13732645378);

  assert.deepEqual([...new Set(calls.map(x => x.id))].sort(), [
    'get_v2_products_channel_products_by_channel_product_no',
    'post_v1_products_search'
  ]);
  assert.equal(calls.some(call => Object.hasOwn(call.input, 'confirmation')), false);
  assert.equal(calls.some(call => Object.hasOwn(call.input, 'secondConfirmation')), false);
  assert.equal(calls.some(call => Object.hasOwn(call.input, 'executionContext')), false);
});

test('resumes from the one-based page checkpoint', async () => {
  const calls = [];
  const pageTwo = structuredClone(search.data);
  pageTwo.page = 2;
  pageTwo.totalPages = 2;
  pageTwo.last = true;
  const importer = new NaverChannelProductImporter({
    commerceGateway: gateway(calls, { searchData: pageTwo }),
    pageSize: 50
  });
  const pages = [];
  for await (const page of importer.iterate({ checkpoint: { page: 2 } })) pages.push(page);
  assert.equal(pages[0].page, 2);
  const searchCall = calls.find(call => call.id === 'post_v1_products_search');
  assert.equal(searchCall.input.body.page, 2);
  assert.equal(searchCall.input.body.size, 50);
  assert.equal(pages[0].nextCheckpoint, null);
});

test('constructor rejects a missing or writable pinned operation', () => {
  assert.throws(
    () => new NaverChannelProductImporter({ commerceGateway: gateway([], { detailReadOnly: false }) }),
    error => error.code === 'NAVER_IMPORT_OPERATION_NOT_READ_ONLY'
  );
  assert.throws(
    () => new NaverChannelProductImporter({
      commerceGateway: { manifest: { operations: [] }, async execute() {} }
    }),
    error => error.code === 'NAVER_IMPORT_OPERATION_MISSING'
  );
});
