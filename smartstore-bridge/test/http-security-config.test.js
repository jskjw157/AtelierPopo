import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHttpConfig, verifyApiKey } from '../src/http/security.js';

const DEMO_KEY = 'd'.repeat(48);
const INHERITED_KEY = 'i'.repeat(48);

function requestWithBearer(key) {
  return { headers: { authorization: `Bearer ${key}` } };
}

function isUnauthorized(error) {
  return error.status === 401;
}

test('demo config binds loopback and uses the demo key when ATELIER_API_KEYS is empty', () => {
  const config = loadHttpConfig({
    ATELIER_HTTP_HOST: '127.0.0.1',
    PORT: '3000',
    ATELIER_API_KEY: DEMO_KEY,
    ATELIER_API_KEYS: ''
  });

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.deepEqual(config.apiKeys, [DEMO_KEY]);
  assert.equal(verifyApiKey(requestWithBearer(DEMO_KEY), config), DEMO_KEY);
  assert.throws(
    () => verifyApiKey(requestWithBearer('w'.repeat(48)), config),
    isUnauthorized
  );
});

test('ATELIER_API_KEYS takes precedence over ATELIER_API_KEY', () => {
  const config = loadHttpConfig({
    ATELIER_API_KEY: DEMO_KEY,
    ATELIER_API_KEYS: INHERITED_KEY
  });

  assert.deepEqual(config.apiKeys, [INHERITED_KEY]);
  assert.throws(
    () => verifyApiKey(requestWithBearer(DEMO_KEY), config),
    isUnauthorized
  );
  assert.equal(verifyApiKey(requestWithBearer(INHERITED_KEY), config), INHERITED_KEY);
});

test('default host remains 0.0.0.0 when ATELIER_HTTP_HOST is unset', () => {
  assert.equal(loadHttpConfig({}).host, '0.0.0.0');
});
