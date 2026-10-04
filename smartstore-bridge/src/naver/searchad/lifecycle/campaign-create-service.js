import { isDeepStrictEqual } from 'node:util';
import { NaverSearchAdClient } from '../client.js';
import { PostgresAccountSendFence } from './postgres-account-send-fence.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { PostgresCampaignDispatchRepository } from './postgres-campaign-dispatch-repository.js';
import { PostgresCampaignCreateRepository, fail, record } from './postgres-campaign-create-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const ORIGIN='https://api.searchad.naver.com';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function scopeCopy(input,context,execute=false) {
  const keys=execute?['customerId','hierarchyRunId','hierarchyObjectId','planId','executionToken']:['customerId','activationId'];
  if(!record(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k)))fail('SEARCHAD_CAMPAIGN_CREATE_INPUT_INVALID','Only exact local identifiers and the issued execution token are accepted.',400);
  const s=Object.fromEntries(keys.map(k=>[k,input[k]]));
  if(typeof s.customerId!=='string'||!/^\d{1,30}$/.test(s.customerId)||keys.filter(k=>k.endsWith('Id')&&k!=='customerId').some(k=>typeof s[k]!=='string'||!UUID.test(s[k]))||
    (execute&&(typeof s.executionToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(s.executionToken))))fail('SEARCHAD_CAMPAIGN_CREATE_INPUT_INVALID','Local identifiers and token have invalid types or formats.',400);
  const p=context?.principal;
  if(!record(p)||p.role!=='admin'||typeof p.principalId!=='string'||!p.principalId.trim()||p.principalId!==p.principalId.trim()||!Array.isArray(p.customerIds)||!p.customerIds.includes(s.customerId))fail('SEARCHAD_CAMPAIGN_CREATE_FORBIDDEN','Authenticated Admin and explicit Customer access are required.',403);
  for(const k of keys)if(k.endsWith('Id')&&k!=='customerId')s[k]=s[k].toLowerCase();
  return {scope:Object.freeze(s),principal:Object.freeze({principalId:p.principalId,role:'admin',customerIds:Object.freeze([s.customerId])})};
}

/** Internal, default-disabled single-campaign path. Deliberately not wired to HTTP/bootstrap. */
export class CampaignCreateService {
  #enabled;#gateway;#registry;#credentials;#config;#clock;#store;#dispatch;#sendFence;
  constructor({pool,registry,credentialsRegistry,config,enabled=false,dailyBudget,riskUnits,dailyCapacityUnits,planTtlSeconds=300,clock=Date.now,fetchImpl=globalThis.fetch,logger=console}={}) {
    if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||typeof registry?.get!=='function'||typeof registry?.status!=='function'||typeof credentialsRegistry?.resolve!=='function')throw new TypeError('Actual PostgreSQL, pinned registry and credential registry are required');
    if(typeof enabled!=='boolean'||typeof clock!=='function'||typeof fetchImpl!=='function'||!record(config)||config.baseUrl!==ORIGIN)throw new TypeError('Explicit gate, clock, transport and fixed official origin are required');
    if(!Number.isSafeInteger(planTtlSeconds)||planTtlSeconds<60||planTtlSeconds>3600)throw new TypeError('Plan TTL must be 60..3600 seconds');
    this.#enabled=enabled;this.#registry=registry;this.#credentials=credentialsRegistry;this.#config=config;this.#clock=clock;
    this.#sendFence=new PostgresAccountSendFence({pool,fetchImpl});
    // Do not inherit the generic client's redirect-following behavior. Credentials
    // and POST bodies must never be forwarded to a redirected origin or replayed.
    const noRedirectFetch=async(url,init)=>{
      if(new URL(url).origin!==ORIGIN)throw new Error('Unexpected campaign transport origin');
      const response=await this.#sendFence.fetch(url,{...init,redirect:'error'});
      if(response.redirected||(response.status>=300&&response.status<400))throw new Error('Campaign redirects are forbidden');
      return response;
    };
    const client=new NaverSearchAdClient({baseUrl:ORIGIN,credentialsRegistry,fetchImpl:noRedirectFetch,maxRetries:0,clock,logger});
    this.#gateway=new SearchAdOperationGateway({client,registry,credentialsRegistry,config,logger});
    const current=customerId=>this.#identity(customerId);
    this.#dispatch=new PostgresCampaignDispatchRepository({pool,registry,enabled,dailyBudget,riskUnits,dailyCapacityUnits,contextResolver:current,clock});
    this.#store=new PostgresCampaignCreateRepository({pool,recipe:createHierarchyCampaignRecipe({dailyBudget}),current,clock,planTtlSeconds,assertSendGate:d=>this.#sendGate(d)});
  }
  #assertEnabled(){if(!this.#enabled)fail('SEARCHAD_CAMPAIGN_CREATE_DISABLED','Bounded campaign creation is disabled.',403);}
  #identity(customerId){
    try {
      if(this.#config.baseUrl!==ORIGIN)throw new Error();
      const specSha=this.#registry.status().specRef;
      for(const [key,method,path,sideEffect,gate] of [[OPS.campaign.create,'POST','/ncc/campaigns',true,'creates'],[OPS.campaign.read,'GET','/ncc/campaigns/{campaignId}',false,'reads']]){
        const op=this.#registry.get(key);
        if(op.operationKey!==key||op.method!==method||op.path!==path||op.sideEffect!==sideEffect||op.requiredGate!==gate||op.state!=='public_documented'||op.runtimeAllowlisted!==true||op.tier!=='B')throw new Error();
      }
      if(typeof specSha!=='string'||!specSha)throw new Error();
      return {specSha,credentialFingerprint:credentialFingerprintForCustomer(this.#credentials,customerId),upstreamBaseUrl:ORIGIN};
    }catch{fail('SEARCHAD_CAMPAIGN_CREATE_CONTEXT_UNAVAILABLE','Current pinned campaign operation or credential identity is unavailable.',503);}
  }
  #sendGate(descriptor){
    try{
      this.#identity(descriptor.customerId);
      this.#gateway.canaryExecutionCheck(this.#registry.get(OPS.campaign.create),{...descriptor,confirmation:this.#registry.get(OPS.campaign.create).confirmation});
      this.#gateway.executionCheck(this.#registry.get(OPS.campaign.read),{customerId:descriptor.customerId});
    }catch{fail('SEARCHAD_CAMPAIGN_CREATE_GATE_DISABLED','Dedicated campaign or verification read gate is unavailable.',403);}
  }
  async prepare(input={},context={}){
    this.#assertEnabled();const {scope,principal}=scopeCopy(input,context);
    return this.#store.prepare({...scope,actorPrincipalId:principal.principalId});
  }
  async execute(input={},context={}){
    this.#assertEnabled();const {scope,principal}=scopeCopy(input,context,true);
    this.#sendGate({customerId:scope.customerId});
    const receipt=await this.#dispatch.claim(scope,{principal});
    const handoff=await this.#store.beginSend(receipt);
    let result;let unavailable=false;
    try{
      result=await this.#sendFence.run(scope.customerId,()=>{
        this.#sendGate(handoff.descriptor);
        if(!isDeepStrictEqual(this.#identity(scope.customerId),handoff.identity)||this.#clock()>=handoff.validUntil||new Date(this.#clock()).toISOString().slice(0,10)!==handoff.riskDate)throw new Error('Handoff context changed');
      },()=>this.#gateway.executeCanary(OPS.campaign.create,{...handoff.descriptor,confirmation:this.#registry.get(OPS.campaign.create).confirmation}));
    }catch{unavailable=true;}
    const captured=await this.#store.capture(handoff.ticket,result,{unavailable});
    if(!captured.ticket)return captured.projection;
    let read;let readUnavailable=false;let contextMismatch=false;
    try{
      if(!isDeepStrictEqual(this.#identity(scope.customerId),handoff.identity))throw new Error('Changed identity');
      read=await this.#gateway.execute(OPS.campaign.read,{customerId:scope.customerId,pathParams:{campaignId:captured.projection.remoteId}});
    }catch{readUnavailable=true;}
    try{contextMismatch=!isDeepStrictEqual(this.#identity(scope.customerId),handoff.identity);}catch{contextMismatch=true;}
    return this.#store.verify(captured.ticket,read,{unavailable:readUnavailable,contextMismatch});
  }
}
