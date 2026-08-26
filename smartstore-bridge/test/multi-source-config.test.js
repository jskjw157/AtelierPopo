import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMultiSourceCatalogConfig, normalizeDomain } from '../src/catalog/multi-source/config.js';

const driveConfig = {
  catalogFolderId: 'drive-queensilver-folder',
  cacheDir: '/tmp/haar-drive-cache'
};

test('default catalog treats QueenSilver as one non-canonical source', () => {
  const config = loadMultiSourceCatalogConfig({}, { driveConfig, cwd: '/tmp/haar' });
  assert.equal(config.sources.length, 1);
  assert.equal(config.sources[0].sourceId, 'queensilver_20260811');
  assert.equal(config.sources[0].providerType, 'google_drive_manifest');
  assert.equal(config.sources[0].canonical, false);
  assert.equal(config.sources[0].rootReference, 'drive-queensilver-folder');
});

test('Cafe24 and HAAR own mall are modeled as one sales channel', () => {
  const config = loadMultiSourceCatalogConfig({}, { driveConfig, cwd: '/tmp/haar' });
  assert.equal(config.channels.length, 2);
  const ownMall = config.channels.find(channel => channel.channelRole === 'owned_store');
  assert.equal(ownMall.channelId, 'haar_own_mall');
  assert.equal(ownMall.platformType, 'cafe24');
  assert.equal(ownMall.primaryDomain, 'haar.co.kr');
  assert.equal(config.channels.some(channel => channel.channelId === 'own_site'), false);
  assert.equal(config.channels.some(channel => channel.channelId === 'cafe24'), false);
});

test('duplicate Cafe24 own-site identities are rejected', () => {
  const channels = [
    {
      channelId: 'haar_own_mall',
      channelRole: 'owned_store',
      platformType: 'cafe24',
      primaryDomain: 'haar.co.kr'
    },
    {
      channelId: 'own_site',
      channelRole: 'own_site',
      platformType: 'own_site',
      primaryDomain: 'shop.haar.co.kr'
    }
  ];
  assert.throws(
    () => loadMultiSourceCatalogConfig({
      ATELIER_SALES_CHANNELS_JSON: JSON.stringify(channels)
    }, { driveConfig, cwd: '/tmp/haar' }),
    error => error.code === 'MULTI_SOURCE_DUPLICATE_CAFE24_OWN_MALL'
  );
});

test('domain normalization keeps channel identity stable', () => {
  assert.equal(normalizeDomain('https://www.HAAR.CO.KR/shop/?x=1'), 'haar.co.kr');
  assert.equal(normalizeDomain('haar.co.kr'), 'haar.co.kr');
});
