import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reportingFixture, context, now } from './helpers/searchad-completion-fixture.js';
import { createPostgresMutationGateway } from '../src/naver/searchad/lifecycle/postgres-mutation-gateway.js';
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';
const serviceModule = await import('../src/naver/searchad/reporting/job-service.js').catch(() => null);
const adapterModule = await import('../src/naver/searchad/reporting/remote-adapter.js').catch(() => null);
const jobsInput = { customerId: '1001', kind: 'stat', reportType: 'AD', statDate: '2026-10-04', intentKey: 'daily-20261004' };
const reply = { reportJobId: 51, reportTp: 'AD', statDt: '2026-10-03T15:00:00Z', status: 'REGIST', updateTm: '2026-10-05T03:00:00Z', downloadUrl: 'https://api.searchad.naver.com/report-download?authtoken=do-not-store' };
// This storage double keeps persistence effects, conflict detection and CAS. The
// companion native PG suite verifies the actual SQL/transaction implementation.
function store() {
  const rows = new Map();
  return { rows, async createReportIntent(intent) {
    const existing = [...rows.values()].find(r => r.customerId === intent.customerId && r.kind === intent.kind && r.intentKey === intent.intentKey);
    if (existing) { if (existing.requestHash !== intent.requestHash) throw Object.assign(new Error('conflict'), { status: 409, code: 'SEARCHAD_REPORT_INTENT_CONFLICT' }); return { ...structuredClone(existing), created: false }; }
    const row = { ...intent, processingState: 'planned', quality: 'provisional', remoteJobId: null, claimId: null, reportCreatedAt: null, lastErrorCode: null }; rows.set(row.reportJobId, row); return { ...structuredClone(row), created: true, dispatchPermit: { reportJobId: row.reportJobId } };
  }, async claimReportDispatch({ customerId, reportJobId, requestHash, identity, dispatchPermit }) {
    const row = rows.get(reportJobId);
    if (!dispatchPermit || dispatchPermit.reportJobId !== reportJobId || !row || row.customerId !== customerId || row.processingState !== 'planned' || row.claimId || row.requestHash !== requestHash || row.credentialFingerprint !== identity.credentialFingerprint) return null;
    row.claimId = randomUUID(); row.processingState = 'dispatching'; return structuredClone(row);
  }, async captureReportRegistration(input) {
    const row = rows.get(input.reportJobId);
    if (row.customerId !== input.customerId || row.claimId !== input.claimId || row.remoteJobId) throw new Error('capture rejected');
    Object.assign(row, { remoteJobId: input.remoteJobId, reportCreatedAt: input.reportCreatedAt, remoteUpdatedAt: input.remoteUpdatedAt, registrationAttemptedAt: input.registrationAttemptedAt, registrationInitiatedAt: input.registrationInitiatedAt, registrationAcknowledgedAt: input.registrationAcknowledgedAt }); return structuredClone(row);
  }, async settleReportJob(input) {
    const row = rows.get(input.reportJobId); if (!row || row.customerId !== input.customerId || row.claimId !== input.claimId) throw new Error('settle rejected');
    Object.assign(row, { processingState: input.processingState, lastErrorCode: input.lastErrorCode ?? null, ...(input.quality ? { quality: input.quality } : {}), remoteUpdatedAt: input.remoteUpdatedAt ?? row.remoteUpdatedAt, firstBuiltObservedAt: row.firstBuiltObservedAt ?? (input.processingState === 'built' ? new Date(input.now).toISOString() : null) }); return structuredClone(row);
  }, async getReportJob({ customerId, reportJobId }) { const row = rows.get(reportJobId); return structuredClone(row?.customerId === customerId ? row : null); } };
}
function harness({ response = reply, repository = store(), afterRequest = () => {} } = {}) {
  assert.equal(typeof serviceModule?.ReportJobService, 'function', 'ReportJobService implementation is required');
  assert.equal(typeof adapterModule?.ReportRemoteAdapter, 'function', 'ReportRemoteAdapter implementation is required');
  const f = reportingFixture({ response, afterRequest }); f.config.allowReportingJobs = true;
  const account = { suspended: false, onLock() {} };
  const pool = { async query() { return { rows: [] }; }, async connect() { return { async query(sql) { if (sql.startsWith('SELECT')) { await account.onLock(); return { rows: [{ customer_id: '1001', suspended: account.suspended }] }; } return { rows: [] }; }, release() {} }; } };
  const fenced = createPostgresMutationGateway({ gateway: f.gateway, pool });
  const remote = new adapterModule.ReportRemoteAdapter({ gateway: fenced, registry: f.registry });
  const service = () => new serviceModule.ReportJobService({ repository, remote, identityResolver: f.identityResolver, clock: () => now, config: { allowReportingJobs: true } });
  return { ...f, repository, pool, account, remote, service: service(), restart: service };
}
test('report_intent_same_key_conflicts_on_hash', async () => {
  const f = harness(); const row = await f.service.register(jobsInput, context);
  assert.equal(row.remoteJobId, '51'); assert.equal(row.processingState, 'registered'); assert.equal(row.quality, 'provisional');
  assert.equal((await f.service.register({ intentKey: jobsInput.intentKey, ...jobsInput }, context)).reportJobId, row.reportJobId);
  await assert.rejects(f.service.register({ ...jobsInput, reportType: 'AD_DETAIL' }, context), { status: 409 });
  assert.equal(f.calls.length, 1); assert.equal(JSON.stringify([...f.repository.rows.values()]).includes('authtoken'), false);
  assert.deepEqual(JSON.parse(f.calls[0].body), { reportTp: 'AD', statDt: '20261004' });
});
test('two_connections_only_one_dispatch', async () => {
  const f = harness(); const result = await Promise.all([f.service.register(jobsInput, context), f.restart().register(jobsInput, context)]);
  assert.equal(result[0].reportJobId, result[1].reportJobId); assert.equal(f.calls.length, 1);
});
test('commit_ack_loss_never_sends', async () => {
  const repository = store(); const claim = repository.claimReportDispatch.bind(repository);
  repository.claimReportDispatch = async input => { await claim(input); throw new Error('commit acknowledgement lost'); };
  const f = harness({ repository }); await assert.rejects(f.service.register(jobsInput, context), { status: 503 });
  await f.restart().register(jobsInput, context); assert.equal(f.calls.length, 0); assert.equal([...repository.rows.values()][0].processingState, 'dispatching');
});
test('timeout_after_send_never_reposts_on_restart', async () => {
  const f = harness({ response: Object.assign(new Error('timeout with private token'), { name: 'AbortError' }) });
  await assert.rejects(f.service.register(jobsInput, context), { status: 502 });
  const row = await f.restart().register(jobsInput, context); assert.equal(row.processingState, 'unknown_outcome'); assert.equal(row.remoteJobId, null); assert.equal(f.calls.length, 1);
  assert.equal(JSON.stringify([...f.repository.rows.values()]).includes('private token'), false);
});
test('missing_remote_id_single_list_match_stays_manual_review', async () => {
  const f = harness({ response: { ...reply, reportJobId: undefined } });
  await assert.rejects(f.service.register(jobsInput, context), { status: 502 });
  const row = [...f.repository.rows.values()][0];
  f.remote.list = async () => [{ remoteJobId: '51', reportType: 'AD', status: 'REGIST', reportCreatedAt: null }];
  const result = await f.restart().reconcile({ customerId: '1001', reportJobId: row.reportJobId }, context);
  assert.equal(result.processingState, 'manual_review'); assert.equal(result.remoteJobId, null); assert.equal(result.diagnostics.candidateCount, 1);
  await f.restart().register(jobsInput, context); assert.equal(f.calls.length, 1);
});
test('known_id_reconcile_is_get_only', async () => {
  const f = harness(); const row = await f.service.register(jobsInput, context); f.account.suspended = true; f.config.allowReportingJobs = false;
  const result = await f.restart().reconcile({ customerId: '1001', reportJobId: row.reportJobId }, context);
  assert.equal(result.remoteJobId, '51'); assert.deepEqual(f.calls.map(c => c.method), ['POST','GET']);
  assert.equal(new URL(f.calls[1].url).pathname, '/stat-reports/51');
});
test('report_gate_does_not_enable_ad_create', async () => {
  const f = harness(); await f.service.register(jobsInput, context);
  await assert.rejects(f.gateway.execute(CANARY_OPERATION_KEYS.createCampaign, { customerId: '1001', confirmation: 'CREATE_AD_ENTITY', body: { name: 'forbidden' } }), { code: 'SEARCHAD_GATE_DISABLED' });
  assert.equal(f.calls.length, 1); assert.equal(f.config.allowCreates, undefined); assert.equal(f.config.allowWrites, false);
});
for (const bad of [ { url: 'https://example.com' }, { remoteJobId: '51' }, { operationKey: CANARY_OPERATION_KEYS.createCampaign }, { identity: {} }, { evidence: {} }, { method: 'DELETE' } ]) test(`registration rejects caller authority ${Object.keys(bad)[0]}`, async () => {
  const f = harness(); await assert.rejects(f.service.register({ ...jobsInput, ...bad }, context), { status: 400 }); assert.equal(f.calls.length, 0); assert.equal(f.repository.rows.size, 0);
});
for (const change of [ { customerId: '2002' }, { reportTp: 'AD_DETAIL' }, { reportJobId: '51' }, { reportJobId: Number.MAX_SAFE_INTEGER + 1 }, { status: 'invented' }, { statDt: '2026-10-02T15:00:00Z' } ]) test(`POST response fails closed ${JSON.stringify(change)}`, async () => {
  const f = harness({ response: { ...reply, ...change } }); await assert.rejects(f.service.register(jobsInput, context), { status: 502 });
  const row = [...f.repository.rows.values()][0]; assert.equal(row.remoteJobId, null); assert.equal(row.processingState, 'unknown_outcome');
});
test('capture storage failure cannot return usable success or replay registration', async () => {
  const repository = store(); repository.captureReportRegistration = async () => { throw new Error('capture lost'); };
  const f = harness({ repository }); await assert.rejects(f.service.register(jobsInput, context), { status: 503 });
  const row = await f.restart().register(jobsInput, context); assert.equal(row.remoteJobId, null); assert.equal(row.processingState, 'unknown_outcome'); assert.equal(f.calls.length, 1);
});
test('suspension or identity changes while waiting for the account fence deny initiation', async () => {
  for (const change of [ f => { f.account.suspended = true; }, f => f.rotate(), f => { f.config.allowReportingJobs = false; } ]) {
    const f = harness(); f.account.onLock = () => change(f); await assert.rejects(f.service.register(jobsInput, context)); assert.equal(f.calls.length, 0);
  }
});
test('master job captures only documented string id and generation time', async () => {
  const f = harness({ response: { id: 'master-fixture-1', item: 'Campaign', status: 'BUILT', updateTime: '2026-10-05T03:00:00Z', downloadUrl: reply.downloadUrl } });
  const row = await f.service.register({ customerId: '1001', kind: 'master', reportType: 'Campaign', intentKey: 'master-fixture' }, context);
  assert.equal(row.remoteJobId, 'master-fixture-1'); assert.equal(row.processingState, 'built'); assert.equal(row.reportCreatedAt, '2026-10-05T03:00:00.000Z'); assert.equal(row.quality, 'provisional');
  assert.equal(new URL(f.calls[0].url).pathname, '/master-reports'); assert.deepEqual(JSON.parse(f.calls[0].body), { item: 'Campaign' });
});

test('rolled-back claim COMMIT and failed quarantine cannot reconstruct dispatch authority', async () => {
  const repository = store(); let claimCalls = 0;
  repository.claimReportDispatch = async () => { claimCalls++; throw new Error('COMMIT aborted and acknowledgement lost; quarantine unavailable'); };
  const f = harness({ repository }); await assert.rejects(f.service.register(jobsInput, context), { status: 503 });
  const row = await f.restart().register(jobsInput, context); assert.equal(row.processingState, 'planned'); assert.equal(f.calls.length, 0); assert.equal(claimCalls, 1);
});

test('PostgreSQL repository consumes an opaque fresh creator permit before claim awaits', async () => {
  const { PostgresReportingRepository } = await import('../src/naver/searchad/reporting/postgres-repository.js');
  assert.equal(typeof PostgresReportingRepository.prototype.createReportIntent, 'function', 'durable fresh creator API is required');
  const f = reportingFixture(); const identity = f.identityResolver('1001');
  const { contentHash } = await import('../src/naver/searchad/write/canonical.js');
  const { validateReportJobInput } = serviceModule;
  const scope = validateReportJobInput(jobsInput);
  const intent = { ...scope, ...identity, reportJobId: randomUUID(), requestHash: contentHash({ ...scope, ...identity }), createdAt: new Date(now).toISOString(), registeredByPrincipalId: 'fixture-operator' };
  const dbRow = { report_job_id: intent.reportJobId, customer_id: '1001', report_kind: 'stat', report_type: 'AD', stat_date: '2026-10-04', intent_key: intent.intentKey, intent_hash: intent.requestHash, spec_sha: identity.specSha, credential_fingerprint: identity.credentialFingerprint, upstream_base_url: identity.upstreamBaseUrl, processing_state: 'planned', quality: 'provisional', intent_json: scope };
  let connections = 0;
  const pool = { async query(sql) { if (sql.startsWith('INSERT')) return { rows: [dbRow] }; return { rows: [dbRow] }; }, async connect() { connections++; throw new Error('database unavailable'); } };
  const repository = new PostgresReportingRepository({ pool }); const created = await repository.createReportIntent(intent);
  assert.equal(created.created, true); assert.equal(typeof created.dispatchPermit, 'object');
  const claim = { customerId: '1001', reportJobId: intent.reportJobId, requestHash: intent.requestHash, identity, now, dispatchPermit: created.dispatchPermit };
  await assert.rejects(repository.claimReportDispatch(claim), { status: 503 });
  assert.equal(await repository.claimReportDispatch(claim), null); assert.equal(connections, 1);
  const restarted = new PostgresReportingRepository({ pool }); assert.equal(await restarted.claimReportDispatch(claim), null);
});

test('stat modified time cannot masquerade as exact report generation', async () => {
  const { parseReportResponse } = adapterModule;
  const parsed = parseReportResponse(reply,jobsInput);
  assert.equal(parsed.reportCreatedAt,null);
  assert.equal(parsed.remoteUpdatedAt,'2026-10-05T03:00:00.000Z');
});

test('report HTTP uses actual runtime role routes and exposes no dispatch authority across restart', async t => {
  const { startWriteFixture } = await import('./helpers/searchad-write-http-fixture.js');
  const { createReportingRuntime } = await import('../src/naver/searchad/reporting/runtime.js');
  const reader = 'report-jobs-reader-'.repeat(4), operator = 'report-jobs-operator-'.repeat(4);
  const h = await startWriteFixture(t, { httpEnv: { ATELIER_SEARCHAD_READER_API_KEY: reader, ATELIER_SEARCHAD_READER_CUSTOMERS: '1001', ATELIER_SEARCHAD_OPERATOR_API_KEY: operator, ATELIER_SEARCHAD_OPERATOR_CUSTOMERS: '1001' } });
  const f = harness();
  const runtime = () => createReportingRuntime({ ...f, pool: f.pool, clock: () => now, reportingConfig: { enabled: true, allowReportingJobs: true } });
  h.app.searchAdCompletionRuntime = await runtime();
  const call = async (token, method, route, body) => { const result = await fetch(`http://127.0.0.1:${h.api.server.address().port}${route}`,{ method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: result.status, body: await result.json() }; };
  const registered = await call(operator,'POST','/api/v1/searchad/reporting/jobs',jobsInput); assert.equal(registered.status,201,JSON.stringify(registered)); assert.equal(registered.body.remoteJobId,'51');
  assert.equal((await call(reader,'POST','/api/v1/searchad/reporting/jobs',jobsInput)).status,403);
  await h.app.searchAdCompletionRuntime.close(); h.app.searchAdCompletionRuntime = await runtime();
  const repeated = await call(operator,'POST','/api/v1/searchad/reporting/jobs',jobsInput); assert.equal(repeated.body.reportJobId,registered.body.reportJobId); assert.equal(f.calls.length,1);
  const path = `/api/v1/searchad/reporting/jobs/${registered.body.reportJobId}`;
  assert.equal((await call(reader,'GET',`${path}?customerId=1001`)).status,200);
  assert.equal((await call(reader,'GET',`${path}?customerId=2002`)).status,403);
  assert.equal((await call(operator,'POST',`${path}/poll`,{ customerId:'1001',remoteJobId:'51' })).status,400);
  const polled = await call(operator,'POST',`${path}/reconcile`,{ customerId:'1001' }); assert.equal(polled.status,200); assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
  assert.equal(JSON.stringify(polled.body).includes('dispatchPermit'),false); assert.equal(JSON.stringify(polled.body).includes('credentialFingerprint'),false);
  const docs = await call(reader,'GET','/openapi-searchad-completion-operator.json'); assert.equal(docs.status,200); assert.equal(docs.body.paths['/api/v1/searchad/reporting/jobs'].post.requestBody.content['application/json'].schema.oneOf.every(branch => branch.additionalProperties === false),true);
  await h.app.searchAdCompletionRuntime.close();
});


test('registration and first BUILT observations retain server-owned generation bounds separately', async () => {
  const builtReply = { ...reply, status: 'BUILT' }; const f = harness({ response: builtReply });
  const row = await f.service.register(jobsInput,context);
  assert.equal(row.reportCreatedAt,null); assert.equal(row.remoteUpdatedAt,'2026-10-05T03:00:00.000Z');
  assert.equal(row.registrationAttemptedAt,'2026-10-05T03:00:00.000Z'); assert.equal(row.registrationAcknowledgedAt,'2026-10-05T03:00:00.000Z');
  assert.equal(row.firstBuiltObservedAt,'2026-10-05T03:00:00.000Z');
});

test('report gateway rejects altered pinned operations and arbitrary advertising keys before transport', async () => {
  const { REPORT_OPERATION_KEYS } = await import('../src/naver/searchad/reporting/operations.js');
  for (const modify of [
    f => { f.registry.get(REPORT_OPERATION_KEYS.registerStat).path = '/ncc/campaigns'; },
    f => { f.registry.get(REPORT_OPERATION_KEYS.registerStat).sourceOperationId = 'other'; },
    f => { f.registry.get(REPORT_OPERATION_KEYS.registerStat).specRef = 'a'.repeat(40); },
    f => { f.registry.get(REPORT_OPERATION_KEYS.registerStat).runtimeAllowlisted = false; },
    f => { f.registry.get(REPORT_OPERATION_KEYS.registerStat).tier = 'C'; },
    f => { f.registry.manifest.operations.push({ ...f.registry.get(REPORT_OPERATION_KEYS.registerStat), operationKey: 'duplicate' }); }
  ]) {
    const f = harness(); modify(f); await assert.rejects(f.service.register(jobsInput,context)); assert.equal(f.calls.length,0);
  }
  const f = harness(); await assert.rejects(f.gateway.executeReportJob(CANARY_OPERATION_KEYS.createCampaign,{ customerId:'1001',body:{name:'forbidden'} })); assert.equal(f.calls.length,0);
});
test('registration unknown-ID diagnostic really performs only pinned list GET and never persists candidates', async () => {
  const listReply = [reply]; const response = { ...reply, reportJobId: undefined };
  const f = harness({ response }); await assert.rejects(f.service.register(jobsInput,context), { status:502 });
  f.gateway.client.fetchImpl = async (url,init) => { assert.equal(init.method,'GET'); assert.equal(new URL(url).pathname,'/stat-reports'); f.calls.push({url:String(url),method:init.method}); return new Response(JSON.stringify(listReply),{headers:{'content-type':'application/json'}}); };
  // Read adapter uses the shared gateway's GET path; account suspension cannot
  // become a registration authorization and cannot block GET recovery.
  f.account.suspended = true;
  const row = [...f.repository.rows.values()][0]; const reconciled = await f.service.reconcile({customerId:'1001',reportJobId:row.reportJobId},context);
  assert.equal(reconciled.diagnostics.candidateCount,1); assert.equal(reconciled.remoteJobId,null); assert.equal(reconciled.processingState,'manual_review'); assert.deepEqual(f.calls.map(c=>c.method),['POST','GET']);
});

test('prototype names are invalid report kinds before persistence or transport', async () => {
  for (const kind of ['constructor','__proto__','toString']) { const f = harness(); await assert.rejects(f.service.register({...jobsInput,kind},context),{status:400}); assert.equal(f.repository.rows.size,0); assert.equal(f.calls.length,0); }
});

test('known-ID recovery cannot redirect a pinned read after adapter construction', async () => {
  const { REPORT_OPERATION_KEYS } = await import('../src/naver/searchad/reporting/operations.js'); const f = harness(); const row = await f.service.register(jobsInput,context);
  f.registry.get(REPORT_OPERATION_KEYS.getStat).path='/ncc/campaigns';
  await assert.rejects(f.service.poll({customerId:'1001',reportJobId:row.reportJobId},context),{status:502}); assert.equal(f.calls.length,1);
});

test('successful registration records actual fenced transport initiation separately from pre-fence attempt', async () => {
  const f = harness(); const row = await f.service.register(jobsInput,context);
  assert.equal(row.registrationInitiatedAt,'2026-10-05T03:00:00.000Z'); assert.equal(row.registrationAttemptedAt,'2026-10-05T03:00:00.000Z');
});
