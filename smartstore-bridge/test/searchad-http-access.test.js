import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadSearchAdHttpAccessControl,
  SEARCHAD_ROLE_RANK
} from '../src/http/searchad-access-control.js';

const K = suffix => `${suffix}-`.padEnd(40, suffix[0] || 'x');

function env(overrides = {}) {
  return {
    ATELIER_SEARCHAD_READER_API_KEY: K('reader'),
    ATELIER_SEARCHAD_READER_CUSTOMERS: '100,200',
    ATELIER_SEARCHAD_OPERATOR_API_KEY: K('operator'),
    ATELIER_SEARCHAD_OPERATOR_CUSTOMERS: '100',
    ATELIER_SEARCHAD_EXECUTOR_API_KEY: K('executor'),
    ATELIER_SEARCHAD_EXECUTOR_CUSTOMERS: '100',
    ATELIER_SEARCHAD_ADMIN_API_KEY: K('admin'),
    ATELIER_SEARCHAD_ADMIN_CUSTOMERS: '100,300',
    ...overrides
  };
}

function req(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

test('SearchAd roles have an explicit monotonic rank', () => {
  assert.deepEqual(SEARCHAD_ROLE_RANK, {
    reader: 1,
    operator: 2,
    executor: 3,
    admin: 4
  });
});

test('role keys resolve to principal identity and explicit Customer allowlist without exposing raw key', () => {
  const access = loadSearchAdHttpAccessControl(env());
  const auth = access.authenticateRequest(req(K('reader')), { minimumRole: 'reader' });
  assert.equal(auth.principal.role, 'reader');
  assert.equal(auth.principal.principalId, 'searchad-reader');
  assert.deepEqual(auth.principal.customerIds, ['100', '200']);
  assert.match(auth.tokenFingerprint, /^[a-f0-9]{16}$/);
  assert.equal(JSON.stringify(auth).includes(K('reader')), false);
});

test('Reader cannot satisfy Admin role, while Admin can satisfy Reader role', () => {
  const access = loadSearchAdHttpAccessControl(env());
  assert.throws(
    () => access.authenticateRequest(req(K('reader')), { minimumRole: 'admin' }),
    error => error?.code === 'SEARCHAD_ROLE_FORBIDDEN' && error?.status === 403
  );
  const auth = access.authenticateRequest(req(K('admin')), { minimumRole: 'reader' });
  assert.equal(auth.principal.role, 'admin');
});

test('principal Customer access is explicit and never supports wildcard grants', () => {
  const access = loadSearchAdHttpAccessControl(env());
  const reader = access.authenticateRequest(req(K('reader')), { minimumRole: 'reader' }).principal;
  access.assertCustomer(reader, '100');
  assert.throws(
    () => access.assertCustomer(reader, '300'),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN'
  );
  assert.throws(
    () => loadSearchAdHttpAccessControl(env({ ATELIER_SEARCHAD_READER_CUSTOMERS: '*' })),
    error => error?.code === 'SEARCHAD_HTTP_ACCESS_CONFIG_INVALID'
  );
});

test('SearchAd access keys are strict: missing bearer, unknown key, duplicate key and key-without-grants fail closed', () => {
  const access = loadSearchAdHttpAccessControl(env());
  assert.throws(
    () => access.authenticateRequest({ headers: {} }, { minimumRole: 'reader' }),
    error => error?.code === 'UNAUTHORIZED' && error?.status === 401
  );
  assert.throws(
    () => access.authenticateRequest(req(K('unknown')), { minimumRole: 'reader' }),
    error => error?.code === 'UNAUTHORIZED'
  );
  assert.throws(
    () => loadSearchAdHttpAccessControl(env({ ATELIER_SEARCHAD_ADMIN_API_KEY: K('reader') })),
    error => error?.code === 'SEARCHAD_HTTP_ACCESS_CONFIG_INVALID'
  );
  assert.throws(
    () => loadSearchAdHttpAccessControl(env({ ATELIER_SEARCHAD_ADMIN_CUSTOMERS: '' })),
    error => error?.code === 'SEARCHAD_HTTP_ACCESS_CONFIG_INVALID'
  );
});

test('unconfigured SearchAd role authentication returns service unavailable, not generic authorization', () => {
  const access = loadSearchAdHttpAccessControl({});
  assert.equal(access.status().configured, false);
  assert.throws(
    () => access.authenticateRequest(req(K('admin')), { minimumRole: 'reader' }),
    error => error?.code === 'SEARCHAD_HTTP_AUTH_NOT_CONFIGURED' && error?.status === 503
  );
});
