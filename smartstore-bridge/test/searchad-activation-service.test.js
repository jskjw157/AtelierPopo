import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdActivationService } from '../src/naver/searchad/activation/activation-service.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';

const NOW = Date.parse('2026-09-11T03:00:00Z');
const FUTURE = new Date(NOW + 60 * 60 * 1000).toISOString();
const PAST = new Date(NOW - 60 * 1000).toISOString();

const admin100 = {
  principal: { principalId: 'admin-100', role: 'admin', customerIds: ['100'] },
  requestId: 'req-activation-100'
};

function evidence(overrides = {}) {
  return {
    evidenceId: 'evidence-100',
    evidenceType: 'active_canary',
    customerId: '100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    operationKeys: [CANARY_OPERATION_KEYS.updateCampaign],
    fieldScope: ['campaign.dailyBudget', 'campaign.userLock'],
    result: 'verified',
    createdAt: new Date(NOW - 60_000).toISOString(),
    expiresAt: FUTURE,
    ...overrides
  };
}

function fixture({ evidenceValue = evidence(), currentCredential = 'credential-100', operationValid = true, existingActivation = null } = {}) {
  let getEvidenceCount = 0;
  let createCount = 0;
  const stored = [];
  const repository = {
    async getEvidence(id) {
      getEvidenceCount += 1;
      if (!evidenceValue || id !== evidenceValue.evidenceId) return null;
      return structuredClone(evidenceValue);
    },
    async getActivationByEvidence(id) {
      return existingActivation && id === existingActivation.evidenceId ? structuredClone(existingActivation) : null;
    },
    async createActivation(grant) {
      createCount += 1;
      const copy = structuredClone(grant);
      stored.push(copy);
      return copy;
    }
  };
  const gateway = {
    get(operationKey) {
      return {
        operationKey,
        runtimeAllowlisted: operationValid,
        state: operationValid ? 'public_documented' : 'internal_quarantined',
        tier: operationValid ? 'B' : 'D'
      };
    }
  };
  const service = new SearchAdActivationService({
    repository,
    gateway,
    credentialFingerprintResolver: async customerId => {
      assert.equal(customerId, evidenceValue?.customerId || '100');
      return currentCredential;
    },
    gatewayContext: { specSha: 'spec-100', upstreamBaseUrl: 'https://api.searchad.naver.com' },
    clock: () => NOW
  });
  return {
    service,
    stored,
    getEvidenceCount: () => getEvidenceCount,
    getCreateCount: () => createCount
  };
}

test('activation accepts exactly evidenceId and rejects fabricated Customer or scope before lookup', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.activate({ evidenceId: 'evidence-100', customerId: '200', operationKeys: ['attacker'] }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_INPUT_INVALID' && error?.status === 400
  );
  assert.equal(f.getEvidenceCount(), 0);
  assert.equal(f.getCreateCount(), 0);
});

test('activation requires Admin and hides missing or cross-Customer evidence as the same 404', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.activate({ evidenceId: 'evidence-100' }, {
      principal: { principalId: 'executor-100', role: 'executor', customerIds: ['100'] }
    }),
    error => error?.code === 'SEARCHAD_ADMIN_REQUIRED' && error?.status === 403
  );

  const missing = fixture({ evidenceValue: null });
  await assert.rejects(
    missing.service.activate({ evidenceId: 'missing' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_NOT_FOUND' && error?.status === 404
  );

  const cross = fixture({ evidenceValue: evidence({ customerId: '200' }) });
  await assert.rejects(
    cross.service.activate({ evidenceId: 'evidence-100' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_NOT_FOUND' && error?.status === 404
  );
});

test('activation rejects failed, expired, mismatched-context or no-longer-verified evidence', async () => {
  const failed = fixture({ evidenceValue: evidence({ result: 'failed' }) });
  await assert.rejects(
    failed.service.activate({ evidenceId: 'evidence-100' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_EVIDENCE_INVALID' && error?.status === 409
  );

  const expired = fixture({ evidenceValue: evidence({ expiresAt: PAST }) });
  await assert.rejects(
    expired.service.activate({ evidenceId: 'evidence-100' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_EVIDENCE_INVALID' && error?.status === 409
  );

  const specMismatch = fixture({ evidenceValue: evidence({ specSha: 'old-spec' }) });
  await assert.rejects(
    specMismatch.service.activate({ evidenceId: 'evidence-100' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 409
  );

  const credentialMismatch = fixture({ currentCredential: 'rotated-credential' });
  await assert.rejects(
    credentialMismatch.service.activate({ evidenceId: 'evidence-100' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 409
  );

  const upstreamMismatch = fixture({ evidenceValue: evidence({ upstreamBaseUrl: 'https://old.example' }) });
  await assert.rejects(
    upstreamMismatch.service.activate({ evidenceId: 'evidence-100' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 409
  );

  const invalidOperation = fixture({ operationValid: false });
  await assert.rejects(
    invalidOperation.service.activate({ evidenceId: 'evidence-100' }, admin100),
    error => error?.code === 'SEARCHAD_ACTIVATION_SCOPE_INVALID' && error?.status === 409
  );
});

test('activation copies immutable evidence scope and returns a public projection without credential fingerprint', async () => {
  const f = fixture();
  const grant = await f.service.activate({ evidenceId: 'evidence-100' }, admin100);

  assert.equal(f.getCreateCount(), 1);
  assert.equal(f.stored[0].evidenceId, 'evidence-100');
  assert.equal(f.stored[0].customerId, '100');
  assert.equal(f.stored[0].credentialFingerprint, 'credential-100');
  assert.deepEqual(f.stored[0].operationKeys, [CANARY_OPERATION_KEYS.updateCampaign]);
  assert.deepEqual(f.stored[0].fieldScope, ['campaign.dailyBudget', 'campaign.userLock']);
  assert.equal(f.stored[0].activatedByPrincipalId, 'admin-100');
  assert.equal(f.stored[0].expiresAt, FUTURE);
  assert.equal(Object.hasOwn(grant, 'credentialFingerprint'), false);
  assert.equal(grant.customerId, '100');
  assert.equal(grant.evidenceType, 'active_canary');
});

test('activation is idempotent for one evidence id and does not create a second immutable grant', async () => {
  const existingActivation = {
    activationId: '11111111-1111-4111-8111-111111111111',
    evidenceId: 'evidence-100',
    evidenceType: 'active_canary',
    customerId: '100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    operationKeys: [CANARY_OPERATION_KEYS.updateCampaign],
    fieldScope: ['campaign.dailyBudget', 'campaign.userLock'],
    activatedByPrincipalId: 'admin-100',
    activatedAt: new Date(NOW - 30_000).toISOString(),
    expiresAt: FUTURE
  };
  const f = fixture({ existingActivation });
  const grant = await f.service.activate({ evidenceId: 'evidence-100' }, admin100);
  assert.equal(f.getCreateCount(), 0);
  assert.equal(grant.activationId, existingActivation.activationId);
  assert.equal(Object.hasOwn(grant, 'credentialFingerprint'), false);
});
