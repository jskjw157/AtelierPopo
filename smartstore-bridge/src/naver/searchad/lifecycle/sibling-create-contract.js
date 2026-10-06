import { createHash } from 'node:crypto';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS, KEYWORD_CREATE_MAX_BATCH } from './operations.js';

export const REMOTE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
export const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const KEYWORD_FIELDS = Object.freeze(['keyword.keyword']);
export const CREATIVE_FIELDS = Object.freeze(['creative.nccAdgroupId','creative.type','creative.headline','creative.description']);
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function siblingScope(input, context, mode) {
  const prepare = mode === 'prepare';
  const keys = prepare ? ['customerId','hierarchyRunId','parentObjectId','activationId'] : ['customerId','hierarchyRunId','parentObjectId','planId','executionToken','kind'];
  if (!record(input) || Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) throw Object.assign(new Error('Only exact local scope is accepted.'),{code:'SEARCHAD_SIBLING_INPUT_INVALID',status:400});
  const scope = Object.fromEntries(keys.map(key => [key,input[key]]));
  if (typeof scope.customerId !== 'string' || !/^\d{1,30}$/.test(scope.customerId) || keys.filter(key => key.endsWith('Id') && key !== 'customerId').some(key => typeof scope[key] !== 'string' || !UUID.test(scope[key]))) throw Object.assign(new Error('Invalid local scope identifiers.'),{code:'SEARCHAD_SIBLING_INPUT_INVALID',status:400});
  const principal=context?.principal;
  if(!record(principal)||principal.role!=='admin'||typeof principal.principalId!=='string'||!principal.principalId.trim()||!Array.isArray(principal.customerIds)||!principal.customerIds.includes(scope.customerId)) throw Object.assign(new Error('Authenticated Admin with Customer access required.'),{code:'SEARCHAD_SIBLING_FORBIDDEN',status:403});
  if(!prepare){
    if(!['keywords','creative'].includes(scope.kind)||typeof scope.executionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(scope.executionToken)) throw Object.assign(new Error('Invalid sibling kind or execution token.'),{code:'SEARCHAD_SIBLING_INPUT_INVALID',status:400});
    scope.tokenHash=createHash('sha256').update(scope.executionToken).digest('hex');delete scope.executionToken;
  }
  for(const key of keys) if(key.endsWith('Id')&&key!=='customerId') scope[key]=scope[key].toLowerCase();
  return Object.freeze({...scope,actorPrincipalId:principal.principalId});
}

/**
 * Classify a keyword batch without promoting partial results to ownership.
 * Partial recovery is accepted only when every returned ID explicitly echoes
 * one unique requested keyword, so no positional inference is needed.
 */
export function keywordBatchOutcome(result, descriptor) {
  if (!record(result) || Object.hasOwn(result, 'body') || Object.hasOwn(result, 'value')) return null;
  if (result.operation?.operationKey !== OPS.keyword.create || result.operation?.sideEffect !== true) return null;
  if (![200, 201].includes(result.upstream?.status)) return null;
  if (!record(descriptor) || descriptor.operationKey !== OPS.keyword.create || typeof descriptor.customerId !== 'string' || !descriptor.customerId) return null;
  if (!record(descriptor.query) || typeof descriptor.query.nccAdgroupId !== 'string' || !REMOTE_ID.test(descriptor.query.nccAdgroupId)) return null;
  if (!Array.isArray(descriptor.body) || descriptor.body.length < 1 || descriptor.body.length > KEYWORD_CREATE_MAX_BATCH) return null;
  if (!Array.isArray(result.data) || result.data.length < 1 || result.data.length > descriptor.body.length) return null;

  const ids = new Set();
  if (result.data.length === descriptor.body.length) {
    const items=[];
    for(let index=0;index<descriptor.body.length;index+=1){
      const expected=descriptor.body[index],item=result.data[index];
      if(!record(expected)||typeof expected.keyword!=='string'||!expected.keyword.trim()||!record(item))return null;
      const id=String(item.nccKeywordId??'').trim();if(!REMOTE_ID.test(id)||ids.has(id))return null;
      if(Object.hasOwn(item,'keyword')&&String(item.keyword)!==expected.keyword)return null;
      ids.add(id);items.push(Object.freeze({index,remoteId:id}));
    }
    return Object.freeze({kind:'exact',items:Object.freeze(items)});
  }

  const expectedByKeyword=new Map();
  for(let index=0;index<descriptor.body.length;index+=1){
    const expected=descriptor.body[index];
    if(!record(expected)||typeof expected.keyword!=='string'||!expected.keyword.trim()||expectedByKeyword.has(expected.keyword))return null;
    expectedByKeyword.set(expected.keyword,index);
  }
  const indexes=new Set(),items=[];
  for(const item of result.data){
    if(!record(item)||!Object.hasOwn(item,'keyword')||typeof item.keyword!=='string')return null;
    const id=String(item.nccKeywordId??'').trim(),index=expectedByKeyword.get(item.keyword);
    if(!REMOTE_ID.test(id)||index===undefined||ids.has(id)||indexes.has(index))return null;
    ids.add(id);indexes.add(index);items.push(Object.freeze({index,remoteId:id}));
  }
  items.sort((a,b)=>a.index-b.index);
  return Object.freeze({kind:'partial',items:Object.freeze(items)});
}

/** Conservative exact parser: partial, extra, duplicate or contradictory results are never promoted. */
export function keywordBatchResponse(result, descriptor) {
  const outcome=keywordBatchOutcome(result,descriptor);
  if(outcome?.kind!=='exact')return null;
  return Object.freeze(outcome.items.map(item=>item.remoteId));
}

export function keywordReadResponse(result,{customerId,parentRemoteId,remoteId,keyword}){
  if(!record(result)||result.operation?.operationKey!==OPS.keyword.read||result.operation?.sideEffect!==false||result.upstream?.status!==200||!record(result.data))return null;
  const d=result.data;
  if(String(d.customerId??'')!==customerId||d.nccAdgroupId!==parentRemoteId||d.nccKeywordId!==remoteId||!REMOTE_ID.test(String(d.nccKeywordId??'')))return null;
  if(Object.hasOwn(d,'keyword')&&String(d.keyword)!==keyword)return null;
  return Object.freeze({customerId,parentRemoteId,remoteId,keyword});
}

export function creativeResponse(result,descriptor,create,remoteId=null){
  if(!record(result)||Object.hasOwn(result,'body')||Object.hasOwn(result,'value'))return null;
  if(result.operation?.operationKey!==(create?OPS.creative.create:OPS.creative.read)||result.operation?.sideEffect!==create||!(create?[200,201]:[200]).includes(result.upstream?.status)||!record(result.data))return null;
  const d=result.data,id=String(d.nccAdId??'').trim();if(String(d.customerId??'')!==descriptor.customerId||!REMOTE_ID.test(id)||(remoteId!==null&&id!==remoteId))return null;
  const body=descriptor.body;
  if(d.nccAdgroupId!==body.nccAdgroupId||d.type!==body.type||!record(d.ad)||d.ad.headline!==body.ad.headline||d.ad.description!==body.ad.description)return null;
  return Object.freeze({customerId:descriptor.customerId,nccAdId:id,...body});
}
