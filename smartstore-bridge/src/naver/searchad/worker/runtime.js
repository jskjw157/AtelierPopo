import { randomUUID } from 'node:crypto';
import { PostgresWorkerRepository } from './postgres-repository.js';
import { SearchAdScheduler, staleSlot } from './scheduler.js';
import { createWorkerHandlers } from './handlers.js';
import { loadWorkerConfig, validateSchedule, exact, workerError } from './config.js';
import { authorize } from '../automation/policy.js';
export class SearchAdWorker {
  constructor({repository,handlers,clock=Date.now,workerId=`worker-${randomUUID()}`,scheduler=null,leaseMs=30000,pollMs=1000,retryMs=60000,logger=console}) {
    Object.assign(this,{repository,handlers,clock,workerId,scheduler,leaseMs,pollMs,retryMs,logger});this.accepting=true;this.running=null;this.timer=null;this.looping=false;
  }
  runOnce() {
    if(!this.accepting)return Promise.resolve(null);
    if(this.running)return this.running;
    const work=this.perform();this.running=work;work.then(()=>{this.running=null;},()=>{this.running=null;});return work;
  }
  async perform() {
    if(this.scheduler)await this.scheduler.tick();
    const job=await this.repository.claim({workerId:this.workerId,now:this.clock(),leaseMs:this.leaseMs});if(!job)return null;
    let heartbeatBusy=false;
    const heartbeat=setInterval(async()=>{if(heartbeatBusy||!this.accepting)return;heartbeatBusy=true;try{await this.repository.heartbeat({...job,now:this.clock(),leaseMs:this.leaseMs});}catch{}finally{heartbeatBusy=false;}},Math.max(10,Math.floor(this.leaseMs/3)));
    heartbeat.unref?.();
    try {
      let outcome;
      if(staleSlot(job.kind,Date.parse(job.slotAt),this.clock()))outcome={state:'skipped',result:{code:'STALE_SLOT'}};
      else if(!await this.repository.owns({...job,now:this.clock()}))return {jobId:job.jobId,leaseLost:true};
      else outcome=await this.handlers[job.kind](job);
      const finished=await this.repository.finish({...job,...outcome,now:this.clock(),retryMs:this.retryMs});
      return {jobId:job.jobId,state:outcome.state,finished};
    } catch(error) {
      // Never turn a lost CAS or thrown source response into success. Durable source
      // claims, not the lease retry, decide whether another invocation is possible.
      if(error?.code==='SEARCHAD_WORKER_LEASE_LOST')return {jobId:job.jobId,leaseLost:true};
      let finished=false;try{finished=await this.repository.finish({...job,state:'retry',result:{code:'SERVICE_UNAVAILABLE'},now:this.clock(),retryMs:this.retryMs});}catch{}
      return {jobId:job.jobId,state:'retry',finished};
    } finally { clearInterval(heartbeat); }
  }
  start() {
    if(this.looping)return this;this.looping=true;this.accepting=true;
    const loop=async()=>{if(!this.looping)return;try{await this.runOnce();}catch{this.logger.error?.('SearchAd worker tick failed',{code:'SEARCHAD_WORKER_TICK_FAILED'});}if(this.looping)this.timer=setTimeout(loop,this.pollMs);};
    void loop();return this;
  }
  async stop({drainTimeoutMs=30000}={}) {
    this.accepting=false;this.looping=false;clearTimeout(this.timer);
    if(!this.running)return true;
    let timer;const drained=await Promise.race([this.running.then(()=>true,()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),drainTimeoutMs);})]);clearTimeout(timer);
    // No resource is disposed while an in-flight service owns it. Timed-out leases
    // remain in durable history and are recoverable by another process.
    return drained;
  }
}
export async function createWorkerRuntime({completion,pool,env,clock=Date.now,logger=console}) {
  const config=loadWorkerConfig(env);
  if(!config.enabled)return null;
  if(!pool || !completion.status().ready || !completion.statsService || !completion.jobService || !completion.automationService)throw workerError('DEPENDENCIES',503);
  const ready=await pool.query("SELECT to_regclass('searchad_worker_jobs') AS jobs,to_regclass('searchad_worker_sources') AS sources,(SELECT count(*) FROM schema_migrations WHERE version='0014')::int AS version");
  if(!ready.rows[0]?.jobs || !ready.rows[0]?.sources || ready.rows[0].version!==1)throw workerError('SCHEMA',503);
  for(const id of config.principal.customerIds)completion.identityResolver(id);
  const repository=new PostgresWorkerRepository({pool}),scheduler=new SearchAdScheduler({repository,clock});
  const handlers=createWorkerHandlers({repository,completion,principal:config.principal,clock});
  const worker=new SearchAdWorker({repository,scheduler,handlers,clock,leaseMs:config.leaseMs,pollMs:config.pollMs,retryMs:config.retryMs,logger});
  let closed=false;
  async function scope(customerId,context) { authorize(customerId,context,'admin');if(!config.principal.customerIds.includes(customerId))throw workerError('CUSTOMER_FORBIDDEN',403);if(closed)throw workerError('UNAVAILABLE',503); }
  const service={
    async createSchedule(input,context) {
      const clean=validateSchedule(input);await scope(clean.customerId,context);
      const customerId=clean.customerId;
      if(clean.startAt && Date.parse(clean.startAt)>clock())throw workerError();
      if(clean.kind==='register_stat_report' && (!completion.config.allowReportingJobs || !completion.ingestionService))throw workerError('DEPENDENCIES',503);
      if(clean.kind==='collect_report_generation' && (!completion.ingestionService || !await completion.repository.getReportJob({customerId,reportJobId:clean.payload.reportJobId})))throw workerError('RESOURCE_NOT_FOUND',404);
      if(clean.kind==='evaluate_automation' && !await completion.automationRepository.findPolicy({customerId,policyId:clean.payload.policyId}))throw workerError('RESOURCE_NOT_FOUND',404);
      if(clean.kind==='reconcile_automation' && !await completion.automationRepository.getRun({customerId,runId:clean.payload.runId}))throw workerError('RESOURCE_NOT_FOUND',404);
      return repository.createSchedule({...clean,createdBy:context.principal.principalId,now:clock()});
    },
    async listSchedules(input,context) { exact(input,['customerId']);await scope(input.customerId,context);return repository.listSchedules(input); },
    async listJobs(input,context) { exact(input,['customerId']);await scope(input.customerId,context);return repository.listJobs(input); }
  };
  // Persisted schedules are checked again at process startup, including gates that
  // may have changed since an administrator created the configuration.
  for(const schedule of await repository.enabledSchedules()) {
    if(!config.principal.customerIds.includes(schedule.customerId))throw workerError('CUSTOMER_FORBIDDEN',503);
    if(['register_stat_report','collect_report_generation'].includes(schedule.kind) && !completion.ingestionService)throw workerError('DEPENDENCIES',503);
    if(schedule.kind==='register_stat_report' && !completion.config.allowReportingJobs)throw workerError('DEPENDENCIES',503);
  }
  return {repository,scheduler,worker,service,status:()=>({required:true,initialized:true,ready:!closed}),async close(options) {closed=true;const drained=await worker.stop(options);if(!drained)throw workerError('SHUTDOWN_PENDING',503);}};
}
