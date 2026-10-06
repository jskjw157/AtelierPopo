import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { SearchAdError, searchAdErrorFromResponse } from '../src/naver/searchad/errors.js';

const source = new URL('../src/naver/searchad/lifecycle/hierarchy-reconcile-service.js', import.meta.url);
async function load() {
  assert.ok(fs.existsSync(source), 'B2b requires a bounded read-only hierarchy reconcile service');
  return import(source);
}
const runId = '00000000-0000-4000-8000-000000000001';
const ids = ['00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'];
const current = { specSha: 'fixture-spec', credentialFingerprint: 'fixture-fingerprint', upstreamBaseUrl: 'https://fixture.invalid' };
const principal = { principalId: 'fixture-admin', role: 'admin', customerIds: ['1001'] };
const idKeys = { campaign: 'nccCampaignId', adgroup: 'nccAdgroupId', keyword: 'nccKeywordId', creative: 'nccAdId' };
const pathKeys = { campaign: 'campaignId', adgroup: 'adgroupId', keyword: 'nccKeywordId', creative: 'adId' };

// These are explicitly in-memory SERVICE-boundary fixtures. Transactional state
// changes are exercised separately with real PostgreSQL in the integration file.
function fixture(type = 'creative') {
  const types = type === 'campaign' ? ['campaign'] : type === 'adgroup' ? ['campaign', 'adgroup'] : ['campaign', 'adgroup', type];
  const objects = types.map((objectType, i) => ({ hierarchyObjectId: ids[i], hierarchyRunId: runId,
    customerId: '1001', objectType, parentObjectId: i ? ids[i - 1] : null,
    createOperationKey: OPS[objectType].create, readOperationKey: OPS[objectType].read, deleteOperationKey: OPS[objectType].delete,
    remoteId: `synthetic-${objectType}`, state: i === types.length - 1 ? 'delete_pending' : 'owned' }));
  const target = objects.at(-1);
  const ownerships = objects.map((o, i) => ({ ownershipId: `ownership-${i}`, customerId: o.customerId, objectType: o.objectType,
    remoteId: o.remoteId, ownerKind: 'hierarchy_canary', ownerRunId: runId, hierarchyObjectId: o.hierarchyObjectId,
    parentHierarchyObjectId: o.parentObjectId, createdOperationKey: o.createOperationKey, state: 'owned' }));
  const snapshot = { run: { hierarchyRunId: runId, customerId: '1001', status: 'unknown_outcome', ...current }, objects, ownerships, targetId: target.hierarchyObjectId };
  const input = { customerId: '1001', hierarchyRunId: runId, hierarchyObjectId: target.hierarchyObjectId };
  const calls = { loads: 0, reads: [], records: [] };
  const repository = {
    async loadSnapshot() { calls.loads += 1; return snapshot; },
    async recordObservation(s, observation) { calls.records.push({ snapshot: s, ...observation }); return { kind: observation.kind }; }
  };
  const data = { [idKeys[type]]: target.remoteId, customerId: 1001 };
  if (type === 'campaign') data.campaignTp = 'WEB_SITE';
  if (type === 'adgroup') data.nccCampaignId = objects[0].remoteId;
  if (type === 'keyword' || type === 'creative') data.nccAdgroupId = objects[1].remoteId;
  if (type === 'creative') data.type = 'TEXT_45';
  let response = { operation: { operationKey: OPS[type].read, sideEffect: false }, upstream: { status: 200 }, data };
  const remote = { async read(d) { calls.reads.push(structuredClone(d)); return response; } };
  Object.defineProperty(remote, 'mutate', { get() { throw new Error('Reconcile must not even acquire a mutation function'); } });
  return { snapshot, input, calls, repository, remote, target, data,
    set response(value) { response = value; }, get response() { return response; },
    args: { repository, remote, contextResolver: async () => current, clock: () => Date.parse('2026-09-12T05:00:00.000Z') } };
}

async function noNetwork(t) {
  let network = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { network += 1; throw new Error('No real upstream call is permitted'); };
  t.after(() => { globalThis.fetch = original; assert.equal(network, 0); });
}

test('B2b reconcile requires explicit repository, read adapter and current identity resolver', async () => {
  const { HierarchyReconcileService: Service } = await load();
  const f = fixture();
  for (const patch of [{ repository: null }, { remote: {} }, { contextResolver: null }]) {
    assert.throws(() => new Service({ ...f.args, ...patch }), TypeError);
  }
});

test('B2b reconcile denies wrong role/Customer and caller-supplied evidence before persistence or I/O', async t => {
  const { HierarchyReconcileService: Service } = await load();
  await noNetwork(t);
  const f = fixture(); const service = new Service(f.args);
  for (const p of [{}, { ...principal, role: 'reader' }, { ...principal, customerIds: ['2002'] }]) {
    await assert.rejects(() => service.reconcile(f.input, { principal: p }));
  }
  for (const extra of [{ remoteId: 'injected' }, { snapshot: f.response }, { passed: true }, { url: 'https://bad.invalid' }, { executionToken: 'no-token-input' }]) {
    await assert.rejects(() => service.reconcile({ ...f.input, ...extra }, { principal }));
  }
  assert.equal(f.calls.loads, 0); assert.deepEqual(f.calls.reads, []); assert.deepEqual(f.calls.records, []);
});

test('B2b reconcile uses only the pinned GET and persisted ID for all four hierarchy object types', async t => {
  const { HierarchyReconcileService: Service } = await load();
  await noNetwork(t);
  for (const type of Object.keys(OPS)) {
    const f = fixture(type); const result = await new Service(f.args).reconcile(f.input, { principal });
    assert.equal(result.kind, 'present');
    assert.deepEqual(f.calls.reads, [{ operationKey: OPS[type].read, customerId: '1001', pathParams: { [pathKeys[type]]: f.target.remoteId } }]);
    assert.equal(f.calls.records.length, 1);
  }
});

test('B2b reconcile validates persisted graph, operation and ownership before reading', async t => {
  const { HierarchyReconcileService: Service } = await load(); await noNetwork(t);
  const changes = [
    f => { f.target.customerId = '2002'; }, f => { f.target.hierarchyRunId = ids[0]; },
    f => { f.target.parentObjectId = ids[0]; }, f => { f.target.readOperationKey = OPS.creative.delete; },
    f => { f.snapshot.ownerships.at(-1).ownerRunId = ids[0]; },
    f => { f.snapshot.ownerships.at(-1).parentHierarchyObjectId = ids[0]; },
    f => { f.snapshot.ownerships.at(-1).remoteId = 'different-id'; },
    f => { f.snapshot.ownerships.pop(); }, f => { f.snapshot.objects[1].parentObjectId = ids[1]; },
    f => { f.snapshot.objects[0].state = 'delete_unknown'; }
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    await assert.rejects(() => new Service(f.args).reconcile(f.input, { principal }));
    assert.deepEqual(f.calls.reads, []); assert.deepEqual(f.calls.records, []);
  }
});

test('B2b reconcile rejects malformed persisted IDs without coercing values into a target', async () => {
  const { HierarchyReconcileService: Service } = await load();
  for (const id of [{}, [], 42, true, ' ', 'synthetic/ad', ' id', 'id\n']) {
    const f = fixture(); f.target.remoteId = id; f.snapshot.ownerships.at(-1).remoteId = id;
    await assert.rejects(() => new Service(f.args).reconcile(f.input, { principal }));
    assert.equal(f.calls.reads.length, 0);
  }
});

test('B2b no-returned-ID create outcome becomes manual-review observation without searching by name', async () => {
  const { HierarchyReconcileService: Service } = await load();
  const f = fixture(); f.target.remoteId = null; f.target.state = 'create_unknown'; f.snapshot.ownerships.pop();
  const result = await new Service(f.args).reconcile(f.input, { principal });
  assert.equal(result.kind, 'no_returned_id'); assert.deepEqual(f.calls.reads, []);
  assert.equal(f.calls.records[0].kind, 'no_returned_id');
});

test('B2b only an actual SearchAd upstream 404 counts as absence; local and forged 404s do not', async () => {
  const { HierarchyReconcileService: Service } = await load();
  const genuine = searchAdErrorFromResponse({ response: { status: 404, statusText: 'Not Found' }, data: {}, requestId: 'fixture' });
  const errors = [genuine, Object.assign(new Error('local'), { status: 404 }),
    new SearchAdError('not upstream', { status: 404 }),
    new SearchAdError('conflicting', { status: 404, upstreamStatus: 503, code: 'SEARCHAD_UPSTREAM_ERROR' })];
  for (const error of errors) {
    const f = fixture(); f.args.remote = { async read() { throw error; } };
    const result = await new Service(f.args).reconcile(f.input, { principal });
    assert.equal(result.kind, error === genuine ? 'absent' : 'unavailable');
  }
});

test('B2b success envelopes must match exact Customer, ID, parent, type and pinned GET', async () => {
  const { HierarchyReconcileService: Service } = await load();
  const changes = [
    f => { f.response.data = null; }, f => { f.response.data = []; }, f => { f.response.data = {}; },
    f => { f.data.customerId = 2002; }, f => { f.data.nccAdId = 'different'; },
    f => { f.data.nccAdId = {}; }, f => { f.data.nccAdgroupId = 'different'; },
    f => { f.data.type = 'OTHER'; }, f => { f.response.operation.operationKey = OPS.creative.delete; },
    f => { f.response.operation.sideEffect = true; }, f => { f.response.upstream.status = 404; },
    f => { f.response.body = f.data; }
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.equal((await new Service(f.args).reconcile(f.input, { principal })).kind, 'mismatch');
  }
});

test('B2b malformed campaign and parent identities also fail closed', async () => {
  const { HierarchyReconcileService: Service } = await load();
  const campaign = fixture('campaign'); campaign.data.campaignTp = 'SHOPPING';
  assert.equal((await new Service(campaign.args).reconcile(campaign.input, { principal })).kind, 'mismatch');
  const group = fixture('adgroup'); group.data.nccCampaignId = 'foreign';
  assert.equal((await new Service(group.args).reconcile(group.input, { principal })).kind, 'mismatch');
  const keyword = fixture('keyword'); delete keyword.data.nccAdgroupId;
  assert.equal((await new Service(keyword.args).reconcile(keyword.input, { principal })).kind, 'mismatch');
});

test('B2b checks current credential/spec/upstream identity both before read and before committing observation', async () => {
  const { HierarchyReconcileService: Service } = await load();
  for (const field of Object.keys(current)) {
    const f = fixture(); f.args.contextResolver = async () => ({ ...current, [field]: 'changed' });
    await assert.rejects(() => new Service(f.args).reconcile(f.input, { principal }));
    assert.equal(f.calls.reads.length, 0); assert.equal(f.calls.records.length, 0);
  }
  const f = fixture(); let calls = 0;
  f.args.contextResolver = async () => (++calls === 1 ? current : { ...current, credentialFingerprint: 'rotated' });
  await assert.rejects(() => new Service(f.args).reconcile(f.input, { principal }));
  assert.equal(f.calls.reads.length, 1); assert.equal(f.calls.records.length, 0);
});

test('B2b never stores arbitrary upstream error text, response bodies, headers or execution tokens', async () => {
  const { HierarchyReconcileService: Service } = await load();
  const secret = 'do-not-persist-this'; const f = fixture();
  f.args.remote = { async read() { throw new SearchAdError(secret, { status: 502, upstreamStatus: 503, details: { authorization: secret }, requestId: secret }); } };
  await new Service(f.args).reconcile(f.input, { principal });
  assert.equal(JSON.stringify(f.calls.records).includes(secret), false);
  assert.deepEqual(Object.keys(f.calls.records[0]).sort(), ['kind', 'observedAt', 'snapshot']);
});
