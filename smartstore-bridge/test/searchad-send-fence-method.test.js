import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresAccountSendFence } from '../src/naver/searchad/lifecycle/postgres-account-send-fence.js';
const url = 'https://api.searchad.naver.com/ncc/campaigns/fixture';
const request = method => ({ method, headers: { 'X-Customer': '1001' }, body: '{}' });
function fixture() {
  const calls = [], sql = [];
  const client = { async query(statement) { sql.push(statement); return { rows: [{ customer_id: '1001', suspended: false }] }; }, release() {} };
  const pool = { query: client.query, async connect() { return client; } };
  const fence = new PostgresAccountSendFence({ pool, fetchImpl: async (_url, init) => { calls.push(init); return { ok: true }; } });
  return { fence, calls, sql };
}
test('an explicit PUT scope admits exactly one PUT without changing legacy POST/DELETE defaults', async () => {
  const { fence, calls } = fixture();
  assert.equal((await fence.run('1001', () => {}, () => fence.fetch(url, request('PUT')), 'PUT')).ok, true);
  await assert.rejects(fence.run('1001', () => {}, () => fence.fetch(url, request('PUT'))), { code: 'SEARCHAD_SEND_FENCE_SCOPE' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].redirect, 'error');
});
test('an explicit method binding cannot be substituted with another mutation', async () => {
  const { fence, calls } = fixture();
  for (const method of ['POST', 'DELETE']) {
    await assert.rejects(fence.run('1001', () => {}, () => fence.fetch(url, request(method)), 'PUT'), { code: 'SEARCHAD_SEND_FENCE_SCOPE' });
  }
  assert.equal(calls.length, 0);
});
test('unsupported or non-string method bindings reject before acquiring PostgreSQL', async () => {
  const { fence, calls, sql } = fixture();
  for (const method of ['GET', 'PATCH', 'put', '', {}, true]) {
    await assert.rejects(fence.run('1001', () => {}, () => fence.fetch(url, request('POST')), method), { code: 'SEARCHAD_SEND_FENCE_INPUT' });
  }
  assert.equal(calls.length, 0); assert.equal(sql.length, 0);
});
