import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SearchAdCapabilityService } from '../src/naver/searchad/capability.js';

const activationSources = [
  'account-control-service.js', 'activation-guard.js', 'activation-service.js',
  'bootstrap.js', 'passive-evidence-service.js', 'postgres-repository.js', 'runtime-production.js'
];

test('0008 recovery contains the original activation core and additive schema', () => {
  const paths = [
    ...activationSources.map(name => `../src/naver/searchad/activation/${name}`),
    '../migrations/postgres/0008_searchad_activation_control.sql'
  ];
  const missing = paths.filter(path => !fs.existsSync(new URL(path, import.meta.url)));
  assert.deepEqual(missing, [], '0008 core and schema must actually exist before the recovery is marked verified');
});

test('passive Customer override is rejected before even the first simulated gateway read', async () => {
  const calls = [];
  const operation = { operationKey: 'fixture.read', sideEffect: false };
  const gateway = {
    get(key) { assert.equal(key, operation.operationKey); return operation; },
    async execute(key, input) {
      calls.push({ key, input });
      return { data: [], upstream: { status: 200, requestId: 'fixture' } };
    }
  };
  const service = new SearchAdCapabilityService({ gateway, config: { passiveProbeLimit: 1 } });
  await assert.rejects(service.runPassive({
    customerId: '100', operations: ['fixture.read'],
    inputs: { 'fixture.read': { customerId: '200' } }
  }), { code: 'SEARCHAD_PASSIVE_CUSTOMER_OVERRIDE_FORBIDDEN', status: 400 });
  assert.equal(calls.length, 0);
});
