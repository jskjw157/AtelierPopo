import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';

// A missing recovery module must be an explicit assertion failure, not an
// import-time crash or a skipped test. These are pure descriptor contracts;
// the owned-looking records below are fixtures, not PostgreSQL evidence.
async function recovered(name) {
  const url = new URL(`../src/naver/searchad/lifecycle/${name}.js`, import.meta.url);
  assert.ok(existsSync(url), `Missing 0009 recovery module: ${name}`);
  return import(url.href);
}
const customerId = '1001';
const hierarchyRunId = 'recovery-run-1';
const stored = (objectType, remoteId, overrides = {}) => ({
  customerId, hierarchyRunId, objectType, remoteId, state: 'owned',
  hierarchyObjectId: `local-${objectType}`, ...overrides
});
const expectCode = (fn, code) => assert.throws(fn, error => error?.code === code);

function forbidNetwork(t) {
  return t.mock.method(globalThis, 'fetch', () => {
    assert.fail('Pure hierarchy validation/recipe must not perform network I/O');
  });
}

test('recovery: all twelve frozen hierarchy keys resolve in the current checked-in registry', async t => {
  const network = forbidNetwork(t);
  const { SEARCHAD_HIERARCHY_OPERATIONS: operations, KEYWORD_CREATE_MAX_BATCH, SEARCHAD_LIFECYCLE_KINDS } = await recovered('operations');
  const manifestPath = fileURLToPath(new URL('../specs/naver-searchad/current.json', import.meta.url));
  const registry = loadSearchAdSpecRegistry(manifestPath);
  assert.equal(Object.isFrozen(operations), true);
  assert.equal(KEYWORD_CREATE_MAX_BATCH, 100);
  assert.deepEqual(SEARCHAD_LIFECYCLE_KINDS, ['create', 'batch_create', 'delete']);
  assert.equal(Object.isFrozen(SEARCHAD_LIFECYCLE_KINDS), true);
  const keys = [];
  for (const object of Object.values(operations)) {
    assert.equal(Object.isFrozen(object), true);
    for (const [kind, key] of Object.entries(object)) {
      const entry = registry.get(key);
      assert.equal(entry.method, { create: 'POST', read: 'GET', delete: 'DELETE' }[kind]);
      assert.equal(entry.runtimeAllowlisted, true);
      assert.equal(entry.state, 'public_documented');
      assert.equal(entry.sideEffect, kind !== 'read');
      keys.push(key);
    }
  }
  assert.equal(keys.length, 12);
  assert.equal(new Set(keys).size, 12);
  assert.equal(network.mock.callCount(), 0);
});

test('recovery: nested target injection and wrong Customer/run/parent are rejected without I/O', async t => {
  const network = forbidNetwork(t);
  const { assertNoCallerRemoteIds, assertHierarchyParent, assertTopCampaignStopped } = await recovered('hierarchy-validator');
  for (const key of ['remoteId', 'nccCampaignId', 'nccAdgroupId', 'nccKeywordId', 'nccAdId']) {
    expectCode(() => assertNoCallerRemoteIds({ items: [{ nested: { [key]: 'existing-object' } }] }), 'SEARCHAD_HIERARCHY_REMOTE_ID_INJECTION');
  }
  const base = { customerId, runId: hierarchyRunId, childType: 'adgroup', parent: {
    customerId, runId: hierarchyRunId, objectType: 'campaign', remoteId: 'returned-cmp', ownershipState: 'owned'
  } };
  assert.equal(assertHierarchyParent(base), true);
  for (const [patch, code] of [
    [{ customerId: '2002' }, 'SEARCHAD_HIERARCHY_PARENT_CUSTOMER_MISMATCH'],
    [{ runId: 'foreign-run' }, 'SEARCHAD_HIERARCHY_PARENT_RUN_MISMATCH'],
    [{ objectType: 'keyword' }, 'SEARCHAD_HIERARCHY_PARENT_TYPE_INVALID'],
    [{ ownershipState: 'deleted' }, 'SEARCHAD_HIERARCHY_PARENT_NOT_OWNED']
  ]) expectCode(() => assertHierarchyParent({ ...base, parent: { ...base.parent, ...patch } }), code);
  for (const value of [null, {}, { userLock: false }, { state: 'enabled' }]) {
    expectCode(() => assertTopCampaignStopped(value), 'SEARCHAD_HIERARCHY_CAMPAIGN_NOT_STOPPED');
  }
  assert.equal(network.mock.callCount(), 0);
});

test('recovery: campaign payload is stopped and server-derived without changing default gates', async t => {
  const network = forbidNetwork(t);
  const { createHierarchyCampaignRecipe } = await recovered('recipe-campaign');
  const recipe = createHierarchyCampaignRecipe({ dailyBudget: 1000 });
  const descriptor = recipe.createCampaign({ customerId, hierarchyRunId, body: { userLock: false, dailyBudget: 999999 } });
  assert.equal(descriptor.body.userLock, true);
  assert.equal(descriptor.body.dailyBudget, 1000);
  assert.equal(descriptor.body.campaignTp, 'WEB_SITE');
  const config = loadSearchAdConfig({});
  for (const key of ['allowWrites', 'allowCreates', 'allowDeletes', 'allowBatchWrites', 'allowActiveCanary']) assert.equal(config[key], false);
  assert.equal(config.automationMode, 'observe');
  assert.equal(network.mock.callCount(), 0);
});

test('recovery: keyword and creative are siblings under an owned adgroup, with batch and type limits', async t => {
  const network = forbidNetwork(t);
  const { createHierarchyChildRecipe } = await recovered('recipe-hierarchy');
  const recipe = createHierarchyChildRecipe({ keywordTexts: ['one', 'two'] });
  const parent = stored('adgroup', 'returned-grp');
  const keywords = recipe.createKeywords({ customerId, hierarchyRunId, parent });
  const creative = recipe.createCreative({ customerId, hierarchyRunId, parent });
  assert.deepEqual(keywords.query, { nccAdgroupId: parent.remoteId });
  assert.equal(keywords.body.length, 2);
  assert.equal(creative.body.nccAdgroupId, parent.remoteId);
  assert.equal(creative.body.type, 'TEXT_45');
  expectCode(() => recipe.createCreative({ customerId, hierarchyRunId, parent: stored('keyword', 'returned-keyword') }), 'SEARCHAD_HIERARCHY_PARENT_TYPE_INVALID');
  expectCode(() => createHierarchyChildRecipe({ keywordTexts: [] }), 'SEARCHAD_KEYWORD_BATCH_LIMIT');
  expectCode(() => createHierarchyChildRecipe({ keywordTexts: Array.from({ length: 101 }, (_, i) => `kw-${i}`) }), 'SEARCHAD_KEYWORD_BATCH_LIMIT');
  const maxRecipe = createHierarchyChildRecipe({ keywordTexts: Array.from({ length: 100 }, (_, i) => `kw-${i}`) });
  assert.equal(maxRecipe.createKeywords({ customerId, hierarchyRunId, parent }).body.length, 100);
  expectCode(() => createHierarchyChildRecipe({ creative: { type: 'PLACE_AD' } }), 'SEARCHAD_CREATIVE_TYPE_INVALID');
  assert.equal(network.mock.callCount(), 0);
});

test('recovery: every read/delete descriptor keeps its stored Customer/run/type and returned ID', async t => {
  const network = forbidNetwork(t);
  const { createHierarchyCampaignRecipe } = await recovered('recipe-campaign');
  const { createHierarchyChildRecipe } = await recovered('recipe-hierarchy');
  const campaign = createHierarchyCampaignRecipe({ dailyBudget: 1000 });
  const child = createHierarchyChildRecipe();
  for (const [recipe, suffix, objectType, pathKey] of [
    [campaign, 'Campaign', 'campaign', 'campaignId'],
    [child, 'Adgroup', 'adgroup', 'adgroupId'],
    [child, 'Keyword', 'keyword', 'nccKeywordId'],
    [child, 'Creative', 'creative', 'adId']
  ]) {
    for (const verb of ['read', 'delete']) {
      const build = recipe[`${verb}${suffix}`];
      const object = stored(objectType, `returned-${objectType}`);
      assert.deepEqual(build({ customerId, hierarchyRunId, object }).pathParams, { [pathKey]: object.remoteId });
      for (const [patch, code] of [
        [{ customerId: '2002' }, 'SEARCHAD_HIERARCHY_OBJECT_CUSTOMER_MISMATCH'],
        [{ hierarchyRunId: 'foreign' }, 'SEARCHAD_HIERARCHY_OBJECT_RUN_MISMATCH'],
        [{ objectType: 'unsupported' }, 'SEARCHAD_HIERARCHY_OBJECT_TYPE_INVALID'],
        [{ state: 'deleted' }, 'SEARCHAD_HIERARCHY_OBJECT_NOT_OWNED'],
        [{ remoteId: null }, 'SEARCHAD_HIERARCHY_OBJECT_NOT_OWNED']
      ]) expectCode(() => build({ customerId, hierarchyRunId, object: { ...object, ...patch } }), code);
    }
  }
  assert.equal(network.mock.callCount(), 0);
});

test('recovery: missing and conflicting response-returned IDs never become descriptor targets', async t => {
  const network = forbidNetwork(t);
  const { extractReturnedId } = await recovered('recipe-campaign');
  for (const key of ['nccCampaignId', 'nccAdgroupId', 'nccAdId']) {
    assert.equal(extractReturnedId({ data: { [key]: 'returned-1' } }, key), 'returned-1');
    expectCode(() => extractReturnedId({ data: {} }, key), 'SEARCHAD_LIFECYCLE_RETURNED_ID_REQUIRED');
    expectCode(() => extractReturnedId({ data: { [key]: 'a' }, body: { [key]: 'b' } }, key), 'SEARCHAD_LIFECYCLE_RETURNED_ID_AMBIGUOUS');
  }
  assert.equal(network.mock.callCount(), 0);
});
