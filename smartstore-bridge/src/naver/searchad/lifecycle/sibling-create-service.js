import { isDeepStrictEqual as equal } from 'node:util';
import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { PostgresSiblingCreateRepository } from './postgres-sibling-create-repository.js';
import { siblingScope } from './sibling-create-contract.js';

const ORIGIN='https://api.searchad.naver.com';
const fail=(code,message,status=409)=>{const e=new Error(message);e.code=`SEARCHAD_SIBLING_${code}`;e.status=status;throw e;};

/** Default-OFF internal keyword/creative continuation. No HTTP/bootstrap wiring. */
export class SiblingCreateService {
  #enabled;#config;#registry;#credentials;#clock;#gateway;#store;
  constructor({pool,registry,credentialsRegistry,config,enabled=false,dailyBudget,riskUnits,dailyCapacityUnits,keywordTexts,planTtlSeconds=300,preflightMaxAgeMs=5000,clock=Date.now,fetchImpl=globalThis.fetch,logger=console}={}){
    if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||typeof registry?.get!=='function'||typeof registry?.status!=='function'||typeof credentialsRegistry?.resolve!=='function')throw new TypeError('PostgreSQL, pinned registry and credentials are required');
    if(typeof enabled!=='boolean'||typeof clock!=='function'||typeof fetchImpl!=='function'||config?.baseUrl!==ORIGIN)throw new TypeError('Explicit gate, clock, transport and official origin required');
    for(const value of [dailyBudget,riskUnits,dailyCapacityUnits])if(!Number.isSafeInteger(value)||value<=0||value>2147483647)throw new TypeError('Positive bounded policy required');
    if(riskUnits>dailyCapacityUnits||!Number.isSafeInteger(planTtlSeconds)||planTtlSeconds<60||planTtlSeconds>3600||!Number.isSafeInteger(preflightMaxAgeMs)||preflightMaxAgeMs<100||preflightMaxAgeMs>30000)throw new TypeError('Invalid sibling policy');
    this.#enabled=enabled;this.#config=config;this.#registry=registry;this.#credentials=credentialsRegistry;this.#clock=clock;
    const safeFetch=async(url,init)=>{if(new URL(url).origin!==ORIGIN)throw new Error('Unexpected sibling origin');const r=await fetchImpl(url,{...init,redirect:'error'});if(r.redirected||(r.status>=300&&r.status<400))throw new Error('Sibling redirects forbidden');return r;};
    const client=new NaverSearchAdClient({baseUrl:ORIGIN,credentialsRegistry,fetchImpl:safeFetch,maxRetries:0,clock,logger});
    this.#gateway=new SearchAdOperationGateway({client,registry,credentialsRegistry,config,logger});
    this.#store=new PostgresSiblingCreateRepository({pool,dailyBudget,keywordTexts,current:id=>this.#identity(id),gate:d=>this.#gate(d),clock,planTtlSeconds,preflightMaxAgeMs,riskUnits,dailyCapacityUnits});
  }
  #on(){if(!this.#enabled)fail('DISABLED','Sibling creation is disabled.',403);}
  #identity(customerId){try{if(this.#config.baseUrl!==ORIGIN)throw new Error();for(const key of [OPS.campaign.read,OPS.adgroup.read,OPS.keyword.create,OPS.keyword.read,OPS.creative.create,OPS.creative.read]){const op=this.#registry.get(key);if(op.operationKey!==key||op.runtimeAllowlisted!==true||op.state!=='public_documented'||op.tier!=='B')throw new Error();}const specSha=this.#registry.status().specRef;if(typeof specSha!=='string'||!specSha)throw new Error();return {specSha,credentialFingerprint:credentialFingerprintForCustomer(this.#credentials,customerId),upstreamBaseUrl:ORIGIN};}catch{fail('CONTEXT','Current sibling operations or credentials are unavailable.',503);}}
  #gate(descriptor){this.#identity(descriptor.customerId);const op=this.#registry.get(descriptor.operationKey);this.#gateway.canaryExecutionCheck(op,{...descriptor,confirmation:op.confirmation});for(const key of [OPS.campaign.read,OPS.adgroup.read,OPS.keyword.read,OPS.creative.read])this.#gateway.executionCheck(this.#registry.get(key),{customerId:descriptor.customerId});}
  async prepareKeywords(input={},context={}){this.#on();return this.#store.prepare(siblingScope(input,context,'prepare'),'keywords');}
  async prepareCreative(input={},context={}){this.#on();return this.#store.prepare(siblingScope(input,context,'prepare'),'creative');}
  async execute(input={},context={}){
    this.#on();const scope=siblingScope(input,context,'execute'),kind=scope.kind;const snapshot=await this.#store.executionSnapshot(scope,kind);const observations=[];
    try{for(const descriptor of snapshot.reads)observations.push(await this.#gateway.execute(descriptor.operationKey,descriptor));}catch{fail('PREFLIGHT','Stopped ancestor/adgroup observation unavailable; no token/risk consumed.');}
    const handoff=await this.#store.claim(snapshot.ticket,observations);let result,unavailable=false;
    try{this.#gate(handoff.descriptor);if(!equal(this.#identity(scope.customerId),handoff.identity)||this.#clock()>=handoff.validUntil||new Date(this.#clock()).toISOString().slice(0,10)!==handoff.riskDate)throw new Error('Changed dispatch context');const op=this.#registry.get(handoff.descriptor.operationKey);result=await this.#gateway.executeCanary(handoff.descriptor.operationKey,{...handoff.descriptor,confirmation:op.confirmation});}catch{unavailable=true;}
    const captured=await this.#store.capture(handoff.ticket,result,{unavailable});if(!captured.ticket)return captured.projection;
    let reads,readUnavailable=false,contextMismatch=false;
    try{
      if(!equal(this.#identity(scope.customerId),handoff.identity))throw new Error('Changed verification context');
      if(kind==='keywords'){reads=[];for(const id of captured.projection.remoteIds)reads.push(await this.#gateway.execute(OPS.keyword.read,{customerId:scope.customerId,pathParams:{nccKeywordId:id}}));}
      else reads=await this.#gateway.execute(OPS.creative.read,{customerId:scope.customerId,pathParams:{adId:captured.projection.remoteIds[0]}});
    }catch{readUnavailable=true;}
    try{contextMismatch=!equal(this.#identity(scope.customerId),handoff.identity);}catch{contextMismatch=true;}
    return this.#store.verify(captured.ticket,reads,{unavailable:readUnavailable,contextMismatch});
  }
}
