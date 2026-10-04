import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
let api={};try{api=await import('../src/naver/searchad/lifecycle/sibling-replan-scope.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND'||!e.message.includes('/sibling-replan-scope.js'))throw e;}
const context=()=>({principal:{principalId:'replan-admin',role:'admin',customerIds:['1001']}});
const input=kind=>({customerId:'1001',hierarchyRunId:randomUUID(),parentObjectId:randomUUID(),activationId:randomUUID(),predecessorPlanId:randomUUID(),confirmation:kind==='keywords'?'REPLAN_EXPIRED_UNUSED_KEYWORD_PLAN':'REPLAN_EXPIRED_UNUSED_CREATIVE_PLAN'});
const failure=e=>e?.code?.startsWith('SEARCHAD_SIBLING_');
test('explicit replan scope validator exists',()=>assert.equal(typeof api.siblingReplanScope,'function'));
for(const kind of ['keywords','creative'])test(`${kind}: copied local scope binds authenticated actor and strips local confirmation`,()=>{
  assert.equal(typeof api.siblingReplanScope,'function');const i=input(kind),c=context(),s=api.siblingReplanScope(i,c,kind),before=structuredClone(s);
  i.predecessorPlanId=randomUUID();c.principal.principalId='changed';assert.deepEqual(s,before);assert.ok(Object.isFrozen(s));
  assert.equal(s.actorPrincipalId,'replan-admin');assert.equal(Object.hasOwn(s,'confirmation'),false);assert.equal(Object.hasOwn(s,'tokenHash'),false);
});
for(const [label,change] of [
 ['remote ID',i=>i.remoteId='victim'],['body',i=>i.body={}],['token',i=>i.executionToken='A'.repeat(43)],['actor',i=>i.actorPrincipalId='spoof'],
 ['kind override',i=>i.kind='creative'],['wrong confirmation',i=>i.confirmation='APPROVE_SEARCHAD_CHANGE'],['missing predecessor',i=>delete i.predecessorPlanId],['bad UUID',i=>i.predecessorPlanId='not-uuid']
])test(`scope rejects ${label}`,()=>{assert.equal(typeof api.siblingReplanScope,'function');const i=input('keywords');change(i);assert.throws(()=>api.siblingReplanScope(i,context(),'keywords'),failure);});
for(const [label,change] of [['Reader',c=>c.principal.role='reader'],['foreign Customer',c=>c.principal.customerIds=['9999']],['missing actor',c=>delete c.principal.principalId]])test(`scope rejects ${label}`,()=>{assert.equal(typeof api.siblingReplanScope,'function');const c=context();change(c);assert.throws(()=>api.siblingReplanScope(input('keywords'),c,'keywords'),failure);});

const mocks={
 'client.js':'export class NaverSearchAdClient {}',
 'gateway.js':'export class SearchAdOperationGateway {}',
 'credential-fingerprint.js':'export const credentialFingerprintForCustomer=()=>"unit-fingerprint";',
 'postgres-sibling-create-repository.js':'export class PostgresSiblingCreateRepository { async prepareReplacement(s,k){globalThis.__replanCalls.push({s,k});return {state:"planned",kind:k};}}',
 'sibling-create-contract.js':'export const siblingScope=()=>{throw new Error("wrong legacy route")};'
};
const h=registerHooks({resolve(s,c,next){const source=c.parentURL?.endsWith('/sibling-create-service.js')?mocks[s.split('/').at(-1)]:null;return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
const {SiblingCreateService}=await import('../src/naver/searchad/lifecycle/sibling-create-service.js');h.deregister();
const service=(enabled)=>new SiblingCreateService({pool:{connect(){},query(){}},registry:{get(){},status(){}},credentialsRegistry:{resolve(){}},config:{baseUrl:'https://api.searchad.naver.com'},dailyBudget:1000,riskUnits:1,dailyCapacityUnits:100,enabled});
for(const [kind,method] of [['keywords','replanKeywords'],['creative','replanCreative']]){
 test(`${method}: service delegates exact scope to repository without calling transport`,async()=>{globalThis.__replanCalls=[];const s=service(true);assert.equal(typeof s[method],'function');const r=await s[method](input(kind),context());assert.equal(r.kind,kind);assert.equal(globalThis.__replanCalls.length,1);assert.equal(globalThis.__replanCalls[0].s.actorPrincipalId,'replan-admin');});
 test(`${method}: service remains default OFF`,async()=>{globalThis.__replanCalls=[];const s=service();assert.equal(typeof s[method],'function');await assert.rejects(s[method](input(kind),context()),e=>e?.code==='SEARCHAD_SIBLING_DISABLED');assert.equal(globalThis.__replanCalls.length,0);});
}
