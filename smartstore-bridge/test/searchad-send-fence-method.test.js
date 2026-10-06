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
test('Circuit final callback runs under the locked account transaction before synchronous validation and transport', async () => {
  const events = []; const client = { async query(sql) { events.push(sql.includes('FOR UPDATE') ? 'account-lock' : sql); return { rows: [{ customer_id: '1001', suspended: false }] }; }, release() {} };
  const fence = new PostgresAccountSendFence({ pool: { query: client.query, async connect() { return client; } }, fetchImpl() { events.push('fetch'); return { ok: true }; } });
  const dispatch = Object.freeze({ customerId: '1001', purpose: 'ordinary' });
  await fence.run('1001', () => { events.push('validate'); }, () => fence.fetch(url, request('PUT')), 'PUT', { dispatch, async beforeSend(store, bound) { assert.equal(store, client); assert.equal(bound, dispatch); events.push('circuit'); } });
  assert.deepEqual(events.slice(-4), ['circuit', 'validate', 'fetch', 'ROLLBACK']);
  assert.ok(events.indexOf('account-lock') < events.indexOf('circuit'));
});
test('Circuit callback rejection prevents transport and preserves sanitized guard error', async () => {
  const { SearchAdWriteError } = await import('../src/naver/searchad/write/errors.js');
  const { fence, calls } = fixture();
  await assert.rejects(fence.run('1001', () => {}, () => fence.fetch(url, request('PUT')), 'PUT', { dispatch: Object.freeze({ customerId: '1001' }), async beforeSend() { throw new SearchAdWriteError('SEARCHAD_CIRCUIT_DENIED', 'Circuit denied.', {}, 409); } }), { code: 'SEARCHAD_CIRCUIT_DENIED' });
  assert.equal(calls.length, 0);
});
test('final Circuit snapshot validator is synchronous and cannot outlive evidence or KST day', async () => {
  const { CircuitService, createCircuitDispatch } = await import('../src/naver/searchad/circuit/service.js');
  const start=Date.parse('2026-10-05T14:59:59.999Z');
  for(const advance of [1,86400001]) {
    let now=start;
    const repository={async hasBacklog(){return false;},async unresolved(){return false;},async getState(){return {};},async getPolicy(){now+=advance;return {};}};
    const service=new CircuitService({repository,clock:()=>now,lossEvidence:{async select(){return {customerId:'1001',statDateKst:'2026-10-05',quality:'actual',completeCustomerDay:true,identityVerified:true,amountNetKrw:0,observedAt:start};}}});
    const dispatch=createCircuitDispatch({customerId:'1001',purpose:'ordinary',operationKey:'fixture',actionClass:'increase',incrementalSpendKrw:1});
    const {fence,calls}=fixture();
    await assert.rejects(fence.run('1001',()=>{},()=>fence.fetch(url,request('PUT')),'PUT',{dispatch,beforeSend:client=>service.assertDispatchAllowed(dispatch,{client,now:start})}));
    assert.equal(calls.length,0,'clock crossing during final SQL must deny at initiation');
  }
  for(const validator of [async()=>{},()=>true,7]) {
    const {fence,calls}=fixture();
    await assert.rejects(fence.run('1001',()=>{},()=>fence.fetch(url,request('PUT')),'PUT',{dispatch:Object.freeze({customerId:'1001'}),async beforeSend(){return validator;}}),{code:'SEARCHAD_SEND_FENCE_VALIDATOR'});
    assert.equal(calls.length,0);
  }
});
