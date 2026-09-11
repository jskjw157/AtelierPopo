import test from 'node:test';
import assert from 'node:assert/strict';

import { createHierarchyCampaignRecipe } from '../src/naver/searchad/lifecycle/recipe-campaign.js';
import { createHierarchyChildRecipe } from '../src/naver/searchad/lifecycle/recipe-hierarchy.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';

const customerId = '100';
const hierarchyRunId = '33333333-3333-4333-8333-333333333333';

function ownedObject(objectType, remoteId, overrides = {}) {
  return {
    hierarchyObjectId: `${objectType}-local-1`,
    hierarchyRunId,
    customerId,
    objectType,
    remoteId,
    state: 'owned',
    ...overrides
  };
}

const campaign = ownedObject('campaign', 'cmp-returned-1');
const adgroup = ownedObject('adgroup', 'grp-returned-1', { parentObjectId: campaign.hierarchyObjectId });
const keyword = ownedObject('keyword', 'kw-returned-1', { parentObjectId: adgroup.hierarchyObjectId });
const creative = ownedObject('creative', 'ad-returned-1', { parentObjectId: adgroup.hierarchyObjectId });

test('campaign recipe creates only a server-owned stopped WEB_SITE payload', () => {
  const recipe = createHierarchyCampaignRecipe({ dailyBudget: 1_000 });
  const descriptor = recipe.createCampaign({
    customerId,
    hierarchyRunId,
    remoteId: undefined,
    body: undefined
  });

  assert.equal(descriptor.operationKey, SEARCHAD_HIERARCHY_OPERATIONS.campaign.create);
  assert.equal(descriptor.customerId, customerId);
  assert.deepEqual(Object.keys(descriptor.body).sort(), ['campaignTp', 'dailyBudget', 'name', 'userLock']);
  assert.equal(descriptor.body.campaignTp, 'WEB_SITE');
  assert.equal(descriptor.body.userLock, true);
  assert.equal(descriptor.body.dailyBudget, 1_000);
  assert.match(descriptor.body.name, /^HAAR_HIERARCHY_/);

  assert.throws(
    () => recipe.createCampaign({ customerId, hierarchyRunId, remoteId: 'attacker-existing-id' }),
    error => error?.code === 'SEARCHAD_HIERARCHY_REMOTE_ID_INJECTION'
  );
});

test('adgroup builder binds only a persisted owned campaign from the same Customer and run', () => {
  const recipe = createHierarchyChildRecipe();
  const descriptor = recipe.createAdgroup({ customerId, hierarchyRunId, parent: campaign });
  assert.equal(descriptor.operationKey, SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create);
  assert.equal(descriptor.body.nccCampaignId, campaign.remoteId);
  assert.equal(descriptor.body.userLock, true);

  assert.throws(
    () => recipe.createAdgroup({ customerId, hierarchyRunId, remoteId: campaign.remoteId }),
    error => error?.code === 'SEARCHAD_HIERARCHY_REMOTE_ID_INJECTION'
  );
  assert.throws(
    () => recipe.createAdgroup({ customerId, hierarchyRunId, parent: { ...campaign, customerId: '200' } }),
    error => error?.code === 'SEARCHAD_HIERARCHY_PARENT_CUSTOMER_MISMATCH'
  );
  assert.throws(
    () => recipe.createAdgroup({ customerId, hierarchyRunId, parent: { ...campaign, hierarchyRunId: 'other-run' } }),
    error => error?.code === 'SEARCHAD_HIERARCHY_PARENT_RUN_MISMATCH'
  );
});

test('keyword builder binds persisted owned adgroup and enforces server-configured batch <=100', () => {
  const recipe = createHierarchyChildRecipe({ keywordTexts: ['haar-canary-one', 'haar-canary-two'] });
  const descriptor = recipe.createKeywords({ customerId, hierarchyRunId, parent: adgroup });
  assert.equal(descriptor.operationKey, SEARCHAD_HIERARCHY_OPERATIONS.keyword.create);
  assert.deepEqual(descriptor.query, { nccAdgroupId: adgroup.remoteId });
  assert.deepEqual(descriptor.body.map(item => item.keyword), ['haar-canary-one', 'haar-canary-two']);
  assert.equal(descriptor.body.length, 2);

  assert.throws(
    () => createHierarchyChildRecipe({ keywordTexts: [] }),
    error => error?.code === 'SEARCHAD_KEYWORD_BATCH_LIMIT'
  );
  assert.throws(
    () => createHierarchyChildRecipe({ keywordTexts: Array.from({ length: 101 }, (_, i) => `kw-${i}`) }),
    error => error?.code === 'SEARCHAD_KEYWORD_BATCH_LIMIT'
  );
});

test('creative builder binds persisted owned adgroup and permits TEXT_45 only', () => {
  const recipe = createHierarchyChildRecipe({
    creative: {
      type: 'TEXT_45',
      headline: 'HAAR canary headline',
      description: 'HAAR canary description',
      pcFinal: 'https://example.invalid/haar-canary',
      mobileFinal: 'https://example.invalid/haar-canary'
    }
  });
  const descriptor = recipe.createCreative({ customerId, hierarchyRunId, parent: adgroup });
  assert.equal(descriptor.operationKey, SEARCHAD_HIERARCHY_OPERATIONS.creative.create);
  assert.equal(descriptor.body.nccAdgroupId, adgroup.remoteId);
  assert.equal(descriptor.body.type, 'TEXT_45');
  assert.equal(descriptor.body.ad.headline, 'HAAR canary headline');

  assert.throws(
    () => createHierarchyChildRecipe({ creative: { type: 'PLACE_AD' } }),
    error => error?.code === 'SEARCHAD_CREATIVE_TYPE_INVALID'
  );
});

test('returned ID extractors accept exactly one response-returned canonical ID and fail closed otherwise', () => {
  const campaignRecipe = createHierarchyCampaignRecipe({ dailyBudget: 1_000 });
  const childRecipe = createHierarchyChildRecipe();

  assert.equal(campaignRecipe.extractCampaignId({ data: { nccCampaignId: 'cmp-response' } }), 'cmp-response');
  assert.equal(childRecipe.extractAdgroupId({ data: { nccAdgroupId: 'grp-response' } }), 'grp-response');
  assert.deepEqual(
    childRecipe.extractKeywordIds({ data: [{ nccKeywordId: 'kw-1' }, { nccKeywordId: 'kw-2' }] }),
    ['kw-1', 'kw-2']
  );
  assert.equal(childRecipe.extractCreativeId({ data: { nccAdId: 'ad-response' } }), 'ad-response');

  assert.throws(
    () => childRecipe.extractAdgroupId({ data: {} }),
    error => error?.code === 'SEARCHAD_LIFECYCLE_RETURNED_ID_REQUIRED'
  );
  assert.throws(
    () => childRecipe.extractAdgroupId({
      data: { nccAdgroupId: 'grp-a' },
      body: { nccAdgroupId: 'grp-b' }
    }),
    error => error?.code === 'SEARCHAD_LIFECYCLE_RETURNED_ID_AMBIGUOUS'
  );
  assert.throws(
    () => childRecipe.extractKeywordIds({ data: [{ nccKeywordId: 'kw-1' }, {}] }),
    error => error?.code === 'SEARCHAD_LIFECYCLE_RETURNED_ID_REQUIRED'
  );
});

test('read and delete builders use persisted returned IDs only for every hierarchy object', () => {
  const campaignRecipe = createHierarchyCampaignRecipe({ dailyBudget: 1_000 });
  const childRecipe = createHierarchyChildRecipe();

  assert.deepEqual(campaignRecipe.readCampaign({ customerId, hierarchyRunId, object: campaign }).pathParams, { campaignId: campaign.remoteId });
  assert.deepEqual(campaignRecipe.deleteCampaign({ customerId, hierarchyRunId, object: campaign }).pathParams, { campaignId: campaign.remoteId });
  assert.deepEqual(childRecipe.readAdgroup({ customerId, hierarchyRunId, object: adgroup }).pathParams, { adgroupId: adgroup.remoteId });
  assert.deepEqual(childRecipe.deleteAdgroup({ customerId, hierarchyRunId, object: adgroup }).pathParams, { adgroupId: adgroup.remoteId });
  assert.deepEqual(childRecipe.readKeyword({ customerId, hierarchyRunId, object: keyword }).pathParams, { nccKeywordId: keyword.remoteId });
  assert.deepEqual(childRecipe.deleteKeyword({ customerId, hierarchyRunId, object: keyword }).pathParams, { nccKeywordId: keyword.remoteId });
  assert.deepEqual(childRecipe.readCreative({ customerId, hierarchyRunId, object: creative }).pathParams, { adId: creative.remoteId });
  assert.deepEqual(childRecipe.deleteCreative({ customerId, hierarchyRunId, object: creative }).pathParams, { adId: creative.remoteId });

  assert.throws(
    () => childRecipe.deleteAdgroup({ customerId, hierarchyRunId, remoteId: 'attacker-id', name: 'find-me' }),
    error => error?.code === 'SEARCHAD_HIERARCHY_REMOTE_ID_INJECTION'
  );

  for (const recipe of [campaignRecipe, childRecipe]) {
    assert.equal(Object.keys(recipe).some(key => /lookup|find.*name|name.*lookup/i.test(key)), false);
  }
});
