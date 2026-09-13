const allowedTypes = new Set(['campaign', 'adgroup', 'keyword', 'creative']);
const settledStates = new Set(['owned', 'deleted']);
const targetStates = new Set(['owned', 'delete_pending', 'delete_unknown', 'manual_review', 'deleted']);

function reject(message) {
  const error = new Error(message);
  error.code = 'SEARCHAD_EXTENDED_CLEANUP_ORDER';
  error.status = 409;
  throw error;
}

export function assertExtendedDeleteOrder(objects, targetId) {
  if (!Array.isArray(objects) || objects.length < 3) reject('bounded graph required');
  if (objects.some(item => !item || typeof item.id !== 'string' || !allowedTypes.has(item.type))) reject('bounded graph invalid');
  if (new Set(objects.map(item => item.id)).size !== objects.length) reject('bounded graph duplicate');

  const roots = objects.filter(item => item.type === 'campaign');
  const groups = objects.filter(item => item.type === 'adgroup');
  const leaves = objects.filter(item => item.type === 'keyword' || item.type === 'creative');
  if (roots.length !== 1 || groups.length !== 1 || leaves.length < 1) reject('bounded graph shape invalid');

  const root = roots[0];
  const group = groups[0];
  if (root.parentId !== null || group.parentId !== root.id || leaves.some(item => item.parentId !== group.id)) reject('bounded parent chain invalid');
  if (new Set(leaves.map(item => item.type)).size !== 1) reject('bounded sibling type mismatch');

  const target = objects.find(item => item.id === targetId);
  if (!target) reject('target outside bounded graph');
  if (!targetStates.has(target.state)) reject('unresolved target state');
  if (objects.some(item => item.id !== targetId && !settledStates.has(item.state))) reject('unresolved descendant state');

  if (target.type === 'keyword' || target.type === 'creative') {
    if (root.state !== 'owned' || group.state !== 'owned') reject('descendant order violation');
    return target;
  }
  if (target.type === 'adgroup') {
    if (root.state !== 'owned' || leaves.some(item => item.state !== 'deleted')) reject('descendant order violation');
    return target;
  }
  if (target.type === 'campaign') {
    if (group.state !== 'deleted' || leaves.some(item => item.state !== 'deleted')) reject('descendant order violation');
    return target;
  }
  reject('unsupported target');
}
