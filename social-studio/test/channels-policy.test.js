import { expect,it } from 'vitest';
import { channelConfig,validatePost,requireWrites,definitions } from '../server/channels/policy.js';
const id='11111111-1111-4111-8111-111111111111';
const post={clientRequestId:id,platform:'threads',format:'text',caption:'hello',mode:'draft',consent:true,mediaAssetIds:[]};
it('defaults every connection and write switch off without changing Meta config',()=>{
 const settings=channelConfig({},'https://test.invalid');
 for(const s of Object.values(settings)){expect(s.connectEnabled).toBe(false);expect(s.writesEnabled).toBe(false);expect(()=>requireWrites(s)).toThrow();}
 expect(settings.x.billingApproved).toBe(false);expect(definitions.tiktok.scopes).toContain('video.upload');expect(definitions.tiktok.scopes).not.toContain('video.publish');
});
it('validates text limits, media shape, consent and explicit one-shot schedule',()=>{
 expect(validatePost(post).scheduledAt).toBe(null);
 for(const patch of [{consent:false},{caption:'a'.repeat(501)},{format:'image'},{mediaAssetIds:[id]},{mode:'schedule',scheduledAt:new Date().toISOString()},{platform:'instagram'},{recurrence:'daily'}]) expect(()=>validatePost({...post,...patch})).toThrow();
 expect(validatePost({...post,platform:'x',caption:'한'.repeat(140)}).platform).toBe('x');
 expect(()=>validatePost({...post,platform:'x',caption:'한'.repeat(141)})).toThrow();
 expect(()=>validatePost({...post,platform:'tiktok',format:'text'})).toThrow();
});
