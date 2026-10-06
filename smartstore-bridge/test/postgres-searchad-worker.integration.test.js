import test from 'node:test';
import assert from 'node:assert/strict';
import { postgresCompletionFixture } from './helpers/postgres-searchad-completion-fixture.js';
import { contentHash } from '../src/naver/searchad/write/canonical.js';
const at=Date.parse('2026-10-05T03:00:00Z'), iso=v=>new Date(v).toISOString();
function native(t) { if(process.env.TEST_DATABASE_URL)return true; assert.notEqual(process.env.CI,'true','Worker acceptance requires native PostgreSQL');t.skip('TEST_DATABASE_URL is required');return false; }
async function fixture(t) {
  const f=await postgresCompletionFixture(t);
  const {PostgresWorkerRepository}=await import('../src/naver/searchad/worker/postgres-repository.js');
  return {...f,repo:new PostgresWorkerRepository({pool:f.pool}),repo2:new PostgresWorkerRepository({pool:f.connect()})};
}
const payload={entityType:'campaign',entityId:'cmp-1'};
async function enqueue(repo,scheduleId='stats',slot=at) { return repo.enqueueSlot({customerId:'1001',scheduleId,slotAt:iso(slot),kind:'collect_stats',payload,requestHash:contentHash({kind:'collect_stats',payload}),now:at}); }
test('two_workers_skip_locked_claim_distinct_jobs',async t=>{
  if(!native(t))return;const f=await fixture(t);await enqueue(f.repo);await enqueue(f.repo,'stats2');
  const [a,b]=await Promise.all([f.repo.claim({workerId:'a',now:at,leaseMs:1000}),f.repo2.claim({workerId:'b',now:at,leaseMs:1000})]);
  assert.notEqual(a.jobId,b.jobId);assert.notEqual(a.ownerToken,b.ownerToken);assert.equal(a.leaseGeneration,1);assert.equal(b.leaseGeneration,1);
});
test('unique_schedule_slot_survives_restart',async t=>{
  if(!native(t))return;const f=await fixture(t);const a=await enqueue(f.repo);const b=await enqueue(f.repo2);assert.equal(a.jobId,b.jobId);
  await assert.rejects(f.repo2.enqueueSlot({customerId:'1001',scheduleId:'stats',slotAt:iso(at),kind:'collect_stats',payload:{...payload,entityId:'cmp-2'},requestHash:contentHash({kind:'collect_stats',payload:{...payload,entityId:'cmp-2'}}),now:at}),{code:'SEARCHAD_WORKER_SLOT_CONFLICT'});
});
test('worker migration exposes exact scoped tables and immutable per-Customer run history',async t=>{
  if(!native(t))return;const f=await fixture(t);
  const names=(await f.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'searchad_worker_%' ORDER BY tablename")).rows.map(row=>row.tablename);
  assert.deepEqual(names,['searchad_worker_jobs','searchad_worker_runs','searchad_worker_schedules','searchad_worker_sources']);
  const entry=await enqueue(f.repo),owner=await f.repo.claim({workerId:'history',now:at,leaseMs:1000});
  await f.repo.finish({...owner,state:'succeeded',result:{code:'COLLECTED'},now:at+1});
  const history=(await f.pool.query('SELECT * FROM searchad_worker_runs WHERE customer_id=$1 AND job_id=$2 ORDER BY created_at,event_id',['1001',entry.jobId])).rows;
  assert.deepEqual(history.map(row=>row.event_type).sort(),['claimed','enqueued','succeeded']);
  for(const query of ["UPDATE searchad_worker_runs SET details_json='{}' WHERE job_id=$1",'DELETE FROM searchad_worker_runs WHERE job_id=$1'])await assert.rejects(f.pool.query(query,[entry.jobId]),/immutable/);
  await assert.rejects(f.pool.query("INSERT INTO searchad_worker_runs(event_id,customer_id,job_id,event_type,lease_generation,created_at) VALUES(gen_random_uuid(),'2002',$1,'claimed',1,$2)",[entry.jobId,iso(at)]),{code:'23503'});
  assert.deepEqual((await f.pool.query('SELECT * FROM searchad_worker_runs WHERE job_id=$1 ORDER BY created_at,event_id',[entry.jobId])).rows,history);
});
test('expired_owner_cannot_finish',async t=>{
  if(!native(t))return;const f=await fixture(t);await enqueue(f.repo);const a=await f.repo.claim({workerId:'a',now:at,leaseMs:1000});
  assert.equal(await f.repo.finish({...a,state:'succeeded',result:{},now:at+1000}),false);
  const b=await f.repo2.claim({workerId:'b',now:at+1000,leaseMs:1000});assert.equal(b.leaseGeneration,2);
  assert.equal(await f.repo.heartbeat({...a,now:at+1001,leaseMs:1000}),false);assert.equal(await f.repo.finish({...a,state:'succeeded',result:{},now:at+1001}),false);
  assert.equal(await f.repo2.finish({...b,state:'succeeded',result:{},now:at+1001}),true);
});
test('stale_backlog_records_skip',async t=>{
  if(!native(t))return;const f=await fixture(t);const {SearchAdScheduler}=await import('../src/naver/searchad/worker/scheduler.js');
  await f.repo.createSchedule({customerId:'1001',scheduleId:'stats',kind:'collect_stats',payload,enabled:true,startAt:iso(at-3600000),now:at-3600000,createdBy:'admin'});
  const result=await new SearchAdScheduler({repository:f.repo,clock:()=>at}).tick();assert.equal(result.skipped,3);assert.equal(result.scheduled,2);
  assert.deepEqual(await new SearchAdScheduler({repository:f.repo2,clock:()=>at}).tick(),{scheduled:0,skipped:0});
  assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM searchad_worker_jobs WHERE state='skipped'")).rows[0].n,3);
});
test('automation source binding is atomic with decision and survives COMMIT acknowledgment loss',async t=>{
  if(!native(t))return;const f=await fixture(t);
  const server=await f.start({allowedPaths:['/ncc/campaigns/cmp-1'],response:{nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false}});
  const runtime=server.app.searchAdCompletionRuntime;
  const {PostgresWorkerRepository}=await import('../src/naver/searchad/worker/postgres-repository.js');
  const repo=new PostgresWorkerRepository({pool:runtime.automationRepository.pool});
  const context={principal:{principalId:'fixture-admin',role:'admin',customerIds:['1001']},requestId:'worker-fixture'};
  const policy=await runtime.automationService.createPolicy({customerId:'1001',entityType:'campaign',entityId:'cmp-1',recipe:{kind:'campaign_user_lock',userLock:true},reason:'scheduled observation'},context);
  const p={policyId:policy.policyId};
  await repo.enqueueSlot({customerId:'1001',scheduleId:'eval',slotAt:iso(at),kind:'evaluate_automation',payload:p,requestHash:contentHash({kind:'evaluate_automation',payload:p}),now:at});
  const owner=await repo.claim({workerId:'one',now:at,leaseMs:1000});
  const claimed=await repo.claimSource(owner,{sourceKey:'decision',kind:'automation',requestHash:owner.requestHash,now:at});
  const run=await repo.withSource(claimed.permit,()=>runtime.automationService.evaluate({customerId:'1001',policyId:policy.policyId,slotAt:iso(at)},context));
  assert.equal((await f.pool.query('SELECT run_id FROM searchad_worker_sources')).rows[0].run_id,run.runId);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,0);
  const foreignPayload={policyId:policy.policyId},foreign=await repo.enqueueSlot({customerId:'2002',scheduleId:'foreign',slotAt:iso(at),kind:'evaluate_automation',payload:foreignPayload,requestHash:contentHash({kind:'evaluate_automation',payload:foreignPayload}),now:at});
  await assert.rejects(f.pool.query("INSERT INTO searchad_worker_sources(customer_id,job_id,source_key,kind,intent_key,request_hash,state,run_id,created_at) VALUES('2002',$1,'foreign','automation','foreign', $2,'linked',$3,$4)",[foreign.jobId,foreign.requestHash,run.runId,iso(at)]),{code:'23503'});
});
const workerEnv={ATELIER_SEARCHAD_WORKER_ENABLED:'true',ATELIER_SEARCHAD_WORKER_PRINCIPAL_ID:'scheduled-operator',ATELIER_SEARCHAD_WORKER_CUSTOMERS:'1001'};
const reportResponse={reportJobId:51,reportTp:'AD',statDt:'2026-10-03T15:00:00Z',status:'REGIST',updateTm:'2026-10-05T03:00:00Z'};
async function enqueueReport(repo,now=at){const payload={reportType:'AD'};return repo.enqueueSlot({customerId:'1001',scheduleId:'daily',slotAt:'2026-10-04T18:00:00.000Z',kind:'register_stat_report',payload,requestHash:contentHash({kind:'register_stat_report',payload}),now});}
test('stale_worker_cannot_double_dispatch after pause immediately inside source service',async t=>{
 if(!native(t))return;const f=await fixture(t);let time=at,release,enter;
 const pending=new Promise(r=>release=r),entered=new Promise(r=>enter=r);
 const first=await f.start({headless:true,clock:()=>time,appEnv:{...workerEnv,ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true'},allowedPaths:['/stat-reports'],response:reportResponse});
 const rt=first.app.searchAdCompletionRuntime, worker=rt.workerRuntime.worker;worker.leaseMs=1000;
 const original=rt.jobService.register;rt.jobService.register=async(...args)=>{enter();await pending;return original(...args);};
 await enqueueReport(rt.workerRuntime.repository);const old=worker.runOnce();await entered;time+=1001;
 const second=await f.start({headless:true,clock:()=>time,appEnv:{...workerEnv,ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true'},allowedPaths:['/stat-reports'],response:reportResponse});
 const recovered=await second.app.searchAdCompletionRuntime.workerRuntime.worker.runOnce();assert.equal(recovered.state,'manual_review');assert.equal(f.calls.length,0);
 release();const obsolete=await old;assert.equal(obsolete.leaseLost,true);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 assert.equal((await f.pool.query('SELECT state FROM searchad_worker_jobs')).rows[0].state,'manual_review');
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_report_jobs')).rows[0].n,1);
});
test('ambiguous_registration_crash_recovers_without_post across actual headless bootstrap restart',async t=>{
 if(!native(t))return;const f=await fixture(t);let time=at;
 const options={headless:true,clock:()=>time,appEnv:{...workerEnv,ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true'},allowedPaths:['/stat-reports'],response:reportResponse};
 const first=await f.start(options),w=first.app.searchAdCompletionRuntime.workerRuntime;
 await f.pool.query("CREATE FUNCTION fail_worker_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.remote_job_id IS NOT NULL THEN RAISE EXCEPTION 'fixture capture failure'; END IF; RETURN NEW; END $$");
 await f.pool.query('CREATE TRIGGER fail_worker_capture BEFORE UPDATE ON searchad_report_jobs FOR EACH ROW EXECUTE FUNCTION fail_worker_capture()');
 await enqueueReport(w.repository);assert.equal((await w.worker.runOnce()).state,'retry');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);await first.app.close();
 await f.pool.query('DROP TRIGGER fail_worker_capture ON searchad_report_jobs');time+=60000;
 const second=await f.start({...options,response:[reportResponse]});const result=await second.app.searchAdCompletionRuntime.workerRuntime.worker.runOnce();
 assert.equal(result.state,'manual_review');assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.filter(c=>c.method==='GET').length,1);
 const rows=(await f.pool.query('SELECT * FROM searchad_worker_jobs')).rows;assert.equal(rows[0].lease_generation,2);assert.equal(rows[0].owner_hash,null);
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_worker_runs')).rows[0].n,5);
});
test('Admin worker HTTP rejects authority payloads, cross Customer resources and non Admin roles',async t=>{
 if(!native(t))return;const f=await fixture(t),key='worker-admin-'.repeat(5);
 const server=await f.start({appEnv:{...workerEnv,ATELIER_SEARCHAD_ADMIN_API_KEY:key,ATELIER_SEARCHAD_ADMIN_CUSTOMERS:'1001,2002',ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID:'worker-admin'}});
 const input={customerId:'1001',scheduleId:'stats',kind:'collect_stats',payload};
 for(const added of [{evidenceId:'fake'},{principal:{role:'admin'}},{executionToken:'secret'}])assert.equal((await server.call(key,'POST','/api/v1/searchad/worker/schedules',{...input,payload:{...payload,...added}})).status,400);
 assert.equal((await server.call(key,'POST','/api/v1/searchad/worker/schedules',{...input,customerId:'2002'})).status,403);
 assert.equal((await server.call(key,'POST','/api/v1/searchad/worker/schedules',{...input,kind:'evaluate_automation',payload:{policyId:'00000000-0000-0000-0000-000000000001'}})).status,404);
 assert.equal((await server.call(key,'POST','/api/v1/searchad/worker/schedules',input)).status,201);
 const {completionOperatorKey}=await import('./helpers/postgres-searchad-completion-fixture.js');
 assert.equal((await server.call(completionOperatorKey,'GET','/api/v1/searchad/worker/jobs?customerId=1001')).status,403);
 const listed=await server.call(key,'GET','/api/v1/searchad/worker/schedules?customerId=1001');assert.equal(listed.body.items.length,1);assert.equal(listed.body.items[0].enabled,false);
 const docs=await server.call(key,'GET','/openapi-searchad-completion-admin.json');assert.ok(docs.body.paths['/api/v1/searchad/worker/schedules']);
 assert.equal(f.calls.length,0);
});
test('CLI main uses actual headless bootstrap, disposes owned resources and reconstructs without HTTP or outbound calls',async t=>{
 if(!native(t))return;const f=await fixture(t),{main}=await import('../src/searchad-worker.js');let app;
 const options={env:{...f.env,...workerEnv},clock:()=>at,logger:{info(){},error(){}},bootstrap:async()=>{app=(await f.start({headless:true,appEnv:workerEnv,allowedPaths:[]})).app;return app;}};
 const first=await main(options);assert.equal(first.enabled,true);const pool=app.searchAdCompletionRuntime.automationRepository.pool;
 assert.equal(app.searchAdWriteRuntime,undefined);assert.equal(await first.close(),true);assert.equal(await first.close(),true);assert.equal(pool.ended,true);assert.equal(f.calls.length,0);
 const second=await main(options);assert.equal(second.enabled,true);await second.close();assert.equal(f.calls.length,0);
});
for(const committed of [false,true])test(`worker source COMMIT acknowledgment loss ${committed?'after':'before'} commit releases max-one pool and never grants resend`,async t=>{
 if(!native(t))return;const f=await fixture(t),pool=f.connect({max:1}),{PostgresWorkerRepository}=await import('../src/naver/searchad/worker/postgres-repository.js');let armed=false;
 const fault={query:(...args)=>pool.query(...args),async connect(){const c=await pool.connect();return {async query(sql,args){if(armed&&sql==='COMMIT'){armed=false;await c.query(committed?'COMMIT':'ROLLBACK');throw new Error('fixture commit acknowledgement loss');}return c.query(sql,args);},release:discard=>c.release(discard)};}};
 const repo=new PostgresWorkerRepository({pool:fault});await enqueueReport(repo);const owner=await repo.claim({workerId:'old',now:at,leaseMs:1000});armed=true;
 await assert.rejects(repo.claimSource(owner,{sourceKey:'report1',kind:'report',requestHash:owner.requestHash,now:at}),/acknowledgement loss/);
 assert.equal(pool.waitingCount,0);assert.equal((await pool.query('SELECT 1 AS n')).rows[0].n,1);
 const next=await f.repo2.claim({workerId:'new',now:at+1000,leaseMs:1000});const recovered=await f.repo2.claimSource(next,{sourceKey:'report1',kind:'report',requestHash:owner.requestHash,now:at+1000});
 assert.equal(recovered.created,!committed);assert.equal(Boolean(recovered.permit),!committed);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_report_jobs')).rows[0].n,0);
});
test('automation decision COMMIT response loss reconstructs same source run after bootstrap and lease turnover',async t=>{
 if(!native(t))return;const f=await fixture(t);let time=at;
 const options={headless:true,clock:()=>time,appEnv:workerEnv,allowedPaths:['/ncc/campaigns/cmp-1'],response:{nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false}};
 const first=await f.start(options),rt=first.app.searchAdCompletionRuntime,repo=rt.workerRuntime.repository;
 const context={principal:{principalId:'admin',role:'admin',customerIds:['1001']},requestId:'claim-loss'};
 const policy=await rt.automationService.createPolicy({customerId:'1001',entityType:'campaign',entityId:'cmp-1',recipe:{kind:'campaign_user_lock',userLock:true},reason:'one decision'},context),payload={policyId:policy.policyId};
 await repo.enqueueSlot({customerId:'1001',scheduleId:'eval',slotAt:iso(at),kind:'evaluate_automation',payload,requestHash:contentHash({kind:'evaluate_automation',payload}),now:at});
 const pool=rt.automationRepository.pool,connect=pool.connect.bind(pool);let injected=false;
 pool.connect=callback=>{if(callback)return connect(callback);return (async()=>{const c=await connect(),query=c.query.bind(c);let links=false;return {async query(sql,args){if(sql.includes("SET state='linked',run_id"))links=true;const result=await query(sql,args);if(links&&sql==='COMMIT'&&!injected){injected=true;throw new Error('fixture lost decision COMMIT response');}return result;},release:discard=>c.release(discard)};})();};
 const result=await rt.workerRuntime.worker.runOnce();assert.equal(result.state,'retry');assert.equal(injected,true);pool.connect=connect;
 const original=(await f.pool.query('SELECT run_id FROM searchad_worker_sources')).rows[0].run_id;assert.ok(original);assert.equal(f.calls.length,1);await first.app.close();time+=60000;
 const second=await f.start({...options,allowedPaths:[]});assert.equal((await second.app.searchAdCompletionRuntime.workerRuntime.worker.runOnce()).state,'succeeded');
 assert.equal((await f.pool.query('SELECT result_json FROM searchad_worker_jobs')).rows[0].result_json.runId,original);
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_automation_runs')).rows[0].n,1);assert.equal(f.calls.length,1);
});
test('bounded collection retry and old report slots retain skipped history without catch-up dispatch',async t=>{
 if(!native(t))return;const f=await fixture(t),{SearchAdWorker}=await import('../src/naver/searchad/worker/runtime.js');await enqueue(f.repo);let count=0;
 const worker=new SearchAdWorker({repository:f.repo,clock:()=>at,retryMs:0,handlers:{async collect_stats(){count++;throw new Error('secret upstream payload');}}});
 for(let i=0;i<7;i++)await worker.runOnce();assert.equal(count,5);const row=(await f.pool.query('SELECT state,result_json FROM searchad_worker_jobs')).rows[0];assert.equal(row.state,'manual_review');assert.equal(JSON.stringify(row).includes('secret'),false);
 const {SearchAdScheduler}=await import('../src/naver/searchad/worker/scheduler.js');await f.repo.createSchedule({customerId:'1001',scheduleId:'report-old',kind:'register_stat_report',payload:{reportType:'AD'},enabled:true,startAt:iso(at-9*86400000),createdBy:'admin',now:at});
 const stats=await new SearchAdScheduler({repository:f.repo,clock:()=>at}).tick();assert.equal(stats.skipped,3);assert.equal(stats.scheduled,7);
});
test('real worker CLI process handles SIGTERM and restarts without an HTTP listener or raw external calls',async t=>{
 if(!native(t))return;const f=await fixture(t),{fork}=await import('node:child_process');
 async function cycle(){
  const child=fork(new URL('./helpers/searchad-worker-cli-fixture.mjs',import.meta.url),[],{env:{...process.env,...f.env,...workerEnv,ATELIER_CONFIG_PATH:f.configPath},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stderr.on('data',b=>output+=b);child.stdout.on('data',b=>output+=b);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const messages=[];let ready;const started=new Promise(r=>ready=r);child.on('message',m=>{messages.push(m);if(m.started)ready();});
  let watchdog;await Promise.race([started,new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error(`CLI did not start: ${output}`)),30000);})]);clearTimeout(watchdog);
  const exit=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`CLI exit ${code}/${signal}: ${output}`)));});
  child.kill('SIGTERM');await exit;assert.deepEqual(messages,[{started:true,writerInitialized:false},{closed:true,poolEnded:true,outbound:0}]);
 }
 await cycle();await cycle();
});
test('daily 03 KST worker registers D+1 D+2 D+3 once and ingests exact existing service generations',async t=>{
 if(!native(t))return;const f=await fixture(t),{LocalReportStorage}=await import('../src/naver/searchad/reporting/blob-storage.js'),fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'worker-reports-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const jobs=new Map();
 const server=await f.start({headless:true,clock:()=>at,blobStorage:new LocalReportStorage({root}),appEnv:{...workerEnv,ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS:'true',ATELIER_SEARCHAD_REPORT_CLOCK_UNCERTAINTY_MS:'1000',ATELIER_SEARCHAD_REPORT_ROLLOUT_UNCERTAINTY_MS:'1000'},allowedPaths:['/stat-reports','/stat-reports/1','/stat-reports/2','/stat-reports/3','/report-download'],response:({target,init})=>{
   if(target.pathname==='/report-download') {const date=jobs.get(target.searchParams.get('authtoken')).date;return new Response(`${date}\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\tbiz-1\t1\tP\t100\t2\t110\t100\t0\n`);}
   if(init.method==='POST'){const data=JSON.parse(init.body),date=`${data.statDt.slice(0,4)}-${data.statDt.slice(4,6)}-${data.statDt.slice(6,8)}`,id=jobs.size+1;const response={reportJobId:id,reportTp:'AD',statDt:new Date(Date.parse(`${date}T00:00:00+09:00`)).toISOString(),status:'BUILT',updateTm:iso(at),downloadUrl:`https://api.searchad.naver.com/report-download?authtoken=${id}`};jobs.set(String(id),{date,response});return Response.json(response);}
   return Response.json(jobs.get(target.pathname.split('/').at(-1)).response);
 }});
 const w=server.app.searchAdCompletionRuntime.workerRuntime;await enqueueReport(w.repository);const outcome=await w.worker.runOnce();assert.equal(outcome.state,'succeeded');
 assert.deepEqual([...jobs.values()].map(j=>j.date),['2026-10-04','2026-10-03','2026-10-02']);assert.equal(f.calls.filter(c=>c.method==='POST').length,3);
 assert.equal((await f.pool.query("SELECT count(*)::int AS n FROM searchad_report_jobs WHERE processing_state='ingested'")).rows[0].n,3);
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_report_ingestions')).rows[0].n,3);
 assert.equal(await w.worker.runOnce(),null);assert.equal(f.calls.filter(c=>c.method==='POST').length,3);
 assert.equal(JSON.stringify((await f.pool.query('SELECT * FROM searchad_worker_jobs')).rows).includes('authtoken'),false);
});
test('shutdown timeout keeps native lease history and shared resources alive until collection drains',async t=>{
 if(!native(t))return;const f=await fixture(t);let release,enter;const waiting=new Promise(r=>release=r),started=new Promise(r=>enter=r);
 const server=await f.start({headless:true,appEnv:workerEnv,beforeResponse:async()=>{enter();await waiting;}}),rt=server.app.searchAdCompletionRuntime,w=rt.workerRuntime;
 await enqueue(w.repository);const active=w.worker.runOnce();await started;
 const {disposeApplicationV05}=await import('../src/bootstrap-v05.js');await assert.rejects(disposeApplicationV05(server.app,{drainTimeoutMs:1}),{code:'SEARCHAD_WORKER_SHUTDOWN_PENDING'});
 assert.equal(rt.automationRepository.pool.ended,false);assert.equal((await f.pool.query('SELECT state FROM searchad_worker_jobs')).rows[0].state,'running');
 assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_worker_runs')).rows[0].n,2);
 release();await active;await server.app.close();assert.equal(rt.automationRepository.pool.ended,true);
 assert.equal((await f.pool.query('SELECT state FROM searchad_worker_jobs')).rows[0].state,'succeeded');
});
for(const terminal of ['not_applied','applied_reconciled'])test(`worker reconciles same consumed automation plan through shared writer while paused and remains idempotent: ${terminal}`,async t=>{
 if(!native(t))return;const f=await fixture(t),{randomUUID}=await import('node:crypto');
 const remoteCurrent={nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false};
 const server=await f.start({headless:true,appEnv:{...workerEnv,ATELIER_SEARCHAD_WRITE_STORAGE:'postgres'},allowedPaths:['/ncc/campaigns/cmp-1'],response:remoteCurrent}),rt=server.app.searchAdCompletionRuntime;
 const context={principal:{principalId:'admin',role:'admin',customerIds:['1001']},requestId:'worker-reconcile'},policy=await rt.automationService.createPolicy({customerId:'1001',entityType:'campaign',entityId:'cmp-1',recipe:{kind:'campaign_user_lock',userLock:true},reason:'synthetic recovery fixture'},context);
 const run=await rt.automationService.evaluate({customerId:'1001',policyId:policy.policyId},context),shared=server.app.searchAdWriteRuntime,repo=shared.repository,planId=randomUUID(),approvalId=randomUUID(),tokenHash=randomUUID();
 const before={nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false};
 await repo.createPlan({plan_id:planId,customer_id:'1001',mutation_operation_key:'PUT:/ncc/campaigns/{nccCampaignId}#fields',mutation_json:{pathParams:{nccCampaignId:'cmp-1'},body:{userLock:true}},read_json:{operationKey:'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',pathParams:{campaignId:'cmp-1'}},before_json:before,before_hash:contentHash(before),expected_after_json:{userLock:true},reason:'synthetic preexisting consumed plan',status:'approved',created_by:'fixture',created_at:iso(at),expires_at:iso(at+600000)});
 await repo.createApproval({approval_id:approvalId,plan_id:planId,actor:'fixture',confirmation:'APPROVE_SEARCHAD_CHANGE',token_hash:tokenHash,created_at:iso(at),expires_at:iso(at+600000)});
 await repo.claimApproval({planId,tokenHash,now:iso(at)});
 await f.pool.query("UPDATE searchad_automation_runs SET plan_id=$2,approval_id=$3,state='executing',revoked_at=$4 WHERE run_id=$1",[run.runId,planId,approvalId,iso(at)]);
 await repo.updatePlan(planId,{status:'unknown_outcome'});await repo.addAttempt({attempt_id:randomUUID(),plan_id:planId,phase:'execute',status:'unknown_outcome',created_at:iso(at)});
 remoteCurrent.userLock=terminal==='applied_reconciled';
 await rt.circuitService.pause({customerId:'1001',reason:'paused fixture'},context);await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
 const approvals=(await f.pool.query('SELECT * FROM searchad_write_approvals')).rows;
 const p={runId:run.runId},w=rt.workerRuntime;await w.repository.enqueueSlot({customerId:'1001',scheduleId:'reconcile',slotAt:iso(at),kind:'reconcile_automation',payload:p,requestHash:contentHash({kind:'reconcile_automation',payload:p}),now:at});
 assert.equal((await w.worker.runOnce()).state,'succeeded');assert.equal((await repo.getPlan(planId)).status,terminal);assert.equal(server.app.searchAdWriteRuntime,shared);
 const history=(await f.pool.query('SELECT * FROM searchad_write_attempts ORDER BY attempt_id')).rows;
 assert.equal((await rt.automationService.reconcile({customerId:'1001',runId:run.runId},context)).state,terminal);
 assert.deepEqual((await f.pool.query('SELECT * FROM searchad_write_attempts ORDER BY attempt_id')).rows,history);
 assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);assert.equal(f.calls.length,2);
 assert.deepEqual((await f.pool.query('SELECT * FROM searchad_write_approvals')).rows,approvals);assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM searchad_write_change_plans')).rows[0].n,1);
 assert.equal((await f.pool.query("SELECT suspended FROM searchad_canary_accounts WHERE customer_id='1001'")).rows[0].suspended,true);assert.equal((await rt.circuitService.repository.getState({customerId:'1001'})).manualPaused,true);
 await assert.rejects(rt.automationService.reconcile({customerId:'2002',runId:run.runId},context),{code:'SEARCHAD_AUTOMATION_FORBIDDEN'});
 await assert.rejects(rt.automationService.reconcile({customerId:'2002',runId:run.runId},{...context,principal:{...context.principal,customerIds:['1001','2002']}}),{code:'SEARCHAD_AUTOMATION_RUN_NOT_FOUND'});
 // The real composite FK prevents cross-Customer primary linkage; keep the
 // constraint active rather than building an impossible trusted fixture.
 await assert.rejects(f.pool.query("UPDATE searchad_write_change_plans SET customer_id='2002' WHERE plan_id=$1",[planId]),{code:'23503'});
 assert.equal((await rt.automationService.reconcile({customerId:'1001',runId:run.runId},context)).state,terminal);
 assert.equal(f.calls.length,2);assert.deepEqual((await f.pool.query('SELECT * FROM searchad_write_approvals')).rows,approvals);
});

for(const terminal of ['not_applied','applied_reconciled'])test(`fix1 incomplete primary ${terminal} attempt remains unknown after paused bootstrap and lease turnover`,async t=>{
 if(!native(t))return;const f=await fixture(t),{randomUUID}=await import('node:crypto');let time=at;
 const current={nccCampaignId:'cmp-1',dailyBudget:1000,userLock:false},options={headless:true,clock:()=>time,appEnv:{...workerEnv,ATELIER_SEARCHAD_WRITE_STORAGE:'postgres'},allowedPaths:['/ncc/campaigns/cmp-1'],response:current};
 const first=await f.start(options),rt=first.app.searchAdCompletionRuntime,context={principal:{principalId:'admin',role:'admin',customerIds:['1001']},requestId:'incomplete-primary'};
 const policy=await rt.automationService.createPolicy({customerId:'1001',entityType:'campaign',entityId:'cmp-1',recipe:{kind:'campaign_user_lock',userLock:true},reason:'synthetic consumed recovery history'},context);
 const run=await rt.automationService.evaluate({customerId:'1001',policyId:policy.policyId},context),writer=first.app.searchAdWriteRuntime.repository,planId=randomUUID(),approvalId=randomUUID(),tokenHash=randomUUID();
 const before={...current};
 await writer.createPlan({plan_id:planId,customer_id:'1001',mutation_operation_key:'PUT:/ncc/campaigns/{nccCampaignId}#fields',mutation_json:{pathParams:{nccCampaignId:'cmp-1'},body:{userLock:true}},read_json:{operationKey:'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',pathParams:{campaignId:'cmp-1'}},before_json:before,before_hash:contentHash(before),expected_after_json:{userLock:true},reason:'synthetic existing consumed plan',status:'approved',created_by:'fixture',created_at:iso(at),expires_at:iso(at+600000)});
 await writer.createApproval({approval_id:approvalId,plan_id:planId,actor:'fixture',confirmation:'APPROVE_SEARCHAD_CHANGE',token_hash:tokenHash,created_at:iso(at),expires_at:iso(at+600000)});
 await writer.claimApproval({planId,tokenHash,now:iso(at)});
 await f.pool.query("UPDATE searchad_automation_runs SET plan_id=$2,approval_id=$3,state='executing',revoked_at=$4 WHERE run_id=$1",[run.runId,planId,approvalId,iso(at)]);
 await f.pool.query("INSERT INTO searchad_automation_reservations(reservation_id,customer_id,dispatch_key,run_id,entity_type,entity_id,state,dispatch_json,created_at,updated_at) VALUES($1,'1001',$2,$3,'campaign','cmp-1','consumed',$4,$5,$5)",[randomUUID(),run.decisionKey,run.runId,{ruleId:policy.ruleId},iso(at)]);
 await writer.updatePlan(planId,{status:'unknown_outcome'});await writer.addAttempt({attempt_id:randomUUID(),plan_id:planId,phase:'execute',status:'unknown_outcome',created_at:iso(at)});
 assert.equal((await rt.automationService.getRun({customerId:'1001',runId:run.runId},context)).state,'unknown_outcome');
 current.userLock=terminal==='applied_reconciled';
 await rt.circuitService.pause({customerId:'1001',reason:'paused incomplete recovery'},context);await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'");
 await f.pool.query("CREATE FUNCTION fail_worker_terminal_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.phase='reconcile' AND NEW.status IN('not_applied','applied_reconciled') THEN RAISE EXCEPTION 'fixture terminal attempt unavailable'; END IF; RETURN NEW; END $$");
 await f.pool.query('CREATE TRIGGER fail_worker_terminal_attempt BEFORE INSERT ON searchad_write_attempts FOR EACH ROW EXECUTE FUNCTION fail_worker_terminal_attempt()');
 const payload={runId:run.runId},w=rt.workerRuntime;
 const job=await w.repository.enqueueSlot({customerId:'1001',scheduleId:'incomplete',slotAt:iso(at),kind:'reconcile_automation',payload,requestHash:contentHash({kind:'reconcile_automation',payload}),now:at});
 assert.equal((await w.worker.runOnce()).state,'retry');
 assert.equal((await writer.getPlan(planId)).status,terminal,'real updatePlan committed before the terminal addAttempt failure');
 assert.equal((await rt.automationService.getRun({customerId:'1001',runId:run.runId},context)).state,'unknown_outcome');
 assert.equal(f.calls.length,2,'only initial current GET and the first existing reconciliation GET');
 const primarySnapshot=async()=>({run:(await f.pool.query('SELECT * FROM searchad_automation_runs WHERE run_id=$1',[run.runId])).rows,plans:(await f.pool.query('SELECT * FROM searchad_write_change_plans ORDER BY plan_id')).rows,approvals:(await f.pool.query('SELECT * FROM searchad_write_approvals ORDER BY approval_id')).rows,attempts:(await f.pool.query('SELECT * FROM searchad_write_attempts ORDER BY attempt_id')).rows,claims:(await f.pool.query('SELECT * FROM searchad_write_execution_claims ORDER BY ordinal')).rows,outcomes:(await f.pool.query('SELECT * FROM searchad_write_execution_outcomes ORDER BY version')).rows,reservations:(await f.pool.query('SELECT * FROM searchad_automation_reservations ORDER BY reservation_id')).rows,events:(await f.pool.query('SELECT * FROM searchad_automation_events ORDER BY event_id')).rows});
 const preserved=await primarySnapshot();assert.deepEqual(preserved.outcomes.map(row=>row.outcome),['unknown']);assert.ok(preserved.approvals[0].used_at);
 await f.pool.query('DROP TRIGGER fail_worker_terminal_attempt ON searchad_write_attempts');await first.app.close();time+=60000;
 const second=await f.start({...options,allowedPaths:[]}),restored=second.app.searchAdCompletionRuntime;
 const recovered=await restored.workerRuntime.worker.runOnce();assert.equal(recovered.state,'manual_review');
 const recorded=(await f.pool.query('SELECT state,lease_generation,result_json FROM searchad_worker_jobs WHERE job_id=$1',[job.jobId])).rows[0];
 assert.equal(recorded.state,'manual_review');assert.equal(recorded.lease_generation,2);assert.equal(recorded.result_json.code,'SOURCE_UNRESOLVED');
 await assert.rejects(restored.automationService.reconcile({customerId:'1001',runId:run.runId},context),{code:'SEARCHAD_AUTOMATION_PRIMARY_OUTCOME_UNRESOLVED'});
 assert.deepEqual(await primarySnapshot(),preserved,'unknown history, consumed approval/reservation and terminal-looking plan remain unchanged');
 assert.equal(f.calls.length,2);assert.equal(f.calls.filter(call=>call.method!=='GET').length,0);
 assert.equal((await restored.circuitService.repository.getState({customerId:'1001'})).manualPaused,true);
 assert.equal(await restored.circuitService.repository.unresolved({customerId:'1001'}),true);
 assert.equal((await f.pool.query("SELECT suspended FROM searchad_canary_accounts WHERE customer_id='1001'")).rows[0].suspended,true);
});
