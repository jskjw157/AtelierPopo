import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';

const CREATE = 'fixture.campaign.create';
const INTERNAL = 'fixture.internal.create';

function operation({
  operationKey = CREATE,
  runtimeAllowlisted = true,
  tier = 'A',
  requiredGate = 'creates',
  destructive = false
} = {}) {
  return {
    operationKey,
    sourceId: 'fixture',
    sourceOperationId: operationKey,
    method: 'POST',
    path: '/ncc/campaigns',
    rawPath: '/api/ncc/campaigns',
    domain: 'campaign',
    tags: ['Campaign'],
    summary: 'create',
    action: 'create',
    sideEffect: true,
    destructive,
    batch: false,
    risk: 'high',
    state: 'public_documented',
    tier,
    runtimeAllowlisted,
    requiredGate,
    confirmation: 'CONFIRM_SEARCHAD_WRITE',
    capabilityKey: 'campaign.create',
    parameters: [],
    specRef: 'spec-1'
  };
}

function makeGateway({ allowActiveCanary = true, op = operation() } = {}) {
  const requests = [];
  const operations = new Map([
    [op.operationKey, op],
    [INTERNAL, operation({ operationKey: INTERNAL, runtimeAllowlisted: false })]
  ]);
  const registry = {
    get(key) {
      const item = operations.get(key);
      if (!item) throw Object.assign(new Error(`missing ${key}`), { code: 'SEARCHAD_OPERATION_NOT_FOUND', status: 404 });
      return item;
    },
    publicOperation(value) { return { ...value }; },
    status() { return { specRef: 'spec-1' }; }
  };
  const client = {
    async request(request) {
      requests.push(structuredClone(request));
      return {
        status: 200,
        requestId: 'req-1',
        attempts: 1,
        durationMs: 2,
        headers: {},
        data: { nccCampaignId: 'cmp-1' }
      };
    }
  };
  const credentialsRegistry = {
    resolve(customerId) {
      assert.equal(customerId, '123');
      return { customerId, principalId: 'principal-1', role: 'admin' };
    },
    status() { return {}; }
  };
  const config = {
    enabled: true,
    configured: true,
    allowReads: true,
    allowWrites: false,
    allowCreates: false,
    allowBatchWrites: false,
    allowRollbacks: false,
    allowDeletes: false,
    allowActiveCanary,
    allowUnverifiedOperations: false,
    automationMode: 'observe'
  };
  return {
    gateway: new SearchAdOperationGateway({ client, config, registry, credentialsRegistry, logger: { info() {} } }),
    requests
  };
}

const input = {
  customerId: '123',
  body: { campaignTp: 'WEB_SITE', userLock: true },
  confirmation: 'CONFIRM_SEARCHAD_WRITE'
};

test('ordinary execute stays blocked when global create gate is off, even with caller-supplied canary hints', async () => {
  const { gateway, requests } = makeGateway();

  await assert.rejects(
    gateway.execute(CREATE, input),
    error => error?.code === 'SEARCHAD_GATE_DISABLED'
  );
  await assert.rejects(
    gateway.execute(CREATE, { ...input, executionPurpose: 'active_canary', allowActiveCanary: true }),
    error => error?.code === 'SEARCHAD_GATE_DISABLED'
  );
  assert.equal(requests.length, 0);
});

test('internal executeCanary requires the dedicated Active Canary gate', async () => {
  const { gateway, requests } = makeGateway({ allowActiveCanary: false });

  await assert.rejects(
    gateway.executeCanary(CREATE, input),
    error => error?.code === 'SEARCHAD_ACTIVE_CANARY_DISABLED'
  );
  assert.equal(requests.length, 0);
});

test('internal executeCanary can use an allowlisted mutation without opening global create gate', async () => {
  const { gateway, requests } = makeGateway({ allowActiveCanary: true });

  const result = await gateway.executeCanary(CREATE, input);
  assert.equal(result.data.nccCampaignId, 'cmp-1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].retrySafe, false);
  assert.equal(requests[0].customerId, '123');
});

test('Active Canary bypass never bypasses runtime allowlist or verification tier', async () => {
  const blocked = makeGateway({ allowActiveCanary: true });
  await assert.rejects(
    blocked.gateway.executeCanary(INTERNAL, { ...input }),
    error => error?.code === 'SEARCHAD_OPERATION_NOT_ALLOWLISTED'
  );

  const unverified = makeGateway({
    allowActiveCanary: true,
    op: operation({ tier: 'C' })
  });
  await assert.rejects(
    unverified.gateway.executeCanary(CREATE, input),
    error => error?.code === 'SEARCHAD_OPERATION_UNVERIFIED'
  );
  assert.equal(unverified.requests.length, 0);
});
