import test from 'node:test';
import assert from 'node:assert/strict';

import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { keywordBatchResponse } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';

function descriptor() {
  return {
    operationKey: OPS.keyword.create,
    customerId: '1001',
    query: { nccAdgroupId: 'grp-parent' },
    body: [{ keyword: 'haar-one' }, { keyword: 'haar-two' }]
  };
}

function result(data, status = 200) {
  return {
    operation: { operationKey: OPS.keyword.create, sideEffect: true },
    upstream: { status },
    data
  };
}

test('keyword batch accepts only an exact ordered set of unique returned IDs', () => {
  assert.deepEqual(
    keywordBatchResponse(result([
      { nccKeywordId: 'kw-returned-1', keyword: 'haar-one' },
      { nccKeywordId: 'kw-returned-2', keyword: 'haar-two' }
    ]), descriptor()),
    ['kw-returned-1', 'kw-returned-2']
  );
});

test('keyword batch rejects partial, extra and duplicate returned IDs', () => {
  for (const data of [
    [{ nccKeywordId: 'kw-returned-1' }],
    [{ nccKeywordId: 'kw-returned-1' }, { nccKeywordId: 'kw-returned-2' }, { nccKeywordId: 'kw-returned-3' }],
    [{ nccKeywordId: 'kw-returned-1' }, { nccKeywordId: 'kw-returned-1' }]
  ]) assert.equal(keywordBatchResponse(result(data), descriptor()), null);
});

test('keyword batch rejects malformed wrappers, IDs and contradictory echoed keywords', () => {
  const invalid = [
    { data: [{ nccKeywordId: 'kw-1' }, { nccKeywordId: 'kw-2' }] },
    result([{ nccKeywordId: '' }, { nccKeywordId: 'kw-2' }]),
    result([{ nccKeywordId: 'kw-1', keyword: 'wrong' }, { nccKeywordId: 'kw-2', keyword: 'haar-two' }]),
    result([{ nccKeywordId: 'kw-1' }, { nccKeywordId: 'kw-2' }], 204)
  ];
  for (const value of invalid) assert.equal(keywordBatchResponse(value, descriptor()), null);
});
