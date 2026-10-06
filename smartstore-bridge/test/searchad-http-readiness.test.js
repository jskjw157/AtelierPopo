import test from 'node:test';
import assert from 'node:assert/strict';
import { startWriteFixture } from './helpers/searchad-write-http-fixture.js';

for (const scenario of [
  { name: 'missing activation runtime', configured: true, runtimeReady: undefined, expectedStatus: 503 },
  { name: 'failed activation startup', configured: true, runtimeReady: false, expectedStatus: 503 },
  { name: 'non-boolean activation readiness', configured: true, runtimeReady: 'true', expectedStatus: 503 },
  { name: 'ready activation infrastructure', configured: true, runtimeReady: true, expectedStatus: 200 },
  { name: 'unconfigured optional SearchAd', configured: false, runtimeReady: undefined, expectedStatus: 200 }
]) {
  test(`public readiness: ${scenario.name}, sanitized and consistent with internal readiness`, async t => {
    const h = await startWriteFixture(t);
    h.app.searchAdConfig.configured = scenario.configured;
    const initialized = scenario.runtimeReady !== undefined;
    h.app.searchAdActivationRuntime = initialized ? {
      status() { return { ready: scenario.runtimeReady, credentialFingerprint: 'private-fingerprint',
        customerId: 'private-customer', databaseUrl: 'private-database-url' }; }
    } : null;
    h.app.searchAdActivationStartupError = scenario.runtimeReady === true ? null : {
      code: 'TEST_STARTUP_FAILURE', message: 'private-startup-detail'
    };
    const result = await h.call('GET', '/health/ready', undefined, { authenticated: false });
    assert.equal(result.status, scenario.expectedStatus, JSON.stringify(result));
    assert.equal(result.body.ok, scenario.expectedStatus === 200);
    assert.equal(result.body.status, scenario.expectedStatus === 200 ? 'ready' : 'not_ready');
    assert.deepEqual(result.body.searchAdActivation, {
      required: scenario.configured, initialized, ready: scenario.runtimeReady === true
    });
    const internal = h.api.readiness();
    assert.equal(internal.ready, result.body.ok);
    assert.equal(internal.readyForRead, true, 'optional activation must not redefine basic read readiness');
    assert.equal(internal.searchAdActivation.required, scenario.configured);
    assert.equal(internal.searchAdActivation.ready, result.body.searchAdActivation.ready);
    assert.equal(JSON.stringify(result.body).includes('private-'), false);
    assert.equal(h.app.searchAdWriteRuntime, undefined, 'health must not initialize a write runtime');
    assert.deepEqual(h.calls, [], 'health must never probe an upstream API');
  });
}
