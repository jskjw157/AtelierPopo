import test from 'node:test';
import assert from 'node:assert/strict';
import { startWriteFixture } from './helpers/searchad-write-http-fixture.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('write HTTP awaits delayed repository reads and approval without serializing a Promise', async t => {
  const h = await startWriteFixture(t);
  const planned = await h.call('POST', '/api/v1/searchad/changes/plan', h.planInput());
  assert.equal(planned.status, 201);
  const id = planned.body.plan_id;
  const runtime = h.app.searchAdWriteRuntime;
  const getPlan = runtime.repository.getPlan.bind(runtime.repository);
  const listPlans = runtime.planService.list.bind(runtime.planService);
  runtime.repository.getPlan = async (...args) => { await tick(); return getPlan(...args); };
  runtime.planService.list = async (...args) => { await tick(); return listPlans(...args); };
  const detail = await h.call('GET', `/api/v1/searchad/changes/${id}`);
  assert.equal(detail.status, 200, JSON.stringify(detail));
  assert.equal(detail.body.plan_id, id);
  const listed = await h.call('GET', '/api/v1/searchad/changes');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items[0].plan_id, id);
  const approval = await h.call('POST', `/api/v1/searchad/changes/${id}/approve`, {
    actor: 'fixture', confirmation: 'APPROVE_SEARCHAD_CHANGE'
  });
  assert.equal(approval.status, 200, JSON.stringify(approval));
  assert.equal(typeof approval.body.executionToken, 'string');
  const applied = await h.call('POST', `/api/v1/searchad/changes/${id}/execute`, {
    executionToken: approval.body.executionToken, idempotencyKey: `delayed-${id}`
  });
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.body.status, 'applied');
  assert.equal(h.mutations().length, 1);
});

test('shutdown preserves runtime resources on drain timeout and closes each once on retry', async t => {
  const h = await startWriteFixture(t);
  const queueClose = h.api.operationQueue.close.bind(h.api.operationQueue);
  const ledgerClose = h.app.ledger.close.bind(h.app.ledger);
  const counts = { ledger: 0, activation: 0 };
  h.app.searchAdActivationRuntime.close = async () => { counts.activation += 1; };
  h.app.ledger.close = () => { counts.ledger += 1; return ledgerClose(); };
  try {
    // A controlled drain result, not a simulation of a closed database.
    h.api.operationQueue.close = async () => false;
    await assert.rejects(h.api.close(), { code: 'HTTP_SHUTDOWN_PENDING' });
    assert.deepEqual(counts, { ledger: 0, activation: 0 });
  } finally {
    h.api.operationQueue.close = queueClose;
  }
  await Promise.all([h.api.close(), h.api.close()]);
  await h.api.close();
  assert.deepEqual(counts, { ledger: 1, activation: 1 });
});

test('shutdown waits for an in-flight HTTP execution before closing activation', async t => {
  let entered;
  let release;
  const started = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const h = await startWriteFixture(t, {
    activationGuard: { async assertMutationAllowed() { entered(); await blocked; return { allowed: true }; } }
  });
  let closes = 0;
  h.app.searchAdActivationRuntime.close = async () => { closes += 1; };
  const input = await h.approve();
  const executing = h.call('POST', `/api/v1/searchad/changes/${input.planId}/execute`, input);
  await started;
  const closing = h.api.close();
  try {
    await tick();
    assert.equal(closes, 0);
  } finally {
    release();
  }
  const result = await executing;
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.status, 'applied');
  await closing;
  assert.equal(closes, 1);
  assert.equal(h.mutations().length, 1);
});
