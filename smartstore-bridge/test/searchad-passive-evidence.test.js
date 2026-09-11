import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdCapabilityService } from '../src/naver/searchad/capability.js';
import * as productionRecipe from '../src/naver/searchad/canary/production-recipe.js';

function fixture() {
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

test('passive probe rejects nested Customer override before remote I/O', async () => {
  const f = fixture();

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
