import { expect,it,vi } from 'vitest';
import { createProviders } from '../server/channels/providers.js';
import { createProviderHttp } from '../server/channels/http.js';
const token='test-only-secret';
it('uses the current Threads host and persists publish intent before a single publish',async()=>{
 const calls=[]; const request=vi.fn(async(url,options)=>{calls.push([url,options]);return url.includes('threads_publish')?{id:'published'}:url.includes('fields=status')?{status:'FINISHED'}:{permalink:'https://www.threads.com/@test/post/example'};});
 const provider=createProviders(request).threads;
 const ctx={post:{account_id:'account',provider_ref:'container',checkpoint:{publishRequested:false}},credentials:{accessToken:token},checkpoint:vi.fn(async value=>{calls.push(['checkpoint',value]);})};
 expect((await provider.resume(ctx)).state).toBe('published');
 expect(calls[1][0]).toBe('checkpoint');expect(calls[1][1].publishRequested).toBe(true);
 ctx.post.checkpoint.publishRequested=true;
 await expect(provider.resume(ctx)).rejects.toMatchObject({code:'CHANNEL_OUTCOME_UNKNOWN'});
 expect(calls.filter(c=>c[0].includes('threads_publish'))).toHaveLength(1);
});
it('leaves a Threads processing container pending and never publishes it early',async()=>{
 const req=vi.fn(async()=>({status:'IN_PROGRESS'}));
 expect((await createProviders(req).threads.resume({post:{provider_ref:'container',checkpoint:{}},credentials:{accessToken:token}})).state).toBe('processing');expect(req).toHaveBeenCalledTimes(1);
});
it('waits for every carousel child, then checkpoints a single parent container creation',async()=>{
 const req=vi.fn().mockResolvedValueOnce({status:'IN_PROGRESS'}).mockResolvedValueOnce({status:'FINISHED'}).mockResolvedValueOnce({status:'FINISHED'}).mockResolvedValueOnce({id:'parent'});
 const ctx={post:{provider_ref:'child1',account_id:'account',caption:'carousel',checkpoint:{phase:'children',childIds:['child1','child2'],parentRequested:false}},credentials:{accessToken:token}};
 ctx.checkpoint=vi.fn(async(value,ref)=>{ctx.post.checkpoint=value;if(ref)ctx.post.provider_ref=ref;});
 const provider=createProviders(req).threads;
 expect((await provider.resume(ctx)).state).toBe('processing');expect(ctx.checkpoint).not.toHaveBeenCalled();
 expect((await provider.resume(ctx)).providerRef).toBe('parent');
 expect(req.mock.calls[3][1].form.children).toBe('child1,child2');expect(ctx.checkpoint.mock.calls[0][0].parentRequested).toBe(true);expect(ctx.post.checkpoint.publishRequested).toBe(false);
});
it('uploads X image bytes through v2 before creating the post',async()=>{
 const req=vi.fn().mockResolvedValueOnce({data:{id:'image'}}).mockResolvedValueOnce({data:{id:'post'}});
 const r=await createProviders(req).x.start({post:{caption:'hello'},credentials:{accessToken:token},assets:[{id:'asset'}],readMedia:async()=>Buffer.from('image')});
 expect(req.mock.calls[0][0]).toBe('https://api.x.com/2/media/upload');expect(req.mock.calls[0][1].body.media_category).toBe('tweet_image');
 expect(req.mock.calls[1][1].body).toEqual({text:'hello',media:{media_ids:['image']}});expect(r.state).toBe('published');
});
it('requests X S256 PKCE and offline scopes, exchanges with confidential-client auth',async()=>{
 const req=vi.fn().mockResolvedValueOnce({access_token:token,scope:'tweet.read tweet.write users.read offline.access media.write',expires_in:7200,refresh_token:'refresh'}).mockResolvedValueOnce({data:{id:'owner',username:'test'}});
 const x=createProviders(req).x,s={clientId:'client',clientSecret:'secret',redirectUri:'https://app.invalid/api/channels/x/callback'};
 const url=new URL(x.authorize(s,'state','challenge'));expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('scope')).toContain('offline.access');
 const r=await x.exchange(s,'code','verifier');expect(req.mock.calls[0][1].form.code_verifier).toBe('verifier');expect(req.mock.calls[0][1].basic).toBe('client:secret');expect(r.refreshToken).toBe('refresh');
});
it('TikTok sends only an inbox upload from a verified origin and never reports published',async()=>{
 const req=vi.fn().mockResolvedValueOnce({data:{publish_id:'inbox'}}).mockResolvedValueOnce({data:{status:'SEND_TO_USER_INBOX'}});
 const tiktok=createProviders(req).tiktok;
 const ctx={post:{provider_ref:'inbox'},credentials:{accessToken:token},assets:[{}],mediaUrl:()=> 'https://media.invalid/public-media/test?sig=not-a-real-signature',settings:{verifiedOrigin:'https://media.invalid'}};
 expect((await tiktok.start(ctx)).state).toBe('processing');expect(req.mock.calls[0][0]).toContain('/inbox/video/init/');
 expect((await tiktok.resume(ctx)).state).toBe('awaiting_user');
 await expect(tiktok.start({...ctx,settings:{verifiedOrigin:''}})).rejects.toMatchObject({code:'CHANNEL_MEDIA_ORIGIN_UNVERIFIED'});
 expect(req).toHaveBeenCalledTimes(2);
});
it('rotates TikTok refresh credentials and rejects an account change',async()=>{
 const req=vi.fn(async()=>({open_id:'new-user',access_token:token,refresh_token:'rotated',expires_in:3600,scope:'user.info.basic,video.upload'}));
 await expect(createProviders(req).tiktok.refresh({},{refreshToken:'old',accountId:'old-user'})).rejects.toMatchObject({code:'CHANNEL_ACCOUNT_MISMATCH'});
});
it.each([401,403,402,429,500])('sanitizes provider failure %s without leaking upstream secrets',async(status)=>{
 const http=createProviderHttp(async()=>({ok:false,status,json:async()=>({error:{code:status,message:token},request_url:'https://api.invalid/?token='+token})}));
 let caught;try{await http('https://api.invalid/',{token});}catch(e){caught=e;}
 expect(caught.code).toMatch(/^CHANNEL_/);expect(JSON.stringify(caught)+caught.message).not.toContain(token);
 if(status===500)expect(caught.code).toBe('CHANNEL_PROVIDER_UNAVAILABLE');
});
it('marks a transport timeout uncertain and performs no automatic retry',async()=>{
 const fetcher=vi.fn(async()=>{throw new Error(token);});
 await expect(createProviderHttp(fetcher)('https://api.invalid',{method:'POST',body:{text:'content'}})).rejects.toMatchObject({code:'CHANNEL_OUTCOME_UNKNOWN'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
