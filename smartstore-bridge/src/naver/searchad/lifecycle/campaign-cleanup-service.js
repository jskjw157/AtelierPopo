import { createCircuitGuard, prepareLifecycleDispatch, preserveCircuitOutcome } from '../circuit/service.js';
import { isDeepStrictEqual as equal } from 'node:util';
import { NaverSearchAdClient } from '../client.js';
import { PostgresAccountSendFence } from './postgres-account-send-fence.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { campaignResponse, fail, record } from './postgres-campaign-create-repository.js';
import { _internal as observations } from './hierarchy-reconcile-service.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from './operations.js';
import { PostgresCampaignCleanupRepository, cleanupScope } from './postgres-campaign-cleanup-repository.js';
import { rootCleanupMaintenanceScope } from './campaign-cleanup-plan-lifecycle.js';

const ORIGIN='https://api.searchad.naver.com';
/** Internal campaign-only cleanup. It intentionally does not expose live HTTP/bootstrap routes. */
export class CampaignCleanupService {
  #enabled; #config; #registry; #credentials; #clock; #gateway; #store; #sendFence;#circuitGuard;
  constructor({pool,circuitGuard=null,registry,credentialsRegistry,config,enabled=false,dailyBudget,riskUnits,dailyCapacityUnits,planTtlSeconds=300,preflightMaxAgeMs=5000,clock=Date.now,fetchImpl=globalThis.fetch,logger=console}={}) {
    if(typeof pool?.connect!=='function'||typeof pool?.query!=='function'||typeof registry?.get!=='function'||typeof registry?.status!=='function'||typeof credentialsRegistry?.resolve!=='function')throw new TypeError('PostgreSQL and current operation/credential registries are required');
    if(typeof enabled!=='boolean'||typeof clock!=='function'||typeof fetchImpl!=='function'||!record(config)||config.baseUrl!==ORIGIN)throw new TypeError('Explicit gate, clock, transport and fixed official origin required');
    for(const n of [dailyBudget,riskUnits,dailyCapacityUnits])if(!Number.isSafeInteger(n)||n<=0||n>2147483647)throw new TypeError('Bounded positive server limits required');
    if(riskUnits>dailyCapacityUnits||!Number.isSafeInteger(planTtlSeconds)||planTtlSeconds<60||planTtlSeconds>3600||!Number.isSafeInteger(preflightMaxAgeMs)||preflightMaxAgeMs<100||preflightMaxAgeMs>30000)throw new TypeError('Invalid cleanup limits or freshness interval');
    this.#enabled=enabled;this.#config=config;this.#registry=registry;this.#credentials=credentialsRegistry;this.#clock=clock;
    this.#circuitGuard=circuitGuard||createCircuitGuard({pool,clock});this.#sendFence=new PostgresAccountSendFence({pool,fetchImpl});
    const safeFetch=async(url,init)=>{
      if(new URL(url).origin!==ORIGIN)throw new Error('Unexpected cleanup origin');
      const r=await this.#sendFence.fetch(url,{...init,redirect:'error'});
      if(r.redirected||(r.status>=300&&r.status<400))throw new Error('Cleanup redirects forbidden');
      return r;
    };
    const client=new NaverSearchAdClient({baseUrl:ORIGIN,credentialsRegistry,fetchImpl:safeFetch,maxRetries:0,clock,logger});
    this.#gateway=new SearchAdOperationGateway({client,registry,credentialsRegistry,config,logger});
    this.#store=new PostgresCampaignCleanupRepository({pool,dailyBudget,riskUnits,dailyCapacityUnits,planTtlSeconds,preflightMaxAgeMs,clock,
      current:customerId=>this.#identity(customerId),gate:d=>this.#gate(d),confirmation:registry.get(OPS.campaign.delete).confirmation});
  }
  #on(){if(!this.#enabled)fail('SEARCHAD_CAMPAIGN_CLEANUP_DISABLED','Campaign cleanup is disabled.',403);}
  #identity(customerId) {
    try {
      if(this.#config.baseUrl!==ORIGIN)throw new Error();
      for(const [key,method,gate] of [[OPS.campaign.read,'GET','reads'],[OPS.campaign.delete,'DELETE','deletes']]){
        const o=this.#registry.get(key);
        if(o.operationKey!==key||o.method!==method||o.path!=='/ncc/campaigns/{campaignId}'||o.requiredGate!==gate||o.sideEffect!==(method==='DELETE')||o.runtimeAllowlisted!==true||o.state!=='public_documented'||o.tier!=='B'||(method==='DELETE'&&o.destructive!==true))throw new Error();
      }
      const specSha=this.#registry.status().specRef;if(typeof specSha!=='string'||!specSha)throw new Error();
      return {specSha,credentialFingerprint:credentialFingerprintForCustomer(this.#credentials,customerId),upstreamBaseUrl:ORIGIN};
    } catch {fail('SEARCHAD_CAMPAIGN_CLEANUP_CONTEXT','Current pinned cleanup identity is unavailable.',503);}
  }
  #deleteInput(descriptor) {
    const preview=this.#gateway.preview(OPS.campaign.delete,descriptor);
    return {...descriptor,confirmation:preview.requiredConfirmation,secondConfirmation:preview.requiredSecondConfirmation};
  }
  #gate(descriptor) {
    this.#identity(descriptor.customerId);
    this.#gateway.canaryExecutionCheck(this.#registry.get(OPS.campaign.delete),this.#deleteInput(descriptor));
    this.#gateway.executionCheck(this.#registry.get(OPS.campaign.read),{customerId:descriptor.customerId});
  }
  #same(snapshot,customerId) {
    if(!equal(this.#identity(customerId),snapshot.identity))fail('SEARCHAD_CAMPAIGN_CLEANUP_CONTEXT','Identity changed during cleanup.');
  }
  async prepare(input={},context={}) {this.#on();const s=cleanupScope(input,context,'prepare');return this.#store.prepare(s);}
  // Local maintenance never dispatches, approves or guesses a remote target.
  async retire(input={},context={}) {this.#on();return this.#store.retire(rootCleanupMaintenanceScope(input,context,'retire'));}
  async replan(input={},context={}) {this.#on();return this.#store.replan(rootCleanupMaintenanceScope(input,context,'replan'));}
  async execute(input = {}, context = {}) { return preserveCircuitOutcome(this.#circuitGuard, input.customerId, () => this.#execute(input, context)); }
  async #execute(input = {}, context = {}) {
    this.#on();const s=cleanupScope(input,context,'execute');
    const snapshot=await this.#store.executionSnapshot(s);
    let read;
    try {read=await this.#gateway.execute(OPS.campaign.read,snapshot.descriptor);}
    catch {fail('SEARCHAD_CAMPAIGN_CLEANUP_PREFLIGHT','Stored target could not be verified stopped; approval remains unused.');}
    this.#same(snapshot,s.customerId);
    if(!campaignResponse(read,snapshot.expected,false,snapshot.remoteId))fail('SEARCHAD_CAMPAIGN_CLEANUP_PREFLIGHT','Pre-delete response differs from the verified stopped campaign.');
    const handoff=await this.#store.claim(snapshot.ticket);let acknowledged=false;
    try {
      const circuitDispatch = await prepareLifecycleDispatch(this.#circuitGuard, s, handoff.descriptor);
      const r=await this.#sendFence.run(s.customerId,()=>{
        this.#same(handoff,s.customerId);this.#gate(handoff.descriptor);
        if(this.#clock()>=handoff.validUntil||new Date(this.#clock()).toISOString().slice(0,10)!==handoff.riskDate)throw new Error('Handoff expired');
      },()=>this.#gateway.executeCanary(OPS.campaign.delete,this.#deleteInput(handoff.descriptor)), null, { dispatch: circuitDispatch, beforeSend: (client, dispatch) => this.#circuitGuard.assertDispatchAllowed(dispatch, { client, now: this.#clock() }) });
      acknowledged=r.operation?.operationKey===OPS.campaign.delete&&r.operation.sideEffect===true&&[200,204].includes(r.upstream?.status);
    } catch { /* No retry; a transport acknowledgement is never absence proof. */ }
    await this.#store.recordSend(handoff.ticket,acknowledged);
    return this.#observe({customerId:s.customerId,hierarchyRunId:s.hierarchyRunId,hierarchyObjectId:s.hierarchyObjectId,planId:s.planId,actorPrincipalId:s.actorPrincipalId});
  }
  async #observe(s) {
    const snapshot=await this.#store.observationSnapshot(s);if(snapshot.projection)return snapshot.projection;
    let kind;
    try {const r=await this.#gateway.execute(OPS.campaign.read,snapshot.descriptor);kind=campaignResponse(r,snapshot.expected,false,snapshot.remoteId)?'present':'mismatch';}
    catch(e) {kind=observations.isExplicitNotFound(e)?'absent':'unavailable';}
    this.#same(snapshot,s.customerId);
    return this.#store.settle(snapshot.ticket,kind);
  }
  // Observation does not require an unused token, unexpired activation or mutation gate.
  async reconcile(input={},context={}) {this.#on();const s=cleanupScope(input,context,'reconcile');return this.#observe(s);}
}
