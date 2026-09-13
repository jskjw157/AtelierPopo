import test from 'node:test';
import assert from 'node:assert/strict';

async function contract() {
  try { return await import('../src/naver/searchad/lifecycle/extended-child-cleanup-contract.js'); }
  catch { return {}; }
}

const graph = states => [
  { id:'campaign', type:'campaign', parentId:null, state:states.campaign ?? 'owned' },
  { id:'adgroup', type:'adgroup', parentId:'campaign', state:states.adgroup ?? 'owned' },
  { id:'kw1', type:'keyword', parentId:'adgroup', state:states.kw1 ?? 'owned' },
  { id:'kw2', type:'keyword', parentId:'adgroup', state:states.kw2 ?? 'owned' }
];

test('leaf siblings may be deleted while parents remain owned', async () => {
  const { assertExtendedDeleteOrder } = await contract();
  assert.equal(typeof assertExtendedDeleteOrder, 'function');
  assert.doesNotThrow(() => assertExtendedDeleteOrder(graph({}), 'kw1'));
  assert.doesNotThrow(() => assertExtendedDeleteOrder(graph({ kw1:'deleted' }), 'kw2'));
});

test('adgroup is blocked until every keyword/creative child is deleted', async () => {
  const { assertExtendedDeleteOrder } = await contract();
  assert.equal(typeof assertExtendedDeleteOrder, 'function');
  assert.throws(() => assertExtendedDeleteOrder(graph({ kw1:'deleted' }), 'adgroup'), /descendant/i);
  assert.doesNotThrow(() => assertExtendedDeleteOrder(graph({ kw1:'deleted', kw2:'deleted' }), 'adgroup'));
});

test('campaign is blocked until adgroup and all leaves are deleted', async () => {
  const { assertExtendedDeleteOrder } = await contract();
  assert.equal(typeof assertExtendedDeleteOrder, 'function');
  assert.throws(() => assertExtendedDeleteOrder(graph({ kw1:'deleted', kw2:'deleted' }), 'campaign'), /descendant/i);
  assert.doesNotThrow(() => assertExtendedDeleteOrder(graph({ kw1:'deleted', kw2:'deleted', adgroup:'deleted' }), 'campaign'));
});

test('mixed keyword+creative or unresolved leaf state is rejected instead of guessed', async () => {
  const { assertExtendedDeleteOrder } = await contract();
  assert.equal(typeof assertExtendedDeleteOrder, 'function');
  const mixed=[...graph({}).slice(0,3),{id:'ad1',type:'creative',parentId:'adgroup',state:'owned'}];
  assert.throws(() => assertExtendedDeleteOrder(mixed,'kw1'), /bounded/i);
  assert.throws(() => assertExtendedDeleteOrder(graph({kw2:'manual_review'}),'kw1'), /unresolved/i);
});

test('only the current deletion target may enter transient cleanup states', async () => {
  const { assertExtendedDeleteOrder } = await contract();
  assert.equal(typeof assertExtendedDeleteOrder, 'function');
  assert.doesNotThrow(() => assertExtendedDeleteOrder(graph({kw1:'delete_pending'}),'kw1'));
  assert.doesNotThrow(() => assertExtendedDeleteOrder(graph({kw1:'delete_unknown'}),'kw1'));
  assert.doesNotThrow(() => assertExtendedDeleteOrder(graph({kw1:'manual_review'}),'kw1'));
  assert.throws(() => assertExtendedDeleteOrder(graph({kw2:'delete_pending'}),'kw1'), /unresolved/i);
});
