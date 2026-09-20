import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Test utility only. Each control runs in a fresh Node process and real PG
// schema. Restore the exact production bytes even if a control fails.
const target = 'src/naver/searchad/lifecycle/inventory-cleanup-fence.js';
const testFile = 'test/postgres-searchad-remote-absence-boundary.integration.test.js';
const original = readFileSync(target, 'utf8');
const marker = 'export function hasUnprovenInventory';
assert.equal(original.split(marker).length, 2, 'Expected exactly one veto export');
const stats = output => Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
  const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
  assert.ok(match, `Missing TAP total: ${key}`);
  return [key, Number(match[1])];
}));
function run() {
  const result = spawnSync(process.execPath, ['--test', testFile], { encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024, env: process.env });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.error || result.signal) throw new Error(`Control did not complete: ${result.error?.message || result.signal}\n${output}`);
  return { status: result.status, totals: stats(output), output };
}
function expectPass(result) {
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(result.totals, { tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, result.output);
}
const baseline = run();
expectPass(baseline);
let negative;
try {
  writeFileSync(target, original.replace(marker, 'function baselineHasUnprovenInventory') + '\n// Disposable negative control; never committed.\nexport const hasUnprovenInventory = () => false;\n');
  negative = run();
  assert.equal(negative.status, 1, negative.output);
  assert.deepEqual(negative.totals, { tests: 6, pass: 0, fail: 6, cancelled: 0, skipped: 0, todo: 0 }, negative.output);
  assert.equal((negative.output.match(/^\s+(?:error: ')?REMOTE_ABSENCE_PARENT_VETO'?\s*$/gm) || []).length, 5, negative.output);
} finally {
  writeFileSync(target, original);
  assert.equal(readFileSync(target, 'utf8'), original, 'Veto source was not restored');
}
const restored = run();
expectPass(restored);
const diff = spawnSync('git', ['diff', '--exit-code', '--', target], { encoding: 'utf8' });
assert.equal(diff.status, 0, diff.stdout || diff.stderr || 'Production source differs from checkout');
console.log(JSON.stringify({ baseline: baseline.totals, negativeControl: negative.totals, expectedVetoFailures: 5, restored: restored.totals, sourceRestored: true }, null, 2));
