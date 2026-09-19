import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUnprovenInventory } from '../src/naver/searchad/lifecycle/inventory-cleanup-fence.js';

const root = { hierarchy_object_id: 'root', object_type: 'campaign', parent_object_id: null };
const group = { hierarchy_object_id: 'group', object_type: 'adgroup', parent_object_id: 'root' };
const other = { hierarchy_object_id: 'other', object_type: 'adgroup', parent_object_id: 'root' };
const leaf = { hierarchy_object_id: 'leaf', object_type: 'keyword', parent_object_id: 'group' };
const creative = { hierarchy_object_id: 'creative', object_type: 'creative', parent_object_id: 'group' };
const objects = [root, group, other, leaf, creative];
const event = (id, phase = 'descendant_inventory', details = {}) => ({ hierarchy_object_id: id, phase, details_json: details });

// Removing the relevant phase/subtree check would make these tests fail.
test('parent veto covers its subtree including legacy or alleged complete-absence observations', () => {
  for (const phase of ['descendant_inventory', 'partial_keyword_inventory']) {
    for (const id of ['root', 'group', 'leaf', null]) {
      assert.equal(hasUnprovenInventory({ target: root, objects, events: [event(id, phase, { completeAbsence: true, cleanupAuthority: true })] }), true);
    }
  }
  assert.equal(hasUnprovenInventory({ target: group, objects, events: [event('leaf')] }), true);
});

test('leaf cleanup is not vetoed by uncertainty about its siblings', () => {
  for (const target of [leaf, creative]) {
    assert.equal(hasUnprovenInventory({ target, objects, events: [event('group')] }), false);
  }
});

test('subtree scoping does not confuse sibling inventory with target descendants', () => {
  assert.equal(hasUnprovenInventory({ target: group, objects, events: [event('other')] }), false);
  assert.equal(hasUnprovenInventory({ target: group, objects, events: [event('root')] }), false);
  assert.equal(hasUnprovenInventory({ target: root, objects, events: [event('other')] }), true);
});

test('no inventory means no new veto, not proof of absence or permission to dispatch', () => {
  assert.equal(hasUnprovenInventory({ target: root, objects, events: [] }), false);
  assert.equal(hasUnprovenInventory({ target: root, objects, events: [event('root', 'create_verification')] }), false);
});

test('missing parent graph fails closed and cycles do not prevent a veto', () => {
  assert.equal(hasUnprovenInventory({ target: root, objects: null, events: [] }), true);
  assert.equal(hasUnprovenInventory({ target: root, objects, events: null }), true);
  const cycle = [{ ...root, parent_object_id: 'group' }, group];
  assert.equal(hasUnprovenInventory({ target: root, objects: cycle, events: [event('group')] }), true);
});
