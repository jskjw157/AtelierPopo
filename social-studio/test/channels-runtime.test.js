import { describe,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { channelsFixture } from './helpers/channels-fixture.js';
import { testDbUrl } from './helpers/ads-db.js';
import { createChannelRuntime } from '../server/channels/runtime.js';
describe.skipIf(!testDbUrl)('channel runtime with isolated PostgreSQL',()=>{
 it('binds single-use OAuth state to owner/provider, rejects replay and encrypts tokens',async()=>{
  const f=await channelsFixture();try{
   const {url}=await f.service.startOAuth('owner','threads'),state=new URL(url).searchParams.get('state');
   await expect(f.service.finishOAuth('other','threads',{state,code:'test'})).rejects.toMatchObject({code:'CHANNEL_OAUTH_STATE_INVALID'});
   await expect(f.service.finishOAuth('owner','x',{state,code:'test'})).rejects.toMatchObject({code:'CHANNEL_OAUTH_STATE_INVALID'});
   await f.service.finishOAuth('owner','threads',{state,code:'test'});
   await expect(f.service.finishOAuth('owner','threads',{state,code:'test'})).rejects.toMatchObject({code:'CHANNEL_OAUTH_STATE_INVALID'});
   const row=(await f.pool.query('SELECT * FROM channel_connections')).rows[0];expect(row.credentials_encrypted).not.toContain('only-test-access');expect(f.decrypt(row.credentials_encrypted)).toContain('only-test-access');
   expect(JSON.stringify(await f.service.status('owner'))).not.toContain('only-test-access');
  }finally{await f.close();}
 });
 it('rejects expired states and insufficient scopes without saving a connection',async()=>{
  const f=await channelsFixture();try{
   const {url}=await f.service.startOAuth('owner','x'),state=new URL(url).searchParams.get('state');
   await f.pool.query("UPDATE channel_oauth_states SET expires_at=NOW()-INTERVAL '1 second'");
   await expect(f.service.finishOAuth('owner','x',{state,code:'test'})).rejects.toMatchObject({code:'CHANNEL_OAUTH_STATE_INVALID'});
   f.providers.threads.exchange=async()=>({accessToken:'test',accountId:'test',expiresIn:3600,scopes:['threads_basic']});
   await expect(f.connect()).rejects.toMatchObject({code:'CHANNEL_PERMISSION_DENIED'});
   expect((await f.pool.query('SELECT * FROM channel_connections')).rowCount).toBe(0);
  }finally{await f.close();}
 });
 it('deduplicates request IDs, rejects changed content and never repeats a completed dispatch',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect(),input=f.input(g),start=vi.spyOn(f.providers.threads,'start');
   const first=await f.service.createPost('owner',input),again=await f.service.createPost('owner',input);expect(again.duplicate).toBe(true);expect(again.post.id).toBe(first.post.id);
   await expect(f.service.createPost('owner',{...input,caption:'changed'})).rejects.toMatchObject({code:'CHANNEL_REQUEST_CONFLICT'});
   expect((await f.service.processPost('owner',first.post.id)).state).toBe('published');
   expect((await f.service.processPost('owner',first.post.id)).alreadyHandled).toBe(true);expect(start).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
 });
 it('serializes concurrent workers before any provider call',async()=>{
  const f=await channelsFixture();let unblock;try{
   const g=await f.connect(),post=(await f.service.createPost('owner',f.input(g))).post;
   let started;const ready=new Promise(r=>started=r),hold=new Promise(r=>unblock=r);
   const start=vi.fn(async()=>{started();await hold;return {state:'published',externalId:'one'};});f.providers.threads.start=start;
   const first=f.service.processPost('owner',post.id);await ready;
   await expect(f.service.processPost('owner',post.id)).rejects.toMatchObject({code:'CHANNEL_BUSY'});unblock();await first;expect(start).toHaveBeenCalledTimes(1);
  }finally{unblock?.();await f.close();}
 });
 it('keeps ambiguous network outcomes terminal and never resends through cron',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect(),post=(await f.service.createPost('owner',f.input(g))).post;
   f.providers.threads.start=vi.fn(async()=>{throw new Error('secret-provider-token');});
   const r=await f.service.processPost('owner',post.id);expect(r).toEqual({state:'uncertain',errorCode:'CHANNEL_OUTCOME_UNKNOWN'});
   await f.service.processPost('owner',post.id);await f.service.runDue();expect(f.providers.threads.start).toHaveBeenCalledTimes(1);
   expect(JSON.stringify(await f.service.posts('owner'))).not.toContain('secret-provider-token');
  }finally{await f.close();}
 });
 it('preserves a Threads checkpoint and forbids re-publish after unknown final response',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect(),post=(await f.service.createPost('owner',f.input(g))).post;
   f.providers.threads.start=async({checkpoint})=>{await checkpoint({publishRequested:false},'container');return {state:'processing',providerRef:'container'};};
   await f.service.processPost('owner',post.id);
   f.providers.threads.resume=vi.fn(async({checkpoint})=>{await checkpoint({publishRequested:true});throw new Error('timeout');});
   expect((await f.service.processPost('owner',post.id,true)).state).toBe('uncertain');
   await f.service.processPost('owner',post.id,true);expect(f.providers.threads.resume).toHaveBeenCalledTimes(1);
   expect((await f.pool.query('SELECT checkpoint FROM channel_posts')).rows[0].checkpoint.publishRequested).toBe(true);
  }finally{await f.close();}
 });
 it('rejects changed account generation and owner access, cancels unsent work on disconnect',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect(),post=(await f.service.createPost('owner',f.input(g))).post;
   await expect(f.service.processPost('other',post.id)).rejects.toMatchObject({code:'CHANNEL_POST_NOT_FOUND'});
   await f.connect();expect((await f.service.processPost('owner',post.id)).errorCode).toBe('CHANNEL_ACCOUNT_CHANGED');
   const current=(await f.service.status('owner')).channels[0].connection.generation;
   await f.service.createPost('owner',f.input(current));await f.service.disconnect('owner','threads');
   expect((await f.service.posts('owner')).posts.some(p=>p.state==='cancelled')).toBe(true);
   await f.pool.query("UPDATE users SET status='disabled' WHERE id='owner'");await expect(f.service.status('owner')).rejects.toMatchObject({code:'CHANNEL_OWNER_REQUIRED'});
  }finally{await f.close();}
 });
 it('gates write/billing permissions, allows local drafts and honors schedule',async()=>{
  const f=await channelsFixture();try{
   f.settings.x.billingApproved=false;await expect(f.service.startOAuth('owner','x')).rejects.toMatchObject({code:'CHANNEL_BILLING_APPROVAL_REQUIRED'});
   const g=await f.connect();f.settings.threads.writesEnabled=false;
   await expect(f.service.createPost('owner',f.input(g))).rejects.toMatchObject({code:'CHANNEL_WRITES_DISABLED'});
   expect((await f.service.createPost('owner',{...f.input(g),mode:'draft'})).post.state).toBe('draft');
   f.settings.threads.writesEnabled=true;
   const post=(await f.service.createPost('owner',{...f.input(g),mode:'schedule',scheduledAt:new Date(Date.now()+120000).toISOString()})).post;
   const start=vi.spyOn(f.providers.threads,'start');expect((await f.service.runDue()).checked).toBe(0);
   await f.pool.query("UPDATE channel_posts SET scheduled_at=NOW()-INTERVAL '1 second' WHERE id=$1",[post.id]);
   await f.service.runDue();expect(start).toHaveBeenCalledTimes(1);await f.service.runDue();expect(start).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
 });
 it('refreshes and encrypts rotated credentials before a scheduled dispatch',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect('x'),post=(await f.service.createPost('owner',f.input(g,'x'))).post;
   await f.pool.query("UPDATE channel_connections SET expires_at=NOW()-INTERVAL '1 second'");
   expect((await f.service.status('owner')).channels.find(c=>c.platform==='x').connection.status).toBe('refresh_available');
   const start=vi.spyOn(f.providers.x,'start');await f.service.processPost('owner',post.id);
   expect(start.mock.calls[0][0].credentials.refreshToken).toBe('rotated-refresh');
   const c=(await f.pool.query('SELECT credentials_encrypted FROM channel_connections')).rows[0];expect(c.credentials_encrypted).not.toContain('rotated-refresh');expect(f.decrypt(c.credentials_encrypted)).toContain('rotated-refresh');
  }finally{await f.close();}
 });
 it('never interprets TikTok inbox delivery as published',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect('tiktok'),asset=randomUUID();
   await f.pool.query("INSERT INTO media_assets(id,file_name,original_name,mime_type,media_type,bytes,checksum) VALUES($1,'test.mp4','test.mp4','video/mp4','video',4,'test')",[asset]);
   f.providers.tiktok.start=async()=>({state:'processing',providerRef:'inbox'});
   const post=(await f.service.createPost('owner',{...f.input(g,'tiktok'),format:'video',mediaAssetIds:[asset]})).post;
   await f.service.processPost('owner',post.id);await f.service.processPost('owner',post.id,true);
   expect((await f.service.posts('owner')).posts[0].state).toBe('awaiting_user');expect((await f.service.posts('owner')).posts[0].external_post_id).toBe(null);
  }finally{await f.close();}
 });
 it('keeps a known persisted publish result when a later audit insert fails',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect(),post=(await f.service.createPost('owner',f.input(g))).post;
   const service=createChannelRuntime({pool:{query:(...args)=>f.pool.query(...args),connect:async()=>{
    const client=await f.pool.connect();return {query:(sql,params)=>String(sql).includes('INSERT INTO audit_logs')?Promise.reject(new Error('audit unavailable')):client.query(sql,params),release:()=>client.release()};
   }},settings:f.settings,providers:f.providers,encrypt:f.encrypt,decrypt:f.decrypt,mediaUrl:()=>'',readMedia:async()=>Buffer.from('test')});
   const r=await service.processPost('owner',post.id);expect(r).toMatchObject({state:'published',historyWarning:true});
   const row=(await f.service.posts('owner')).posts[0];expect(row.state).toBe('published');expect(row.external_post_id).toBe('external');
  }finally{vi.restoreAllMocks();await f.close();}
 });
 it('returns the original scheduled request after its due time passes',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect(),now=Date.now(),input={...f.input(g),mode:'schedule',scheduledAt:new Date(now+120000).toISOString()};
   const first=await f.service.createPost('owner',input);
   vi.spyOn(Date,'now').mockReturnValue(now+180000);
   const again=await f.service.createPost('owner',input);expect(again.duplicate).toBe(true);expect(again.post.id).toBe(first.post.id);
   await expect(f.service.createPost('owner',{...input,clientRequestId:randomUUID()})).rejects.toMatchObject({code:'CHANNEL_SCHEDULE_INVALID'});
  }finally{vi.restoreAllMocks();await f.close();}
 });
 it('retries only safe status reads after transient errors without repeating an upload',async()=>{
  const f=await channelsFixture();try{
   const g=await f.connect(),post=(await f.service.createPost('owner',f.input(g))).post;
   f.providers.threads.start=vi.fn(async({checkpoint})=>{await checkpoint({publishRequested:false},'container');return {state:'processing',providerRef:'container'};});
   f.providers.threads.resume=vi.fn().mockRejectedValueOnce(Object.assign(new Error('rate limit'),{code:'CHANNEL_RATE_LIMITED'})).mockResolvedValueOnce({state:'published',externalId:'final'});
   await f.service.processPost('owner',post.id);
   expect((await f.service.processPost('owner',post.id,true)).state).toBe('processing');
   await f.service.runDue();expect(f.providers.threads.start).toHaveBeenCalledTimes(1);expect(f.providers.threads.resume).toHaveBeenCalledTimes(2);expect((await f.service.posts('owner')).posts[0].state).toBe('published');
  }finally{await f.close();}
 });
});
