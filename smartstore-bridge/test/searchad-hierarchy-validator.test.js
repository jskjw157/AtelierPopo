import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCHAD_HIERARCHY_OPERATIONS,
  KEYWORD_CREATE_MAX_BATCH
} from '../src/naver/searchad/lifecycle/operations.js';
import {
  assertNoCallerRemoteIds,
  assertHierarchyParent,
  assertTopCampaignStopped,
  assertKeywordBatch,
  assertText45Creative
} from '../src/naver/searchad/lifecycle/hierarchy-validator.js';

function expectCode(fn, code) {
  assert.throws(fn, error => {
    assert.equal(error?.code, code);
    assert.equal(error?.status, 400);
    return true;
  });
}

test('hierarchy operation descriptors are pinned to checked-in Naver operation keys', () => {
  assert.equal(KEYWORD_CREATE_MAX_BATCH, 100);
  assert.deepEqual(SEARCHAD_HIERARCHY_OPERATIONS, {
    campaign: {
      create: 'ncc.post.add_using_post_3__p_ncc_campaigns',
      read: 'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',
      delete: 'ncc.delete.remove_using_delete_5__p_ncc_campaigns_campaign_id'
    },
    adgroup: {
      create: 'ncc.post.add_using_post_6__p_ncc_adgroups',
      read: 'ncc.get.get_using_get_16__p_ncc_adgroups_adgroup_id',
      delete: 'ncc.delete.remove_using_delete_7__p_ncc_adgroups_adgroup_id'
    },
    keyword: {
      create: 'ncc.post.add_using_post_4__p_ncc_keywords__q_ncc_adgroup_id',
      read: 'ncc.get.get_using_get_14__p_ncc_keywords_ncc_keyword_id',
      delete: 'ncc.delete.remove_using_delete_6__p_ncc_keywords_ncc_keyword_id'
    },
    creative: {
      create: 'ncc.post.add_using_post_1__p_ncc_ads',
      read: 'ncc.get.get_using_get_10__p_ncc_ads_ad_id',
      delete: 'ncc.delete.remove_using_delete__p_ncc_ads_ad_id'
    }
  });
});

test('caller-supplied existing SearchAd IDs are rejected recursively', () => {
  for (const key of ['remoteId', 'nccCampaignId', 'nccAdgroupId', 'nccKeywordId', 'nccAdId']) {
    expectCode(
      () => assertNoCallerRemoteIds({ nested: { [key]: 'existing-remote-object' } }),
      'SEARCHAD_HIERARCHY_REMOTE_ID_INJECTION'
    );
  }
  assert.doesNotThrow(() => assertNoCallerRemoteIds({ name: 'server recipe input', items: [{ keyword: 'haar' }] }));
});

test('hierarchy parent must be owned by the same Customer and hierarchy run with the exact parent type', () => {
  const base = {
    customerId: 'customer-100',
    runId: 'run-100',
    childType: 'adgroup',
    parent: {
      customerId: 'customer-100',
      runId: 'run-100',
      objectType: 'campaign',
      remoteId: 'returned-campaign-id',
      ownershipState: 'owned'
    }
  };
  assert.doesNotThrow(() => assertHierarchyParent(base));
  expectCode(
    () => assertHierarchyParent({ ...base, parent: { ...base.parent, customerId: 'customer-200' } }),
    'SEARCHAD_HIERARCHY_PARENT_CUSTOMER_MISMATCH'
  );
  expectCode(
    () => assertHierarchyParent({ ...base, parent: { ...base.parent, runId: 'run-200' } }),
    'SEARCHAD_HIERARCHY_PARENT_RUN_MISMATCH'
  );
  expectCode(
    () => assertHierarchyParent({ ...base, parent: { ...base.parent, objectType: 'adgroup' } }),
    'SEARCHAD_HIERARCHY_PARENT_TYPE_INVALID'
  );
  expectCode(
    () => assertHierarchyParent({ ...base, parent: { ...base.parent, remoteId: null } }),
    'SEARCHAD_HIERARCHY_PARENT_NOT_OWNED'
  );
  expectCode(
    () => assertHierarchyParent({ ...base, parent: { ...base.parent, ownershipState: 'deleted' } }),
    'SEARCHAD_HIERARCHY_PARENT_NOT_OWNED'
  );

  const keywordParent = { ...base, childType: 'keyword', parent: { ...base.parent, objectType: 'adgroup' } };
  const creativeParent = { ...base, childType: 'creative', parent: { ...base.parent, objectType: 'adgroup' } };
  assert.doesNotThrow(() => assertHierarchyParent(keywordParent));
  assert.doesNotThrow(() => assertHierarchyParent(creativeParent));
});

test('top campaign must be remotely stopped or paused before child hierarchy mutation', () => {
  assert.doesNotThrow(() => assertTopCampaignStopped({ userLock: true }));
  assert.doesNotThrow(() => assertTopCampaignStopped({ state: 'paused' }));
  assert.doesNotThrow(() => assertTopCampaignStopped({ state: 'stopped' }));
  for (const campaign of [{ userLock: false }, { state: 'enabled' }, {}, null]) {
    expectCode(() => assertTopCampaignStopped(campaign), 'SEARCHAD_HIERARCHY_CAMPAIGN_NOT_STOPPED');
  }
});

test('keyword create hard limit is 1..100 items', () => {
  assert.doesNotThrow(() => assertKeywordBatch([{}]));
  assert.doesNotThrow(() => assertKeywordBatch(Array.from({ length: 100 }, () => ({}))));
  expectCode(() => assertKeywordBatch([]), 'SEARCHAD_KEYWORD_BATCH_LIMIT');
  expectCode(() => assertKeywordBatch(Array.from({ length: 101 }, () => ({}))), 'SEARCHAD_KEYWORD_BATCH_LIMIT');
  expectCode(() => assertKeywordBatch(null), 'SEARCHAD_KEYWORD_BATCH_LIMIT');
});

test('creative hierarchy recipe accepts TEXT_45 only', () => {
  assert.doesNotThrow(() => assertText45Creative({ type: 'TEXT_45' }));
  for (const type of ['SHOPPING_PRODUCT_AD', 'PLACE_AD', '', null]) {
    expectCode(() => assertText45Creative({ type }), 'SEARCHAD_CREATIVE_TYPE_INVALID');
  }
});
