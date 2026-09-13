import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdActivationGuard } from '../src/naver/searchad/activation/activation-guard.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';

const NOW = Date.parse('2026-09-11T03:00:00Z');
const FUTURE = new Date(NOW + 60 * 60 * 1000).toISOString();
const PAST = new Date(NOW - 60 * 1000).toISOString();

function updateDescriptor(overrides = {}) {
  return {
    operationKey: CANARY_OPERATION_KEYS.updateCampaign,
    customerId: '100',
    pathParams: { campaignId: 'cmp-100' },
    query: { fields: 'budget' },
    body: { nccCampaignId: 'cmp-100', dailyBudget: 1000, userLock: true },
    ...overrides
  };
}

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
    expiresAt: FUTURE,
    ...overrides
  };
}

function activation(overrides = {}) {
  return {
    activationId: '11111111-1111-4111-8111-111111111111',
    evidenceId: 'evidence-100',
    evidenceType: 'active_canary',
    customerId: '100',
    specSha: 'spec-100',
    credentialFingerprint: 'credential-100',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    operationKeys: [CANARY_OPERATION_KEYS.updateCampaign],
    fieldScope: ['campaign.dailyBudget', 'campaign.userLock'],
    expiresAt: FUTURE,
    ...overrides
  };
}

function fixture({ account = { customerId: '100', suspended: false }, grant = activation(), evidenceValue = evidence(), currentCredential = 'credential-100', operationValid = true } = {}) {
  const calls = [];
  const repository = {
    async getAccount(customerId) {
      calls.push({ type: 'getAccount', customerId });
      return account ? { ...account } : null;
    },
    async findUsableActivation({ customerId, operationKey, now }) {
      calls.push({ type: 'findUsableActivation', customerId, operationKey, now });
      return grant ? structuredClone(grant) : null;
    },
    async getEvidence(evidenceId) {
      calls.push({ type: 'getEvidence', evidenceId });
      return evidenceValue ? structuredClone(evidenceValue) : null;
    }
  };
  const gateway = {
    get(operationKey) {
      calls.push({ type: 'gatewayGet', operationKey });
      return {
        operationKey,
        runtimeAllowlisted: operationValid,
        state: operationValid ? 'public_documented' : 'internal_quarantined',
        tier: operationValid ? 'B' : 'D'
      };
    }
  };
  const guard = new SearchAdActivationGuard({
    repository,
    gateway,
    credentialFingerprintResolver: async customerId => {
      calls.push({ type: 'credential', customerId });
      return currentCredential;
    },
    gatewayContext: { specSha: 'spec-100', upstreamBaseUrl: 'https://api.searchad.naver.com' },
    clock: () => NOW
  });
  return { guard, calls };
}

test('normal mutation requires a durable activation and does not infer permission from global gates', async () => {
  const f = fixture({ grant: null });
  await assert.rejects(
    f.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() }),
    error => error?.code === 'SEARCHAD_ACTIVATION_REQUIRED' && error?.status === 403
  );
});

test('passive-backed activation can never authorize a normal write', async () => {
  const f = fixture({
    grant: activation({ evidenceType: 'passive_capability' }),
    evidenceValue: evidence({ evidenceType: 'passive_capability' })
  });
  await assert.rejects(
    f.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() }),
    error => error?.code === 'SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED' && error?.status === 403
  );
});

test('exact active-canary campaign update activation passes after current context revalidation', async () => {
  const f = fixture();
  const result = await f.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() });
  assert.equal(result.allowed, true);
  assert.equal(result.activationId, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(result.mutableFields.sort(), ['campaign.dailyBudget', 'campaign.userLock'].sort());
});

test('account suspension is an overriding kill switch checked before activation lookup', async () => {
  const f = fixture({ account: { customerId: '100', suspended: true } });
  await assert.rejects(
    f.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() }),
    error => error?.code === 'SEARCHAD_ACCOUNT_SUSPENDED' && error?.status === 403
  );
  assert.equal(f.calls.some(call => call.type === 'findUsableActivation'), false);
});

test('create delete or unknown lifecycle mutations stay blocked until lifecycle activation exists', async () => {
  const f = fixture();
  await assert.rejects(
    f.guard.assertMutationAllowed({ customerId: '100', descriptor: { operationKey: CANARY_OPERATION_KEYS.createCampaign, body: {} } }),
    error => error?.code === 'SEARCHAD_LIFECYCLE_ACTIVATION_REQUIRED' && error?.status === 403
  );
  assert.equal(f.calls.some(call => call.type === 'findUsableActivation'), false);
});

test('unknown mutable fields fail closed instead of being ignored', async () => {
  const f = fixture();
  await assert.rejects(
    f.guard.assertMutationAllowed({
      customerId: '100',
      descriptor: updateDescriptor({ body: { nccCampaignId: 'cmp-100', dailyBudget: 1000, name: 'attacker-change' } })
    }),
    error => error?.code === 'SEARCHAD_ACTIVATION_FIELD_MAPPING_UNKNOWN' && error?.status === 409
  );
});

test('field scope, expiry, operation verification and current identity are all revalidated', async () => {
  const narrow = fixture({ evidenceValue: evidence({ fieldScope: ['campaign.dailyBudget'] }) });
  await assert.rejects(
    narrow.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() }),
    error => error?.code === 'SEARCHAD_ACTIVATION_FIELD_SCOPE_MISMATCH' && error?.status === 403
  );

  const expired = fixture({ grant: activation({ expiresAt: PAST }) });
  await assert.rejects(
    expired.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() }),
    error => error?.code === 'SEARCHAD_ACTIVATION_EXPIRED' && error?.status === 403
  );

  const invalidOperation = fixture({ operationValid: false });
  await assert.rejects(
    invalidOperation.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() }),
    error => error?.code === 'SEARCHAD_ACTIVATION_OPERATION_UNVERIFIED' && error?.status === 403
  );

  const rotated = fixture({ currentCredential: 'credential-rotated' });
  await assert.rejects(
    rotated.guard.assertMutationAllowed({ customerId: '100', descriptor: updateDescriptor() }),
    error => error?.code === 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' && error?.status === 403
  );
});
