import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdAccountControlService } from '../src/naver/searchad/activation/account-control-service.js';

const admin100 = {
  principal: { principalId: 'admin-100', role: 'admin', customerIds: ['100'] },
  requestId: 'req-account-100'
};

function fixture() {
  const accounts = new Map([
    ['100', { customerId: '100', suspended: false, updatedAt: '2026-09-11T03:00:00.000Z' }],
    ['200', { customerId: '200', suspended: true, updatedAt: '2026-09-11T03:00:00.000Z' }]
  ]);
  const calls = [];
  const repository = {
    async getAccount(customerId) {
      calls.push({ type: 'getAccount', customerId: String(customerId) });
      const value = accounts.get(String(customerId));
      return value ? { ...value } : null;
    },
    async listAccounts(customerIds) {
      calls.push({ type: 'listAccounts', customerIds: [...customerIds].map(String) });
      return customerIds.map(id => accounts.get(String(id))).filter(Boolean).map(value => ({ ...value }));
    },
    async setAccountSuspended({ customerId, suspended, actorPrincipalId, requestId, createdAt }) {
      calls.push({ type: 'setAccountSuspended', customerId: String(customerId), suspended: Boolean(suspended), actorPrincipalId, requestId, createdAt });
      const current = accounts.get(String(customerId)) || { customerId: String(customerId), suspended: false };
      const updated = { ...current, suspended: Boolean(suspended), updatedAt: createdAt };
      accounts.set(String(customerId), updated);
      return { ...updated };
    }
  };
  const service = new SearchAdAccountControlService({
    repository,
    clock: () => Date.parse('2026-09-11T03:00:00Z')
  });
  return { service, calls, accounts };
}

test('account suspend and resume require Admin plus explicit Customer access', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.suspend('100', {
      principal: { principalId: 'executor-100', role: 'executor', customerIds: ['100'] }
    }),
    error => error?.code === 'SEARCHAD_ADMIN_REQUIRED' && error?.status === 403
  );
  await assert.rejects(
    f.service.suspend('100', {
      principal: { principalId: 'admin-200', role: 'admin', customerIds: ['200'] }
    }),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN' && error?.status === 403
  );
  assert.equal(f.calls.filter(call => call.type === 'setAccountSuspended').length, 0);
});

test('account state changes bind authenticated principal and request id, never a caller actor', async () => {
  const f = fixture();
  const suspended = await f.service.suspend('100', admin100);
  assert.equal(suspended.suspended, true);
  const call = f.calls.find(item => item.type === 'setAccountSuspended');
  assert.equal(call.actorPrincipalId, 'admin-100');
  assert.equal(call.requestId, 'req-account-100');
  assert.equal(call.createdAt, '2026-09-11T03:00:00.000Z');

  const resumed = await f.service.resume('100', admin100);
  assert.equal(resumed.suspended, false);
});

test('Reader can list only explicitly granted account control status', async () => {
  const f = fixture();
  const result = await f.service.list({
    principal: { principalId: 'reader-100', role: 'reader', customerIds: ['100'] }
  });
  assert.deepEqual(result, [{ customerId: '100', suspended: false, updatedAt: '2026-09-11T03:00:00.000Z' }]);
  const call = f.calls.find(item => item.type === 'listAccounts');
  assert.deepEqual(call.customerIds, ['100']);
});

test('account control rejects unauthenticated or unknown role status reads', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.list({ principal: { principalId: 'x', role: 'unknown', customerIds: ['100'] } }),
    error => error?.code === 'SEARCHAD_READER_REQUIRED' && error?.status === 403
  );
});
