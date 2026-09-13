import { SearchAdWriteError } from '../write/errors.js';
import { KEYWORD_CREATE_MAX_BATCH } from './operations.js';

const REMOTE_ID_KEYS = new Set([
  'remoteId',
  'nccCampaignId',
  'nccAdgroupId',
  'nccKeywordId',
  'nccAdId'
]);

const EXPECTED_PARENT_TYPE = Object.freeze({
  adgroup: 'campaign',
  keyword: 'adgroup',
  creative: 'adgroup'
});

function fail(code, message, details = {}) {
  throw new SearchAdWriteError(code, message, details, 400);
}

function scanForRemoteIds(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForRemoteIds(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (REMOTE_ID_KEYS.has(key)) {
      fail('SEARCHAD_HIERARCHY_REMOTE_ID_INJECTION', 'Caller-supplied SearchAd remote IDs are forbidden for hierarchy Canary targets.', {
        path: `${path}.${key}`
      });
    }
    scanForRemoteIds(child, `${path}.${key}`);
  }
}

export function assertNoCallerRemoteIds(payload) {
  scanForRemoteIds(payload);
  return true;
}

export function assertHierarchyParent({ customerId, runId, childType, parent } = {}) {
  const expectedParentType = EXPECTED_PARENT_TYPE[String(childType || '')];
  if (!expectedParentType) {
    fail('SEARCHAD_HIERARCHY_PARENT_TYPE_INVALID', 'Hierarchy child type does not have a supported parent type.', { childType: childType || null });
  }
  if (String(parent?.customerId || '') !== String(customerId || '')) {
    fail('SEARCHAD_HIERARCHY_PARENT_CUSTOMER_MISMATCH', 'Hierarchy parent must belong to the same Customer.');
  }
  if (String(parent?.runId || '') !== String(runId || '')) {
    fail('SEARCHAD_HIERARCHY_PARENT_RUN_MISMATCH', 'Hierarchy parent must belong to the same Canary run.');
  }
  if (parent?.objectType !== expectedParentType) {
    fail('SEARCHAD_HIERARCHY_PARENT_TYPE_INVALID', 'Hierarchy parent type is invalid.', {
      childType,
      expectedParentType,
      actualParentType: parent?.objectType || null
    });
  }
  if (parent?.ownershipState !== 'owned' || typeof parent?.remoteId !== 'string' || parent.remoteId.trim() === '') {
    fail('SEARCHAD_HIERARCHY_PARENT_NOT_OWNED', 'Hierarchy parent must have a server-persisted returned remote ID in owned state.');
  }
  return true;
}

export function assertTopCampaignStopped(campaign) {
  const state = String(campaign?.state || '').trim().toLowerCase();
  if (campaign?.userLock === true || state === 'paused' || state === 'stopped') return true;
  fail('SEARCHAD_HIERARCHY_CAMPAIGN_NOT_STOPPED', 'Top campaign must be remotely stopped or paused before child hierarchy mutation.');
}

export function assertKeywordBatch(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > KEYWORD_CREATE_MAX_BATCH) {
    fail('SEARCHAD_KEYWORD_BATCH_LIMIT', `Keyword create batch must contain 1..${KEYWORD_CREATE_MAX_BATCH} items.`, {
      maxBatch: KEYWORD_CREATE_MAX_BATCH,
      count: Array.isArray(items) ? items.length : null
    });
  }
  return true;
}

export function assertText45Creative(creative) {
  if (creative?.type !== 'TEXT_45') {
    fail('SEARCHAD_CREATIVE_TYPE_INVALID', 'Hierarchy creative type must be TEXT_45.');
  }
  return true;
}
