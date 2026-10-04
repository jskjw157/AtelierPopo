import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresReportingRepository } from '../src/naver/searchad/reporting/postgres-repository.js';
import { reportingFixture, context, now } from './helpers/searchad-completion-fixture.js';
import { postgresCompletionFixture, completionReaderKey as reader, completionOperatorKey as operator } from './helpers/postgres-searchad-completion-fixture.js';
const input = { customerId: '1001', kind: 'stat', reportType: 'AD', statDate: '2026-10-04', intentKey: 'pg-daily-20261004' };
const response = { reportJobId: 51, reportTp: 'AD', statDt: '2026-10-03T15:00:00Z', status: 'REGIST', updateTm: '2026-10-05T03:00:00Z', downloadUrl: 'https://api.searchad.naver.com/report-download?authtoken=pg-private-token' };
function requirePg(t) { if (process.env.TEST_DATABASE_URL) return true; assert.notEqual(process.env.CI, 'true', 'CI requires native PostgreSQL report registration acceptance'); t.skip('TEST_DATABASE_URL is required'); return false; }
async function service(repository, f) { const { ReportJobService } = await import('../src/naver/searchad/reporting/job-service.js'); return new ReportJobService({ repository, remote: { register: async () => { f.sends++; return { remoteJobId: '51', status: 'REGIST', reportCreatedAt: null }; } }, identityResolver: f.identityResolver, clock: () => now, config: { allowReportingJobs: true } }); }
test('two_connections_only_one_dispatch with native PostgreSQL scoped conflicts and restart', async t => {
  if (!requirePg(t)) return; const h = await postgresCompletionFixture(t); await h.pool.query("INSERT INTO searchad_customer_accounts(customer_id) VALUES('1001'),('2002') ON CONFLICT DO NOTHING");
  const f = reportingFixture(); f.sends = 0;
  const a = await service(new PostgresReportingRepository({ pool: h.pool }), f); const b = await service(new PostgresReportingRepository({ pool: h.connect() }), f);
  const rows = await Promise.all([a.register(input, context), b.register(input, context)]); assert.equal(rows[0].reportJobId, rows[1].reportJobId); assert.equal(f.sends, 1);
  await assert.rejects(b.register({ ...input, reportType: 'AD_DETAIL' }, context), { status: 409 });
  const repository = new PostgresReportingRepository({ pool: h.connect() }); assert.equal(await repository.getReportJob({ customerId: '2002', reportJobId: rows[0].reportJobId }), null);
  assert.equal((await (await service(repository, f)).register(input, context)).remoteJobId, '51'); assert.equal(f.sends, 1);
  assert.equal(JSON.stringify((await h.pool.query('SELECT * FROM searchad_report_jobs')).rows).includes('authtoken'), false);
});
for (const committed of [true,false]) test(`commit_ack_loss_never_sends with ${committed ? 'committed' : 'rolled-back'} native claim and unavailable quarantine`, async t => {
  if (!requirePg(t)) return; const h = await postgresCompletionFixture(t); await h.pool.query("INSERT INTO searchad_customer_accounts(customer_id) VALUES('1001') ON CONFLICT DO NOTHING");
  const faultPool = { async query(sql, args) { if (sql.startsWith('UPDATE')) throw new Error('quarantine unavailable'); return h.pool.query(sql, args); }, async connect() {
    const c = await h.pool.connect(); return { async query(sql,args) { if (sql === 'COMMIT') { await c.query(committed ? 'COMMIT' : 'ROLLBACK'); throw new Error('acknowledgement lost'); } return c.query(sql,args); }, release: discard => c.release(discard) };
  } };
  const f = reportingFixture(); f.sends = 0; const first = await service(new PostgresReportingRepository({ pool: faultPool }), f);
  await assert.rejects(first.register(input, context), { status: 503 });
  const repository = new PostgresReportingRepository({ pool: h.connect() }); const restarted = await service(repository, f);
  const row = await restarted.register(input, context); assert.equal(f.sends, 0); assert.equal(row.processingState, committed ? 'dispatching' : 'planned');
  assert.equal(row.dispatchPermit, undefined); assert.equal(row.created, undefined);
});
test('actual report HTTP bootstrap registration repeats and reconstructs without another POST', async t => {
  if (!requirePg(t)) return; const f = await postgresCompletionFixture(t);
  const first = await f.start({ appEnv: { ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS: 'true' }, allowedPaths: ['/stat-reports','/stat-reports/51'], response });
  const registered = await first.call(operator,'POST','/api/v1/searchad/reporting/jobs',input); assert.equal(registered.status,201,JSON.stringify(registered)); assert.equal(registered.body.remoteJobId,'51');
  assert.equal((await first.call(reader,'POST','/api/v1/searchad/reporting/jobs',input)).status,403);
  assert.equal((await first.call(operator,'POST','/api/v1/searchad/reporting/jobs',{ ...input, remoteJobId: '51' })).status,400);
  assert.equal((await first.call(operator,'POST','/api/v1/searchad/reporting/jobs',input)).body.reportJobId, registered.body.reportJobId);
  await first.api.close();
  const second = await f.start({ appEnv: { ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS: 'true' }, allowedPaths: ['/stat-reports','/stat-reports/51'], response });
  assert.equal((await second.call(operator,'POST','/api/v1/searchad/reporting/jobs',input)).body.reportJobId,registered.body.reportJobId);
  const route = `/api/v1/searchad/reporting/jobs/${registered.body.reportJobId}`;
  const read = await second.call(reader,'GET',`${route}?customerId=1001`); assert.equal(read.status,200); assert.equal(read.body.remoteJobId,'51');
  assert.equal((await second.call(reader,'GET',`${route}?customerId=2002`)).status,403);
  assert.equal((await second.call(operator,'POST',`${route}/reconcile`,{ customerId: '1001' })).status,200);
  assert.equal(f.calls.filter(call=>call.method === 'POST').length,1); assert.equal(f.calls.filter(call=>call.method === 'GET').length,1);
  const serialized = JSON.stringify((await f.pool.query('SELECT * FROM searchad_report_jobs')).rows); assert.equal(serialized.includes('pg-private-token'),false);
  assert.equal(JSON.stringify(read.body).includes('credentialFingerprint'),false); assert.equal(JSON.stringify(read.body).includes('dispatchPermit'),false);
  const docs = await second.call(reader,'GET','/openapi-searchad-completion-reader.json'); assert.ok(docs.body.paths['/api/v1/searchad/reporting/jobs/{reportJobId}']); assert.equal(docs.body.paths['/api/v1/searchad/reporting/jobs']?.post,undefined);
  assert.equal(second.app.searchAdConfig.allowWrites,false); assert.equal(second.app.searchAdConfig.allowCreates,false);
  await second.api.close();
  const disabled = await f.start({ allowedPaths: ['/stat-reports'], response }); assert.equal((await disabled.call(operator,'POST','/api/v1/searchad/reporting/jobs',{...input,intentKey:'gate-off'})).status,503);
});

test('native report account fence denies suspended Customer and rotation after locked read', async t => {
  if (!requirePg(t)) return; const h = await postgresCompletionFixture(t);
  await h.pool.query("INSERT INTO searchad_customer_accounts(customer_id) VALUES('1001') ON CONFLICT DO NOTHING");
  await h.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',true) ON CONFLICT(customer_id) DO UPDATE SET suspended=true");
  const { createReportingRuntime } = await import('../src/naver/searchad/reporting/runtime.js');
  const f = reportingFixture({ response }); f.config.allowReportingJobs = true;
  const repository = new PostgresReportingRepository({ pool: h.pool });
  let rotate = false;
  const pool = { query: (sql,args) => h.pool.query(sql,args), async connect() { const c = await h.pool.connect(); return { async query(sql,args) { const result = await c.query(sql,args); if (rotate && sql.includes('FROM searchad_canary_accounts') && sql.includes('FOR UPDATE')) f.rotate(); return result; }, on: (...args) => c.on(...args), removeListener: (...args) => c.removeListener(...args), release: discard => c.release(discard) }; } };
  const runtime = await createReportingRuntime({ ...f, repository, pool, clock: () => now, reportingConfig: { enabled: true, allowReportingJobs: true } });
  t.after(() => runtime.close());
  await assert.rejects(runtime.jobService.register(input,context), { status:502 }); assert.equal(f.calls.length,0);
  await h.pool.query("UPDATE searchad_canary_accounts SET suspended=false WHERE customer_id='1001'"); rotate = true;
  await assert.rejects(runtime.jobService.register({ ...input,intentKey:'rotated-while-locked' },context), { status:502 }); assert.equal(f.calls.length,0);
});
test('native capture failure and offline timeout retain consumed intent across actual HTTP restart', async t => {
  if (!requirePg(t)) return; const f = await postgresCompletionFixture(t);
  const first = await f.start({ appEnv: { ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true' }, allowedPaths:['/stat-reports'], response });
  await f.pool.query("CREATE FUNCTION fail_report_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.remote_job_id IS NOT NULL THEN RAISE EXCEPTION 'offline capture store failure'; END IF; RETURN NEW; END $$");
  await f.pool.query('CREATE TRIGGER fail_report_capture BEFORE UPDATE ON searchad_report_jobs FOR EACH ROW EXECUTE FUNCTION fail_report_capture()');
  const capture = await first.call(operator,'POST','/api/v1/searchad/reporting/jobs',input); assert.equal(capture.status,503,JSON.stringify(capture)); assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  await f.pool.query('DROP TRIGGER fail_report_capture ON searchad_report_jobs'); await first.api.close();
  const second = await f.start({ appEnv:{ ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true' },allowedPaths:['/stat-reports'],response:Object.assign(new Error('offline transport timeout'),{name:'AbortError'}) });
  const unresolved = await second.call(operator,'POST','/api/v1/searchad/reporting/jobs',input); assert.equal(unresolved.status,201); assert.equal(unresolved.body.processingState,'unknown_outcome'); assert.equal(unresolved.body.remoteJobId,null); assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  const timeoutInput = { ...input,intentKey:'pg-timeout' }; assert.equal((await second.call(operator,'POST','/api/v1/searchad/reporting/jobs',timeoutInput)).status,502); await second.api.close();
  const third = await f.start({ appEnv:{ ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true' },allowedPaths:['/stat-reports'],response });
  const repeated = await third.call(operator,'POST','/api/v1/searchad/reporting/jobs',timeoutInput); assert.equal(repeated.status,201); assert.equal(repeated.body.processingState,'unknown_outcome'); assert.equal(f.calls.filter(c=>c.method==='POST').length,2);
});

test('native BUILT metadata persists generation bounds while processing and quality remain distinct', async t => {
  if (!requirePg(t)) return; const f = await postgresCompletionFixture(t);
  const first = await f.start({appEnv:{ ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true' },allowedPaths:['/stat-reports','/stat-reports/51'],response:{...response,status:'BUILT'}});
  const registered = await first.call(operator,'POST','/api/v1/searchad/reporting/jobs',input); assert.equal(registered.status,201,JSON.stringify(registered)); assert.equal(registered.body.processingState,'built'); assert.equal(registered.body.quality,'provisional');
  assert.equal(registered.body.reportCreatedAt,null); assert.equal(registered.body.remoteUpdatedAt,'2026-10-05T03:00:00.000Z'); assert.equal(registered.body.registrationInitiatedAt,'2026-10-05T03:00:00.000Z'); assert.equal(registered.body.firstBuiltObservedAt,'2026-10-05T03:00:00.000Z'); assert.equal(registered.body.generationTimeBasis,'derived_window');
  await f.pool.query("UPDATE searchad_report_jobs SET processing_state='ingested',quality='quarantined' WHERE report_job_id=$1",[registered.body.reportJobId]);
  const repository = first.app.searchAdCompletionRuntime.repository;
  const row = await repository.getReportJob({customerId:'1001',reportJobId:registered.body.reportJobId});
  const refresh = await repository.settleReportJob({customerId:'1001',reportJobId:row.reportJobId,claimId:row.claimId,processingState:'polling',quality:null,now:now+60000});
  assert.equal(refresh.processingState,'ingested'); assert.equal(refresh.quality,'quarantined'); assert.equal(refresh.firstBuiltObservedAt,'2026-10-05T03:00:00.000Z');
});

test('unknown-ID native HTTP recovery lists one candidate but never captures ownership', async t => {
  if (!requirePg(t)) return; const f = await postgresCompletionFixture(t);
  const first = await f.start({appEnv:{ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true'},allowedPaths:['/stat-reports'],response:{...response,reportJobId:undefined}});
  const missing = await first.call(operator,'POST','/api/v1/searchad/reporting/jobs',input); assert.equal(missing.status,502);
  const id = (await f.pool.query('SELECT report_job_id FROM searchad_report_jobs')).rows[0].report_job_id; await first.api.close();
  const second = await f.start({allowedPaths:['/stat-reports'],response:[response]});
  const result = await second.call(operator,'POST',`/api/v1/searchad/reporting/jobs/${id}/reconcile`,{customerId:'1001'}); assert.equal(result.status,200,JSON.stringify(result)); assert.equal(result.body.processingState,'manual_review'); assert.equal(result.body.remoteJobId,null); assert.deepEqual(result.body.diagnostics,{candidateCount:1,ownershipEstablished:false,completeAbsenceProof:false});
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1); assert.equal(f.calls.filter(c=>c.method==='GET').length,1); assert.equal(JSON.stringify((await f.pool.query('SELECT * FROM searchad_report_jobs')).rows).includes('pg-private-token'),false);
});
test('master native HTTP captures documented generation timestamp and GET-only restart recovery', async t => {
  if (!requirePg(t)) return; const f = await postgresCompletionFixture(t);
  const master = {id:'master-fixture-1',item:'Campaign',fromTime:'2026-10-01T00:00:00Z',status:'BUILT',updateTime:'2026-10-05T03:00:00Z',downloadUrl:response.downloadUrl};
  const first = await f.start({appEnv:{ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true'},allowedPaths:['/master-reports'],response:master});
  const request = {customerId:'1001',kind:'master',reportType:'Campaign',fromTime:'2026-10-01T00:00:00Z',intentKey:'master-fixture'};
  const result = await first.call(operator,'POST','/api/v1/searchad/reporting/jobs',request); assert.equal(result.status,201,JSON.stringify(result)); assert.equal(result.body.reportCreatedAt,'2026-10-05T03:00:00.000Z'); assert.equal(result.body.generationTimeBasis,'response_generation_time'); assert.equal(result.body.quality,'provisional'); await first.api.close();
  const second = await f.start({allowedPaths:['/master-reports/master-fixture-1'],response:master});
  const polled = await second.call(operator,'POST',`/api/v1/searchad/reporting/jobs/${result.body.reportJobId}/poll`,{customerId:'1001'}); assert.equal(polled.status,200); assert.equal(polled.body.remoteJobId,'master-fixture-1'); assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  assert.deepEqual(JSON.parse(f.calls[0].body),{item:'Campaign',fromTime:'2026-10-01T00:00:00.000Z'}); assert.equal(JSON.stringify((await f.pool.query('SELECT * FROM searchad_report_jobs')).rows).includes('pg-private-token'),false);
});
