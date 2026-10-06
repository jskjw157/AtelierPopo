import { sendJson } from './runtime.js';
import { workerError } from '../naver/searchad/worker/config.js';
export function createSearchAdWorkerRoutes(context) {
  return [['GET','schedules','listSchedules'],['GET','jobs','listJobs'],['POST','schedules','createSchedule']].map(([method,path,action])=>({method,pattern:new RegExp(`^/api/v1/searchad/worker/${path}$`),auth:true,write:method==='POST',searchAdRole:'admin',handler:async({req,res,url,body,principal,requestId})=>{
    if(method==='POST'?url.searchParams.size!==0:[...url.searchParams.keys()].some(key=>key!=='customerId')||url.searchParams.getAll('customerId').length!==1)throw workerError();
    const service=context.app.searchAdCompletionRuntime?.workerRuntime?.service;if(!service)throw workerError('UNAVAILABLE',503);
    const input=method==='POST'?body:Object.fromEntries(url.searchParams);
    sendJson(req,res,method==='POST'?201:200,await service[action](input,{principal,requestId}));
  }}));
}
