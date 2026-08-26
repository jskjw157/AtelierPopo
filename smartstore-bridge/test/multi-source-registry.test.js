import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogSourceRegistry, SalesChannelRegistry } from '../src/catalog/multi-source/source-registry.js';

const sources = [
  {
    sourceId: 'supplier_a', sourceName: '공급처 A', sourceType: 'supplier', providerType: 'other',
    rootReference: null, credentialRef: null, defaultCurrency: 'KRW', status: 'active', canonical: false, metadata: {}
  },
  {
    sourceId: 'supplier_b', sourceName: '공급처 B', sourceType: 'supplier', providerType: 'other',
    rootReference: null, credentialRef: null, defaultCurrency: 'KRW', status: 'active', canonical: false, metadata: {}
  }
];

function provider(sourceId) {
  return {
    async status() { return { ready: true, sourceId }; },
    async listChanges() { return { items: [{ sourceId, sourceProductId: '1905' }], nextCursor: null, hasMore: false }; },
    async getSourceProduct(productId) { return { product_id: productId, name: `${sourceId}-${productId}` }; },
    async hydrateAssets(productId) { return { sourceId, sourceProductId: productId }; },
    async normalize(raw) {
      return { sourceId, sourceProductId: String(raw.product_id), sourceProductName: raw.name };
    }
  };
}

test('same source product id remains distinct across suppliers', async () => {
  const registry = new CatalogSourceRegistry({ sources });
  registry.registerProvider('supplier_a', provider('supplier_a'));
  registry.registerProvider('supplier_b', provider('supplier_b'));

  const a = await registry.getSourceProduct('supplier_a', '1905');
  const b = await registry.getSourceProduct('supplier_b', '1905');
  assert.equal(a.sourceProduct.sourceId, 'supplier_a');
  assert.equal(b.sourceProduct.sourceId, 'supplier_b');
  assert.notEqual(a.sourceProduct.sourceProductName, b.sourceProduct.sourceProductName);
});

test('unimplemented provider is reported without hiding the source', async () => {
  const registry = new CatalogSourceRegistry({ sources });
  registry.registerProvider('supplier_a', provider('supplier_a'));
  const listed = await registry.listSources();
  assert.equal(listed.length, 2);
  assert.equal(listed.find(item => item.sourceId === 'supplier_a').provider.ready, true);
  assert.equal(listed.find(item => item.sourceId === 'supplier_b').provider.ready, false);
});

test('sales channel registry resolves Cafe24 own mall as one channel', () => {
  const registry = new SalesChannelRegistry([
    {
      channelId: 'haar_naver_smartstore', channelName: 'HAAR 스마트스토어', channelRole: 'marketplace',
      platformType: 'naver_smartstore', externalStoreId: null, primaryDomain: null, status: 'active', metadata: {}
    },
    {
      channelId: 'haar_own_mall', channelName: 'HAAR 자사몰', channelRole: 'owned_store',
      platformType: 'cafe24', externalStoreId: 'haar', primaryDomain: 'haar.co.kr', status: 'active', metadata: {}
    }
  ]);
  assert.equal(registry.ownMall().channelId, 'haar_own_mall');
  assert.equal(registry.findByPlatform('cafe24', 'haar').channelId, 'haar_own_mall');
  assert.equal(registry.findByDomain('https://www.haar.co.kr/products').channelId, 'haar_own_mall');
  assert.equal(registry.status().ownedStoreCount, 1);
});
