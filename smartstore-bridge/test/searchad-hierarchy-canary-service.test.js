import test from 'node:test';
import assert from 'node:assert/strict';

import { HierarchyCanaryService } from '../src/naver/searchad/lifecycle/hierarchy-canary-service.js';
import { createHierarchyCampaignRecipe } from '../src/naver/searchad/lifecycle/recipe-campaign.js';
import { createHierarchyChildRecipe } from '../src/naver/searchad/lifecycle/recipe-hierarchy.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';

const NOW = Date.parse('2026-09-11T06:00:00Z');
const admin100 = {
  principal: { principalId: 'admin-hierarchy-100', role: 'admin', customerIds: ['100'] },
  requestId: 'request-hierarchy-100'
};

function clone(value) { return value == null ? value : structuredClone(value); }

function makeRepository(order = []) {
  const runs = new Map();
  const objects = new Map();
  const events = [];
  const ownership = [];
  return {
    runs,
    objects,
    events,
    ownership,
    async listRuns({ customerIds = [], statuses = [] } = {}) {
      return [...runs.values()].filter(run =>
        customerIds.includes(run.customerId) && (!statuses.length || statuses.includes(run.status))
      ).map(clone);
    },
    async createRun(run) { runs.set(run.hierarchyRunId, clone(run)); return clone(run); },
    async getRun(id, customerId = null) {
      const run = runs.get(id);
      return run && (customerId == null || run.customerId === customerId) ? clone(run) : null;
    },
    async updateRun(id, patch) {
      const current = runs.get(id);
      if (!current) return null;
      const next = { ...current, ...clone(patch) };
      runs.set(id, next);
      return clone(next);
    },
    async createObject(object) { objects.set(object.hierarchyObjectId, clone(object)); return clone(object); },
    async getObject(id, customerId = null) {
      const object = objects.get(id);
      return object && (customerId == null || object.customerId === customerId) ? clone(object) : null;
    },
    async listObjects(runId, customerId = null) {
      return [...objects.values()].filter(object => object.hierarchyRunId === runId && (customerId == null || object.customerId === customerId)).map(clone);
    },
    async updateObject(id, patch) {
      const current = objects.get(id);
      if (!current) return null;
      const next = { ...current, ...clone(patch) };
      objects.set(id, next);
      return clone(next);
    },
    async listLiveChildren(parentObjectId, customerId = null) {
      return [...objects.values()].filter(object =>
        object.parentObjectId === parentObjectId && object.state !== 'deleted' && (customerId == null || object.customerId === customerId)
      ).map(clone);
    },
    async addEvent(event) {
      events.push(clone(event));
      if (event.status === 'dispatch_intent') order.push('dispatch-intent');
      return clone(event);
    },
    async listEvents(runId, customerId = null) {
      return events.filter(event => event.hierarchyRunId === runId && (customerId == null || event.customerId === customerId)).map(clone);
    },
    async holdOwnership(record) { ownership.push(clone(record)); return clone(record); },
    async updateOwnership(id, patch) {
      const index = ownership.findIndex(item => item.ownershipId === id);
      if (index < 0) return null;
      ownership[index] = { ...ownership[index], ...clone(patch) };
      return clone(ownership[index]);
    },
    async listOwnershipByRun({ ownerRunId, customerId = null } = {}) {
      return ownership.filter(item => item.ownerRunId === ownerRunId && (customerId == null || item.customerId === customerId)).map(clone);
    }
  };
}

function fixture({ mutateImpl, readImpl } = {}) {
  const order = [];
  const repository = makeRepository(order);
  let mutateCount = 0;
  let readCount = 0;
  const activationGuard = {
    async assertLifecycleMutationAllowed(input) {
      order.push('activation');
      return {
        allowed: true,
        activationId: '11111111-1111-4111-8111-111111111111',
        evidenceId: 'evidence-hierarchy-100',
        ...input
      };
    }
  };
  const riskService = {
    async reserve(input) { order.push('risk-reserve'); return { reservation: { ...clone(input), state: 'reserved' } }; },
    async consume(input) { order.push('risk-consume'); return { reservation: { ...clone(input), state: 'consumed' } }; },
    async release(input) { order.push('risk-release'); return { reservation: { ...clone(input), state: 'released' } }; }
  };
  const approvalService = {
    async claim(planId, executionToken) {
      order.push('approval-claim');
      assert.equal(planId, 'plan-100');
      assert.equal(executionToken, 'token-100');
      return { approvalId: 'approval-100', planId };
    }
  };
  const remote = {
    async mutate(descriptor) {
      mutateCount += 1;
      order.push('remote-mutate');
      return mutateImpl ? mutateImpl(descriptor) : { data: { nccCampaignId: 'cmp-returned-100' }, upstream: { requestId: 'remote-request-100' } };
    },
    async read(descriptor) {
      readCount += 1;
      order.push('remote-read');
      return readImpl ? readImpl(descriptor) : { data: { nccCampaignId: 'cmp-returned-100', campaignTp: 'WEB_SITE', userLock: true } };
    }
  };
  const service = new HierarchyCanaryService({
    repository,
    activationGuard,
    riskService,
    approvalService,
    remote,
    campaignRecipe: createHierarchyCampaignRecipe({ dailyBudget: 1_000 }),
    childRecipe: createHierarchyChildRecipe(),
    gatewayContext: { specSha: 'spec-100', upstreamBaseUrl: 'https://api.searchad.naver.com' },
    credentialFingerprintResolver: async customerId => {
      assert.equal(customerId, '100');
      return 'credential-100';
    },
    clock: () => NOW
  });
  return { service, repository, order, mutateCount: () => mutateCount, readCount: () => readCount };
}

const startInput = { customerId: '100', planId: 'plan-100', executionToken: 'token-100' };

test('hierarchy start requires Admin plus explicit Customer access before side effects', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.start(startInput, { principal: { principalId: 'reader-100', role: 'reader', customerIds: ['100'] } }),
    error => error?.code === 'SEARCHAD_HIERARCHY_ADMIN_REQUIRED' && error?.status === 403
  );
  await assert.rejects(
    f.service.start(startInput, { principal: { principalId: 'admin-200', role: 'admin', customerIds: ['200'] } }),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN' && error?.status === 403
  );
  assert.equal(f.mutateCount(), 0);
  assert.deepEqual(f.order, []);
});

test('caller-supplied remote target ID is rejected before activation, approval, risk or remote I/O', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.start({ ...startInput, remoteId: 'attacker-existing-id' }, admin100),
    error => error?.code === 'SEARCHAD_HIERARCHY_REMOTE_ID_INJECTION'
  );
  assert.equal(f.mutateCount(), 0);
  assert.deepEqual(f.order, []);
});

test('successful campaign create persists only the response-returned ID and ownership hold', async () => {
  const f = fixture();
  const result = await f.service.start(startInput, admin100);

  const remoteIndex = f.order.indexOf('remote-mutate');
  for (const required of ['activation', 'risk-reserve', 'approval-claim', 'risk-consume', 'dispatch-intent']) {
    assert.notEqual(f.order.indexOf(required), -1, `${required} must occur`);
    assert.ok(f.order.indexOf(required) < remoteIndex, `${required} must occur before remote mutation`);
  }

  assert.equal(f.mutateCount(), 1);
  assert.equal(result.run.status, 'active');
  assert.equal(result.object.objectType, 'campaign');
  assert.equal(result.object.remoteId, 'cmp-returned-100');
  assert.equal(result.object.state, 'owned');
  assert.equal(f.repository.ownership.length, 1);
  assert.equal(f.repository.ownership[0].remoteId, 'cmp-returned-100');
  assert.equal(f.repository.ownership[0].state, 'owned');
  assert.equal(f.repository.ownership[0].customerId, '100');
});

test('ambiguous campaign create becomes unknown_outcome, consumes risk, and is never resent', async () => {
  const timeout = Object.assign(new Error('upstream timeout after dispatch'), { code: 'ETIMEDOUT', status: 504 });
  const f = fixture({ mutateImpl: async () => { throw timeout; } });

  await assert.rejects(
    f.service.start(startInput, admin100),
    error => error?.code === 'SEARCHAD_HIERARCHY_UNKNOWN_OUTCOME' && error?.status === 409
  );
  assert.equal(f.mutateCount(), 1);
  assert.equal(f.order.includes('risk-consume'), true);
  assert.equal(f.order.includes('risk-release'), false);

  const [run] = [...f.repository.runs.values()];
  const [object] = [...f.repository.objects.values()];
  assert.equal(run.status, 'unknown_outcome');
  assert.equal(object.state, 'create_unknown');
  assert.equal(object.remoteId, null);

  await assert.rejects(
    f.service.start(startInput, admin100),
    error => error?.code === 'SEARCHAD_HIERARCHY_ALREADY_ACTIVE' && error?.status === 409
  );
  assert.equal(f.mutateCount(), 1);
});

test('read-only reconcile never mutates and unresolved create without returned ID becomes manual review', async () => {
  const f = fixture();
  await f.repository.createRun({
    hierarchyRunId: '44444444-4444-4444-8444-444444444444', customerId: '100', recipeId: 'hierarchy_v1',
    status: 'unknown_outcome', startedByPrincipalId: 'admin-hierarchy-100', specSha: 'spec-100',
    credentialFingerprint: 'credential-100', upstreamBaseUrl: 'https://api.searchad.naver.com',
    activationId: '11111111-1111-4111-8111-111111111111', startedAt: new Date(NOW).toISOString()
  });
  await f.repository.createObject({
    hierarchyObjectId: '55555555-5555-4555-8555-555555555555', hierarchyRunId: '44444444-4444-4444-8444-444444444444',
    customerId: '100', objectType: 'campaign', createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create,
    readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.read, deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete,
    remoteId: null, state: 'create_unknown', createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString()
  });

  const result = await f.service.reconcile('44444444-4444-4444-8444-444444444444', admin100);
  assert.equal(f.mutateCount(), 0);
  assert.equal(result.status, 'manual_review');
  assert.equal(f.repository.objects.get('55555555-5555-4555-8555-555555555555').state, 'manual_review');
  assert.equal(f.repository.events.some(event => event.phase === 'reconcile' && event.status === 'unresolved_no_returned_id'), true);
});

test('restart recovery from persisted dispatching state never replays mutation', async () => {
  const f = fixture();
  await f.repository.createRun({
    hierarchyRunId: '66666666-6666-4666-8666-666666666666', customerId: '100', recipeId: 'hierarchy_v1',
    status: 'active', startedByPrincipalId: 'admin-hierarchy-100', specSha: 'spec-100',
    credentialFingerprint: 'credential-100', upstreamBaseUrl: 'https://api.searchad.naver.com',
    activationId: '11111111-1111-4111-8111-111111111111', startedAt: new Date(NOW).toISOString()
  });
  await f.repository.createObject({
    hierarchyObjectId: '77777777-7777-4777-8777-777777777777', hierarchyRunId: '66666666-6666-4666-8666-666666666666',
    customerId: '100', objectType: 'campaign', createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create,
    readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.read, deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete,
    remoteId: null, state: 'dispatching', createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString()
  });
  await f.repository.addEvent({
    eventId: '88888888-8888-4888-8888-888888888888', hierarchyRunId: '66666666-6666-4666-8666-666666666666',
    hierarchyObjectId: '77777777-7777-4777-8777-777777777777', customerId: '100', phase: 'campaign_create',
    status: 'dispatch_intent', operationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create, lifecycleKind: 'create',
    createdAt: new Date(NOW).toISOString()
  });

  const restarted = new HierarchyCanaryService({
    repository: f.repository,
    activationGuard: { async assertLifecycleMutationAllowed() { throw new Error('must not authorize during read-only recovery'); } },
    riskService: { reserve() { throw new Error('must not reserve during recovery'); }, consume() { throw new Error('must not consume during recovery'); }, release() { throw new Error('must not release during recovery'); } },
    approvalService: { claim() { throw new Error('must not claim during recovery'); } },
    remote: { async mutate() { throw new Error('must not mutate during recovery'); }, async read() { return null; } },
    campaignRecipe: createHierarchyCampaignRecipe({ dailyBudget: 1_000 }),
    childRecipe: createHierarchyChildRecipe(),
    gatewayContext: { specSha: 'spec-100', upstreamBaseUrl: 'https://api.searchad.naver.com' },
    credentialFingerprintResolver: async () => 'credential-100',
    clock: () => NOW
  });

  const result = await restarted.reconcile('66666666-6666-4666-8666-666666666666', admin100);
  assert.equal(result.status, 'manual_review');
  assert.equal(f.repository.objects.get('77777777-7777-4777-8777-777777777777').state, 'manual_review');
  assert.equal(f.mutateCount(), 0);
});
