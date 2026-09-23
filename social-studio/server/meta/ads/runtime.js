import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {AppError} from '../../http.js';
import {createAdsAuth} from './auth.js';
import {createAdsClient} from './client.js';
import {createAdsDrafts} from './drafts.js';
import {createAdsInsights} from './insights.js';
import {createAdsActions} from './actions.js';
import {createAdsMutator} from './mutations.js';

export async function loadAdImage({pool,uploadDir},creative) {
  const row=(await pool.query('SELECT file_name,bytes,checksum,mime_type,media_type,status FROM media_assets WHERE id=$1',[creative.assetId])).rows[0];
  if(!row||row.status!=='ready'||row.media_type!=='image'||row.mime_type!==creative.mimeType||row.file_name!==path.basename(row.file_name))
    throw new AppError(409,'ADS_IMAGE_UNAVAILABLE','광고 이미지를 안전하게 읽을 수 없습니다.');
  let bytes;
  try {
    const base=await fs.realpath(uploadDir),file=await fs.realpath(path.join(base,row.file_name));
    if(path.dirname(file)!==base)throw new Error('invalid path');
    const stat=await fs.stat(file);
    if(!stat.isFile()||stat.size>20*1024*1024||stat.size<=0)throw new Error('invalid file size');
    bytes=await fs.readFile(file);
  }catch {throw new AppError(409,'ADS_IMAGE_UNAVAILABLE','저장된 광고 이미지가 없거나 허용 범위를 벗어났습니다.');}
  if(bytes.length!==Number(row.bytes)||row.checksum!==creative.checksum||createHash('sha256').update(bytes).digest('hex')!==creative.checksum)
    throw new AppError(409,'ADS_IMAGE_CHANGED','승인 후 이미지가 변경됐습니다. 초안을 다시 확인해 주세요.');
  return bytes.toString('base64');
}

export function createAdsRuntime({pool,config,get,post,encrypt,decrypt}) {
  // App-secret proof is computed on the server; it is never included in results.
  const proof=token=>createHmac('sha256',config.meta.appSecret).update(token).digest('hex');
  const safeGet=(p,t,params={})=>get(p,t,{...params,appsecret_proof:proof(t)});
  const safePost=(p,t,params={})=>post(p,t,{...params,appsecret_proof:proof(t)});
  const graph=createAdsClient({get:safeGet});
  const auth=createAdsAuth({pool,graph,encrypt,decrypt,appId:config.meta.appId});
  const drafts=createAdsDrafts({pool,auth,graph});
  const insights=createAdsInsights({pool,auth,graph});
  const mutator=createAdsMutator({get:safeGet,post:safePost,loadImage:creative=>loadAdImage({pool,uploadDir:config.uploadDir},creative)});
  const writesEnabled=()=>config.ads?.allowWrites===true;
  const actions=createAdsActions({pool,auth,drafts,mutator,writesEnabled});
  async function status(actorId) {
    return {...await auth.status(actorId),executionEnabled:writesEnabled(),supportedFormats:['single_image'],
      integrationMode:'read_only',providerWritesLiveVerified:false};
  }
  async function startOAuth(actorId) {
    await auth.owner(actorId);
    if(!config.meta.appId||!config.meta.appSecret||!config.meta.redirectUri)throw new AppError(409,'META_NOT_CONFIGURED','서버의 Meta 앱 설정이 필요합니다.');
    const state=randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO oauth_states(state_hash,user_id,expires_at,purpose) VALUES($1,$2,NOW()+INTERVAL '10 minutes','ads')",[createHash('sha256').update(state).digest('hex'),actorId]);
    const url=new URL(`https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth`);
    for(const [key,value] of Object.entries({client_id:config.meta.appId,redirect_uri:config.meta.redirectUri,state,scope:'ads_read,ads_management',response_type:'code',auth_type:'rerequest'}))url.searchParams.set(key,value);
    return url.toString();
  }
  async function hierarchy(actorId) {
    const ctx=await auth.context(actorId);return {account:ctx.account,...await ctx.read(t=>graph.hierarchy(ctx.account.external_account_id,t))};
  }
  async function tracking(actorId) {const ctx=await auth.context(actorId);return ctx.read(t=>graph.pixels(ctx.account.external_account_id,t));}
  async function testConnection(actorId) {
    await auth.discover(actorId);
    const ctx=await auth.context(actorId);
    await ctx.read(t=>graph.account(ctx.account.external_account_id,t));
    // Read-only preflight checks tasks/status. It is not a claim that Meta accepted a write.
    let writePreflightPassed=false;
    if(ctx.scopes.includes('ads_management')){try{await mutator.preflight(ctx);writePreflightPassed=true;}catch{/* read access can remain usable */}}
    return {...await status(actorId),readTestPassed:true,writePreflightPassed};
  }
  return {auth,graph,drafts,insights,actions,status,startOAuth,hierarchy,tracking,testConnection};
}
