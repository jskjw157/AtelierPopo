import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/bootstrap-v05.js', import.meta.url), 'utf8');

test('bootstrap-v05 explicitly initializes write control plane before lifecycle and returns lifecycle runtime state', () => {
  assert.match(source, /createProductionSearchAdWriteRuntime/);
  assert.match(source, /bootstrapSearchAdLifecycleRuntime/);
  assert.match(source, /searchAdWriteRuntime/);
  assert.match(source, /searchAdLifecycleRuntime/);
  assert.match(source, /searchAdLifecycleStartupError/);

  const activationIndex = source.indexOf('bootstrapSearchAdActivationRuntime');
  const writeIndex = source.indexOf('createProductionSearchAdWriteRuntime({', activationIndex);
  const lifecycleIndex = source.indexOf('bootstrapSearchAdLifecycleRuntime({', writeIndex);
  assert.ok(activationIndex >= 0, 'activation bootstrap missing');
  assert.ok(writeIndex > activationIndex, 'write runtime must be initialized after activation runtime');
  assert.ok(lifecycleIndex > writeIndex, 'lifecycle bootstrap must receive the established write approval service');
  assert.match(source.slice(lifecycleIndex), /searchAdWriteRuntime/);
});

test('bootstrap-v05 does not enable SearchAd mutation gates while wiring lifecycle runtime', () => {
  assert.equal(source.includes("ATELIER_SEARCHAD_ALLOW_WRITES: 'true'"), false);
  assert.equal(source.includes("ATELIER_SEARCHAD_ALLOW_CREATES: 'true'"), false);
  assert.equal(source.includes("ATELIER_SEARCHAD_ALLOW_DELETES: 'true'"), false);
  assert.equal(source.includes("ATELIER_SEARCHAD_HIERARCHY_CANARY_ENABLED: 'true'"), false);
});
