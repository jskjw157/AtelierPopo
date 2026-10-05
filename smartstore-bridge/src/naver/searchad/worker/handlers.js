import { contentHash } from '../write/canonical.js';
import { reportDates } from './scheduler.js';
import { validateSchedule, workerError } from './config.js';
export function createWorkerHandlers({repository,completion,principal,clock=Date.now}) {
  async function guard(job) {
    if(!principal.customerIds.includes(job.customerId))throw workerError('CUSTOMER_FORBIDDEN',403);
    validateSchedule({customerId:job.customerId,scheduleId:job.scheduleId,kind:job.kind,payload:job.payload});
    if(!await repository.owns({...job,now:clock()}))throw workerError('LEASE_LOST',409);
    return {principal,requestId:`worker:${job.jobId}`};
  }
  async function collect(job,reportJobId) {
    const context=await guard(job),input={customerId:job.customerId,reportJobId};
    let report=await completion.repository.getReportJob(input);
    if(!report)throw workerError('RESOURCE_NOT_FOUND',404);
    if(['unknown_outcome','manual_review','dispatching','planned'].includes(report.processingState)) {
      await completion.jobService.reconcile(input,context);
      return {state:'manual_review',result:{reportJobId,code:'SOURCE_UNRESOLVED'}};
    }
    if(report.processingState==='ingested')return {state:'succeeded',result:{reportJobId,code:'COMPLETE'}};
    if(report.processingState==='failed')return {state:'failed',result:{reportJobId}};
    await guard(job);report=await completion.jobService.poll(input,context);
    if(report.processingState!=='built')return {state:report.processingState==='failed'?'failed':'retry',result:{reportJobId,code:'PENDING'}};
    if(!completion.ingestionService)throw workerError('UNAVAILABLE',503);
    await guard(job);await completion.ingestionService.ingest(input,context);
    return {state:'succeeded',result:{reportJobId,code:'COLLECTED'}};
  }
  return {
    async collect_stats(job) {
      const context=await guard(job),date=new Date(Date.parse(job.slotAt)+9*3600000).toISOString().slice(0,10);
      const observation=await completion.statsService.collect({customerId:job.customerId,...job.payload,since:date,until:date},context);
      return {state:'succeeded',result:{observationId:observation.observationId,code:'COLLECTED'}};
    },
    async register_stat_report(job) {
      const context=await guard(job);let state='succeeded',count=0;
      for(const [index,statDate] of reportDates(Date.parse(job.slotAt)).entries()) {
        await guard(job);
        const input={customerId:job.customerId,kind:'stat',reportType:job.payload.reportType,statDate};
        const source=await repository.claimSource(job,{sourceKey:`report${index+1}`,kind:'report',requestHash:contentHash(input),now:clock()});
        let reportJobId=await repository.reportForIntent(source);
        if(!reportJobId) {
          if(!source.created)return {state:'manual_review',result:{code:'SOURCE_UNRESOLVED'}};
          await guard(job);
          const report=await repository.withSource(source.permit,()=>completion.jobService.register({...input,intentKey:source.intentKey},context));
          reportJobId=report.reportJobId;
        }
        const outcome=await collect(job,reportJobId);count++;
        if(['failed','manual_review'].includes(outcome.state))return outcome;
        if(outcome.state==='retry')state='retry';
      }
      return {state,result:{count,code:state==='retry'?'PENDING':'COMPLETE'}};
    },
    async collect_report_generation(job) { return collect(job,job.payload.reportJobId); },
    async evaluate_automation(job) {
      const context=await guard(job);
      const source=await repository.claimSource(job,{sourceKey:'decision',kind:'automation',requestHash:job.requestHash,now:clock()});
      if(source.runId) { const run=await completion.automationService.getRun({customerId:job.customerId,runId:source.runId},context);return {state:'succeeded',result:{runId:run.runId,code:'SOURCE_LINKED'}}; }
      if(!source.created)return {state:'manual_review',result:{code:'SOURCE_UNRESOLVED'}};
      await guard(job);
      const run=await repository.withSource(source.permit,()=>completion.automationService.evaluate({customerId:job.customerId,policyId:job.payload.policyId,slotAt:job.slotAt},context));
      return {state:'succeeded',result:{runId:run.runId,code:'SOURCE_LINKED'}};
    },
    async reconcile_automation(job) {
      const context=await guard(job),run=await completion.automationService.reconcile({customerId:job.customerId,runId:job.payload.runId},context);
      return {state:['manual_review','executing','unknown'].includes(run.state)?'manual_review':'succeeded',result:{runId:run.runId}};
    }
  };
}
