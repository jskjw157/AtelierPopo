import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdLifecycleRiskService } from '../src/naver/searchad/lifecycle/risk-service.js';

function fixture() {
  const calls = [];
  const repository = {
    async reserveRisk(input) {
      calls.push(['reserve', input]);
      return { reservation: { ...input, state: 'reserved' } };
    },
    async consumeRisk(input) {
      calls.push(['consume', input]);
      return { ...input, state: 'consumed' };
    },
    async releaseRisk(input) {
      calls.push(['release', input]);
      return { ...input, state: 'released' };
    }
  };
  const service = new SearchAdLifecycleRiskService({
    repository,
    dailyCapacityUnits: 12,
    riskPolicy: {
      'campaign.create': { lifecycleKind: 'create', units: 5 },
      'keyword.batch_create': { lifecycleKind: 'batch_create', units: 3 },
      'campaign.delete': { lifecycleKind: 'delete', units: 2 }
    },
    clock: () => Date.parse('2026-09-11T23:59:59.000Z')
  });
  return { service, calls };
}

async function expectCode(promise, code, status) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    assert.equal(error?.status, status);
    return true;
  });
}

test('risk reservation rejects caller-supplied units, capacity or risk date before persistence', async () => {
  for (const injected of [
    { units: 1 },
    { capacityUnits: 999999 },
    { riskDate: '2099-01-01' }
  ]) {
    const { service, calls } = fixture();
    await expectCode(service.reserve({
      customerId: '100',
      intentId: 'intent-100',
      operationKey: 'campaign.create',
      lifecycleKind: 'create',
      ownerKind: 'hierarchy_canary',
      ownerRunId: 'run-100',
      ...injected
    }), 'SEARCHAD_RISK_INPUT_INVALID', 400);
    assert.equal(calls.length, 0);
  }
});

test('risk reservation derives UTC risk date, capacity and units only from server policy', async () => {
  const { service, calls } = fixture();
  const result = await service.reserve({
    customerId: '100',
    intentId: 'intent-100',
    operationKey: 'campaign.create',
    lifecycleKind: 'create',
    ownerKind: 'hierarchy_canary',
    ownerRunId: 'run-100'
  });
  assert.equal(result.reservation.state, 'reserved');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], {
    customerId: '100',
    intentId: 'intent-100',
    operationKey: 'campaign.create',
    lifecycleKind: 'create',
    ownerKind: 'hierarchy_canary',
    ownerRunId: 'run-100',
    riskDate: '2026-09-11',
    units: 5,
    capacityUnits: 12,
    createdAt: '2026-09-11T23:59:59.000Z'
  });
});

test('unconfigured operation or lifecycle mismatch fails closed before persistence', async () => {
  const { service, calls } = fixture();
  await expectCode(service.reserve({
    customerId: '100', intentId: 'unknown', operationKey: 'creative.create', lifecycleKind: 'create',
    ownerKind: 'hierarchy_canary', ownerRunId: 'run-100'
  }), 'SEARCHAD_RISK_OPERATION_NOT_CONFIGURED', 403);
  await expectCode(service.reserve({
    customerId: '100', intentId: 'mismatch', operationKey: 'campaign.create', lifecycleKind: 'delete',
    ownerKind: 'hierarchy_canary', ownerRunId: 'run-100'
  }), 'SEARCHAD_RISK_LIFECYCLE_MISMATCH', 403);
  assert.equal(calls.length, 0);
});

test('consume and release accept intentId only and persist a server timestamp', async () => {
  const { service, calls } = fixture();
  await service.consume({ intentId: 'intent-consume' });
  await service.release({ intentId: 'intent-release' });
  assert.deepEqual(calls, [
    ['consume', { intentId: 'intent-consume', updatedAt: '2026-09-11T23:59:59.000Z' }],
    ['release', { intentId: 'intent-release', updatedAt: '2026-09-11T23:59:59.000Z' }]
  ]);

  await expectCode(service.consume({ intentId: 'x', units: 1 }), 'SEARCHAD_RISK_INPUT_INVALID', 400);
  await expectCode(service.release({ intentId: 'x', riskDate: '2099-01-01' }), 'SEARCHAD_RISK_INPUT_INVALID', 400);
});
