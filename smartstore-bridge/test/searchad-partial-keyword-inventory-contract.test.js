import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PARTIAL_KEYWORD_INVENTORY_OPERATION,
  PARTIAL_KEYWORD_INVENTORY_PAGE_SIZE,
  buildPartialKeywordInventoryDescriptor,
  classifyPartialKeywordInventoryPage
} from '../src/naver/searchad/lifecycle/partial-keyword-inventory-contract.js';

const OPERATION = 'ncc.get.get_by_adgroup_id_using_get_1__p_ncc_keywords__q_base_search_id_ncc_adgroup_id_record_size_selector';

function result(data, overrides = {}) {
  return {
    operation: { operationKey: OPERATION, sideEffect: false },
    upstream: { status: 200 },
    data,
    ...overrides
  };
}

test('partial keyword inventory uses only the pinned read-only adgroup list operation', () => {
  assert.equal(PARTIAL_KEYWORD_INVENTORY_OPERATION, OPERATION);
  assert.equal(PARTIAL_KEYWORD_INVENTORY_PAGE_SIZE, 1000);
  assert.deepEqual(
    buildPartialKeywordInventoryDescriptor({ customerId: '1001', adgroupRemoteId: 'grp-1' }),
    {
      operationKey: OPERATION,
      customerId: '1001',
      query: { nccAdgroupId: 'grp-1', recordSize: 1000 }
    }
  );

  for (const bad of [
    {},
    { customerId: '', adgroupRemoteId: 'grp-1' },
    { customerId: '1001', adgroupRemoteId: '' },
    { customerId: '1001', adgroupRemoteId: '../victim' },
    { customerId: '1001', adgroupRemoteId: 'grp-1', remoteId: 'injected' }
  ]) {
    assert.throws(() => buildPartialKeywordInventoryDescriptor(bad));
  }
});

test('inventory classifies descendant presence without assigning an unreturned local keyword ID', () => {
  const classified = classifyPartialKeywordInventoryPage(result([
    { customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: 'kw-a', keyword: 'haar-one' },
    { customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: 'kw-b', keyword: 'haar-two' }
  ]), { customerId: '1001', adgroupRemoteId: 'grp-1' });

  assert.deepEqual(classified, {
    kind: 'present_remote_descendants',
    count: 2,
    remoteIds: ['kw-a', 'kw-b'],
    completeAbsence: false
  });
  assert.equal(Object.hasOwn(classified, 'matchedLocalObjectId'), false);
  assert.equal(Object.hasOwn(classified, 'keywordMapping'), false);
});

test('empty first page is explicitly not treated as complete remote absence', () => {
  assert.deepEqual(
    classifyPartialKeywordInventoryPage(result([]), { customerId: '1001', adgroupRemoteId: 'grp-1' }),
    { kind: 'empty_unproven', count: 0, remoteIds: [], completeAbsence: false }
  );
});

test('malformed, cross-parent, cross-Customer, duplicate, oversized, or wrong-operation inventory fails closed', () => {
  const validScope = { customerId: '1001', adgroupRemoteId: 'grp-1' };
  const invalidResults = [
    null,
    { operation: { operationKey: OPERATION, sideEffect: false }, upstream: { status: 200 }, data: {} },
    result([{ customerId: '1001', nccAdgroupId: 'other', nccKeywordId: 'kw-a' }]),
    result([{ customerId: '9999', nccAdgroupId: 'grp-1', nccKeywordId: 'kw-a' }]),
    result([{ customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: 'kw-a' }, { customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: 'kw-a' }]),
    result([{ customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: '../bad' }]),
    result(Array.from({ length: 1001 }, (_, i) => ({ customerId: '1001', nccAdgroupId: 'grp-1', nccKeywordId: `kw-${i}` }))),
    result([], { operation: { operationKey: 'wrong.operation', sideEffect: false } }),
    result([], { operation: { operationKey: OPERATION, sideEffect: true } }),
    result([], { upstream: { status: 206 } }),
    { operation: { operationKey: OPERATION, sideEffect: false }, upstream: { status: 200 }, data: [], body: [] }
  ];

  for (const invalid of invalidResults) {
    assert.deepEqual(classifyPartialKeywordInventoryPage(invalid, validScope), {
      kind: 'unresolved',
      count: 0,
      remoteIds: [],
      completeAbsence: false
    });
  }
});
