import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Disposable CI regression-sensitivity check, not a runtime bypass. Every run
// uses fresh Node processes and the integration suite's isolated PG schemas.
const target = 'src/naver/searchad/lifecycle/postgres-sibling-plan-retirement-repository.js';
const testFile = 'test/postgres-searchad-sibling-plan-retirement.integration.test.js';
const wrapper = 'unused expired sibling retirement is atomic, local-only and preserves all live ancestors';
const expectedFailures = [
  'one returned keyword ID vetoes the whole keyword batch',
  'one dispatching keyword vetoes the whole keyword batch',
  'one manual-review keyword vetoes the whole keyword batch'
].sort();
// Remove only the three state/returned-ID/deletion-state predicates. Scope,
// type, operation, provenance, approval, hold and risk checks stay in place.
const guard = "o.state!=='planned'||o.remote_id!==null||o.deleted_at!==null||";
const original = readFileSync(target);
const source = original.toString('utf8');
assert.equal(source.split(guard).length, 2, 'Expected exactly one batch state/returned-ID predicate sequence');

function totals(output) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))];
    assert.equal(matches.length, 1, `Expected one top-level TAP total: ${key}\n${output}`);
    return [key, Number(matches[0][1])];
  }));
}
function run() {
  const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testFile], {
    encoding: 'utf8', timeout: 360_000, maxBuffer: 16 * 1024 * 1024, env: process.env
  });
  const output = `${child.stdout || ''}\n${child.stderr || ''}`;
  assert.ok(!child.error && !child.signal, `Integration process did not complete: ${child.error?.message || child.signal}\n${output}`);
  return { status: child.status, totals: totals(output), output };
}
function expectGreen(result) {
  assert.equal(result.status, 0, result.output);
  assert.ok(result.totals.tests > expectedFailures.length + 1, result.output);
  assert.deepEqual(result.totals, { tests: result.totals.tests, pass: result.totals.tests, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, result.output);
}

const baseline = run();
expectGreen(baseline);
let negative;
try {
  writeFileSync(target, source.replace(guard, ''));
  negative = run();
  assert.equal(negative.status, 1, negative.output);
  assert.deepEqual(negative.totals, { tests: baseline.totals.tests, pass: baseline.totals.tests - expectedFailures.length - 1, fail: expectedFailures.length + 1, cancelled: 0, skipped: 0, todo: 0 }, negative.output);
  const nested = [...negative.output.matchAll(/^ +not ok \d+ - (.+)$/gm)].map(m => m[1]).sort();
  const topLevel = [...negative.output.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(nested, expectedFailures, negative.output);
  assert.deepEqual(topLevel, [wrapper], negative.output);
  assert.equal((negative.output.match(/^\s*error: 'Missing expected rejection(?: \(retirementError\))?\.'\s*$/gm) || []).length, expectedFailures.length, negative.output);
} finally {
  // Never leave the weakened production source in the checkout, including on
  // an assertion/timeout failure. Full regression runs only after restoration.
  writeFileSync(target, original);
  assert.ok(readFileSync(target).equals(original), 'Exact production bytes were not restored');
}
const restored = run();
expectGreen(restored);
assert.deepEqual(restored.totals, baseline.totals, restored.output);
const diff = spawnSync('git', ['diff', '--exit-code', '--', target], { encoding: 'utf8' });
assert.ok(!diff.error && !diff.signal, 'Could not verify restored source against git');
assert.equal(diff.status, 0, diff.stdout || diff.stderr || 'Production source differs from checkout');
console.log(JSON.stringify({
  baseline: baseline.totals,
  negativeControl: negative.totals,
  expectedVetoFailures: expectedFailures,
  restored: restored.totals,
  sourceRestored: true
}, null, 2));
