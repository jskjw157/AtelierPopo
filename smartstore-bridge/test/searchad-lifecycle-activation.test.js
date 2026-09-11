import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdActivationService } from '../src/naver/searchad/activation/activation-service.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';

const NOW = Date.parse('2026-09-11T05:00:00Z');
const FUTURE = new Date(NOW + 60 * 60 * 1000).toISOString();

const admin100 = {
  principal: { principalId: 'admin-lifecycle-100', role: 'admin', customerIds: ['100'] },
  requestId: 'req-lifecycle-activation-100'
};

function makeService(evidenceValue) {
  const stored = [];
  const repository = {
    async getEvidence(id) {
      return id === evidenceValue.evidenceId ? structuredClone(evidenceValue) : null;
    },
    async getActivationByEvidence() {
      return null;
    },
    async createActivation(grant) {
      const copy = structuredClone(grant);
      stored.push(copy);
      return copy;
    }
  };
  const gateway = {
    get(operationKey) {
      return {
        operationKey,
        runtimeAllowlisted: true,
        state: 'public_documented',
        tier: 'B'
      };
    }
  };
  return {
    stored,
    service: new SearchAdActivationService({
      repository,
      gateway,
      credentialFingerprintResolver: async customerId => {
        assert.equal(customerId, '100');
        return 'credential-100';
      },
      gatewayContext: {
        specSha: 'spec-100',
        upstreamBaseUrl: 'https://api.searchad.naver.com'
      },
      clock: () => NOW
    })
  };
}

test('activation copies trusted lifecycle kinds without requiring update field scope', async () => {
  const evidenceValue = {
    evidenceId: 'hierarchy-evidence-100',
    evidenceType: 'active_canary',
    customerId: '100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    operationKeys: [SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create],
    fieldScope: [],
    lifecycleKinds: ['create'],
    result: 'verified',
    createdAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: FUTURE
  };
  const f = makeService(evidenceValue);
  const grant = await f.service.activate({ evidenceId: evidenceValue.evidenceId }, admin100);

  assert.equal(f.stored.length, 1);
  assert.deepEqual(f.stored[0].operationKeys, [SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create]);
  assert.deepEqual(f.stored[0].fieldScope, []);
  assert.deepEqual(f.stored[0].lifecycleKinds, ['create']);
  assert.deepEqual(grant.lifecycleKinds, ['create']);
  assert.equal(Object.hasOwn(grant, 'credentialFingerprint'), false);
});

test('existing update activation with empty lifecycle kinds stays valid', async () => {
  const evidenceValue = {
    evidenceId: 'update-evidence-100',
    evidenceType: 'active_canary',
    customerId: '100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    operationKeys: [CANARY_OPERATION_KEYS.updateCampaign],
    fieldScope: ['campaign.dailyBudget'],
    lifecycleKinds: [],
    result: 'verified',
    createdAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: FUTURE
  };
  const f = makeService(evidenceValue);
  const grant = await f.service.activate({ evidenceId: evidenceValue.evidenceId }, admin100);

  assert.equal(f.stored.length, 1);
  assert.deepEqual(grant.lifecycleKinds, []);
  assert.deepEqual(grant.fieldScope, ['campaign.dailyBudget']);
});
