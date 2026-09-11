import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrapSearchAdLifecycleRuntime } from '../src/naver/searchad/lifecycle/bootstrap.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';

function poolFixture() {
  return {
    async query(sql) {
      if (String(sql).includes('to_regclass')) {
        return { rows: [{
          runs: 'searchad_hierarchy_canary_runs',
          objects: 'searchad_hierarchy_objects',
          events: 'searchad_hierarchy_events',
          ownership: 'searchad_remote_object_ownership',
          capacity: 'searchad_daily_risk_capacity',
          reservations: 'searchad_risk_reservations'
        }] };
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
    registry: { manifest: { specRef: 'spec-bootstrap' } },
    status() { return { specRef: 'spec-bootstrap', baseUrl: 'https://api.searchad.naver.com' }; },
    get(key) { const value = operations.get(key); if (!value) throw new Error('missing operation'); return value; },
    async execute() { return { data: null }; },
    async executeCanary() { throw new Error('mutation must remain disabled'); },
    preview() { return { requiredSecondConfirmation: 'resource-confirmation' }; }
  };
}

const credentialsRegistry = {
  resolve(customerId) { return { customerId, principalId: 'principal', accessLicense: 'license', secretKey: 'secret' }; },
  listCustomers() { return [{ customerId: '100', status: 'active' }]; }
};

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

test('lifecycle bootstrap reuses established write approval service and wires ownership guard back into normal writes', async () => {
  const approvalService = { claim() { throw new Error('not used with gate off'); } };
  const executionService = { ownershipGuard: null };
  const app = {
    searchAdGateway: gatewayFixture(),
    searchAdCredentials: credentialsRegistry,
    searchAdActivationRuntime: activationRuntimeFixture(),
    searchAdWriteRuntime: { approvalService, executionService }
  };

  const result = await bootstrapSearchAdLifecycleRuntime({
    app,
    pool: poolFixture(),
    env: { ATELIER_SEARCHAD_HIERARCHY_CANARY_ENABLED: 'false' },
    logger: { error() {} }
  });

  assert.equal(result.startupError, null);
  assert.equal(result.runtime.status().ready, true);
  assert.equal(result.runtime.status().mutationEnabled, false);
  assert.equal(executionService.ownershipGuard, result.runtime.ownershipGuard);
  await result.runtime.close();
});

test('lifecycle bootstrap fails closed without established write approval when mutation gate is enabled', async () => {
  const app = {
    searchAdGateway: gatewayFixture(),
    searchAdCredentials: credentialsRegistry,
    searchAdActivationRuntime: activationRuntimeFixture(),
    searchAdWriteRuntime: { approvalService: null, executionService: { ownershipGuard: null } }
  };
  const result = await bootstrapSearchAdLifecycleRuntime({
    app,
    pool: poolFixture(),
    env: { ATELIER_SEARCHAD_HIERARCHY_CANARY_ENABLED: 'true' },
    logger: { error() {} }
  });
  assert.equal(result.runtime, null);
  assert.equal(result.startupError?.code, 'SEARCHAD_HIERARCHY_APPROVAL_REQUIRED');
  assert.equal(JSON.stringify(result.startupError).includes('secret'), false);
});
