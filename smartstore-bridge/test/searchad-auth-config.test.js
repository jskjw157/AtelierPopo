import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildSearchAdHeaders, createSearchAdSignature, normalizeSearchAdUri, SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { loadSearchAdConfig, publicSearchAdConfig } from '../src/naver/searchad/config.js';

function expected(secret, timestamp, method, uri) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${method}.${uri}`).digest('base64');
}

test('SearchAd signature uses timestamp.method.pathname and excludes query', () => {
  const signature = createSearchAdSignature({
    secretKey: 'secret-value', timestamp: 1700000000000, method: 'get', uri: '/ncc/campaigns?foo=bar'
  });
  assert.equal(signature, expected('secret-value', '1700000000000', 'GET', '/ncc/campaigns'));
  assert.equal(normalizeSearchAdUri('https://api.searchad.naver.com/ncc/campaigns?a=1'), '/ncc/campaigns');
});

test('SearchAd headers include the official four authentication headers', () => {
  const headers = buildSearchAdHeaders({
    accessLicense: 'license', secretKey: 'secret', customerId: '12345', timestamp: 1700000000000,
    method: 'POST', uri: '/ncc/campaigns'
  });
  assert.deepEqual(Object.keys(headers).sort(), ['X-API-KEY','X-Customer','X-Signature','X-Timestamp'].sort());
  assert.equal(headers['X-Customer'], '12345');
});

test('SearchAd config defaults to read-only observe mode and supports principal 1:N customers', () => {
  const config = loadSearchAdConfig({
    NAVER_SEARCHAD_ACCESS_LICENSE: 'license',
    NAVER_SEARCHAD_SECRET_KEY: 'secret',
    NAVER_SEARCHAD_CUSTOMERS_JSON: JSON.stringify([{ customerId: '12341001' }, { customerId: '12341002' }])
  }, { cwd: '/tmp/app' });
  assert.equal(config.configured, true);
  assert.equal(config.allowReads, true);
  assert.equal(config.allowWrites, false);
  assert.equal(config.allowCreates, false);
  assert.equal(config.automationMode, 'observe');
  const registry = new SearchAdCredentialsRegistry(config.topology);
  assert.equal(registry.resolve('12341001').accessLicense, 'license');
  assert.equal(registry.resolve('12341002').principalId, 'default');
  assert.equal(publicSearchAdConfig(config).customers[0].customerIdMasked.endsWith('1001'), true);
});

test('SearchAd credential registry prevents ambiguous customer grants', () => {
  assert.throws(() => new SearchAdCredentialsRegistry({
    principals: [
      { principalId: 'p1', accessLicense: 'a', secretKey: 's', status: 'active' },
      { principalId: 'p2', accessLicense: 'b', secretKey: 't', status: 'active' }
    ],
    customers: [{ customerId: '1001', status: 'active' }],
    grants: [
      { principalId: 'p1', customerId: '1001' },
      { principalId: 'p2', customerId: '1001' }
    ]
  }), /Multiple SearchAd principals/);
});
