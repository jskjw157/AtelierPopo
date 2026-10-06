import { sendJson } from './runtime.js';
import { HttpError } from './errors.js';
export function createSearchAdProfitabilityRoutes(context){
  const route=(method,path,role,service,action)=>({method,pattern:new RegExp(`^/api/v1/searchad/${path}$`),auth:true,write:method==='POST',searchAdRole:role,handler:async({req,res,url,body,match,principal,requestId})=>{
    const queryKeys=match.groups?.haarProductId?['customerId','since','until']:['customerId','haarProductId','since','until'];
    if(method==='POST'?url.searchParams.size>0:[...url.searchParams.keys()].some(k=>!queryKeys.includes(k))||queryKeys.some(k=>url.searchParams.getAll(k).length!==1))throw new HttpError(400,'SEARCHAD_PRODUCT_INPUT','Exact scoped input required.');
    const target=context.app.searchAdCompletionRuntime?.[service];if(!target)throw new HttpError(503,'SEARCHAD_PRODUCT_UNAVAILABLE','Product evidence unavailable.');
    const input=method==='GET'?{...Object.fromEntries(url.searchParams),haarProductId:match.groups?.haarProductId||url.searchParams.get('haarProductId')}:body;
    sendJson(req,res,200,await target[action](input,{principal,requestId}));
  }});
  return [route('POST','customer-channel-bindings','admin','productMappingService','bindCustomerChannel'),route('POST','product-mappings','admin','productMappingService','createRevision'),route('POST','product-costs','admin','productMappingService','appendCost'),route('POST','product-evidence/collect','operator','productEvidenceService','collect'),route('GET','profitability/products/(?<haarProductId>[^/]+)','reader','profitabilityService','getLatest'),route('POST','recommendations/generate','operator','recommendationService','generate'),route('GET','recommendations','reader','recommendationService','list')];
}
