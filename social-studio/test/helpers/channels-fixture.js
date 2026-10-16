import fs from 'node:fs/promises';
import { randomUUID,createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { testDatabase } from './ads-db.js';
import { createChannelRuntime } from '../../server/channels/runtime.js';
import { channelConfig,definitions } from '../../server/channels/policy.js';
export async function channelsFixture(overrides={}) {
 const db=await testDatabase();
 await db.pool.query(await fs.readFile(new URL('../../server/channels/schema.sql',import.meta.url),'utf8'));
 await db.pool.query("INSERT INTO users(id,email,password_hash) VALUES('owner','owner@test','not-for-login'),('other','other@test','not-for-login')");
 const key=randomBytes(32);
 const encrypt=value=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(value),c.final(),c.getAuthTag()]).toString('base64');};
 const decrypt=value=>{const b=Buffer.from(value,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]).toString();};
 const settings=channelConfig({},'https://app.invalid');
 for(const s of Object.values(settings))Object.assign(s,{clientId:'fake-client',clientSecret:'fake-secret',connectEnabled:true,writesEnabled:true,billingApproved:true});
 const providers=Object.fromEntries(Object.entries(definitions).map(([platform,def])=>[platform,{
  authorize:(settings,state,challenge)=>`https://auth.invalid/?state=${state}&challenge=${challenge}`,
  exchange:async()=>({accessToken:'only-test-access',refreshToken:'only-test-refresh',expiresIn:3600,scopes:def.scopes,accountId:platform+'-user',accountName:'Test '+platform}),
  refresh:async(_s,c)=>({...c,accessToken:'rotated-access',refreshToken:'rotated-refresh',expiresIn:3600}),
  start:async()=>({state:'published',externalId:'external',permalink:'https://example.invalid/post'}),
  resume:async()=>({state:'awaiting_user'})
 }]));
 const service=createChannelRuntime({pool:db.pool,settings,providers,encrypt,decrypt,mediaUrl:()=> 'https://app.invalid/media',readMedia:async()=>Buffer.from('test'),...overrides});
 async function connect(platform='threads',userId='owner') {
  const auth=await service.startOAuth(userId,platform);await service.finishOAuth(userId,platform,{code:'mock-code',state:new URL(auth.url).searchParams.get('state')});
  return (await service.status(userId)).channels.find(c=>c.platform===platform).connection.generation;
 }
 const input=(generation,platform='threads')=>({clientRequestId:randomUUID(),platform,format:'text',caption:'test',mediaAssetIds:[],mode:'publish',consent:true,accountGeneration:generation});
 return {...db,service,settings,providers,connect,input,encrypt,decrypt};
}
