import test from 'node:test';
import assert from 'node:assert/strict';
import { startWriteFixture, CUSTOMER_ID } from './helpers/searchad-write-http-fixture.js';
import { SearchAdGatewayRemoteAdapter } from '../src/naver/searchad/write/remote-adapter.js';
import { SearchAdWriteError } from '../src/naver/searchad/write/errors.js';
import { errorPayloadV05 } from '../src/http/errors-v05.js';

const endpoint = auth => `/api/v1/searchad/changes/${auth.planId}`;
const legacy = (f, operation = f.update) => `/api/v1/searchad/operations/${operation.operationKey}/execute`;

// Would fail if the adapter passes one descriptor object to the real two-argument Gateway.
test('real SearchAd adapter uses the pinned registry, signed client and two-argument gateway', async t => {
  const f = await startWriteFixture(t);
  const adapter = new SearchAdGatewayRemoteAdapter({ gateway: f.gateway });
  const before = await adapter.read({ ...f.descriptor(f.read), customerId: CUSTOMER_ID });
  assert.equal(before.value.bidAmt, 300);
  await adapter.mutate({ ...f.descriptor(), customerId: CUSTOMER_ID });
  assert.equal((await adapter.read({ ...f.descriptor(f.read), customerId: CUSTOMER_ID })).value.bidAmt, 500);
  assert.deepEqual(f.calls.map(c => c.method), ['GET', 'PUT', 'GET']);
  assert.equal(f.calls[1].path, '/ncc/keywords/kw-1');
  assert.equal(f.calls[1].query, 'fields=bidAmt');
});

test('adapter read rejects a manifest write operation before network I/O', async t => {
  const f = await startWriteFixture(t);
  const adapter = new SearchAdGatewayRemoteAdapter({ gateway: f.gateway });
  await assert.rejects(() => adapter.read({ ...f.descriptor(), customerId: CUSTOMER_ID }),
    { code: 'SEARCHAD_VERIFICATION_READ_REQUIRED' });
  assert.equal(f.calls.length, 0);
});

test('adapter mutation rejects a read operation before network I/O', async t => {
  const f = await startWriteFixture(t);
  const adapter = new SearchAdGatewayRemoteAdapter({ gateway: f.gateway });
  await assert.rejects(() => adapter.mutate({ ...f.descriptor(f.read), customerId: CUSTOMER_ID }),
    { code: 'SEARCHAD_MUTATION_REQUIRED' });
  assert.equal(f.calls.length, 0);
});

test('HTTP change plan approval execute verifies remote state and persists upstream request ID', async t => {
  const f = await startWriteFixture(t);
  const auth = await f.approve();
  const result = await f.call('POST', `${endpoint(auth)}/execute`, auth);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.status, 'applied');
  assert.equal(f.state().bidAmt, 500);
  assert.deepEqual(f.calls.map(c => c.method), ['GET', 'GET', 'PUT', 'GET']);
  const saved = await f.call('GET', endpoint(auth));
  assert.equal(saved.body.attempts.find(a => a.phase === 'execute').remote_request_id, 'fixture-3');
  assert.ok(!JSON.stringify(saved.body).includes(auth.executionToken));
  const repeated = await f.call('POST', `${endpoint(auth)}/execute`, auth);
  assert.equal(repeated.status, 409);
  assert.equal(f.mutations().length, 1);
});

test('HTTP plan validation cannot use a mutation as the verification read', async t => {
  const f = await startWriteFixture(t);
  const input = f.planInput();
  input.verification.read = f.descriptor();
  const result = await f.call('POST', '/api/v1/searchad/changes/plan', input);
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal(result.body.error.code, 'SEARCHAD_VERIFICATION_READ_REQUIRED');
  assert.equal(f.calls.length, 0);
});

test('HTTP master write switch blocks execute without consuming the approved token', async t => {
  const f = await startWriteFixture(t, { masterWrites: false });
  const auth = await f.approve();
  const count = f.calls.length;
  const result = await f.call('POST', `${endpoint(auth)}/execute`, auth);
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.body.error.code, 'HTTP_WRITES_DISABLED');
  assert.equal(f.calls.length, count);
  f.api.httpConfig.allowWrites = true;
  assert.equal((await f.call('POST', `${endpoint(auth)}/execute`, auth)).status, 200);
  assert.equal(f.mutations().length, 1);
});

test('HTTP master write switch also blocks rollback then permits an approved rollback', async t => {
  const f = await startWriteFixture(t);
  const auth = await f.approve();
  assert.equal((await f.call('POST', `${endpoint(auth)}/execute`, auth)).status, 200);
  f.api.httpConfig.allowWrites = false;
  const rollback = { confirmation: 'ROLLBACK_SEARCHAD_CHANGE', idempotencyKey: `rollback-${auth.planId}` };
  const result = await f.call('POST', `${endpoint(auth)}/rollback`, rollback);
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.body.error.code, 'HTTP_WRITES_DISABLED');
  assert.equal(f.mutations().length, 1);
  f.api.httpConfig.allowWrites = true;
  const restored = await f.call('POST', `${endpoint(auth)}/rollback`, rollback);
  assert.equal(restored.status, 200, JSON.stringify(restored));
  assert.equal(restored.body.status, 'rolled_back');
  assert.equal(f.state().bidAmt, 300);
});

test('HTTP preserves SearchAd prevalidation status and still allows plan and approval', async t => {
  const f = await startWriteFixture(t, { searchAdWrites: false });
  const auth = await f.approve();
  const result = await f.call('POST', `${endpoint(auth)}/execute`, auth);
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.body.error.code, 'SEARCHAD_WRITES_PREVALIDATION_GATED');
  assert.equal(f.mutations().length, 0);
});

test('HTTP stale plan is a 409 and never changes a remotely edited object', async t => {
  const f = await startWriteFixture(t);
  const auth = await f.approve();
  f.setState({ bidAmt: 450 });
  const result = await f.call('POST', `${endpoint(auth)}/execute`, auth);
  assert.equal(result.status, 409, JSON.stringify(result));
  assert.equal(result.body.error.code, 'SEARCHAD_STALE_PLAN');
  assert.equal(f.mutations().length, 0);
});

test('unknown outcome through the real client is never retried and reconciles with master writes off', async t => {
  const f = await startWriteFixture(t);
  const auth = await f.approve();
  f.failMutation();
  const result = await f.call('POST', `${endpoint(auth)}/execute`, auth);
  assert.equal(result.status, 409, JSON.stringify(result));
  assert.equal(result.body.error.code, 'SEARCHAD_UNKNOWN_OUTCOME');
  assert.equal(f.mutations().length, 1);
  f.api.httpConfig.allowWrites = false;
  const reconciled = await f.call('POST', `${endpoint(auth)}/reconcile`, {});
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled));
  assert.equal(reconciled.body.status, 'applied_reconciled');
  assert.equal(f.mutations().length, 1);
});

test('generic operation endpoint refuses direct writes without a persisted approved plan', async t => {
  const f = await startWriteFixture(t);
  const result = await f.call('POST', legacy(f), {
    ...f.descriptor(), customerId: CUSTOMER_ID, idempotencyKey: 'unsafe-direct-mutation'
  });
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal(result.body.error.code, 'SEARCHAD_CHANGE_PLAN_REQUIRED');
  assert.equal(f.mutations().length, 0);
});

test('generic operation endpoint executes the same approved plan through drift and verification', async t => {
  const f = await startWriteFixture(t);
  const auth = await f.approve();
  const result = await f.call('POST', legacy(f), auth);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.result.status, 'applied');
  assert.deepEqual(f.calls.map(c => c.method), ['GET', 'GET', 'PUT', 'GET']);
  assert.equal((await f.call('POST', `${endpoint(auth)}/execute`, auth)).status, 409);
  assert.equal(f.mutations().length, 1);
});

test('generic approved-plan execution rejects caller payload overrides before any new I/O', async t => {
  const f = await startWriteFixture(t);
  const auth = await f.approve();
  const count = f.calls.length;
  const result = await f.call('POST', legacy(f), { ...auth, body: { bidAmt: 99999 } });
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal(result.body.error.code, 'SEARCHAD_APPROVED_PLAN_OVERRIDE_FORBIDDEN');
  assert.equal(f.calls.length, count);
});

test('generic approved-plan execution checks the operation and customer scope', async t => {
  const f = await startWriteFixture(t);
  const auth = await f.approve();
  const count = f.calls.length;
  const other = f.registry.findByPath('DELETE', '/ncc/keywords/{nccKeywordId}');
  const mismatch = await f.call('POST', legacy(f, other), auth);
  assert.equal(mismatch.status, 409, JSON.stringify(mismatch));
  assert.equal(mismatch.body.error.code, 'SEARCHAD_CHANGE_OPERATION_MISMATCH');
  const wrongCustomer = await f.call('POST', legacy(f), { ...auth, customerId: '9999' });
  assert.equal(wrongCustomer.status, 403, JSON.stringify(wrongCustomer));
  assert.equal(wrongCustomer.body.error.code, 'SEARCHAD_CUSTOMER_SCOPE_MISMATCH');
  assert.equal(f.calls.length, count);
});

test('generic approved-plan execution obeys HTTP master write switch', async t => {
  const f = await startWriteFixture(t, { masterWrites: false });
  const auth = await f.approve();
  const result = await f.call('POST', legacy(f), auth);
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.body.error.code, 'HTTP_WRITES_DISABLED');
  assert.equal(f.mutations().length, 0);
});

test('generic read operation remains available with both write gates off', async t => {
  const f = await startWriteFixture(t, { masterWrites: false, searchAdWrites: false });
  const result = await f.call('POST', legacy(f, f.read), { ...f.descriptor(f.read), customerId: CUSTOMER_ID });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.result.data.bidAmt, 300);
  assert.equal(f.mutations().length, 0);
});

test('SearchAdWriteError reaches HTTP callers with its status and recursively redacted details', () => {
  const error = new SearchAdWriteError('SEARCHAD_TEST_CONFLICT', 'Conflict', {
    nested: { executionToken: 'private-execution-value', authorization: 'Bearer private-access' }, safe: 'visible'
  }, 409);
  const result = errorPayloadV05(error, 'request-1');
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'SEARCHAD_TEST_CONFLICT');
  assert.equal(result.body.error.details.safe, 'visible');
  assert.doesNotMatch(JSON.stringify(result), /private-execution-value|private-access/);
});
