import { SEARCHAD_HIERARCHY_OPERATIONS as OPS, KEYWORD_CREATE_MAX_BATCH } from './operations.js';

const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Conservative batch parser: partial, extra, duplicate or contradictory results are never promoted. */
export function keywordBatchResponse(result, descriptor) {
  if (!record(result) || Object.hasOwn(result, 'body') || Object.hasOwn(result, 'value')) return null;
  if (result.operation?.operationKey !== OPS.keyword.create || result.operation?.sideEffect !== true) return null;
  if (![200, 201].includes(result.upstream?.status)) return null;
  if (!record(descriptor) || descriptor.operationKey !== OPS.keyword.create || typeof descriptor.customerId !== 'string' || !descriptor.customerId) return null;
  if (!record(descriptor.query) || typeof descriptor.query.nccAdgroupId !== 'string' || !REMOTE_ID.test(descriptor.query.nccAdgroupId)) return null;
  if (!Array.isArray(descriptor.body) || descriptor.body.length < 1 || descriptor.body.length > KEYWORD_CREATE_MAX_BATCH) return null;
  if (!Array.isArray(result.data) || result.data.length !== descriptor.body.length) return null;

  const ids = [];
  for (let index = 0; index < descriptor.body.length; index += 1) {
    const expected = descriptor.body[index];
    const item = result.data[index];
    if (!record(expected) || typeof expected.keyword !== 'string' || !expected.keyword.trim() || !record(item)) return null;
    const id = String(item.nccKeywordId ?? '').trim();
    if (!REMOTE_ID.test(id)) return null;
    if (Object.hasOwn(item, 'keyword') && String(item.keyword) !== expected.keyword) return null;
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) return null;
  return Object.freeze(ids);
}
