import { afterEach,describe,expect,it } from 'vitest';
import { createAdsActions } from '../server/meta/ads/actions.js';
import { createAdsMutator } from '../server/meta/ads/mutations.js';
import { createAdsDrafts } from '../server/meta/ads/drafts.js';
import { testDbUrl } from './helpers/ads-db.js';
import { adsFixture } from './helpers/ads-fixture.js';
import { seedSource } from './helpers/ads-source.js';
import { metaSimulator } from './helpers/meta-simulator.js';
describe.skipIf(!testDbUrl)('Immutable approval and at-most-once Meta actions',()=>{
 let f,sim,drafts,actions,draft;
 afterEach(async()=>{if(f)await f.close();f=null});
 async function setup(enabled=true,postOverride) {
   f=await adsFixture();sim=metaSimulator();drafts=createAdsDrafts(f);
   const mutator=createAdsMutator({get:sim.get,post:postOverride?((...args)=>postOverride(sim,...args)):sim.post,loadImage:async()=>'test-image-bytes'});
   actions=createAdsActions({...f,drafts,mutator,writesEnabled:()=>enabled});
   draft=await drafts.create('owner',await seedSource(f));
 }
 async function approved(){const a=await actions.prepare('owner',{actionType:'launch',draftId:draft.id});await actions.approve('owner',a.id,a.payload_hash);return a;}
 it('cannot execute pending, expired, hash-mismatched or replayed requests',async()=>{
   await setup();const a=await actions.prepare('owner',{actionType:'launch',draftId:draft.id});
   await expect(actions.execute('owner',a.id)).rejects.toThrow();expect(sim.posts).toHaveLength(0);
   await expect(actions.approve('owner',a.id,'0'.repeat(64))).rejects.toThrow();
   await f.pool.query("UPDATE meta_ad_action_requests SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[a.id]);
   await expect(actions.approve('owner',a.id,a.payload_hash)).rejects.toThrow();expect(sim.posts).toHaveLength(0);
 });
 it('keeps the production write switch fail-closed even after approval',async()=>{
   await setup(false);const a=await approved();await expect(actions.execute('owner',a.id)).rejects.toMatchObject({code:'ADS_WRITES_DISABLED'});expect(sim.posts).toHaveLength(0);
 });
 it('creates a fully paused hierarchy and activates the campaign last',async()=>{
   await setup();const a=await approved();const result=await actions.execute('owner',a.id);
   expect(result.status).toBe('executed');
   const creates=sim.posts.filter(p=>['campaigns','adsets','ads'].some(edge=>p.path.endsWith('/'+edge)));
   expect(creates.every(p=>p.params.status==='PAUSED')).toBe(true);
   expect(sim.posts.at(-1)).toMatchObject({path:'/'+result.external_response.campaignId,params:{status:'ACTIVE'}});
   expect(sim.posts.find(p=>p.path.endsWith('/adcreatives')).params.object_story_spec.link_data.link).toBe(draft.definition.landingUrl);
   const before=sim.posts.length;await expect(actions.execute('owner',a.id)).rejects.toThrow();expect(sim.posts).toHaveLength(before);
 });
 it('does not execute twice under concurrent requests',async()=>{
   await setup();const a=await approved();const result=await Promise.allSettled([actions.execute('owner',a.id),actions.execute('owner',a.id)]);
   expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(sim.posts.filter(p=>p.path.endsWith('/campaigns'))).toHaveLength(1);
 });
 it('stores partial IDs and never activates when a creation step fails',async()=>{
   await setup(true,async(sim,path,...rest)=>{if(path.endsWith('/ads'))throw new Error('provider transport timeout');return sim.post(path,...rest)});
   const a=await approved();await expect(actions.execute('owner',a.id)).rejects.toThrow();
   const saved=await actions.get('owner',a.id);expect(saved.status).toBe('verification_required');expect(saved.external_response.campaignId).toBeTruthy();
   expect(sim.posts.some(p=>p.params.status==='ACTIVE')).toBe(false);
   const count=sim.posts.length;await expect(actions.execute('owner',a.id)).rejects.toThrow();expect(sim.posts).toHaveLength(count);
 });
 it('reconciles a timed-out final activation with reads only, not another POST',async()=>{
   await setup(true,async(sim,path,token,params)=>{const r=await sim.post(path,token,params);if(/^\/\d+$/.test(path)&&params.status==='ACTIVE'&&sim.objects.get(path.slice(1))?.objective)throw new Error('response lost');return r});
   const a=await approved();await expect(actions.execute('owner',a.id)).rejects.toThrow();const n=sim.posts.length;
   const r=await actions.reconcile('owner',a.id);expect(r.status).toBe('executed');expect(sim.posts).toHaveLength(n);
 });
 it('does not inherit approval after editing a draft',async()=>{
   await setup();const a=await approved();await drafts.update('owner',draft.id,{...draft.definition.input,clientRequestId:draft.client_request_id,expectedRevision:1,budgetAmount:'30000'});
   await expect(actions.execute('owner',a.id)).rejects.toThrow();expect(sim.posts).toHaveLength(0);
 });
 it('detects changed provider status before executing a budget or delivery action',async()=>{
   await setup();sim.objects.set('999',{id:'999',account_id:'123',name:'Existing',status:'PAUSED',daily_budget:'20000'});
   const a=await actions.prepare('owner',{actionType:'resume',targetType:'campaign',targetId:'999'});await actions.approve('owner',a.id,a.payload_hash);
   sim.objects.get('999').daily_budget='30000';await expect(actions.execute('owner',a.id)).rejects.toThrow();expect(sim.posts).toHaveLength(0);
 });
 it.each(['pause','resume','change_budget'])('requires independent exact approval for %s',async actionType=>{
   await setup();sim.objects.set('999',{id:'999',account_id:'123',name:'Existing',status:'PAUSED',daily_budget:'20000'});
   const a=await actions.prepare('owner',{actionType,targetType:'campaign',targetId:'999',...(actionType==='change_budget'?{budgetType:'daily',budgetAmount:'30000'}:{})});
   await expect(actions.execute('owner',a.id)).rejects.toThrow();expect(sim.posts).toHaveLength(0);
   await actions.approve('owner',a.id,a.payload_hash);expect((await actions.execute('owner',a.id)).status).toBe('executed');expect(sim.posts).toHaveLength(1);
 });
 it('rejects a target belonging to another account',async()=>{
   await setup();sim.objects.set('999',{id:'999',account_id:'999',status:'PAUSED'});
   await expect(actions.prepare('owner',{actionType:'resume',targetType:'campaign',targetId:'999'})).rejects.toThrow();expect(sim.posts).toHaveLength(0);
 });
 it('requires the explicit hash even when called outside the HTTP adapter',async()=>{
   await setup();const a=await actions.prepare('owner',{actionType:'launch',draftId:draft.id});
   await expect(actions.approve('owner',a.id)).rejects.toMatchObject({code:'ADS_APPROVAL_HASH_REQUIRED'});
   expect((await actions.get('owner',a.id)).status).toBe('pending');
 });
 it.each(['schedule','cap','identity'])('blocks final activation when the provider changes approved %s',async kind=>{
   await setup(true,async(sim,path,token,params)=>{
     const r=await sim.post(path,token,params);
     if(kind==='schedule'&&path.endsWith('/adsets'))sim.objects.get(r.id).end_time=new Date(Date.now()+999*86400000).toISOString();
     if(kind==='cap'&&path.endsWith('/campaigns'))sim.objects.get(r.id).spend_cap='99999999';
     if(kind==='identity'&&path.endsWith('/adcreatives'))sim.objects.get(r.id).object_story_spec.instagram_user_id='999999';
     return r;
   });
   if(kind==='cap')draft=await drafts.update('owner',draft.id,{...draft.definition.input,clientRequestId:draft.client_request_id,expectedRevision:1,budgetType:'daily',totalSpendLimit:'100000'});
   const a=await approved();await expect(actions.execute('owner',a.id)).rejects.toThrow();
   expect(sim.posts.some(p=>/^\/\d+$/.test(p.path)&&p.params.status==='ACTIVE')).toBe(false);
 });
 it('binds campaign activation approval to descendant budgets as well as the parent',async()=>{
   await setup();sim.objects.set('999',{id:'999',account_id:'123',name:'Existing',status:'PAUSED'});
   sim.objects.set('998',{id:'998',account_id:'123',campaign_id:'999',name:'Adset',status:'ACTIVE',daily_budget:'20000'});
   const a=await actions.prepare('owner',{actionType:'resume',targetType:'campaign',targetId:'999'});await actions.approve('owner',a.id,a.payload_hash);
   sim.objects.get('998').daily_budget='900000';
   await expect(actions.execute('owner',a.id)).rejects.toMatchObject({code:'ADS_PROVIDER_CHANGED'});expect(sim.posts).toHaveLength(0);
 });

 it('refuses to reconcile a changed canonical action payload',async()=>{
   await setup(true,async(sim,path,token,params)=>{const r=await sim.post(path,token,params);if(/^\/\d+$/.test(path)&&params.status==='ACTIVE'&&sim.objects.get(path.slice(1))?.objective)throw new Error('response lost');return r});
   const a=await approved();await expect(actions.execute('owner',a.id)).rejects.toThrow();
   await f.pool.query(`UPDATE meta_ad_action_requests SET canonical_payload=canonical_payload||'{"tampered":true}'::jsonb WHERE id=$1`,[a.id]);
   await expect(actions.reconcile('owner',a.id)).rejects.toMatchObject({code:'ADS_APPROVAL_HASH_MISMATCH'});
   expect((await actions.get('owner',a.id)).status).toBe('verification_required');
 });

});
