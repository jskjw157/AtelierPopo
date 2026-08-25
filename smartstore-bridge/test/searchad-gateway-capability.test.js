import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { SearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { SearchAdCapabilityService } from '../src/naver/searchad/capability.js';

function setup({ allowWrites = false } = {}) {
  const operations = [
    { operationKey:'ncc.get.list', sourceId:'ncc', sourceOperationId:'list', method:'GET', path:'/ncc/campaigns', rawPath:'/api/ncc/campaigns', domain:'campaign', tags:['Campaign'], summary:'list', action:'read', sideEffect:false, destructive:false, batch:false, risk:'low', state:'public_documented', tier:'B', runtimeAllowlisted:true, requiredGate:'reads', confirmation:null, capabilityKey:'campaign.read', parameters:[], specRef:'x' },
    { operationKey:'ncc.post.create', sourceId:'ncc', sourceOperationId:'create', method:'POST', path:'/ncc/campaigns', rawPath:'/api/ncc/campaigns', domain:'campaign', tags:['Campaign'], summary:'create', action:'create', sideEffect:true, destructive:false, batch:false, risk:'high', state:'public_documented', tier:'B', runtimeAllowlisted:true, requiredGate:'creates', confirmation:'CREATE_AD_ENTITY', capabilityKey:'campaign.create', parameters:[], specRef:'x' },
    { operationKey:'ncc.delete.remove', sourceId:'ncc', sourceOperationId:'remove', method:'DELETE', path:'/ncc/campaigns/{campaignId}', rawPath:'/api/ncc/campaigns/{campaignId}', domain:'campaign', tags:['Campaign'], summary:'delete', action:'delete', sideEffect:true, destructive:true, batch:false, risk:'critical', state:'public_documented', tier:'B', runtimeAllowlisted:true, requiredGate:'deletes', confirmation:'DELETE_AD_ENTITY', capabilityKey:'campaign.delete', parameters:[{name:'campaignId',in:'path',required:true}], specRef:'x' }
  ];
  const manifest = { specRef:'x', generatedAt:'now', baseUrl:'https://api.searchad.naver.com', sources:[{}], counts:{}, operations };
  const registry = new SearchAdSpecRegistry(manifest);
  const credentials = new SearchAdCredentialsRegistry({ principals:[{principalId:'p',accessLicense:'a',secretKey:'s',status:'active'}], customers:[{customerId:'1001',status:'active'}], grants:[{principalId:'p',customerId:'1001',role:'operator'}] });
  const calls=[];
  const client={ request: async input => { calls.push(input); return {status:200,data:[],requestId:'r',attempts:1,durationMs:1,headers:{}}; } };
  const config={ enabled:true, configured:true, allowReads:true, allowWrites, allowCreates:allowWrites, allowBatchWrites:false, allowDeletes:allowWrites, allowRollbacks:false, allowUnverifiedOperations:false, allowActiveCanary:false, automationMode:'observe', passiveProbeLimit:10 };
  const gateway=new SearchAdOperationGateway({client,config,registry,credentialsRegistry:credentials,logger:{}});
  return {gateway,calls,config};
}

test('SearchAd gateway blocks writes until gates and exact confirmations are enabled', async () => {
  const disabled=setup();
  assert.throws(() => disabled.gateway.executionCheck(disabled.gateway.get('ncc.post.create'), {customerId:'1001',confirmation:'CREATE_AD_ENTITY'}), /gate creates is disabled/i);
  const enabled=setup({allowWrites:true});
  await enabled.gateway.execute('ncc.post.create',{customerId:'1001',confirmation:'CREATE_AD_ENTITY',body:{name:'x'}});
  assert.equal(enabled.calls[0].method,'POST');
  const preview=enabled.gateway.preview('ncc.delete.remove',{customerId:'1001',pathParams:{campaignId:'cmp1'}});
  assert.equal(preview.requiredSecondConfirmation,'searchad:1001:campaign:cmp1');
  await assert.rejects(() => enabled.gateway.execute('ncc.delete.remove',{customerId:'1001',pathParams:{campaignId:'cmp1'},confirmation:'DELETE_AD_ENTITY',secondConfirmation:'wrong'}), /secondConfirmation/);
});

test('Passive capability probe executes read-only operations and records no-data evidence', async () => {
  const {gateway}=setup();
  const service=new SearchAdCapabilityService({gateway,config:gateway.config,clock:()=>new Date('2026-08-25T00:00:00Z')});
  const result=await service.runPassive({customerId:'1001',operations:['ncc.get.list']});
  assert.equal(result.summary.supported,1);
  assert.equal(result.results[0].state,'supported_no_data');
  assert.equal(result.results[0].evidence,'live_passive');
});
