import test from 'node:test';
import assert from 'node:assert/strict';

import { ActiveCanaryService } from '../src/naver/searchad/canary/active-canary-service.js';
import { SearchAdWriteError } from '../src/naver/searchad/write/errors.js';

const admin = {
  principalId: 'admin-100',
  role: 'admin',
  customerIds: ['100']
};

function fixture({ status = 'cleanup_required', remoteId = 'cmp-returned-100', beforeSpend = 0, readResult = null, mutateImpl } = {}) {
  let now = Date.parse('2026-09-11T00:00:00Z');
  const calls = [];
  const run = {
    canaryRunId: 'run-100',
    customerId: '100',
    passiveEvidenceId: 'passive-100',
    recipeId: 'stopped_web_site_campaign_v1',
    status,
    startedByPrincipalId: 'admin-100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    verifiedOperationScope: { operationKeys: ['campaign.delete'], fieldScope: ['campaign.userLock'] },
    startedAt: new Date(now - 60_000).toISOString(),
    beforeSpend,
    remoteId,
    cleanupVerifiedAt: null,
    completedAt: null,
    lastError: null
  };
  const repository = {
    async getRun(id) {
      calls.push({ type: 'getRun', id });
      return id === run.canaryRunId ? { ...run } : null;
    },
    async updateRun(id, patch) {
      calls.push({ type: 'updateRun', id, patch: structuredClone(patch) });
      Object.assign(run, patch);
      return { ...run };
    },
    async updateObject(canaryRunId, objectRemoteId, patch) {
      calls.push({ type: 'updateObject', canaryRunId, remoteId: objectRemoteId, patch: structuredClone(patch) });
      return { canaryRunId, remoteId: objectRemoteId, ...patch };
    },
    async settleMutation(runId, patch, event) {
      const result = await this.updateRun(runId, patch); await this.addEvent(event); return result;
    },
    async addEvent(event) {
      calls.push({ type: 'addEvent', event: structuredClone(event) });
      return event.eventId;
    }
  };
  const remote = {
    async read(descriptor) {
      calls.push({ type: 'read', descriptor: structuredClone(descriptor) });
      if (readResult instanceof Error) throw readResult;
      return readResult;
    },
    async mutate(descriptor) {
      calls.push({ type: 'mutate', descriptor: structuredClone(descriptor) });
      if (mutateImpl) return mutateImpl(descriptor);
      return { requestId: 'delete-request-1' };
    }
  };
  const recipe = {
    id: 'stopped_web_site_campaign_v1',
    requiredOperationKeys: [],
    verifiedOperationScope: { operationKeys: ['campaign.delete'], fieldScope: ['campaign.userLock'] },
    readCampaign({ customerId, remoteId: id }) {
      return {
        operationKey: 'campaign.read',
        customerId: String(customerId),
        pathParams: { campaignId: String(id) }
      };
    },
    cleanupCampaign({ customerId, remoteId: id }) {
      return {
        operationKey: 'campaign.delete',
        customerId: String(customerId),
        pathParams: { campaignId: String(id) }
      };
    },
    assertCleanup(value) { return value == null; },
    parseSpend() { return 0; }
  };
  const service = new ActiveCanaryService({
    repository,
    remote,
    recipe,
    config: {
      allowActiveCanary: true,
      activationMode: 'canary',
      specSha: 'spec-100',
      credentialFingerprint: 'credential-100',
      upstreamBaseUrl: 'https://api.searchad.naver.com'
    },
    credentialFingerprintResolver: async () => 'credential-100',
    clock: () => now
  });
  return {
    service,
    calls,
    run,
    advance(ms) { now += ms; }
  };
}

function notFoundError() {
  const error = new Error('not found');
  error.status = 404;
  return error;
}

test('reconcile is read-only and can confirm cleanup by the persisted returned remote ID', async () => {
  const f = fixture({ readResult: notFoundError() });

  const result = await f.service.reconcile('run-100', { principal: admin, requestId: 'req-reconcile' });

  assert.equal(result.status, 'spend_check_pending');
  assert.ok(result.cleanupVerifiedAt);
  assert.equal(f.calls.filter(call => call.type === 'mutate').length, 0);
  const read = f.calls.find(call => call.type === 'read');
  assert.equal(read.descriptor.pathParams.campaignId, 'cmp-returned-100');
});

test('cleanup sends one delete only to the persisted returned remote ID and verifies deletion read-only', async () => {
  const f = fixture({ readResult: notFoundError() });

  const result = await f.service.cleanup('run-100', { principal: admin, requestId: 'req-cleanup' });

  assert.equal(result.status, 'spend_check_pending');
  const mutations = f.calls.filter(call => call.type === 'mutate');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].descriptor.pathParams.campaignId, 'cmp-returned-100');
  assert.equal(JSON.stringify(mutations[0].descriptor).includes('name'), false);
  assert.equal(f.calls.filter(call => call.type === 'read').length, 1);
});

test('cleanup with no persisted returned remote ID is blocked before mutation', async () => {
  const f = fixture({ remoteId: null });

  await assert.rejects(
    f.service.cleanup('run-100', { principal: admin, requestId: 'req-cleanup' }),
    error => error?.code === 'SEARCHAD_CANARY_REMOTE_ID_REQUIRED' && error?.status === 409
  );
  assert.equal(f.calls.filter(call => call.type === 'mutate').length, 0);
});

test('ambiguous cleanup is never blindly resent on a second cleanup request', async () => {
  const ambiguous = new SearchAdWriteError(
    'SEARCHAD_UPSTREAM_UNAVAILABLE',
    'ambiguous delete',
    {},
    503
  );
  ambiguous.ambiguous = true;
  const f = fixture({
    mutateImpl() { throw ambiguous; }
  });

  await assert.rejects(
    f.service.cleanup('run-100', { principal: admin, requestId: 'req-cleanup-1' }),
    error => error?.code === 'SEARCHAD_CANARY_UNKNOWN_OUTCOME'
  );
  const sentAfterFirst = f.calls.filter(call => call.type === 'mutate').length;
  assert.equal(sentAfterFirst, 1);

  await assert.rejects(
    f.service.cleanup('run-100', { principal: admin, requestId: 'req-cleanup-2' }),
    error => error?.code === 'SEARCHAD_CANARY_CLEANUP_NOT_ALLOWED' && error?.status === 409
  );
  assert.equal(f.calls.filter(call => call.type === 'mutate').length, 1);
});

test('verified cleanup with a missing baseline spend never advances to spend-check pending', async () => {
  const f = fixture({ beforeSpend: null, readResult: notFoundError() });

  const result = await f.service.cleanup('run-100', { principal: admin, requestId: 'req-cleanup-missing-baseline' });

  assert.equal(result.status, 'cleanup_required');
  assert.ok(result.cleanupVerifiedAt);
  assert.equal(f.calls.filter(call => call.type === 'mutate').length, 1);
});
