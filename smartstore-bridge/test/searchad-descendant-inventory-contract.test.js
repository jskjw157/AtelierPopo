import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESCENDANT_INVENTORY_OPERATIONS,
  DESCENDANT_INVENTORY_PAGE_SIZE,
  buildDescendantInventoryDescriptor,
  classifyDescendantInventoryPage
} from '../src/naver/searchad/lifecycle/descendant-inventory-contract.js';

const OPS = Object.freeze({
  campaignAdgroup: 'ncc.get.get_groups_using_get_2__p_ncc_adgroups__q_base_search_id_ncc_campaign_id_record_size_selector',
  adgroupKeyword: 'ncc.get.get_by_adgroup_id_using_get_1__p_ncc_keywords__q_base_search_id_ncc_adgroup_id_record_size_selector',
  adgroupCreative: 'ncc.get.get_by_adgroup_id_using_get__p_ncc_ads__q_ncc_adgroup_id'
});

const scopes = Object.freeze([
  {
    scope: { customerId: '1001', parentType: 'campaign', parentRemoteId: 'cmp-1', childType: 'adgroup' },
    operationKey: OPS.campaignAdgroup,
    query: { nccCampaignId: 'cmp-1', recordSize: 1000 },
    rows: [
      { customerId: '1001', nccCampaignId: 'cmp-1', nccAdgroupId: 'grp-a' },
      { customerId: '1001', nccCampaignId: 'cmp-1', nccAdgroupId: 'grp-b' }
    ]
  },
  {
    scope: { customerId: '1001', parentType: 'adgroup', parentRemoteId: 'grp-1', childType: 'keyword' },
    operationKey: OPS.adgroupKeyword,
    query: { nccAdgroupId: 'grp-1', recordSize: 1000 },
    rows: [
      { customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: 'kw-a', keyword: 'haar-one' },
      { customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: 'kw-b', keyword: 'haar-two' }
    ]
  },
  {
    scope: { customerId: '1001', parentType: 'adgroup', parentRemoteId: 'grp-1', childType: 'creative' },
    operationKey: OPS.adgroupCreative,
    query: { nccAdgroupId: 'grp-1' },
    rows: [
      { customerId: '1001', nccAdgroupId: 'grp-1', nccAdId: 'ad-a', type: 'TEXT_45' },
      { customerId: '1001', nccAdgroupId: 'grp-1', nccAdId: 'ad-b', type: 'TEXT_45' }
    ]
  }
]);

function envelope(entry, data, overrides = {}) {
  return {
    operation: { operationKey: entry.operationKey, sideEffect: false },
    upstream: { status: 200 },
    data,
    ...overrides
  };
}

test('descendant inventory pins only the three approved read-only parent-child list operations', () => {
  assert.deepEqual(DESCENDANT_INVENTORY_OPERATIONS, OPS);
  assert.equal(DESCENDANT_INVENTORY_PAGE_SIZE, 1000);

  for (const entry of scopes) {
    assert.deepEqual(buildDescendantInventoryDescriptor(entry.scope), {
      operationKey: entry.operationKey,
      customerId: '1001',
      query: entry.query
    });
  }

  for (const bad of [
    {},
    { customerId: '', parentType: 'campaign', parentRemoteId: 'cmp-1', childType: 'adgroup' },
    { customerId: '1001', parentType: 'campaign', parentRemoteId: '../victim', childType: 'adgroup' },
    { customerId: '1001', parentType: 'campaign', parentRemoteId: 'cmp-1', childType: 'keyword' },
    { customerId: '1001', parentType: 'adgroup', parentRemoteId: 'grp-1', childType: 'adgroup' },
    { customerId: '1001', parentType: 'adgroup', parentRemoteId: 'grp-1', childType: 'keyword', selector: 'NEXT' },
    { customerId: '1001', parentType: 'adgroup', parentRemoteId: 'grp-1', childType: 'creative', operationKey: 'injected' }
  ]) {
    assert.throws(() => buildDescendantInventoryDescriptor(bad));
  }
});

test('non-empty inventory proves remote descendant presence only and never creates local mapping authority', () => {
  for (const entry of scopes) {
    const classified = classifyDescendantInventoryPage(envelope(entry, entry.rows), entry.scope);
    const idKey = entry.scope.childType === 'adgroup' ? 'nccAdgroupId' :
      entry.scope.childType === 'keyword' ? 'nccKeywordId' : 'nccAdId';
    const expectedIds = entry.rows.map(row => row[idKey]);

    assert.deepEqual(classified, {
      kind: 'present_remote_descendants',
      count: 2,
      remoteIds: expectedIds,
      completeAbsence: false
    });
    assert.equal(Object.hasOwn(classified, 'matchedLocalObjectId'), false);
    assert.equal(Object.hasOwn(classified, 'ownership'), false);
    assert.equal(Object.hasOwn(classified, 'cleanupAuthority'), false);
  }
});

test('an empty list never becomes complete absence for campaign adgroups, adgroup keywords, or adgroup creatives', () => {
  for (const entry of scopes) {
    assert.deepEqual(
      classifyDescendantInventoryPage(envelope(entry, []), entry.scope),
      { kind: 'empty_unproven', count: 0, remoteIds: [], completeAbsence: false }
    );
  }
});

test('cross-scope, duplicate, unsafe, oversized, malformed, mutating, or wrong-operation inventory fails closed', () => {
  for (const entry of scopes) {
    const idKey = entry.scope.childType === 'adgroup' ? 'nccAdgroupId' :
      entry.scope.childType === 'keyword' ? 'nccKeywordId' : 'nccAdId';
    const parentKey = entry.scope.parentType === 'campaign' ? 'nccCampaignId' : 'nccAdgroupId';
    const valid = entry.rows[0];
    const duplicate = [{ ...valid }, { ...valid }];
    const crossParent = [{ ...valid, [parentKey]: 'other-parent' }];
    const crossCustomer = [{ ...valid, customerId: '9999' }];
    const unsafe = [{ ...valid, [idKey]: '../bad' }];
    const oversized = Array.from({ length: 1001 }, (_, index) => ({
      ...valid,
      [idKey]: `remote-${index}`
    }));

    for (const invalid of [
      null,
      { operation: { operationKey: entry.operationKey, sideEffect: false }, upstream: { status: 200 }, data: {} },
      envelope(entry, crossParent),
      envelope(entry, crossCustomer),
      envelope(entry, duplicate),
      envelope(entry, unsafe),
      envelope(entry, oversized),
      envelope(entry, [], { operation: { operationKey: 'wrong.operation', sideEffect: false } }),
      envelope(entry, [], { operation: { operationKey: entry.operationKey, sideEffect: true } }),
      envelope(entry, [], { upstream: { status: 206 } }),
      { operation: { operationKey: entry.operationKey, sideEffect: false }, upstream: { status: 200 }, data: [], body: [] }
    ]) {
      assert.deepEqual(classifyDescendantInventoryPage(invalid, entry.scope), {
        kind: 'unresolved',
        count: 0,
        remoteIds: [],
        completeAbsence: false
      });
    }
  }
});

test('classifier rejects caller scope extensions and unsupported graph edges', () => {
  const entry = scopes[1];
  assert.deepEqual(
    classifyDescendantInventoryPage(envelope(entry, entry.rows), { ...entry.scope, remoteId: 'kw-a' }),
    { kind: 'unresolved', count: 0, remoteIds: [], completeAbsence: false }
  );
  assert.deepEqual(
    classifyDescendantInventoryPage(envelope(entry, entry.rows), {
      customerId: '1001',
      parentType: 'campaign',
      parentRemoteId: 'cmp-1',
      childType: 'creative'
    }),
    { kind: 'unresolved', count: 0, remoteIds: [], completeAbsence: false }
  );
});
