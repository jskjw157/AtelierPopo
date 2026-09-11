import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdLifecycleActivationGuard } from '../src/naver/searchad/lifecycle/activation-guard.js';
import { SearchAdActivationGuard } from '../src/naver/searchad/activation/activation-guard.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';

const NOW = Date.parse('2026-09-11T05:30:00Z');
const FUTURE = new Date(NOW + 60 * 60 * 1000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

function lifecycleGrant(overrides = {}) {
  return {
    activationId: '11111111-1111-4111-8111-111111111111',
    evidenceId: 'lifecycle-evidence-100',
    evidenceType: 'active_canary',
    customerId: '100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    operationKeys: [SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create],
    fieldScope: [],
    lifecycleKinds: ['create'],
    activatedAt: new Date(NOW - 30_000).toISOString(),
    expiresAt: FUTURE,
    ...overrides
  };
}

function lifecycleEvidence(overrides = {}) {
  return {
    evidenceId: 'lifecycle-evidence-100',
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
    expiresAt: FUTURE,
    ...overrides
  };
}

function lifecycleFixture({
  account = { customerId: '100', suspended: false },
  grant = lifecycleGrant(),
  evidence = lifecycleEvidence(),
  operationValid = true,
  currentCredential = 'credential-100',
  gatewayContext = { specSha: 'spec-100', upstreamBaseUrl: 'https://api.searchad.naver.com' }
} = {}) {
  let findCount = 0;
  const repository = {
    async getAccount(customerId) {
      return customerId === '100' ? structuredClone(account) : null;
    },
    async findUsableLifecycleActivation(args) {
      findCount += 1;
      return grant ? structuredClone(grant) : null;
    },
    async getEvidence(id) {
      return evidence && id === evidence.evidenceId ? structuredClone(evidence) : null;
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
  return {
    findCount: () => findCount,
    guard: new SearchAdLifecycleActivationGuard({
      repository,
      gateway,
      credentialFingerprintResolver: async customerId => {
        assert.equal(customerId, '100');
        return currentCredential;
      },
      gatewayContext,
      clock: () => NOW
    })
  };
}

const exactRequest = {
  customerId: '100',
  operationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create,
  lifecycleKind: 'create'
};

test('passive evidence can never authorize a lifecycle mutation', async () => {
  const f = lifecycleFixture({
    grant: lifecycleGrant({ evidenceType: 'passive_capability' }),
    evidence: lifecycleEvidence({ evidenceType: 'passive_capability' })
  });
  await assert.rejects(
    f.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED' && error?.status === 403
  );
});

test('lifecycle authorization requires exact Customer and operationKey scope', async () => {
  const wrongCustomer = lifecycleFixture({
    grant: lifecycleGrant({ customerId: '200' }),
    evidence: lifecycleEvidence({ customerId: '200' })
  });
  await assert.rejects(
    wrongCustomer.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 403
  );

  const wrongOperation = lifecycleFixture({
    grant: lifecycleGrant({ operationKeys: [SEARCHAD_HIERARCHY_OPERATIONS.campaign.create] }),
    evidence: lifecycleEvidence({ operationKeys: [SEARCHAD_HIERARCHY_OPERATIONS.campaign.create] })
  });
  await assert.rejects(
    wrongOperation.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_LIFECYCLE_SCOPE_MISMATCH' && error?.status === 403
  );
});

test('lifecycle kind scope is exact: create, batch_create and delete are not interchangeable', async () => {
  const createOnly = lifecycleFixture();
  await assert.rejects(
    createOnly.guard.assertLifecycleMutationAllowed({ ...exactRequest, lifecycleKind: 'delete' }),
    error => error?.code === 'SEARCHAD_LIFECYCLE_SCOPE_MISMATCH' && error?.status === 403
  );
  await assert.rejects(
    createOnly.guard.assertLifecycleMutationAllowed({ ...exactRequest, lifecycleKind: 'batch_create' }),
    error => error?.code === 'SEARCHAD_LIFECYCLE_SCOPE_MISMATCH' && error?.status === 403
  );

  const batchOnly = lifecycleFixture({
    grant: lifecycleGrant({ lifecycleKinds: ['batch_create'] }),
    evidence: lifecycleEvidence({ lifecycleKinds: ['batch_create'] })
  });
  await assert.rejects(
    batchOnly.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_LIFECYCLE_SCOPE_MISMATCH' && error?.status === 403
  );
});

test('stale activation context, evidence expiry and unverified gateway descriptor fail closed', async () => {
  const expired = lifecycleFixture({
    grant: lifecycleGrant({ expiresAt: PAST }),
    evidence: lifecycleEvidence({ expiresAt: PAST })
  });
  await assert.rejects(
    expired.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_LIFECYCLE_ACTIVATION_REQUIRED' || error?.code === 'SEARCHAD_ACTIVATION_EXPIRED'
  );

  const specMismatch = lifecycleFixture({ gatewayContext: { specSha: 'spec-new', upstreamBaseUrl: 'https://api.searchad.naver.com' } });
  await assert.rejects(
    specMismatch.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 403
  );

  const credentialMismatch = lifecycleFixture({ currentCredential: 'credential-rotated' });
  await assert.rejects(
    credentialMismatch.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 403
  );

  const upstreamMismatch = lifecycleFixture({ gatewayContext: { specSha: 'spec-100', upstreamBaseUrl: 'https://other.example' } });
  await assert.rejects(
    upstreamMismatch.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 403
  );

  const invalidOperation = lifecycleFixture({ operationValid: false });
  await assert.rejects(
    invalidOperation.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_ACTIVATION_OPERATION_UNVERIFIED' && error?.status === 403
  );
});

test('suspended account blocks lifecycle execution before activation lookup', async () => {
  const f = lifecycleFixture({ account: { customerId: '100', suspended: true } });
  await assert.rejects(
    f.guard.assertLifecycleMutationAllowed(exactRequest),
    error => error?.code === 'SEARCHAD_ACCOUNT_SUSPENDED' && error?.status === 403
  );
  assert.equal(f.findCount(), 0);
});

test('exact lifecycle activation passes only after current descriptor and identity revalidation', async () => {
  const f = lifecycleFixture();
  const result = await f.guard.assertLifecycleMutationAllowed(exactRequest);
  assert.deepEqual(result, {
    allowed: true,
    activationId: '11111111-1111-4111-8111-111111111111',
    evidenceId: 'lifecycle-evidence-100',
    customerId: '100',
    operationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.create,
    lifecycleKind: 'create'
  });
});

test('existing #16 update activation with empty lifecycle kinds remains authorized by update guard', async () => {
  const grant = {
    activationId: '22222222-2222-4222-8222-222222222222',
    evidenceId: 'update-evidence-100',
    evidenceType: 'active_canary',
    customerId: '100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    operationKeys: [CANARY_OPERATION_KEYS.updateCampaign],
    fieldScope: ['campaign.dailyBudget'],
    lifecycleKinds: [],
    expiresAt: FUTURE
  };
  const evidence = { ...grant, result: 'verified' };
  const repository = {
    async getAccount() { return { customerId: '100', suspended: false }; },
    async findUsableActivation() { return structuredClone(grant); },
    async getEvidence() { return structuredClone(evidence); }
  };
  const gateway = {
    get(operationKey) {
      return { operationKey, runtimeAllowlisted: true, state: 'public_documented', tier: 'B' };
    }
  };
  const guard = new SearchAdActivationGuard({
    repository,
    gateway,
    credentialFingerprintResolver: async () => 'credential-100',
    gatewayContext: { specSha: 'spec-100', upstreamBaseUrl: 'https://api.searchad.naver.com' },
    clock: () => NOW
  });

  const result = await guard.assertMutationAllowed({
    customerId: '100',
    descriptor: {
      operationKey: CANARY_OPERATION_KEYS.updateCampaign,
      query: { fields: 'budget' },
      body: { nccCampaignId: 'server-owned-campaign-id', dailyBudget: 100 }
    }
  });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.mutableFields, ['campaign.dailyBudget']);
});
