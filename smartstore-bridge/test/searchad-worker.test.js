import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapSearchAdCompletionRuntime } from '../src/naver/searchad/completion-bootstrap.js';

// A disabled composition must expose truthful, non-authorizing worker readiness.
test('worker defaults OFF and does not initialize on unconfigured application', async () => {
  const { runtime } = await bootstrapSearchAdCompletionRuntime({ env: {} });
  assert.deepEqual(runtime.status().worker, { required: false, initialized: false, ready: false });
  await runtime.close();
});
test('payload_evidence_injection_rejected', async () => {
  const { validateSchedule, loadWorkerConfig } = await import('../src/naver/searchad/worker/config.js');
  const base = { customerId:'1001', scheduleId:'stats', kind:'collect_stats', payload:{entityType:'campaign',entityId:'cmp-1'} };
  for (const key of ['evidence','evidenceId','executionToken','principal','actor','roles','customerId','since','until']) {
    assert.throws(() => validateSchedule({...base,payload:{...base.payload,[key]:'injected'}}), { code:'SEARCHAD_WORKER_INPUT' });
  }
  assert.throws(() => loadWorkerConfig({ATELIER_SEARCHAD_WORKER_ENABLED:'true'}), {code:'SEARCHAD_WORKER_CONFIG'});
});
test('report_dates_follow_kst_at_utc_midnight', async () => {
  const { reportDates, slotFor } = await import('../src/naver/searchad/worker/scheduler.js');
  assert.deepEqual(reportDates(Date.parse('2026-10-04T18:00:00Z')), ['2026-10-04','2026-10-03','2026-10-02']);
  assert.deepEqual(reportDates(Date.parse('2026-10-05T00:00:00Z')), ['2026-10-04','2026-10-03','2026-10-02']);
  assert.equal(slotFor('register_stat_report',Date.parse('2026-10-05T00:00:00Z')), Date.parse('2026-10-04T18:00:00Z'));
  assert.equal(slotFor('register_stat_report',Date.parse('2026-10-04T17:59:59Z')), Date.parse('2026-10-03T18:00:00Z'));
});
test('enabled worker without PostgreSQL fails startup before constructing an application', async () => {
  const {main}=await import('../src/searchad-worker.js');let calls=0;
  await assert.rejects(main({env:{ATELIER_SEARCHAD_WORKER_ENABLED:'true'},bootstrap:async()=>{calls++;return {};},logger:{info(){},error(){}}}),{code:'SEARCHAD_WORKER_CONFIG'});
  assert.equal(calls,0);
});
test('shutdown_leaves_recoverable_history and does not finish before active service settles',async()=>{
  const {SearchAdWorker}=await import('../src/naver/searchad/worker/runtime.js');
  let release,entered;const waiting=new Promise(r=>release=r), started=new Promise(r=>entered=r);let finished=0;
  const repository={async claim(){return {jobId:'fixture',kind:'collect_stats',slotAt:'2026-10-05T03:00:00.000Z'};},async owns(){return true;},async heartbeat(){return true;},async finish(){finished++;return true;}};
  const worker=new SearchAdWorker({repository,clock:()=>Date.parse('2026-10-05T03:00:00Z'),handlers:{async collect_stats(){entered();await waiting;return {state:'succeeded',result:{}};}}});
  const run=worker.runOnce();await started;assert.equal(await worker.stop({drainTimeoutMs:1}),false);assert.equal(finished,0);assert.equal(await worker.runOnce(),null);release();await run;assert.equal(await worker.stop(),true);assert.equal(finished,1);
});
