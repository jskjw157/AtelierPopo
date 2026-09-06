import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, contentHash, isSubset, materializeBodyFromBefore } from '../src/naver/searchad/write/canonical.js';
import { loadSearchAdWriteConfig } from '../src/naver/searchad/write/config.js';
import { redactSearchAdWriteValue, sanitizeSearchAdRemoteError } from '../src/naver/searchad/write/redaction.js';

test('canonical SearchAd JSON and hash are stable across object key order', () => {
  const left = { b: 2, a: { y: 2, x: 1 }, list: [{ z: 3, a: 1 }] };
  const right = { list: [{ a: 1, z: 3 }], a: { x: 1, y: 2 }, b: 2 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(contentHash(left), contentHash(right));
});

test('rollback request fields are materialized from the authoritative before snapshot', () => {
  const before = { bidAmt: 320, budget: { daily: 10000 }, name: 'original' };
  const result = materializeBodyFromBefore(before, { userLock: true }, {
    bidAmt: 'bidAmt',
    'budget.daily': 'budget.daily'
  });
  assert.deepEqual(result, {
    userLock: true,
    bidAmt: 320,
    budget: { daily: 10000 }
  });
});

test('subset verification accepts dynamic remote metadata but rejects changed expected values', () => {
  const remote = { bidAmt: 400, editTm: 'dynamic', nested: { status: 'ELIGIBLE', score: 9 } };
  assert.equal(isSubset(remote, { bidAmt: 400, nested: { status: 'ELIGIBLE' } }), true);
  assert.equal(isSubset(remote, { bidAmt: 401 }), false);
});

test('SearchAd write defaults are temporary prevalidation gates, not a permanent prohibition', () => {
  const config = loadSearchAdWriteConfig({}, { baseDir: '/tmp/haar' });
  assert.equal(config.enabled, true);
  assert.equal(config.allowPlans, true);
  assert.equal(config.allowWrites, false);
  assert.equal(config.allowRollback, false);
  assert.equal(config.allowReconcile, true);
  assert.equal(config.initialActivationMode, 'prevalidation');
});

test('nested SearchAd credentials and bearer values are redacted', () => {
  const input = {
    accessLicense: 'license-value',
    nested: {
      secretKey: 'secret-value',
      Authorization: 'Bearer abc',
      harmless: 'visible'
    },
    list: [{ client_secret: 'hidden' }]
  };
  assert.deepEqual(redactSearchAdWriteValue(input), {
    accessLicense: '[REDACTED]',
    nested: {
      secretKey: '[REDACTED]',
      Authorization: '[REDACTED]',
      harmless: 'visible'
    },
    list: [{ client_secret: '[REDACTED]' }]
  });
  const error = new Error('remote failed');
  error.code = 'REMOTE_FAIL';
  error.status = 503;
  error.details = input;
  const safe = sanitizeSearchAdRemoteError(error);
  assert.equal(safe.details.nested.harmless, 'visible');
  assert.equal(safe.details.nested.secretKey, '[REDACTED]');
});
