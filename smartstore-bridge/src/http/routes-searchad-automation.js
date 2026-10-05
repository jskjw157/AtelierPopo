import { sendJson } from './runtime.js';
import { HttpError } from './errors.js';
import { requireSearchAdHttpWrites } from './searchad-write-runtime.js';
function service(context) { const value=context.app.searchAdCompletionRuntime?.automationService; if (!value) throw new HttpError(503,'SEARCHAD_AUTOMATION_UNAVAILABLE','SearchAd automation is unavailable.'); return value; }
export function createSearchAdAutomationRoutes(context) {
  const base='/api/v1/searchad/automation';
  const route=(method,path,role,action,{id=false,status=200}={})=>({method,pattern:new RegExp(`^${base}/${path}$`),auth:true,write:method==='POST',searchAdRole:role,handler:async({req,res,url,body,match,principal,requestId})=>{
    if (method==='POST' ? url.searchParams.size>0 : [...url.searchParams.keys()].some(key=>key!=='customerId') || url.searchParams.getAll('customerId').length!==1) throw new HttpError(400,'SEARCHAD_AUTOMATION_INPUT','Exact Customer scope is required.');
    if (action==='executeApproved') requireSearchAdHttpWrites(context);
    const input=method==='GET'?Object.fromEntries(url.searchParams):body;
    if (id && (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!['customerId',...(action==='executeApproved'?['executionToken']:[])].includes(key)))) throw new HttpError(400,'SEARCHAD_AUTOMATION_INPUT','Unexpected request field.');
    sendJson(req,res,status,await service(context)[action](id?{...input,runId:match.groups.runId}:input,{principal,requestId}));
  }});
  return [route('POST','policies','admin','createPolicy',{status:201}),route('GET','policies','reader','listPolicies'),route('POST','evaluate','operator','evaluate'),route('GET','runs','reader','listRuns'),route('GET','runs/(?<runId>[^/]+)','reader','getRun',{id:true}),route('POST','runs/(?<runId>[^/]+)/prepare','operator','prepare',{id:true}),route('POST','runs/(?<runId>[^/]+)/execute-approved','executor','executeApproved',{id:true})];
}
