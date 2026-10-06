import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { contentHash } from '../write/canonical.js';
import { workerError, safeResult, publicJob, validateSchedule, identifier } from './config.js';
import { slotFor } from './scheduler.js';
const sourceScope=new AsyncLocalStorage();
const ownerScope=new AsyncLocalStorage();
export function currentWorkerSource() { return sourceScope.getStore(); }
export function currentWorkerDispatch() { return ownerScope.getStore(); }
const iso=value=>new Date(value).toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
function job(row) { return row && {jobId:row.job_id,customerId:row.customer_id,scheduleId:row.schedule_id,slotAt:iso(row.slot_at),kind:row.kind,payload:row.payload_json,requestHash:row.request_hash,state:row.state,leaseGeneration:row.lease_generation,attempts:row.attempts,maxAttempts:row.max_attempts,result:row.result_json,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}; }
function schedule(row) { return {customerId:row.customer_id,scheduleId:row.schedule_id,kind:row.kind,payload:row.payload_json,enabled:row.enabled,nextSlotAt:iso(row.next_slot_at)}; }
function source(row) { return row && {customerId:row.customer_id,jobId:row.job_id,sourceKey:row.source_key,kind:row.kind,intentKey:row.intent_key,requestHash:row.request_hash,state:row.state,runId:row.run_id}; }
export class PostgresWorkerRepository {
  #permits=new WeakMap();
  constructor({pool}) { this.pool=pool; }
  async withOwner(owner,task) {
    const binding=structuredClone(owner),ownerHash=hash(binding.ownerToken);
    return ownerScope.run(Object.freeze({pool:this.pool,customerId:binding.customerId,assertRun:async(client,runId,now)=>{
      const row=(await client.query(`SELECT j.lease_until FROM searchad_worker_jobs j JOIN searchad_worker_sources s ON s.job_id=j.job_id AND s.customer_id=j.customer_id
        WHERE j.job_id=$1 AND j.customer_id=$2 AND j.owner_hash=$3 AND j.lease_generation=$4 AND j.state='running' AND j.lease_until>$5
        AND s.source_key='decision' AND s.kind='automation' AND s.state='linked' AND s.run_id=$6 FOR UPDATE OF j`,[binding.jobId,binding.customerId,ownerHash,binding.leaseGeneration,iso(now),runId])).rows[0];
      if(!row)throw workerError('LEASE_LOST',409);
      return Date.parse(row.lease_until);
    }}),task);
  }
  async transaction(task) {
    const client=await this.pool.connect(); let discard=false;
    try { await client.query('BEGIN');const value=await task(client);await client.query('COMMIT');return value; }
    catch(error){try{await client.query('ROLLBACK');}catch{discard=true;}throw error;}finally{client.release(discard);}
  }
  async history(client,row,type,details,now) { await client.query('INSERT INTO searchad_worker_runs(event_id,customer_id,job_id,event_type,lease_generation,details_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),row.customer_id,row.job_id,type,row.lease_generation,safeResult(details),iso(now)]); }
  async createSchedule(input) {
    const clean=validateSchedule(Object.fromEntries(['customerId','scheduleId','kind','payload','enabled','startAt'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]])));
    const requestHash=contentHash({kind:clean.kind,payload:clean.payload});
    return this.transaction(async client=>{
      const result=await client.query(`INSERT INTO searchad_worker_schedules(customer_id,schedule_id,kind,payload_json,request_hash,enabled,next_slot_at,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(customer_id,schedule_id) DO UPDATE SET enabled=EXCLUDED.enabled WHERE searchad_worker_schedules.request_hash=EXCLUDED.request_hash RETURNING *`,[clean.customerId,clean.scheduleId,clean.kind,clean.payload,requestHash,clean.enabled,iso(slotFor(clean.kind,clean.startAt===undefined?input.now:Date.parse(clean.startAt))),input.createdBy,iso(input.now)]);
      if(!result.rows[0])throw workerError('SCHEDULE_CONFLICT',409);return schedule(result.rows[0]);
    });
  }
  async enabledSchedules() { return (await this.pool.query('SELECT * FROM searchad_worker_schedules WHERE enabled=true ORDER BY customer_id,schedule_id')).rows.map(schedule); }
  async listSchedules({customerId}) { return {items:(await this.pool.query('SELECT * FROM searchad_worker_schedules WHERE customer_id=$1 ORDER BY schedule_id LIMIT 100',[customerId])).rows.map(schedule)}; }
  async listJobs({customerId}) { return {items:(await this.pool.query('SELECT * FROM searchad_worker_jobs WHERE customer_id=$1 ORDER BY created_at DESC,job_id LIMIT 100',[customerId])).rows.map(row=>publicJob(job(row)))}; }
  async advanceSchedule({customerId,scheduleId,slotAt,nextSlotAt}) { await this.pool.query('UPDATE searchad_worker_schedules SET next_slot_at=$4 WHERE customer_id=$1 AND schedule_id=$2 AND next_slot_at=$3',[customerId,scheduleId,slotAt,nextSlotAt]); }
  async enqueueSlot({customerId,scheduleId,slotAt,kind,payload,requestHash,now,skipped=false}) {
    validateSchedule({customerId,scheduleId,kind,payload});
    if(contentHash({kind,payload})!==requestHash || !Number.isFinite(now) || !Number.isFinite(Date.parse(slotAt)))throw workerError();
    return this.transaction(async client=>{
      const inserted=(await client.query(`INSERT INTO searchad_worker_jobs(job_id,customer_id,schedule_id,slot_at,kind,payload_json,request_hash,state,available_at,result_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$9) ON CONFLICT(customer_id,schedule_id,slot_at) DO NOTHING RETURNING *`,[randomUUID(),customerId,scheduleId,slotAt,kind,payload,requestHash,skipped?'skipped':'queued',iso(now),skipped?{code:'STALE_SLOT'}:{}])).rows[0];
      const row=inserted || (await client.query('SELECT * FROM searchad_worker_jobs WHERE customer_id=$1 AND schedule_id=$2 AND slot_at=$3',[customerId,scheduleId,slotAt])).rows[0];
      if(row.request_hash!==requestHash)throw workerError('SLOT_CONFLICT',409);
      if(inserted)await this.history(client,row,skipped?'skipped':'enqueued',skipped?{code:'STALE_SLOT'}:{},now);
      return {...job(row),created:Boolean(inserted)};
    });
  }
  async claim({workerId,now,leaseMs}) {
    if(!identifier(workerId)||!Number.isFinite(now)||!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>300000)throw workerError();
    const ownerToken=randomUUID();
    return this.transaction(async client=>{
      // The bounded final attempt remains terminal even after an owner crash.
      const exhausted=await client.query(`UPDATE searchad_worker_jobs SET state='manual_review',owner_hash=NULL,lease_until=NULL,result_json='{"code":"ATTEMPTS_EXHAUSTED"}',updated_at=$1 WHERE state='running' AND lease_until<=$1 AND attempts>=max_attempts RETURNING *`,[iso(now)]);
      for(const row of exhausted.rows)await this.history(client,row,'manual_review',{code:'ATTEMPTS_EXHAUSTED'},now);
      const row=(await client.query(`WITH candidate AS (
        SELECT job_id FROM searchad_worker_jobs WHERE attempts<max_attempts AND available_at<=$1
        AND (state IN('queued','retry') OR (state='running' AND lease_until<=$1)) ORDER BY slot_at,job_id FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE searchad_worker_jobs j SET state='running',worker_id=$2,owner_hash=$3,lease_generation=j.lease_generation+1,lease_until=$4,attempts=j.attempts+1,updated_at=$1 FROM candidate c WHERE j.job_id=c.job_id RETURNING j.*`,[iso(now),workerId,hash(ownerToken),iso(now+leaseMs)])).rows[0];
      if(!row)return null;await this.history(client,row,'claimed',{},now);return {...job(row),ownerToken};
    });
  }
  async owns({jobId,ownerToken,leaseGeneration,now},client=this.pool) {
    if(typeof ownerToken!=='string')return false;
    return (await client.query("SELECT job_id FROM searchad_worker_jobs WHERE job_id=$1 AND owner_hash=$2 AND lease_generation=$3 AND state='running' AND lease_until>$4",[jobId,hash(ownerToken),leaseGeneration,iso(now)])).rows.length===1;
  }
  async heartbeat({jobId,ownerToken,leaseGeneration,now,leaseMs}) {
    if(typeof ownerToken!=='string'||!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>300000)return false;
    return (await this.pool.query("UPDATE searchad_worker_jobs SET lease_until=$5,updated_at=$4 WHERE job_id=$1 AND owner_hash=$2 AND lease_generation=$3 AND state='running' AND lease_until>$4 RETURNING job_id",[jobId,hash(ownerToken),leaseGeneration,iso(now),iso(now+leaseMs)])).rows.length===1;
  }
  async finish({jobId,ownerToken,leaseGeneration,state,result,now,retryMs=60000}) {
    if(!['succeeded','skipped','failed','manual_review','retry'].includes(state))throw workerError();
    return this.transaction(async client=>{
      const row=(await client.query(`UPDATE searchad_worker_jobs SET state=CASE WHEN $5='retry' AND attempts>=max_attempts THEN 'manual_review' ELSE $5 END,result_json=$6,owner_hash=NULL,lease_until=NULL,available_at=$7,updated_at=$4 WHERE job_id=$1 AND owner_hash=$2 AND lease_generation=$3 AND state='running' AND lease_until>$4 RETURNING *`,[jobId,hash(ownerToken),leaseGeneration,iso(now),state,safeResult(result),iso(now+retryMs)])).rows[0];
      if(!row)return false;await this.history(client,row,row.state,result,now);return true;
    });
  }
  async claimSource(owner,{sourceKey,kind,requestHash,now}) {
    let created=false;
    const value=await this.transaction(async client=>{
      // Lock/CAS the actual generation before granting any new source invocation.
      await client.query('SELECT job_id FROM searchad_worker_jobs WHERE job_id=$1 FOR UPDATE',[owner.jobId]);
      if(!await this.owns({...owner,now},client))throw workerError('LEASE_LOST',409);
      const row=(await client.query(`INSERT INTO searchad_worker_sources(customer_id,job_id,source_key,kind,intent_key,request_hash,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'claimed',$7) ON CONFLICT(job_id,source_key) DO NOTHING RETURNING *`,[owner.customerId,owner.jobId,sourceKey,kind,`worker:${owner.jobId}:${sourceKey}`,requestHash,iso(now)])).rows[0];
      created=Boolean(row);
      const value=source(row || (await client.query('SELECT * FROM searchad_worker_sources WHERE job_id=$1 AND source_key=$2',[owner.jobId,sourceKey])).rows[0]);
      if(value.requestHash!==requestHash||value.kind!==kind)throw workerError('SOURCE_CONFLICT',409);return value;
    });
    // A COMMIT acknowledgment failure can never reconstruct this one-time permit.
    const permit=created?Object.freeze({}):null;if(permit)this.#permits.set(permit,value);
    return {...value,created,permit};
  }
  async withSource(permit,task) {
    const binding=this.#permits.get(permit);this.#permits.delete(permit);if(!binding)throw workerError('SOURCE_USED',409);
    let used=false;
    return sourceScope.run(Object.freeze({pool:this.pool,customerId:binding.customerId,persist:async(client,run)=>{
      if(used || binding.kind!=='automation' || binding.customerId!==run.customerId)throw workerError('SOURCE_CONFLICT',409);used=true;
      const result=await client.query("UPDATE searchad_worker_sources SET state='linked',run_id=$3 WHERE job_id=$1 AND source_key=$2 AND customer_id=$4 AND state='claimed' AND run_id IS NULL RETURNING job_id",[binding.jobId,binding.sourceKey,run.runId,binding.customerId]);
      if(result.rows.length!==1)throw workerError('SOURCE_CONFLICT',409);
    }}),task);
  }
  async reportForIntent({customerId,intentKey}) { return (await this.pool.query("SELECT report_job_id FROM searchad_report_jobs WHERE customer_id=$1 AND report_kind='stat' AND intent_key=$2",[customerId,intentKey])).rows[0]?.report_job_id || null; }
}
