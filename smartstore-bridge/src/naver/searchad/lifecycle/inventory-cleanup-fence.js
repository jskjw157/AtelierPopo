const INVENTORY_PHASES = new Set(['descendant_inventory', 'partial_keyword_inventory']);

/**
 * Negative safety fence over a caller-validated, Customer/run-scoped graph.
 * Existing list observations never establish complete remote absence. Ignore
 * claimed completeness/authority flags and retain the veto even for deleted
 * local descendants. Known keyword/creative leaf cleanup is separate.
 *
 * false means only that this additional veto is absent. It is NOT an absence
 * proof, a capability grant, or permission to expose legacy cleanup to HTTP.
 */
export function hasUnprovenInventory({ target, objects, events } = {}) {
  if (['keyword', 'creative'].includes(target?.object_type)) return false;
  if (!['campaign', 'adgroup'].includes(target?.object_type) ||
      !Array.isArray(objects) || !Array.isArray(events)) return true;

  const subtree = new Set([target.hierarchy_object_id]);
  let previousSize;
  do {
    previousSize = subtree.size;
    for (const object of objects) {
      if (subtree.has(object.parent_object_id)) subtree.add(object.hierarchy_object_id);
    }
  } while (subtree.size !== previousSize);

  return events.some(event => INVENTORY_PHASES.has(event.phase) &&
    (event.hierarchy_object_id == null || subtree.has(event.hierarchy_object_id)));
}
