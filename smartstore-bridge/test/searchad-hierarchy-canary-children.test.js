import test from 'node:test';
import assert from 'node:assert/strict';

import { HierarchyCanaryService } from '../src/naver/searchad/lifecycle/hierarchy-canary-service.js';
import { createHierarchyCampaignRecipe } from '../src/naver/searchad/lifecycle/recipe-campaign.js';
import { createHierarchyChildRecipe } from '../src/naver/searchad/lifecycle/recipe-hierarchy.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';

const NOW = Date.parse('2026-09-11T06:30:00Z');
const admin100 = { principal: { principalId: 'admin-100', role: 'admin', customerIds: ['100'] }, requestId: 'request-100' };
const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const campaignId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const adgroupId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const keywordId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const creativeId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function clone(value) { return value == null ? value : structuredClone(value); }

function repositoryFixture() {
  const runs = new Map();
  const objects = new Map();
  const events = [];
  const ownership = [];
  return {
    runs, objects, events, ownership,
    async listRuns() { return []; },
    async createRun(run) { runs.set(run.hierarchyRunId, clone(run)); return clone(run); },
    async getRun(id, customerId = null) { const x = runs.get(id); return x && (!customerId || x.customerId === customerId) ? clone(x) : null; },
    async updateRun(id, patch) { const x = { ...runs.get(id), ...clone(patch) }; runs.set(id, x); return clone(x); },
    async createObject(object) { objects.set(object.hierarchyObjectId, clone(object)); return clone(object); },
    async getObject(id, customerId = null) { const x = objects.get(id); return x && (!customerId || x.customerId === customerId) ? clone(x) : null; },
    async listObjects(id, customerId = null) { return [...objects.values()].filter(x => x.hierarchyRunId === id && (!customerId || x.customerId === customerId)).map(clone); },
    async updateObject(id, patch) { const x = { ...objects.get(id), ...clone(patch) }; objects.set(id, x); return clone(x); },
    async listLiveChildren(parentObjectId, customerId = null) { return [...objects.values()].filter(x => x.parentObjectId === parentObjectId && x.state !== 'deleted' && (!customerId || x.customerId === customerId)).map(clone); },
    async addEvent(event) { events.push(clone(event)); return clone(event); },
    async listEvents(id, customerId = null) { return events.filter(x => x.hierarchyRunId === id && (!customerId || x.customerId === customerId)).map(clone); },
    async holdOwnership(record) { ownership.push(clone(record)); return clone(record); },
    async listOwnershipByRun({ ownerRunId, customerId = null }) { return ownership.filter(x => x.ownerRunId === ownerRunId && (!customerId || x.customerId === customerId)).map(clone); },
    async updateOwnership(id, patch) { const i = ownership.findIndex(x => x.ownershipId === id); if (i < 0) return null; ownership[i] = { ...ownership[i], ...clone(patch) }; return clone(ownership[i]); }
  };
}

async function seedRun(repository, { withAdgroup = false, withKeyword = false, withCreative = false } = {}) {
  const at = new Date(NOW).toISOString();
  await repository.createRun({ hierarchyRunId: runId, customerId: '100', recipeId: 'hierarchy_v1', status: 'active', startedByPrincipalId: 'admin-100', specSha: 'spec-100', credentialFingerprint: 'cred-100', upstreamBaseUrl: 'https://api.searchad.naver.com', activationId: '11111111-1111-4111-8111-111111111111', startedAt: at });
  await repository.createObject({ hierarchyObjectId: campaignId, hierarchyRunId: runId, customerId: '100', objectType: 'campaign', parentObjectId: null, createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create, readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.read, deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete, remoteId: 'cmp-100', state: 'owned', createdAt: at, updatedAt: at });
  await repository.holdOwnership({ ownershipId: 'f1111111-1111-4111-8111-111111111111', customerId: '100', objectType: 'campaign', remoteId: 'cmp-100', ownerKind: 'hierarchy_canary', ownerRunId: runId, hierarchyObjectId: campaignId, parentHierarchyObjectId: null, createdOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create, state: 'owned', createdAt: at, updatedAt: at });
  if (withAdgroup) {
    await repository.createObject({ hierarchyObjectId: adgroupId, hierarchyRunId: runId, customerId: '100', objectType: 'adgroup', parentObjectId: campaignId, createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create, readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.read, deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.delete, remoteId: 'grp-100', state: 'owned', createdAt: at, updatedAt: at });
    await repository.holdOwnership({ ownershipId: 'f2222222-2222-4222-8222-222222222222', customerId: '100', objectType: 'adgroup', remoteId: 'grp-100', ownerKind: 'hierarchy_canary', ownerRunId: runId, hierarchyObjectId: adgroupId, parentHierarchyObjectId: campaignId, createdOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create, state: 'owned', createdAt: at, updatedAt: at });
  }
  if (withKeyword) {
    await repository.createObject({ hierarchyObjectId: keywordId, hierarchyRunId: runId, customerId: '100', objectType: 'keyword', parentObjectId: adgroupId, createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create, readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.read, deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.delete, remoteId: 'kw-100', state: 'owned', createdAt: at, updatedAt: at });
    await repository.holdOwnership({ ownershipId: 'f3333333-3333-4333-8333-333333333333', customerId: '100', objectType: 'keyword', remoteId: 'kw-100', ownerKind: 'hierarchy_canary', ownerRunId: runId, hierarchyObjectId: keywordId, parentHierarchyObjectId: adgroupId, createdOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create, state: 'owned', createdAt: at, updatedAt: at });
  }
  if (withCreative) {
    await repository.createObject({ hierarchyObjectId: creativeId, hierarchyRunId: runId, customerId: '100', objectType: 'creative', parentObjectId: adgroupId, createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.create, readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.read, deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.delete, remoteId: 'ad-100', state: 'owned', createdAt: at, updatedAt: at });
    await repository.holdOwnership({ ownershipId: 'f4444444-4444-4444-8444-444444444444', customerId: '100', objectType: 'creative', remoteId: 'ad-100', ownerKind: 'hierarchy_canary', ownerRunId: runId, hierarchyObjectId: creativeId, parentHierarchyObjectId: adgroupId, createdOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.create, state: 'owned', createdAt: at, updatedAt: at });
  }
}

function serviceFixture({ campaignStopped = true, mutateImpl, deleteReadsAs404 = false } = {}) {
  const repository = repositoryFixture();
  const mutationKeys = [];
  const activationCalls = [];
  const riskCalls = [];
  let approvalClaims = 0;
  const remote = {
    async mutate(descriptor) {
      mutationKeys.push(descriptor.operationKey);
      if (mutateImpl) return mutateImpl(descriptor);
      if (descriptor.operationKey === SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create) return { data: { nccAdgroupId: 'grp-created' } };
      if (descriptor.operationKey === SEARCHAD_HIERARCHY_OPERATIONS.keyword.create) return { data: [{ nccKeywordId: 'kw-created-1' }, { nccKeywordId: 'kw-created-2' }] };
      if (descriptor.operationKey === SEARCHAD_HIERARCHY_OPERATIONS.creative.create) return { data: { nccAdId: 'ad-created' } };
      return { ok: true };
    },
    async read(descriptor) {
      if (descriptor.operationKey === SEARCHAD_HIERARCHY_OPERATIONS.campaign.read) {
        return { data: { nccCampaignId: 'cmp-100', campaignTp: 'WEB_SITE', userLock: campaignStopped } };
      }
      if (deleteReadsAs404) throw Object.assign(new Error('not found'), { status: 404 });
      return { data: { exists: true } };
    }
  };
  const service = new HierarchyCanaryService({
    repository,
    activationGuard: { async assertLifecycleMutationAllowed(input) { activationCalls.push(clone(input)); return { allowed: true, activationId: '11111111-1111-4111-8111-111111111111', ...input }; } },
    riskService: {
      async reserve(input) { riskCalls.push(['reserve', clone(input)]); return { reservation: { state: 'reserved' } }; },
      async consume(input) { riskCalls.push(['consume', clone(input)]); return { reservation: { state: 'consumed' } }; },
      async release(input) { riskCalls.push(['release', clone(input)]); return { reservation: { state: 'released' } }; }
    },
    approvalService: { async claim(planId, token) { approvalClaims += 1; assert.equal(planId, 'plan-100'); assert.equal(token, 'token-100'); return { approvalId: `approval-${approvalClaims}` }; } },
    remote,
    campaignRecipe: createHierarchyCampaignRecipe({ dailyBudget: 1_000 }),
    childRecipe: createHierarchyChildRecipe({ keywordTexts: ['haar-one', 'haar-two'], creative: { type: 'TEXT_45', headline: 'HAAR headline', description: 'HAAR description', pcFinal: 'https://example.invalid/haar', mobileFinal: 'https://example.invalid/haar' } }),
    gatewayContext: { specSha: 'spec-100', upstreamBaseUrl: 'https://api.searchad.naver.com' },
    credentialFingerprintResolver: async () => 'cred-100',
    clock: () => NOW
  });
  return { service, repository, mutationKeys, activationCalls, riskCalls, approvalClaims: () => approvalClaims };
}

const execution = { planId: 'plan-100', executionToken: 'token-100' };

test('child create re-reads top campaign and blocks before approval/risk/mutation when it is not stopped', async () => {
  const f = serviceFixture({ campaignStopped: false });
  await seedRun(f.repository);
  await assert.rejects(
    f.service.createAdgroup({ hierarchyRunId: runId, parentObjectId: campaignId, ...execution }, admin100),
    error => error?.code === 'SEARCHAD_HIERARCHY_CAMPAIGN_NOT_STOPPED'
  );
  assert.deepEqual(f.mutationKeys, []);
  assert.equal(f.approvalClaims(), 0);
  assert.deepEqual(f.riskCalls, []);
});

test('adgroup create uses persisted parent, exact activation/risk scope and response-returned ID only', async () => {
  const f = serviceFixture();
  await seedRun(f.repository);
  const result = await f.service.createAdgroup({ hierarchyRunId: runId, parentObjectId: campaignId, ...execution }, admin100);
  assert.equal(result.object.objectType, 'adgroup');
  assert.equal(result.object.parentObjectId, campaignId);
  assert.equal(result.object.remoteId, 'grp-created');
  assert.equal(result.object.state, 'owned');
  assert.deepEqual(f.activationCalls.at(-1), { customerId: '100', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create, lifecycleKind: 'create' });
  assert.equal(f.repository.ownership.some(x => x.objectType === 'adgroup' && x.remoteId === 'grp-created'), true);
});

test('keyword batch persists each returned keyword ID and creative create remains TEXT_45', async () => {
  const f = serviceFixture();
  await seedRun(f.repository, { withAdgroup: true });
  const keywords = await f.service.createKeywords({ hierarchyRunId: runId, parentObjectId: adgroupId, ...execution }, admin100);
  assert.deepEqual(keywords.objects.map(x => x.remoteId), ['kw-created-1', 'kw-created-2']);
  assert.equal(keywords.objects.every(x => x.objectType === 'keyword' && x.state === 'owned'), true);
  assert.deepEqual(f.activationCalls.at(-1), { customerId: '100', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create, lifecycleKind: 'batch_create' });

  const creative = await f.service.createCreative({ hierarchyRunId: runId, parentObjectId: adgroupId, ...execution }, admin100);
  assert.equal(creative.object.remoteId, 'ad-created');
  assert.equal(creative.object.objectType, 'creative');
  assert.deepEqual(f.activationCalls.at(-1), { customerId: '100', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.create, lifecycleKind: 'create' });
});

test('cleanupNext deletes deepest owned objects first and verifies deletion by returned ID before parent', async () => {
  const f = serviceFixture({ deleteReadsAs404: true });
  await seedRun(f.repository, { withAdgroup: true, withKeyword: true, withCreative: true });

  for (let i = 0; i < 4; i += 1) {
    await f.service.cleanupNext({ hierarchyRunId: runId, ...execution }, admin100);
  }
  assert.deepEqual(f.mutationKeys, [
    SEARCHAD_HIERARCHY_OPERATIONS.creative.delete,
    SEARCHAD_HIERARCHY_OPERATIONS.keyword.delete,
    SEARCHAD_HIERARCHY_OPERATIONS.adgroup.delete,
    SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete
  ]);
  assert.equal([...f.repository.objects.values()].every(x => x.state === 'deleted'), true);
  assert.equal(f.repository.ownership.every(x => x.state === 'deleted'), true);
  assert.equal(f.repository.runs.get(runId).status, 'passed');
});

test('cleanup never deletes a parent while a live child is unresolved', async () => {
  const f = serviceFixture({ deleteReadsAs404: true });
  await seedRun(f.repository, { withAdgroup: true });
  await f.repository.updateObject(adgroupId, { state: 'manual_review' });
  await assert.rejects(
    f.service.cleanupNext({ hierarchyRunId: runId, ...execution }, admin100),
    error => error?.code === 'SEARCHAD_HIERARCHY_CLEANUP_BLOCKED' && error?.status === 409
  );
  assert.deepEqual(f.mutationKeys, []);
  assert.equal(f.repository.objects.get(campaignId).state, 'owned');
});

test('ambiguous delete becomes delete_unknown and a later cleanup call never resends it', async () => {
  const timeout = Object.assign(new Error('timeout after delete dispatch'), { code: 'ETIMEDOUT', status: 504 });
  const f = serviceFixture({ mutateImpl: async descriptor => {
    if (descriptor.operationKey === SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete) throw timeout;
    return { ok: true };
  } });
  await seedRun(f.repository);

  await assert.rejects(
    f.service.cleanupNext({ hierarchyRunId: runId, ...execution }, admin100),
    error => error?.code === 'SEARCHAD_HIERARCHY_UNKNOWN_OUTCOME'
  );
  assert.deepEqual(f.mutationKeys, [SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete]);
  assert.equal(f.repository.objects.get(campaignId).state, 'delete_unknown');
  assert.equal(f.repository.ownership[0].state, 'delete_unknown');

  await assert.rejects(
    f.service.cleanupNext({ hierarchyRunId: runId, ...execution }, admin100),
    error => error?.code === 'SEARCHAD_HIERARCHY_DELETE_UNKNOWN' && error?.status === 409
  );
  assert.deepEqual(f.mutationKeys, [SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete]);
});
