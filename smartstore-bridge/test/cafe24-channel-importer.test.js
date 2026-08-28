import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Cafe24ChannelProductImporter } from '../src/catalog/channel-import/cafe24-importer.js';

const products = JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/cafe24-products-page.json', import.meta.url
), 'utf8'));
const variants = JSON.parse(fs.readFileSync(new URL(
  './fixtures/channel-import/cafe24-variants-page.json', import.meta.url
), 'utf8'));

function client(calls, { count = 1 } = {}) {
  return {
    async get(path, options = {}) {
      calls.push({ path, options: structuredClone(options) });
      if (path === '/admin/products/count') return { data: { count }, meta: {} };
      if (path === '/admin/products') return { data: structuredClone(products.data), meta: {} };
      if (path === '/admin/products/421/variants') {
        return { data: structuredClone(variants.data), meta: {} };
      }
      throw new Error(`unexpected ${path}`);
    }
  };
}

test('uses GET endpoints and exact-enables custom codes only', async () => {
  const calls = [];
  const importer = new Cafe24ChannelProductImporter({
    client: client(calls),
    shopNo: 1,
    pageSize: 100
  });
  assert.deepEqual(await importer.preview(), { remoteCount: 1, pageSize: 100 });
  const pages = [];
  for await (const page of importer.iterate()) pages.push(page);
  assert.equal(pages.length, 1);
  const item = pages[0].items[0];
  assert.equal(item.channelId, 'haar_own_mall');
  assert.equal(item.remoteProductId, '421');
  assert.equal(item.channelProductKey, 'haar_own_mall:421');
  assert.equal(item.productName, '925 실버 샘플 리본 귀걸이');
  assert.equal(item.channelStatus, 'SALE');
  assert.equal(item.identifiers.find(x => x.type === 'custom_product_code').eligibleForExactMatch, true);
  assert.equal(item.identifiers.find(x => x.type === 'product_code').eligibleForExactMatch, false);
  assert.equal(item.identifiers.find(x => x.type === 'custom_variant_code').eligibleForExactMatch, true);
  assert.equal(item.identifiers.find(x => x.type === 'variant_code').eligibleForExactMatch, false);
  assert.equal(item.identifiers.some(x => x.type === 'variant_sku_set'), true);
  assert.equal(item.identifiers.some(x => x.type.includes('name') || x.type.includes('price') || x.type.includes('image')), false);
  assert.deepEqual([...new Set(calls.map(call => call.path))].sort(), [
    '/admin/products',
    '/admin/products/421/variants',
    '/admin/products/count'
  ]);
  assert.equal(calls.every(call => call.options.query.shop_no === 1), true);
});

test('resumes from offset checkpoint and returns the next checkpoint deterministically', async () => {
  const calls = [];
  const importer = new Cafe24ChannelProductImporter({
    client: client(calls, { count: 101 }),
    shopNo: 1,
    pageSize: 100
  });
  const pages = [];
  for await (const page of importer.iterate({ checkpoint: { offset: 100 } })) pages.push(page);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].offset, 100);
  assert.equal(pages[0].nextCheckpoint, null);
  const listCall = calls.find(call => call.path === '/admin/products');
  assert.equal(listCall.options.query.offset, 100);
  assert.equal(listCall.options.query.limit, 100);
});

test('standard Cafe24 variant codes cannot create an exact variant set', async () => {
  const calls = [];
  const variantData = structuredClone(variants.data);
  for (const variant of variantData.variants) delete variant.custom_variant_code;
  const customClient = {
    async get(path, options = {}) {
      calls.push({ path, options });
      if (path === '/admin/products/count') return { data: { count: 1 }, meta: {} };
      if (path === '/admin/products') return { data: structuredClone(products.data), meta: {} };
      if (path === '/admin/products/421/variants') return { data: variantData, meta: {} };
      throw new Error(`unexpected ${path}`);
    }
  };
  const importer = new Cafe24ChannelProductImporter({ client: customClient });
  const iterator = importer.iterate();
  const page = (await iterator.next()).value;
  const item = page.items[0];
  assert.equal(item.identifiers.some(x => x.type === 'variant_sku_set'), false);
  assert.equal(item.identifiers.filter(x => x.type === 'variant_code').every(x => x.eligibleForExactMatch === false), true);
});
