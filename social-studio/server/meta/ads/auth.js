import { randomUUID } from 'node:crypto';
import { AppError } from '../../http.js';
import { normalizeActId } from './client.js';
import { adsAudit,inTransaction } from './storage.js';
const readScope = scopes => Array.isArray(scopes) && scopes.some(scope=>['ads_read','ads_management'].includes(scope));
const alive = row => row?.status==='connected' && (!row.token_expires_at || new Date(row.token_expires_at)>new Date());
function accountValues(row) {
  const id=normalizeActId(row.id);
  if(!/^[A-Z]{3}$/.test(row.currency || '')) throw new AppError(502,'ADS_ACCOUNT_RESPONSE_INVALID','광고 계정의 통화를 확인할 수 없습니다.');
  return {id,name:String(row.name||id),currency:row.currency,timezone:row.timezone_name||null,
    status:Number.isInteger(row.account_status)?row.account_status:null,businessId:row.business?.id||null,
    tasks:Array.isArray(row.user_tasks)?row.user_tasks.filter(v=>typeof v==='string'):[]};
}
export function createAdsAuth({pool,graph,encrypt,decrypt,appId}) {
  async function owner(actorId) {
    const {rows}=await pool.query("SELECT id FROM users WHERE id=$1 AND role='owner' AND status='active'",[actorId]);
    if(!rows.length) throw new AppError(403,'ADS_OWNER_REQUIRED','활성 관리자 계정만 광고 관리에 접근할 수 있습니다.');
  }
  async function connection(actorId, required=true) {
    await owner(actorId);
    const {rows}=await pool.query("SELECT * FROM meta_ad_connections WHERE id='primary' AND owner_user_id=$1",[actorId]);
    const row=rows[0];
    if(required && (!alive(row)||!readScope(row.scopes))) throw new AppError(409,'ADS_RECONNECT_REQUIRED','광고 권한으로 Meta 계정을 다시 연결해 주세요.');
    return row || null;
  }
  async function sameGeneration(client,actorId,generation) {
    const {rows}=await client.query("SELECT generation FROM meta_ad_connections WHERE id='primary' AND owner_user_id=$1 FOR UPDATE",[actorId]);
    if(rows[0]?.generation!==generation) throw new AppError(409,'ADS_IDENTITY_CHANGED','연결 정보가 변경됐습니다. 다시 조회해 주세요.');
  }
  async function accounts(actorId) {
    const row=await connection(actorId,false);
    if(!row) return [];
    return (await pool.query(`SELECT id,external_account_id,name,currency,timezone_name,account_status,business_id,user_tasks,selected,last_synced_at
      FROM meta_ad_accounts WHERE connection_generation=$1 AND accessible=TRUE ORDER BY name,external_account_id`,[row.generation])).rows;
  }
  async function status(actorId) {
    const row=await connection(actorId,false), list=await accounts(actorId);
    const scopes=row?.scopes||[];
    return {connected:alive(row),readable:Boolean(alive(row)&&readScope(scopes)),managementGranted:scopes.includes('ads_management'),
      writeCapabilityVerified:false,executionEnabled:false,scopes,tokenExpiresAt:row?.token_expires_at||null,
      lastCheckedAt:row?.last_checked_at||null,selectedAccount:list.find(a=>a.selected)||null,
      status:!row?'disconnected':alive(row)?row.status:'reconnect_required'};
  }
  async function saveCredential(actorId,{accessToken,tokenInfo}) {
    await owner(actorId);
    if(!accessToken || !tokenInfo?.is_valid || tokenInfo.type!=='USER' || String(tokenInfo.app_id)!==String(appId) || !/^\d+$/.test(String(tokenInfo.user_id)))
      throw new AppError(400,'ADS_TOKEN_INVALID','Meta 사용자 토큰의 앱과 유효성을 확인하지 못했습니다.');
    if(!readScope(tokenInfo.scopes)) throw new AppError(403,'ADS_SCOPE_REQUIRED','광고 조회 권한 ads_read 또는 ads_management가 필요합니다.');
    const expiries=[tokenInfo.expires_at,tokenInfo.data_access_expires_at].map(Number).filter(n=>Number.isFinite(n)&&n>0);
    const expiresAt=expiries.length?new Date(Math.min(...expiries)*1000):null;
    if(expiresAt && expiresAt<=new Date()) throw new AppError(400,'ADS_TOKEN_EXPIRED','이미 만료된 Meta 토큰입니다.');
    const generation=randomUUID();
    await inTransaction(pool,async client=>{
      await client.query(`INSERT INTO meta_ad_connections(id,owner_user_id,facebook_user_id,access_token_encrypted,scopes,token_expires_at,status,generation,last_checked_at)
        VALUES('primary',$1,$2,$3,$4::jsonb,$5,'connected',$6,NOW()) ON CONFLICT(id) DO UPDATE SET
        owner_user_id=EXCLUDED.owner_user_id,facebook_user_id=EXCLUDED.facebook_user_id,access_token_encrypted=EXCLUDED.access_token_encrypted,
        scopes=EXCLUDED.scopes,token_expires_at=EXCLUDED.token_expires_at,status='connected',generation=EXCLUDED.generation,last_checked_at=NOW(),updated_at=NOW()`,
        [actorId,String(tokenInfo.user_id),encrypt(accessToken),JSON.stringify(tokenInfo.scopes),expiresAt,generation]);
      await client.query('UPDATE meta_ad_accounts SET selected=FALSE,accessible=FALSE');
      await client.query("UPDATE meta_ad_action_requests SET status='invalidated',updated_at=NOW() WHERE status IN ('pending','approved')");
      await adsAudit(client,actorId,'ads.connected',null,{scopes:tokenInfo.scopes});
    });
    return status(actorId);
  }
  async function providerRead(row,work) {
    try { return await work(decrypt(row.access_token_encrypted)); }
    catch(error) {
      if([10,190,200].includes(Number(error.metaCode))) await pool.query("UPDATE meta_ad_connections SET status='permission_error',updated_at=NOW() WHERE generation=$1",[row.generation]);
      throw error;
    }
  }
  async function discover(actorId) {
    const row=await connection(actorId);
    const inventory=(await providerRead(row,token=>graph.listAccounts(token))).map(accountValues);
    await inTransaction(pool,async client=>{
      await sameGeneration(client,actorId,row.generation);
      await client.query('UPDATE meta_ad_accounts SET accessible=FALSE WHERE connection_generation=$1',[row.generation]);
      for(const item of inventory) await client.query(`INSERT INTO meta_ad_accounts(id,external_account_id,name,currency,timezone_name,account_status,business_id,user_tasks,connection_generation,accessible,last_synced_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,TRUE,NOW()) ON CONFLICT(external_account_id) DO UPDATE SET
        name=EXCLUDED.name,currency=EXCLUDED.currency,timezone_name=EXCLUDED.timezone_name,account_status=EXCLUDED.account_status,
        business_id=EXCLUDED.business_id,user_tasks=EXCLUDED.user_tasks,connection_generation=EXCLUDED.connection_generation,accessible=TRUE,last_synced_at=NOW(),updated_at=NOW()`,
        [randomUUID(),item.id,item.name,item.currency,item.timezone,item.status,item.businessId,JSON.stringify(item.tasks),row.generation]);
      await client.query('UPDATE meta_ad_accounts SET selected=FALSE WHERE accessible=FALSE');
      await client.query("UPDATE meta_ad_action_requests SET status='invalidated' WHERE status IN ('pending','approved') AND external_account_id NOT IN (SELECT external_account_id FROM meta_ad_accounts WHERE accessible=TRUE)");
      await client.query("UPDATE meta_ad_connections SET last_checked_at=NOW() WHERE id='primary'");
      await adsAudit(client,actorId,'ads.accounts.synced',null,{count:inventory.length});
    });
    return accounts(actorId);
  }
  async function select(actorId,accountId) {
    const id=normalizeActId(accountId),row=await connection(actorId);
    if(!(await accounts(actorId)).some(a=>a.external_account_id===id)) throw new AppError(400,'ADS_ACCOUNT_NOT_AVAILABLE','현재 연결에서 확인된 광고 계정을 선택해 주세요.');
    const live=accountValues(await providerRead(row,token=>graph.account(id,token)));
    if(live.id!==id) throw new AppError(502,'ADS_ACCOUNT_RESPONSE_INVALID','Meta 광고 계정 응답이 일치하지 않습니다.');
    await inTransaction(pool,async client=>{
      await sameGeneration(client,actorId,row.generation);
      await client.query('UPDATE meta_ad_accounts SET selected=FALSE');
      const saved=await client.query(`UPDATE meta_ad_accounts SET selected=TRUE,currency=$2,timezone_name=$3,account_status=$4,user_tasks=$5::jsonb,last_synced_at=NOW()
        WHERE external_account_id=$1 AND connection_generation=$6 AND accessible=TRUE`,[id,live.currency,live.timezone,live.status,JSON.stringify(live.tasks),row.generation]);
      if(!saved.rowCount) throw new AppError(409,'ADS_ACCOUNT_NOT_AVAILABLE','선택할 계정을 다시 조회해 주세요.');
      await client.query("UPDATE meta_ad_action_requests SET status='invalidated' WHERE status IN ('pending','approved') AND external_account_id<>$1",[id]);
      await adsAudit(client,actorId,'ads.account.selected',id,{currency:live.currency});
    });
    return (await status(actorId)).selectedAccount;
  }
  async function context(actorId) {
    const row=await connection(actorId),account=(await accounts(actorId)).find(a=>a.selected);
    if(!account) throw new AppError(409,'ADS_ACCOUNT_REQUIRED','운영할 광고 계정을 먼저 선택해 주세요.');
    return {account,generation:row.generation,scopes:row.scopes,read:work=>providerRead(row,work)};
  }
  async function disconnect(actorId) {
    const row=await connection(actorId,false);if(!row)return;
    await inTransaction(pool,async client=>{
      await sameGeneration(client,actorId,row.generation);
      await client.query("DELETE FROM meta_ad_connections WHERE id='primary'");
      await client.query('UPDATE meta_ad_accounts SET selected=FALSE,accessible=FALSE');
      await client.query("UPDATE meta_ad_action_requests SET status='invalidated' WHERE status IN ('pending','approved')");
      await adsAudit(client,actorId,'ads.disconnected');
    });
  }
  return {owner,status,accounts,saveCredential,discover,select,context,disconnect};
}
