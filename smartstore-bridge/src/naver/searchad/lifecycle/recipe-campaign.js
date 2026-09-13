import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from './operations.js';
import { assertNoCallerRemoteIds } from './hierarchy-validator.js';

function fail(code, message, details = {}, status = 409) {
  throw new SearchAdWriteError(code, message, details, status);
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    fail('SEARCHAD_HIERARCHY_CONFIG_INVALID', `${label} must be a finite positive number.`, { label }, 500);
  }
  return number;
}

function sanitizedToken(value, max = 40) {
  const token = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
  if (!token) fail('SEARCHAD_HIERARCHY_RUN_ID_REQUIRED', 'hierarchyRunId is required.', {}, 400);
  return token;
}

function nonNullObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function returnedCandidates(result, key) {
  const sources = [
    nonNullObject(result),
    nonNullObject(result?.data),
    nonNullObject(result?.value),
    nonNullObject(result?.body)
  ].filter(Boolean);
  return [...new Set(sources
    .filter(source => Object.hasOwn(source, key))
    .map(source => String(source[key] ?? '').trim())
    .filter(Boolean))];
}

export function extractReturnedId(result, key) {
  const candidates = returnedCandidates(result, key);
  if (!candidates.length) {
    fail('SEARCHAD_LIFECYCLE_RETURNED_ID_REQUIRED', `SearchAd create response must contain returned ${key}.`, { key });
  }
  if (candidates.length !== 1) {
    fail('SEARCHAD_LIFECYCLE_RETURNED_ID_AMBIGUOUS', `SearchAd create response contains ambiguous ${key} values.`, { key, count: candidates.length });
  }
  return candidates[0];
}

function assertNoNonNullCallerRemoteIds(input = {}) {
  const filtered = Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null)
  );
  assertNoCallerRemoteIds(filtered);
}

function assertStoredObject({ customerId, hierarchyRunId, object, objectType }) {
  if (!object || typeof object !== 'object') {
    fail('SEARCHAD_HIERARCHY_OBJECT_REQUIRED', 'A persisted hierarchy object is required.', { objectType }, 400);
  }
  if (String(object.customerId || '') !== String(customerId || '')) {
    fail('SEARCHAD_HIERARCHY_OBJECT_CUSTOMER_MISMATCH', 'Hierarchy object must belong to the same Customer.', { objectType }, 400);
  }
  if (String(object.hierarchyRunId || '') !== String(hierarchyRunId || '')) {
    fail('SEARCHAD_HIERARCHY_OBJECT_RUN_MISMATCH', 'Hierarchy object must belong to the same hierarchy run.', { objectType }, 400);
  }
  if (String(object.objectType || '') !== String(objectType)) {
    fail('SEARCHAD_HIERARCHY_OBJECT_TYPE_INVALID', 'Hierarchy object type is invalid.', {
      expected: objectType,
      actual: object?.objectType || null
    }, 400);
  }
  if (String(object.state || '') !== 'owned' || !String(object.remoteId || '').trim()) {
    fail('SEARCHAD_HIERARCHY_OBJECT_NOT_OWNED', 'Hierarchy object must have a persisted returned remote ID in owned state.', { objectType }, 409);
  }
  return object;
}

export function createHierarchyCampaignRecipe({ dailyBudget } = {}) {
  const budget = positiveNumber(dailyBudget, 'dailyBudget');

  return Object.freeze({
    id: 'hierarchy_stopped_web_site_campaign_v1',

    createCampaign(input = {}) {
      assertNoNonNullCallerRemoteIds(input);
      const customerId = String(input.customerId || '').trim();
      if (!customerId) fail('SEARCHAD_CUSTOMER_ID_REQUIRED', 'customerId is required.', {}, 400);
      const token = sanitizedToken(input.hierarchyRunId);
      return {
        operationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create,
        customerId,
        body: {
          campaignTp: 'WEB_SITE',
          name: `HAAR_HIERARCHY_${token}`,
          userLock: true,
          dailyBudget: budget
        }
      };
    },

    extractCampaignId(result) {
      return extractReturnedId(result, 'nccCampaignId');
    },

    readCampaign({ customerId, hierarchyRunId, object } = {}) {
      const stored = assertStoredObject({ customerId, hierarchyRunId, object, objectType: 'campaign' });
      return {
        operationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.read,
        customerId: String(customerId),
        pathParams: { campaignId: String(stored.remoteId) }
      };
    },

    deleteCampaign({ customerId, hierarchyRunId, object } = {}) {
      const stored = assertStoredObject({ customerId, hierarchyRunId, object, objectType: 'campaign' });
      return {
        operationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete,
        customerId: String(customerId),
        pathParams: { campaignId: String(stored.remoteId) }
      };
    }
  });
}

export const _internal = {
  positiveNumber,
  sanitizedToken,
  returnedCandidates,
  assertNoNonNullCallerRemoteIds,
  assertStoredObject
};
