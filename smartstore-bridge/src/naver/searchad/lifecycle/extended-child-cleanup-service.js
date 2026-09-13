import { isDeepStrictEqual as equal } from 'node:util';
import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { SearchAdError } from '../errors.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { createHierarchyCampaignRecipe } from './recipe-campaign.js';
import { createHierarchyChildRecipe } from './recipe-hierarchy.js';
import { cleanupScope } from './child-first-cleanup-contract.js';
import { PostgresExtendedChildCleanupRepository } from './postgres-extended-child-cleanup-repository.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';

const ORIGIN='https://api.searchad.naver.com';
const SHAPES={
  campaign:{path:'/ncc/campaigns/{campaignId}',param:'campaignId'},
  adgroup:{path:'/ncc/adgroups/{adgroupId}',param:'adgroupId'},
  keyword:{path:'/ncc/keywords/{nccKeywordId}',param:'nccKeywordId'},
  creative:{path:'/ncc/ads/{adId}',param:'adId'}
};
const fail=(code,message,status=409)=>{const error=new Error(message);error.code=`SEARCHAD_EXTENDED_CLEANUP_${code}`;error.status=status;throw error;};

export class ExtendedChildCleanupService {
  #enabled;#registry;#credentials;#config;#clock;#gateway;#store;
  constructor({pool,registry,credentialsRegistry,config,enabled=false,dailyBudget,riskUnits,dailyCapacityUnits,planTtlSeconds=300,preflightMaxAgeMs=5000,clock=Date.now,fetchImpl=globalThis.fetch,logger=console}={}){
    if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||typeof registry?.get!=='function'||typeof registry?.status!=='function'||typeof credentialsRegistry?.resolve!=='function')throw new TypeError('Actual PostgreSQL, registry and credentials are required');
    if(typeof enabled!=='boolean'||typeof clock!=='function'||typeof fetchImpl!=='function'||config?.baseUrl!==ORIGIN)throw new TypeError('Explicit gate, clock, transport and official origin are required');
    for(const value of [dailyBudget,riskUnits,dailyCapacityUnits])if(!Number.isSafeInteger(value)||value<=0||value>2147483647)throw new TypeError('Positive bounded server policy is required');
    if(riskUnits>dailyCapacityUnits||!Number.isSafeInteger(planTtlSeconds)||planTtlSeconds<60||planTtlSeconds>3600||!Number.isSafeInteger(preflightMaxAgeMs)||preflightMaxAgeMs<100||preflightMaxAgeMs>30000)throw new TypeError('Invalid risk, TTL or freshness policy');
    this.#enabled=enabled;this.#registry=registry;this.#credentials=credentialsRegistry;this.#config=config;this.#clock=clock;
    const safeFetch=async(url,init)=>{if(new URL(url).origin!==ORIGIN)throw new Error('Unexpected cleanup origin');const response=await fetchImpl(url,{...init,redirect:'error'});if(response.redirected||(response.status>=300&&response.status<400))throw new Error('Cleanup redirects are forbidden');return response;};
    const client=new NaverSearchAdClient({baseUrl:ORIGIN,credentialsRegistry,fetchImpl:safeFetch,maxRetries:0,clock,logger});
    this.#gateway=new SearchAdOperationGateway({client,registry,credentialsRegistry,config,logger});
    this.#store=new PostgresExtendedChildCleanupRepository({pool,rootRecipe:createHierarchyCampaignRecipe({dailyBudget}),childRecipe:createHierarchyChildRecipe(),dailyBudget,current:customerId=>this.#identity(customerId),gate:descriptor=>this.#gate(descriptor),confirmation:type=>registry.get(OPS[type].delete).confirmation,clock,planTtlSeconds,preflightMaxAgeMs,riskUnits,dailyCapacityUnits});
  }
  #on(){if(!this.#enabled)fail('DISABLED','Extended child-first deletion is disabled.',403);}
  #identity(customerId){
    try{
      if(this.#config.baseUrl!==ORIGIN)throw new Error('origin');
      for(const [type,shape] of Object.entries(SHAPES))for(const [kind,method,gate] of [['read','GET','reads'],['delete','DELETE','deletes']]){
        const operation=this.#registry.get(OPS[type][kind]);
        if(operation.operationKey!==OPS[type][kind]||operation.method!==method||operation.path!==shape.path||operation.sideEffect!==(kind==='delete')||operation.requiredGate!==gate||operation.runtimeAllowlisted!==true||operation.state!=='public_documented'||operation.tier!=='B'||(kind==='delete'&&(!operation.destructive||!operation.confirmation)))throw new Error('operation');
      }
      const specSha=this.#registry.status().specRef;if(typeof specSha!=='string'||!specSha)throw new Error('spec');
      return {specSha,credentialFingerprint:credentialFingerprintForCustomer(this.#credentials,customerId),upstreamBaseUrl:ORIGIN};
    }catch{fail('CONTEXT','Current operation or credential identity is unavailable.',503);}
  }
  #transport(descriptor){return {...descriptor,confirmation:this.#registry.get(descriptor.operationKey).confirmation,secondConfirmation:this.#gateway.preview(descriptor.operationKey,descriptor).resourceKey};}
  #gate(descriptor){this.#identity(descriptor.customerId);this.#gateway.canaryExecutionCheck(this.#registry.get(descriptor.operationKey),this.#transport(descriptor));for(const type of Object.keys(SHAPES))this.#gateway.executionCheck(this.#registry.get(OPS[type].read),{customerId:descriptor.customerId,pathParams:{[SHAPES[type].param]:'probe'}});}
  async #read(descriptor,identity){
    if(!equal(this.#identity(descriptor.customerId),identity))fail('CONTEXT','Identity changed before read.');
    this.#gateway.executionCheck(this.#registry.get(descriptor.operationKey),descriptor);
    let observation;
    try{observation={kind:'present',result:await this.#gateway.execute(descriptor.operationKey,descriptor)};}
    catch(error){const absent=error instanceof SearchAdError&&error.status===404&&error.upstreamStatus===404&&error.retryable===false&&typeof error.code==='string'&&error.code.startsWith('SEARCHAD_UPSTREAM_');observation={kind:absent?'absent':'unavailable'};}
    if(!equal(this.#identity(descriptor.customerId),identity))fail('CONTEXT','Identity changed during read.');
    return observation;
  }
  async prepare(input={},context={}){this.#on();return this.#store.prepare(cleanupScope(input,context,'prepare'));}
  async execute(input={},context={}){
    this.#on();const scope=cleanupScope(input,context,'execute'),snapshot=await this.#store.executionSnapshot(scope),observations=[];
    for(const read of snapshot.reads)observations.push(await this.#read(read.descriptor,snapshot.identity));
    const handoff=await this.#store.claim(snapshot.ticket,observations);let status=null;
    try{this.#gate(handoff.descriptor);if(!equal(this.#identity(scope.customerId),handoff.identity)||this.#clock()>=handoff.validUntil||new Date(this.#clock()).toISOString().slice(0,10)!==handoff.riskDate)throw new Error('Dispatch context changed');const response=await this.#gateway.executeCanary(handoff.descriptor.operationKey,this.#transport(handoff.descriptor));status=response.upstream?.status??null;}catch{/* Ambiguous mutation is observed, never blindly replayed. */}
    await this.#store.recordSend(handoff.ticket,status);
    return this.#observe(scope);
  }
  async #observe(scope){const snapshot=await this.#store.observationSnapshot(scope);if(snapshot.projection)return snapshot.projection;const result=await this.#read(snapshot.descriptor,snapshot.identity);return this.#store.observe(snapshot.ticket,result);}
  async reconcile(input={},context={}){return this.#observe(cleanupScope(input,context,'reconcile'));}
}
