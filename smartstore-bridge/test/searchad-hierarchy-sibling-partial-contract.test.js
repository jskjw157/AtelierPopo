import test from 'node:test';
import assert from 'node:assert/strict';

import * as sibling from '../src/naver/searchad/lifecycle/sibling-create-contract.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const descriptor = () => ({
  operationKey: OPS.keyword.create,
  customerId: '1001',
  query: { nccAdgroupId: 'grp-parent' },
  body: [{ keyword: 'haar-one' }, { keyword: 'haar-two' }]
});

const result = data => ({
  operation: { operationKey: OPS.keyword.create, sideEffect: true },
  upstream: { status: 200 },
  data
});

test('partial keyword batch exposes only explicitly echoed returned IDs as quarantine candidates', () => {
  assert.equal(typeof sibling.keywordBatchOutcome, 'function');
  assert.deepEqual(
    sibling.keywordBatchOutcome(result([
      { nccKeywordId: 'kw-returned-2', keyword: 'haar-two' }
    ]), descriptor()),
    {
      kind: 'partial',
      items: [{ index: 1, remoteId: 'kw-returned-2' }]
    }
  );
});
