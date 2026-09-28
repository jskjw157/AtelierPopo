import { isDeepStrictEqual as equal } from 'node:util';
import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { SearchAdError } from '../errors.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { PostgresChildFirstCleanupRepository } from './postgres-child-first-cleanup-repository.js';
import { cleanupScope, problem } from './child-first-cleanup-contract.js';
import { cleanupMaintenanceScope } from './cleanup-plan-lifecycle.js';

const ORIGIN='https://api.searchad.naver.com';
/** Bounded, default-OFF, internal deletion only. Not an HTTP route or evidence issuer. */
export class ChildFirstCleanupService {
  #enabled;#registry;#credentials;#config;#clock;#gateway;#store;
  constructor({pool,registry,credentialsRegistry,config,enabled=false,dailyBudget,riskUnits,dailyCapacityUnits,planTtlSeconds=300,preflightMaxAgeMs=5000,clock=Date.now,fetchImpl=globalThis.fetch,logger=console}={}){
    if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||typeof registry?.get!=='function'||typeof registry?.status!=='function'||typeof credentialsRegistry?.resolve!=='function')throw new TypeError('Actual PostgreSQL, pinned registry and current credentials required');
    if(typeof enabled!=='boolean'||typeof clock!=='function'||typeof fetchImpl!=='function'||config?.baseUrl!==ORIGIN)throw new TypeError('Explicit gate, clock, transport and fixed official origin required');
    for(const value of [dailyBudget,riskUnits,dailyCapacityUnits])if(!Number.isSafeInteger(value)||value<=0||value>2147483647)throw new TypeError('Positive bounded server policy required');
    if(riskUnits>dailyCapacityUnits||!Number.isSafeInteger(planTtlSeconds)||planTtlSeconds<60||planTtlSeconds>3600||!Number.isSafeInteger(preflightMaxAgeMs)||preflightMaxAgeMs<100||preflightMaxAgeMs>30000)throw new TypeError('Invalid server TTL, risk or freshness policy');
    this.#enabled=enabled;this.#registry=registry;this.#credentials=credentialsRegistry;this.#config=config;this.#clock=clock;
    const safeFetch=async(url,init)=>{if(new URL(url).origin!==ORIGIN)throw new Error('Unexpected cleanup origin');const r=await fetchImpl(url,{...init,redirect:'error'});if(r.redirected||(r.status>=300&&r.status<400))throw new Error('Cleanup redirects forbidden');return r;};
    const client=new NaverSearchAdClient({baseUrl:ORIGIN,credentialsRegistry,fetchImpl:safeFetch,maxRetries:0,clock,logger});
    this.#gateway=new SearchAdOperationGateway({client,registry,credentialsRegistry,config,logger});
    this.#store=new PostgresChildFirstCleanupRepository({pool,dailyBudget,riskUnits,dailyCapacityUnits,planTtlSeconds,preflightMaxAgeMs,clock,current:id=>this.#identity(id),gate:d=>this.#gate(d),confirmation:type=>registry.get(OPS[type].delete).confirmation});
  }
  #on(){if(!this.#enabled)problem('DISABLED','Child-first deletion is disabled.',403);}
  #identity(customerId){
    try{
      if(this.#config.baseUrl!==ORIGIN)throw new Error();
      for(const [type,segment,param] of [['campaign','campaigns','campaignId'],['adgroup','adgroups','adgroupId']])for(const [kind,method,gate] of [['read','GET','reads'],['delete','DELETE','deletes']]){
        const op=this.#registry.get(OPS[type][kind]);
        if(op.operationKey!==OPS[type][kind]||op.method!==method||op.path!==`/ncc/${segment}/{${param}}`||op.domain!==type||op.sideEffect!==(kind==='delete')||op.requiredGate!==gate||op.runtimeAllowlisted!==true||op.state!=='public_documented'||op.tier!=='B'||(kind==='delete'&&(!op.destructive||!op.confirmation)))throw new Error();
      }
      const specSha=this.#registry.status().specRef;if(typeof specSha!=='string'||!specSha)throw new Error();
      return {specSha,credentialFingerprint:credentialFingerprintForCustomer(this.#credentials,customerId),upstreamBaseUrl:ORIGIN};
    }catch{problem('CONTEXT','Current operation or credential identity is unavailable.',503);}
  }
  #transport(d){return {...d,confirmation:this.#registry.get(d.operationKey).confirmation,secondConfirmation:this.#gateway.preview(d.operationKey,d).resourceKey};}
  #gate(d){this.#identity(d.customerId);this.#gateway.canaryExecutionCheck(this.#registry.get(d.operationKey),this.#transport(d));for(const type of ['campaign','adgroup'])this.#gateway.executionCheck(this.#registry.get(OPS[type].read),{customerId:d.customerId});}
  async #read(descriptor,identity){
    if(!equal(this.#identity(descriptor.customerId),identity))problem('CONTEXT','Identity changed before observation.');
    this.#gateway.executionCheck(this.#registry.get(descriptor.operationKey),descriptor);
    let observation;
    try{observation={kind:'present',result:await this.#gateway.execute(descriptor.operationKey,descriptor)};}
    catch(error){const absent=error instanceof SearchAdError&&error.status===404&&error.upstreamStatus===404&&error.retryable===false&&typeof error.code==='string'&&error.code.startsWith('SEARCHAD_UPSTREAM_');observation={kind:absent?'absent':'unavailable'};}
    if(!equal(this.#identity(descriptor.customerId),identity))problem('CONTEXT','Identity changed during observation.');
    return observation;
  }
  async prepare(input={},context={}){this.#on();return this.#store.prepare(cleanupScope(input,context,'prepare'));}
  async retirePlan(input={},context={}){this.#on();return this.#store.retirePlan(cleanupMaintenanceScope(input,context,'retire'));}
  async replan(input={},context={}){this.#on();return this.#store.replan(cleanupMaintenanceScope(input,context,'replan'));}
  async execute(input={},context={}){
    this.#on();const scope=cleanupScope(input,context,'execute');const snapshot=await this.#store.executionSnapshot(scope);
    const observations=[];for(const d of snapshot.reads)observations.push(await this.#read(d,snapshot.identity));
    const handoff=await this.#store.claim(snapshot.ticket,observations);let status=null;
    try{
      this.#gate(handoff.descriptor);
      if(!equal(this.#identity(scope.customerId),handoff.identity)||this.#clock()>=handoff.validUntil||new Date(this.#clock()).toISOString().slice(0,10)!==handoff.riskDate)throw new Error('Dispatch context changed');
      const response=await this.#gateway.executeCanary(handoff.descriptor.operationKey,this.#transport(handoff.descriptor));status=response.upstream?.status??null;
    }catch{/* Unknown outcome is read back, never blindly replayed. */}
    await this.#store.recordSend(handoff.ticket,status);
    return this.#observe(scope);
  }
  async #observe(scope){const snapshot=await this.#store.observationSnapshot(scope);if(snapshot.projection)return snapshot.projection;const result=await this.#read(snapshot.descriptor,snapshot.identity);return this.#store.observe(snapshot.ticket,result);}
  async reconcile(input={},context={}){return this.#observe(cleanupScope(input,context,'reconcile'));}
}
