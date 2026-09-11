import { SearchAdWriteError } from '../write/errors.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from './operations.js';
import {
  assertHierarchyParent,
  assertKeywordBatch,
  assertNoCallerRemoteIds,
  assertText45Creative
} from './hierarchy-validator.js';
import { extractReturnedId } from './recipe-campaign.js';

function fail(code, message, details = {}, status = 409) {
  throw new SearchAdWriteError(code, message, details, status);
}

function sanitizedToken(value, max = 32) {
  const token = String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, max);
  if (!token) fail('SEARCHAD_HIERARCHY_RUN_ID_REQUIRED', 'hierarchyRunId is required.', {}, 400);
  return token;
}

function assertNoExternalRemoteIds(input = {}) {
  const external = Object.fromEntries(
    Object.entries(input || {})
      .filter(([key, value]) => key !== 'parent' && key !== 'object' && value !== undefined && value !== null)
  );
  assertNoCallerRemoteIds(external);
}

function parentView(parent) {
  return {
    customerId: parent?.customerId,
    runId: parent?.hierarchyRunId ?? parent?.runId,
    objectType: parent?.objectType,
    ownershipState: parent?.state ?? parent?.ownershipState,
    remoteId: parent?.remoteId
  };
}

function assertOwnedParent({ customerId, hierarchyRunId, childType, parent }) {
  assertHierarchyParent({
    customerId,
    runId: hierarchyRunId,
    childType,
    parent: parentView(parent)
  });
  return parent;
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
  if (String(object.objectType || '') !== objectType) {
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

function normalizeKeywordTexts(value) {
  const texts = value == null ? ['haar-hierarchy-canary'] : value;
  assertKeywordBatch(texts);
  return Object.freeze(texts.map(text => String(text || '').trim()).map((text, index) => {
    if (!text) fail('SEARCHAD_KEYWORD_TEXT_REQUIRED', 'Hierarchy keyword text must be non-empty.', { index }, 400);
    return text;
  }));
}

function normalizeCreative(value) {
  const creative = value == null ? {
    type: 'TEXT_45',
    headline: 'HAAR hierarchy canary',
    description: 'HAAR hierarchy canary verification',
    pcFinal: 'https://example.invalid/haar-hierarchy-canary',
    mobileFinal: 'https://example.invalid/haar-hierarchy-canary'
  } : value;
  assertText45Creative(creative);
  return Object.freeze({
    type: 'TEXT_45',
    headline: String(creative.headline || 'HAAR hierarchy canary').trim(),
    description: String(creative.description || 'HAAR hierarchy canary verification').trim(),
    pcFinal: String(creative.pcFinal || 'https://example.invalid/haar-hierarchy-canary').trim(),
    mobileFinal: String(creative.mobileFinal || creative.pcFinal || 'https://example.invalid/haar-hierarchy-canary').trim()
  });
}

function keywordArraySources(result) {
  const sources = [result, result?.data, result?.value, result?.body].filter(Array.isArray);
  return sources.map(items => items.map((item, index) => {
    const value = String(item?.nccKeywordId ?? '').trim();
    if (!value) {
      fail('SEARCHAD_LIFECYCLE_RETURNED_ID_REQUIRED', 'Every SearchAd keyword create result must contain returned nccKeywordId.', { index });
    }
    return value;
  }));
}

function extractKeywordIds(result) {
  const arrays = keywordArraySources(result);
  if (!arrays.length) {
    fail('SEARCHAD_LIFECYCLE_RETURNED_ID_REQUIRED', 'SearchAd keyword create response must contain returned nccKeywordId values.');
  }
  const unique = [...new Map(arrays.map(values => [JSON.stringify(values), values])).values()];
  if (unique.length !== 1) {
    fail('SEARCHAD_LIFECYCLE_RETURNED_ID_AMBIGUOUS', 'SearchAd keyword create response contains ambiguous returned ID sets.', { count: unique.length });
  }
  return unique[0];
}

function readDescriptor({ customerId, hierarchyRunId, object, objectType, operationKey, pathKey }) {
  const stored = assertStoredObject({ customerId, hierarchyRunId, object, objectType });
  return {
    operationKey,
    customerId: String(customerId),
    pathParams: { [pathKey]: String(stored.remoteId) }
  };
}

export function createHierarchyChildRecipe({ keywordTexts, creative } = {}) {
  const keywords = normalizeKeywordTexts(keywordTexts);
  const creativeConfig = normalizeCreative(creative);

  return Object.freeze({
    id: 'hierarchy_children_v1',

    createAdgroup(input = {}) {
      assertNoExternalRemoteIds(input);
      const customerId = String(input.customerId || '').trim();
      const hierarchyRunId = String(input.hierarchyRunId || '').trim();
      const parent = assertOwnedParent({ customerId, hierarchyRunId, childType: 'adgroup', parent: input.parent });
      return {
        operationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create,
        customerId,
        body: {
          nccCampaignId: String(parent.remoteId),
          name: `HAAR_HIERARCHY_ADGROUP_${sanitizedToken(hierarchyRunId)}`,
          userLock: true
        }
      };
    },

    createKeywords(input = {}) {
      assertNoExternalRemoteIds(input);
      const customerId = String(input.customerId || '').trim();
      const hierarchyRunId = String(input.hierarchyRunId || '').trim();
      const parent = assertOwnedParent({ customerId, hierarchyRunId, childType: 'keyword', parent: input.parent });
      return {
        operationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create,
        customerId,
        query: { nccAdgroupId: String(parent.remoteId) },
        body: keywords.map(keyword => ({ keyword }))
      };
    },

    createCreative(input = {}) {
      assertNoExternalRemoteIds(input);
      const customerId = String(input.customerId || '').trim();
      const hierarchyRunId = String(input.hierarchyRunId || '').trim();
      const parent = assertOwnedParent({ customerId, hierarchyRunId, childType: 'creative', parent: input.parent });
      return {
        operationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.create,
        customerId,
        body: {
          nccAdgroupId: String(parent.remoteId),
          type: 'TEXT_45',
          ad: {
            headline: creativeConfig.headline,
            description: creativeConfig.description,
            pc: { final: creativeConfig.pcFinal },
            mobile: { final: creativeConfig.mobileFinal }
          }
        }
      };
    },

    extractAdgroupId(result) {
      return extractReturnedId(result, 'nccAdgroupId');
    },

    extractKeywordIds,

    extractCreativeId(result) {
      return extractReturnedId(result, 'nccAdId');
    },

    readAdgroup(args = {}) {
      assertNoExternalRemoteIds(args);
      return readDescriptor({ ...args, objectType: 'adgroup', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.read, pathKey: 'adgroupId' });
    },

    deleteAdgroup(args = {}) {
      assertNoExternalRemoteIds(args);
      return readDescriptor({ ...args, objectType: 'adgroup', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.delete, pathKey: 'adgroupId' });
    },

    readKeyword(args = {}) {
      assertNoExternalRemoteIds(args);
      return readDescriptor({ ...args, objectType: 'keyword', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.read, pathKey: 'nccKeywordId' });
    },

    deleteKeyword(args = {}) {
      assertNoExternalRemoteIds(args);
      return readDescriptor({ ...args, objectType: 'keyword', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.delete, pathKey: 'nccKeywordId' });
    },

    readCreative(args = {}) {
      assertNoExternalRemoteIds(args);
      return readDescriptor({ ...args, objectType: 'creative', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.read, pathKey: 'adId' });
    },

    deleteCreative(args = {}) {
      assertNoExternalRemoteIds(args);
      return readDescriptor({ ...args, objectType: 'creative', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.delete, pathKey: 'adId' });
    }
  });
}

export const _internal = {
  sanitizedToken,
  assertNoExternalRemoteIds,
  parentView,
  assertOwnedParent,
  assertStoredObject,
  normalizeKeywordTexts,
  normalizeCreative,
  keywordArraySources,
  extractKeywordIds,
  readDescriptor
};
