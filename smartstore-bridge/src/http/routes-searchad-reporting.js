import { HttpError } from './errors.js';
import { sendJson } from './runtime.js';
import { searchAdCompletionOpenApi } from './openapi-searchad-completion.js';
import { ENTITY_TYPES, publicObservation, publicReportJob, exactKeys, validateStatsInput } from '../naver/searchad/reporting/contracts.js';
function customerScope(principal, value) {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value) || !principal?.customerIds?.includes(value)) throw new HttpError(403, 'SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.');
  return value;
}
function runtimeFor(context) {
  const runtime = context.app.searchAdCompletionRuntime;
  if (runtime?.status?.().ready !== true || !runtime.repository || !runtime.statsService) throw new HttpError(503, 'SEARCHAD_REPORTING_NOT_READY', 'SearchAd reporting is unavailable.');
  return runtime;
}
function queryInput(url, allowed) {
  if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) throw new HttpError(400, 'SEARCHAD_REPORTING_QUERY_INVALID', 'SearchAd reporting query is invalid.');
  const result = Object.fromEntries(url.searchParams);
  if (result.entityType !== undefined && !ENTITY_TYPES.includes(result.entityType)) throw new HttpError(400, 'SEARCHAD_REPORTING_QUERY_INVALID', 'SearchAd reporting query is invalid.');
  if (result.entityId !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(result.entityId)) throw new HttpError(400, 'SEARCHAD_REPORTING_QUERY_INVALID', 'SearchAd reporting query is invalid.');
  if (result.limit !== undefined && (!/^\d+$/.test(result.limit) || Number(result.limit) < 1 || Number(result.limit) > 100)) throw new HttpError(400, 'SEARCHAD_REPORTING_QUERY_INVALID', 'SearchAd reporting query is invalid.');
  return result;
}
export function createSearchAdReportingRoutes(context) {
  return [
    ...['reader','operator','executor','admin'].map(role => ({ method: 'GET', pattern: new RegExp(`^/openapi-searchad-completion-${role}\\.json$`), auth: false, write: false, handler: async ({ req, res }) => sendJson(req, res, 200, searchAdCompletionOpenApi({ role })) })),
    { method: 'POST', pattern: /^\/api\/v1\/searchad\/reporting\/jobs$/, auth: true, write: true, searchAdRole: 'operator', handler: async ({ req, res, body, url, principal, requestId }) => {
      customerScope(principal, body?.customerId); queryInput(url, []);
      const runtime = runtimeFor(context);
      if (!runtime.jobService) throw new HttpError(503, 'SEARCHAD_REPORTING_NOT_READY', 'SearchAd reporting is unavailable.');
      sendJson(req,res,201,publicReportJob(await runtime.jobService.register(body, { principal, requestId })));
    } },
    { method: 'GET', pattern: /^\/api\/v1\/searchad\/reporting\/jobs\/(?<reportJobId>[^/]+)$/, auth: true, write: false, searchAdRole: 'reader', handler: async ({ req,res,url,match,principal }) => {
      const query = queryInput(url,['customerId']); const customerId = customerScope(principal,query.customerId);
      const row = await runtimeFor(context).repository.getReportJob({ customerId,reportJobId: match.groups.reportJobId });
      if (!row) throw new HttpError(404,'SEARCHAD_REPORT_JOB_NOT_FOUND','SearchAd report job was not found.');
      sendJson(req,res,200,publicReportJob(row));
    } },
    ...['poll','reconcile'].map(action => ({ method: 'POST', pattern: new RegExp(`^/api/v1/searchad/reporting/jobs/(?<reportJobId>[^/]+)/${action}$`), auth: true, write: true, searchAdRole: 'operator', handler: async ({ req,res,url,match,body,principal,requestId }) => {
      const customerId = customerScope(principal,body?.customerId); exactKeys(body,['customerId'],'SEARCHAD_REPORT_INPUT_INVALID'); queryInput(url,[]);
      const runtime = runtimeFor(context);
      if (!runtime.jobService) throw new HttpError(503,'SEARCHAD_REPORTING_NOT_READY','SearchAd reporting is unavailable.');
      const row = await runtime.jobService[action]({ customerId,reportJobId: match.groups.reportJobId }, { principal,requestId });
      sendJson(req,res,200,{ ...publicReportJob(row), ...(row.diagnostics ? { diagnostics: row.diagnostics } : {}) });
    } })),
    ...['ingest','evaluate'].map(action => ({ method:'POST',pattern:new RegExp(`^/api/v1/searchad/reporting/jobs/(?<reportJobId>[^/]+)/${action}$`),auth:true,write:true,searchAdRole:'operator',handler:async({req,res,url,match,body,principal,requestId})=>{
      const customerId=customerScope(principal,body?.customerId);exactKeys(body,['customerId'],'SEARCHAD_REPORT_INPUT_INVALID');queryInput(url,[]);const runtime=runtimeFor(context);
      const service=action==='ingest'?runtime.ingestionService:runtime.spendEvidenceService;if(!service)throw new HttpError(503,'SEARCHAD_REPORTING_NOT_READY','Report ingestion is unavailable.');
      sendJson(req,res,200,await service[action==='ingest'?'ingest':'evaluateGeneration']({customerId,reportJobId:match.groups.reportJobId},{principal,requestId}));
    }})),
    {method:'GET',pattern:/^\/api\/v1\/searchad\/reporting\/jobs\/(?<reportJobId>[^/]+)\/content$/,auth:true,write:false,searchAdRole:'reader',handler:async({req,res,url,match,principal,requestId})=>{
      const query=queryInput(url,['customerId']);const customerId=customerScope(principal,query.customerId);const runtime=runtimeFor(context);if(!runtime.ingestionService)throw new HttpError(503,'SEARCHAD_REPORTING_NOT_READY','Report ingestion is unavailable.');
      const bytes=await runtime.ingestionService.archived({customerId,reportJobId:match.groups.reportJobId},{principal,requestId});res.writeHead(200,{'Content-Type':'text/tab-separated-values; charset=utf-8','Content-Length':bytes.length,'Content-Disposition':'attachment; filename="report.tsv"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
    }},
    { method: 'POST', pattern: /^\/api\/v1\/searchad\/reporting\/stats$/, auth: true, write: true, searchAdRole: 'operator', handler: async ({ req, res, body, principal, requestId }) => {
      customerScope(principal, body?.customerId);
      validateStatsInput(body);
      const row = await runtimeFor(context).statsService.collect(body, { principal, requestId });
      sendJson(req, res, 201, publicObservation(row));
    } },
    { method: 'GET', pattern: /^\/api\/v1\/searchad\/reporting\/observations$/, auth: true, write: false, searchAdRole: 'reader', handler: async ({ req, res, url, principal }) => {
      const query = queryInput(url, ['customerId','entityType','entityId','limit']);
      const customerId = customerScope(principal, query.customerId);
      const rows = await runtimeFor(context).repository.listObservations({ customerId, entityType: query.entityType, entityId: query.entityId, limit: Number(query.limit || 100) });
      sendJson(req, res, 200, { items: rows.map(publicObservation) });
    } },
    { method: 'GET', pattern: /^\/api\/v1\/searchad\/reporting\/observations\/(?<observationId>[^/]+)$/, auth: true, write: false, searchAdRole: 'reader', handler: async ({ req, res, url, match, principal }) => {
      const query = queryInput(url, ['customerId']);
      const customerId = customerScope(principal, query.customerId);
      const row = await runtimeFor(context).repository.getObservation({ customerId, observationId: match.groups.observationId });
      if (!row) throw new HttpError(404, 'SEARCHAD_REPORTING_OBSERVATION_NOT_FOUND', 'SearchAd observation was not found.');
      sendJson(req, res, 200, publicObservation(row));
    } },
    { method: 'GET', pattern: /^\/api\/v1\/searchad\/reporting\/metrics$/, auth: true, write: false, searchAdRole: 'reader', handler: async ({ req, res, url, principal }) => {
      const query = queryInput(url, ['customerId','entityType','entityId']);
      const customerId=customerScope(principal, query.customerId); const runtime=runtimeFor(context);
      if(!runtime.ingestionService)return sendJson(req,res,200,{available:false,status:'unavailable',reason:'REPORT_INGESTION_REQUIRED',items:[]});
      const identity=await runtime.identityResolver(customerId);
      sendJson(req,res,200,{available:true,status:'available',items:await runtime.repository.listMetrics({...query,customerId,identity})});
    } }
  ];
}
