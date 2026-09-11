import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionSearchAdLifecycleRuntime } from '../src/naver/searchad/lifecycle/runtime-production.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';

function poolFixture() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(String(sql));
      if (String(sql).includes('to_regclass')) {
        return { rows: [{ runs: 'searchad_hierarchy_canary_runs', objects: 'searchad_hierarchy_objects', events: 'searchad_hierarchy_events', ownership: 'searchad_remote_object_ownership', capacity: 'searchad_daily_risk_capacity', reservations: 'searchad_risk_reservations' }] };
      }
      return { rows: [] };
    }
  };
}

function gatewayFixture() {
  const operations = new Map();
  for (const group of Object.values(SEARCHAD_HIERARCHY_OPERATIONS)) {
    for (const key of Object.values(group)) {
      const sideEffect = key.includes('.post.') || key.includes('.delete.');
      operations.set(key, {
        operationKey: key,
        runtimeAllowlisted: true,
        state: 'public_documented',
        tier: 'B',
        sideEffect,
        destructive: key.includes('.delete.'),
        confirmation: sideEffect ? 'CONFIRM' : null,
        requiredGate: key.includes('.delete.') ? 'deletes' : sideEffect ? 'creates' : 'reads'
      });
    }
  }
  return {
    config: { baseUrl: 'https://api.searchad.naver.com' },
    registry: { manifest: { specRef: 'spec-runtime' } },
    status() { return { specRef: 'spec-runtime', baseUrl: 'https://api.searchad.naver.com' }; },
    get(key) { const value = operations.get(key); if (!value) throw new Error('missing operation'); return value; },
    async execute() { return { data: null }; },
    async executeCanary() { throw new Error('must not execute with lifecycle gate off'); },
    preview() { return { requiredSecondConfirmation: 'resource-confirmation' }; }
  };
}

function activationRuntimeFixture() {
  return {
    repository: {
      async getAccount() { return { customerId: '100', suspended: false }; },
      async findUsableLifecycleActivation() { return null; },
      async getEvidence() { return null; }
    },
    status() { return { ready: true }; }
  };
}

const credentialsRegistry = {
  resolve(customerId) { return { customerId, accessLicense: 'license', secretKey: 'secret' }; },
  listCustomers() { return [{ customerId: '100', status: 'active' }]; }
};

test('lifecycle runtime is read-ready with mutation gate OFF and never requires an approval service', async () => {
  const runtime = await createProductionSearchAdLifecycleRuntime({
    gateway: gatewayFixture(),
    credentialsRegistry,
    activationRuntime: activationRuntimeFixture(),
    pool: poolFixture(),
    env: { ATELIER_SEARCHAD_HIERARCHY_CANARY_ENABLED: 'false' }
  });
  const status = runtime.status();
  assert.equal(status.ready, true);
  assert.equal(status.mutationEnabled, false);
  assert.equal(status.storage.runtime, 'postgres');
  assert.equal(status.storage.schemaReady, true);
  assert.equal(Boolean(runtime.repository), true);
  assert.equal(Boolean(runtime.ownershipGuard), true);

  await assert.rejects(
    runtime.service.start({ customerId: '100', planId: 'p', executionToken: 'secret-token' }, { principal: { principalId: 'admin', role: 'admin', customerIds: ['100'] } }),
    error => error?.code === 'SEARCHAD_HIERARCHY_CANARY_DISABLED' && error?.status === 403
  );
  await runtime.close();
});

test('enabling lifecycle mutation without the established write approval service fails closed', async () => {
  await assert.rejects(
    createProductionSearchAdLifecycleRuntime({
      gateway: gatewayFixture(),
      credentialsRegistry,
      activationRuntime: activationRuntimeFixture(),
      pool: poolFixture(),
      env: { ATELIER_SEARCHAD_HIERARCHY_CANARY_ENABLED: 'true' }
    }),
    error => error?.code === 'SEARCHAD_HIERARCHY_APPROVAL_REQUIRED' && error?.status === 503
  );
});

test('runtime status is sanitized and server-owned risk policy is not client configurable', async () => {
  const runtime = await createProductionSearchAdLifecycleRuntime({
    gateway: gatewayFixture(),
    credentialsRegistry,
    activationRuntime: activationRuntimeFixture(),
    pool: poolFixture(),
    env: {
      ATELIER_SEARCHAD_HIERARCHY_CANARY_ENABLED: 'false',
      ATELIER_SEARCHAD_HIERARCHY_DAILY_RISK_CAPACITY: '12'
    }
  });
  const text = JSON.stringify(runtime.status());
  assert.equal(text.includes('secret'), false);
  assert.equal(text.includes('accessLicense'), false);
  assert.equal(runtime.status().risk.dailyCapacityUnits, 12);
  await runtime.close();
});