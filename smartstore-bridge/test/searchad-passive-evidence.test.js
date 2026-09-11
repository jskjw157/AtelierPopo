import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdCapabilityService } from '../src/naver/searchad/capability.js';
import * as productionRecipe from '../src/naver/searchad/canary/production-recipe.js';
import { PassiveCapabilityEvidenceService } from '../src/naver/searchad/activation/passive-evidence-service.js';

function capabilityFixture() {
  let executeCount = 0;
  const operation = {
    operationKey: 'campaign.list',
    runtimeAllowlisted: true,
    sideEffect: false,
    method: 'GET',
    parameters: [],
    domain: 'campaign',
    capabilityKey: 'campaign.read'
  };
  const gateway = {
    registry: { manifest: { operations: [operation] } },
    get(operationKey) {
      assert.equal(operationKey, operation.operationKey);
      return operation;
    },
    async execute(_operationKey, input) {
      executeCount += 1;
      return { data: [], upstream: { status: 200, requestId: `req-${input.customerId}` } };
    }
  };
  const service = new SearchAdCapabilityService({
    gateway,
    config: { passiveProbeLimit: 5 },
    clock: () => new Date('2026-09-11T00:00:00Z')
  });
  return { service, getExecuteCount: () => executeCount };
}

function evidenceFixture({ probeSupported = true, invalidTargetOperationKey = null } = {}) {
  let probeCount = 0;
  const stored = [];
  const targetScope = productionRecipe.STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE;
  const gateway = {
    get(operationKey) {
      const valid = operationKey !== invalidTargetOperationKey;
      return {
        operationKey,
        runtimeAllowlisted: valid,
        state: valid ? 'public_documented' : 'internal_quarantined',
        tier: valid ? 'B' : 'D'
      };
    }
  };
  const capabilityService = {
    defaultPassiveOperations() {
      return ['campaign.list', 'business-channel.list'];
    },
    async runPassive({ customerId, operations }) {
      probeCount += 1;
      assert.equal(customerId, '100');
      assert.deepEqual(operations, ['campaign.list', 'business-channel.list']);
      return {
        customerId,
        checkedAt: '2026-09-11T00:00:00.000Z',
        results: operations.map((operationKey, index) => ({
          operationKey,
          state: probeSupported ? 'supported' : (index === 0 ? 'permission_required' : 'supported'),
          supported: probeSupported || index !== 0,
          upstreamStatus: probeSupported || index !== 0 ? 200 : 403,
          requestId: `probe-request-${index}`,
          error: index === 0 ? { message: 'must-not-persist-raw-secret', details: { secret: 'raw-secret' } } : undefined,
          rawResponse: { secret: 'raw-response-secret' }
        })),
        summary: { supported: probeSupported ? 2 : 1, failed: probeSupported ? 0 : 1 }
      };
    }
  };
  const repository = {
    async createEvidence(evidence) {
      const copy = structuredClone(evidence);
      stored.push(copy);
      return copy;
    }
  };
  const service = new PassiveCapabilityEvidenceService({
    repository,
    capabilityService,
    gateway,
    targetScope,
    credentialFingerprintResolver: async customerId => {
      assert.equal(customerId, '100');
      return 'credential-fingerprint-100';
    },
    gatewayContext: {
      specSha: 'spec-sha-100',
      upstreamBaseUrl: 'https://api.searchad.naver.com'
    },
    evidenceTtlMs: 60 * 60 * 1000,
    clock: () => Date.parse('2026-09-11T00:00:00Z')
  });
  return {
    service,
    stored,
    targetScope,
    getProbeCount: () => probeCount
  };
}

const operatorContext = {
  principal: { principalId: 'operator-100', role: 'operator', customerIds: ['100'] },
  requestId: 'http-request-100'
};

test('passive probe rejects nested Customer override before remote I/O', async () => {
  const f = capabilityFixture();

  await assert.rejects(
    f.service.runPassive({
      customerId: '100',
      operations: ['campaign.list'],
      inputs: { 'campaign.list': { customerId: '200' } }
    }),
    error => error?.code === 'SEARCHAD_PASSIVE_CUSTOMER_OVERRIDE_FORBIDDEN' && error?.status === 400
  );

  assert.equal(f.getExecuteCount(), 0);
});

test('stopped WEB_SITE Canary exposes one immutable server-owned Passive target scope', () => {
  const scope = productionRecipe.STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE;
  assert.ok(scope);
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(Object.isFrozen(scope.operationKeys), true);
  assert.equal(Object.isFrozen(scope.fieldScope), true);
  assert.deepEqual(scope.operationKeys, Object.values(productionRecipe.CANARY_OPERATION_KEYS));
  assert.deepEqual(scope.fieldScope, ['campaign.userLock', 'campaign.dailyBudget']);
});

test('trusted Passive evidence rejects caller-supplied result or scope before any probe', async () => {
  const f = evidenceFixture();

  await assert.rejects(
    f.service.issue({
      customerId: '100',
      passed: true,
      operationKeys: ['attacker.operation'],
      fieldScope: ['attacker.field'],
      credentialFingerprint: 'attacker-credential',
      specSha: 'attacker-spec',
      upstreamBaseUrl: 'https://attacker.invalid'
    }, operatorContext),
    error => error?.code === 'SEARCHAD_PASSIVE_EVIDENCE_INPUT_INVALID' && error?.status === 400
  );

  assert.equal(f.getProbeCount(), 0);
  assert.equal(f.stored.length, 0);
});

test('trusted Passive evidence requires Operator or higher and explicit Customer access', async () => {
  const f = evidenceFixture();

  await assert.rejects(
    f.service.issue({ customerId: '100' }, {
      principal: { principalId: 'reader-100', role: 'reader', customerIds: ['100'] }
    }),
    error => error?.code === 'SEARCHAD_OPERATOR_REQUIRED' && error?.status === 403
  );
  await assert.rejects(
    f.service.issue({ customerId: '100' }, {
      principal: { principalId: 'operator-200', role: 'operator', customerIds: ['200'] }
    }),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN' && error?.status === 403
  );

  assert.equal(f.getProbeCount(), 0);
});

test('verified Passive evidence is server-derived, scope-bound, immutable-ready and sanitized', async () => {
  const f = evidenceFixture();

  const evidence = await f.service.issue({ customerId: '100' }, operatorContext);

  assert.equal(evidence.evidenceType, 'passive_capability');
  assert.equal(evidence.customerId, '100');
  assert.equal(evidence.result, 'verified');
  assert.equal(evidence.specSha, 'spec-sha-100');
  assert.equal(evidence.credentialFingerprint, 'credential-fingerprint-100');
  assert.equal(evidence.upstreamBaseUrl, 'https://api.searchad.naver.com');
  assert.deepEqual(evidence.operationKeys, f.targetScope.operationKeys);
  assert.deepEqual(evidence.fieldScope, f.targetScope.fieldScope);
  assert.equal(evidence.createdByPrincipalId, 'operator-100');
  assert.equal(evidence.sourceRequestId, 'http-request-100');
  assert.equal(evidence.createdAt, '2026-09-11T00:00:00.000Z');
  assert.equal(evidence.expiresAt, '2026-09-11T01:00:00.000Z');
  assert.equal(f.stored.length, 1);
  assert.deepEqual(evidence.details.probeOperations, [
    { operationKey: 'campaign.list', state: 'supported', supported: true, upstreamStatus: 200, requestId: 'probe-request-0' },
    { operationKey: 'business-channel.list', state: 'supported', supported: true, upstreamStatus: 200, requestId: 'probe-request-1' }
  ]);
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('raw-secret'), false);
  assert.equal(serialized.includes('raw-response-secret'), false);
});

test('failed Passive probe or invalid target descriptor creates failed evidence, never verified evidence', async () => {
  const failedProbe = evidenceFixture({ probeSupported: false });
  const probeEvidence = await failedProbe.service.issue({ customerId: '100' }, operatorContext);
  assert.equal(probeEvidence.result, 'failed');

  const invalidOperationKey = productionRecipe.STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE.operationKeys[0];
  const invalidTarget = evidenceFixture({ invalidTargetOperationKey: invalidOperationKey });
  const targetEvidence = await invalidTarget.service.issue({ customerId: '100' }, operatorContext);
  assert.equal(targetEvidence.result, 'failed');
  assert.equal(targetEvidence.details.targetValidation.every(item => item.operationKey !== invalidOperationKey || item.verified === false), true);
});
