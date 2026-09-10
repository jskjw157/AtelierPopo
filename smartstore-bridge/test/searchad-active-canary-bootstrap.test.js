import test from 'node:test';
import assert from 'node:assert/strict';

import { bootstrapActiveCanaryRuntime } from '../src/naver/searchad/canary/bootstrap.js';

function fakeGateway() {
  return {
    get() { return { sideEffect: false }; },
    execute() {},
    executeCanary() {},
    status() {
      return {
        specRef: '8e250490ab748367a627213f7d7a2917e005cb10',
        baseUrl: 'https://api.searchad.naver.com'
      };
    }
  };
}

function fakeCredentials() {
  return {
    resolve() {
      return { principalId: 'p1', accessLicense: 'a1', secretKey: 's1', customerId: '123' };
    },
    listCustomers() { return [{ customerId: '123', status: 'active' }]; }
  };
}

test('bootstrap keeps Active Canary disabled without requiring PostgreSQL when gate is OFF', async () => {
  const result = await bootstrapActiveCanaryRuntime({
    app: { searchAdGateway: fakeGateway(), searchAdCredentials: fakeCredentials() },
    env: {}
  });
  assert.equal(result.startupError, null);
  assert.equal(result.runtime.status().enabled, false);
  assert.equal(result.runtime.status().ready, false);
});

test('bootstrap records a fail-closed startup error when Canary is enabled but PostgreSQL is unavailable', async () => {
  const result = await bootstrapActiveCanaryRuntime({
    app: { searchAdGateway: fakeGateway(), searchAdCredentials: fakeCredentials() },
    env: {
      ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true',
      ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
      ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000',
      ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1200',
      ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-10',
      ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-10'
    }
  });
  assert.equal(result.runtime, null);
  assert.equal(result.startupError?.code, 'SEARCHAD_CANARY_DATABASE_REQUIRED');
  assert.equal(String(result.startupError?.message || '').includes('postgresql://'), false);
});

test('bootstrap never initializes an enabled Canary runtime without SearchAd gateway credentials', async () => {
  const result = await bootstrapActiveCanaryRuntime({
    app: {},
    env: {
      ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true',
      ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
      ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000',
      ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1200',
      ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-10',
      ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-10',
      DATABASE_URL: 'postgresql://must-not-leak.invalid/secret'
    }
  });
  assert.equal(result.runtime, null);
  assert.equal(result.startupError?.code, 'SEARCHAD_CANARY_GATEWAY_REQUIRED');
  assert.equal(JSON.stringify(result.startupError).includes('must-not-leak'), false);
});
