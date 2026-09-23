import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../http.js';
import { safeErrorMessage } from '../../security.js';
import { payloadHash } from './canonical.js';
import { toMinorUnits } from './money.js';
import { inTransaction,adsAudit,lockAdsContext } from './storage.js';
const requestSchema=z.object({actionType:z.enum(['launch','pause','resume','change_budget']),draftId:z.string().uuid().optional(),
  targetType:z.enum(['campaign','adset','ad']).optional(),targetId:z.string().regex(/^\d+$/).optional(),
  budgetType:z.enum(['daily','lifetime']).optional(),budgetAmount:z.union([z.string().max(32),z.number().finite()]).optional()}).strict();
const fail=(code,message)=>new AppError(409,code,message);
export function createAdsActions({pool,auth,drafts,mutator,writesEnabled=()=>false}) {
  async function get(actorId,id,db=pool) {
    await auth.owner(actorId);const row=(await db.query('SELECT * FROM meta_ad_action_requests WHERE id=$1 AND requested_by=$2',[id,actorId])).rows[0];
    if(!row)throw new AppError(404,'ADS_ACTION_NOT_FOUND','승인 요청을 찾지 못했습니다.');return row;
  }
  async function list(actorId) {await auth.owner(actorId);return(await pool.query('SELECT * FROM meta_ad_action_requests WHERE requested_by=$1 ORDER BY requested_at DESC LIMIT 100',[actorId])).rows;}
  async function prepare(actorId,input) {
    const parsed=requestSchema.safeParse(input);if(!parsed.success)throw new AppError(400,'ADS_ACTION_INVALID','광고 작업 입력을 확인해 주세요.');
    const value=parsed.data,ctx=await auth.context(actorId),id=randomUUID();let payload,draft=null;
    if(value.actionType==='launch') {
      if(!value.draftId||value.targetId||value.targetType||value.budgetType||value.budgetAmount!==undefined)throw new AppError(400,'ADS_ACTION_INVALID','실행할 초안만 지정해 주세요.');
      draft=await drafts.validateLaunch(actorId,value.draftId);
      payload={actionId:id,actionType:'launch',draftId:draft.id,revision:draft.revision,definition:draft.definition,accountId:ctx.account.external_account_id,generation:ctx.generation};
    }else{
      if(!value.targetId||!value.targetType||value.draftId)throw new AppError(400,'ADS_ACTION_INVALID','변경 대상의 종류와 ID가 필요합니다.');
      const before=await mutator.snapshot(ctx,value.targetType,value.targetId);let change;
      if(value.actionType==='change_budget') {
        if(value.targetType==='ad'||!value.budgetType||value.budgetAmount===undefined)throw new AppError(400,'ADS_BUDGET_INVALID','광고세트 또는 캠페인의 예산을 지정해 주세요.');
        const key=value.budgetType==='daily'?'daily_budget':'lifetime_budget';let amount;
        try {amount=toMinorUnits(value.budgetAmount,ctx.account.currency)}catch(e){throw new AppError(400,'ADS_BUDGET_INVALID',e.message)}
        if(amount<=0||Number(before.target[key])<=0||before.target[key]===null)throw new AppError(400,'ADS_BUDGET_INVALID','기존 예산 방식과 동일한 양수 예산만 변경할 수 있습니다.');
        change={[key]:String(amount)};
      }else{
        if(value.budgetType||value.budgetAmount!==undefined)throw new AppError(400,'ADS_ACTION_INVALID','상태 변경에 예산을 함께 넣을 수 없습니다.');
        change={status:value.actionType==='pause'?'PAUSED':'ACTIVE'};
      }
      payload={actionId:id,actionType:value.actionType,targetType:value.targetType,targetId:value.targetId,before,change,accountId:ctx.account.external_account_id,currency:ctx.account.currency,generation:ctx.generation};
    }
    const summary=payload.actionType==='launch'?{...payload.definition,actionType:'launch',
      maximumAdBudgetMinor:payload.definition.totalSpendLimitMinor??(payload.definition.budgetType==='lifetime'?payload.definition.budgetAmountMinor:null),
      notice:payload.definition.budgetType==='daily'?'일예산은 평균입니다. 일예산×기간은 확정 지출 상한이 아닙니다. 세금·수수료 별도.':'총예산 기준입니다. 세금·수수료 별도.'}:{...payload,notice:'지정한 대상만 변경합니다. 상위·하위 광고의 상태는 자동 변경하지 않습니다.'};
    return inTransaction(pool,async client=>{
      await lockAdsContext(client,actorId,ctx);
      if(draft){const current=(await client.query('SELECT revision,status FROM meta_ad_drafts WHERE id=$1 FOR UPDATE',[draft.id])).rows[0];if(current.revision!==draft.revision||current.status!=='draft')throw fail('ADS_DRAFT_STALE','초안이 변경됐습니다.');}
      await client.query("UPDATE meta_ad_action_requests SET status='expired' WHERE status IN ('pending','approved') AND expires_at<=NOW()");
      const active=(await client.query(`SELECT * FROM meta_ad_action_requests WHERE external_account_id=$1 AND COALESCE(target_local_id,target_external_id)=$2
        AND target_type=$3 AND status IN ('pending','approved','executing','verification_required') FOR UPDATE`,[ctx.account.external_account_id,draft?.id||value.targetId,draft?'draft':value.targetType])).rows[0];
      if(active) {
        const comparable={...payload,actionId:active.canonical_payload.actionId};
        if(payloadHash(comparable)===active.payload_hash)return active;
        throw fail('ADS_ACTION_PENDING','같은 대상의 이전 승인 요청을 먼저 취소하거나 확인해 주세요.');
      }
      const saved=await client.query(`INSERT INTO meta_ad_action_requests(id,action_type,target_type,target_local_id,target_external_id,canonical_payload,payload_hash,summary,
        requested_by,expires_at,external_account_id,connection_generation,draft_revision) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,NOW()+INTERVAL '10 minutes',$10,$11,$12) RETURNING *`,
        [id,value.actionType,draft?'draft':value.targetType,draft?.id||null,value.targetId||null,JSON.stringify(payload),payloadHash(payload),JSON.stringify(summary),actorId,ctx.account.external_account_id,ctx.generation,draft?.revision||null]);
      await adsAudit(client,actorId,'ads.action.prepared',id,{actionType:value.actionType,payloadHash:payloadHash(payload)});return saved.rows[0];
    });
  }
  function check(row,ctx,expectedStatus,hash=row.payload_hash) {
    if(row.status!==expectedStatus||new Date(row.expires_at)<=new Date()||row.executed_at)throw fail('ADS_ACTION_NOT_APPROVED','승인 상태·만료 시각·실행 이력을 확인해 주세요.');
    if(row.external_account_id!==ctx.account.external_account_id||row.connection_generation!==ctx.generation)throw fail('ADS_CONTEXT_CHANGED','승인 당시 계정과 현재 계정이 다릅니다.');
    if(row.payload_hash!==hash||payloadHash(row.canonical_payload)!==hash)throw fail('ADS_APPROVAL_HASH_MISMATCH','승인 내용이 변경됐습니다.');
  }
  async function approve(actorId,id,expectedHash) {
    if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash))throw new AppError(400,'ADS_APPROVAL_HASH_REQUIRED','표시된 승인 내용의 정확한 해시가 필요합니다.');
    const ctx=await auth.context(actorId);
    return inTransaction(pool,async client=>{
      await lockAdsContext(client,actorId,ctx);await client.query('SELECT id FROM meta_ad_action_requests WHERE id=$1 FOR UPDATE',[id]);
      const row=await get(actorId,id,client);check(row,ctx,'pending',expectedHash);
      const saved=await client.query("UPDATE meta_ad_action_requests SET status='approved',approved_by=$2,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[id,actorId]);
      await adsAudit(client,actorId,'ads.action.approved',id,{payloadHash:expectedHash});return saved.rows[0];
    });
  }
  async function execute(actorId,id) {
    if(!writesEnabled())throw fail('ADS_WRITES_DISABLED','서버의 광고 집행 잠금이 켜져 있습니다.');
    const ctx=await auth.context(actorId);
    if(!ctx.scopes.includes('ads_management'))throw fail('ADS_MANAGEMENT_REQUIRED','광고 관리 권한이 필요합니다.');
    const lease=await pool.connect();let locked=false,claimed=false,row;
    try {
      locked=(await lease.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked",['haar-ads:'+ctx.account.external_account_id])).rows[0].locked;
      if(!locked)throw fail('ADS_EXECUTION_BUSY','다른 광고 작업이 진행 중입니다.');
      row=await get(actorId,id);check(row,ctx,'approved');
      const payload=row.canonical_payload;
      if(payload.actionType==='launch') {const draft=await drafts.validateLaunch(actorId,payload.draftId);if(draft.revision!==payload.revision||payloadHash(draft.definition)!==payloadHash(payload.definition))throw fail('ADS_DRAFT_CHANGED','승인 후 초안이 변경됐습니다.');}
      else if(payloadHash(await mutator.snapshot(ctx,payload.targetType,payload.targetId))!==payloadHash(payload.before))throw fail('ADS_PROVIDER_CHANGED','Meta 상태나 예산이 승인 이후 변경됐습니다.');
      await inTransaction(pool,async client=>{
        await lockAdsContext(client,actorId,ctx);
        const uncertain=await client.query("SELECT id FROM meta_ad_action_requests WHERE external_account_id=$1 AND id<>$2 AND status IN ('executing','verification_required') LIMIT 1",[ctx.account.external_account_id,id]);
        if(uncertain.rowCount)throw fail('ADS_RECONCILE_REQUIRED','이 계정의 이전 실행 결과부터 재확인해 주세요.');
        await client.query('SELECT id FROM meta_ad_action_requests WHERE id=$1 FOR UPDATE',[id]);row=await get(actorId,id,client);check(row,ctx,'approved');
        if(payload.actionType==='launch') {
          const d=(await client.query('SELECT * FROM meta_ad_drafts WHERE id=$1 FOR UPDATE',[payload.draftId])).rows[0];
          if(d.status!=='draft'||d.revision!==payload.revision||payloadHash(d.definition)!==payloadHash(payload.definition))throw fail('ADS_DRAFT_CHANGED','초안이 변경됐습니다.');
          await client.query("UPDATE meta_ad_drafts SET status='executing' WHERE id=$1",[payload.draftId]);
        }
        await client.query("UPDATE meta_ad_action_requests SET status='executing',updated_at=NOW() WHERE id=$1",[id]);
        await adsAudit(client,actorId,'ads.action.claimed',id,{payloadHash:row.payload_hash});
      });claimed=true;
      async function checkpoint(stage,ids={}) {
        const current=await auth.context(actorId);
        if(current.generation!==ctx.generation||current.account.external_account_id!==ctx.account.external_account_id)throw fail('ADS_CONTEXT_CHANGED','실행 중 계정이 변경됐습니다.');
        await pool.query("UPDATE meta_ad_action_requests SET external_response=COALESCE(external_response,'{}'::jsonb)||$2::jsonb,updated_at=NOW() WHERE id=$1 AND status='executing'",[id,JSON.stringify({stage,...ids})]);
        if(payload.actionType==='launch')await pool.query(`UPDATE meta_ad_drafts SET external_campaign_id=COALESCE($2,external_campaign_id),external_adset_id=COALESCE($3,external_adset_id),
          external_creative_id=COALESCE($4,external_creative_id),external_ad_id=COALESCE($5,external_ad_id) WHERE id=$1`,[payload.draftId,ids.campaignId||null,ids.adsetId||null,ids.creativeId||null,ids.adId||null]);
      }
      const result=await mutator.execute(payload,ctx,checkpoint);
      await complete(actorId,row,result);return get(actorId,id);
    } catch(error) {
      if(claimed) {
        await pool.query("UPDATE meta_ad_action_requests SET status='verification_required',sanitized_error=$2,updated_at=NOW() WHERE id=$1",[id,safeErrorMessage(error)]);
        if(row?.target_local_id)await pool.query("UPDATE meta_ad_drafts SET status='verification_required',last_error=$2 WHERE id=$1",[row.target_local_id,safeErrorMessage(error)]);
        throw fail('ADS_VERIFICATION_REQUIRED','Meta 실행 결과를 다시 확인해야 합니다. 중복 생성 방지를 위해 재실행을 막았습니다.');
      }
      throw error;
    } finally {if(locked)await lease.query('SELECT pg_advisory_unlock(hashtext($1))',['haar-ads:'+ctx.account.external_account_id]);lease.release();}
  }
  async function complete(actorId,row,result) {
    await inTransaction(pool,async client=>{
      await client.query("UPDATE meta_ad_action_requests SET status='executed',executed_at=NOW(),external_response=COALESCE(external_response,'{}'::jsonb)||$2::jsonb,sanitized_error=NULL,updated_at=NOW() WHERE id=$1",[row.id,JSON.stringify(result)]);
      if(row.target_local_id)await client.query("UPDATE meta_ad_drafts SET status='executed',last_error=NULL,updated_at=NOW() WHERE id=$1",[row.target_local_id]);
      await adsAudit(client,actorId,'ads.action.verified',row.id,{actionType:row.action_type});
    });
  }
  async function reconcile(actorId,id) {
    let row=await get(actorId,id);const ctx=await auth.context(actorId);
    if(!['executing','verification_required'].includes(row.status)||ctx.account.external_account_id!==row.external_account_id)throw fail('ADS_RECONCILE_INVALID','재확인 가능한 요청과 광고 계정을 선택해 주세요.');
    const lease=await pool.connect();let locked=false;
    try{
      locked=(await lease.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',['haar-ads:'+ctx.account.external_account_id])).rows[0].locked;
      if(!locked)throw fail('ADS_EXECUTION_BUSY','실행 중인 작업은 완료 후 재확인해 주세요.');
      row=await get(actorId,id);
      if(!['executing','verification_required'].includes(row.status))throw fail('ADS_RECONCILE_INVALID','요청 상태가 이미 변경됐습니다.');
      if(payloadHash(row.canonical_payload)!==row.payload_hash)throw fail('ADS_APPROVAL_HASH_MISMATCH','승인 내용이 변경됐습니다.');
      const result=await mutator.inspect(row.canonical_payload,ctx,row.external_response||{});
      await complete(actorId,row,result);return get(actorId,id);
    }finally{if(locked)await lease.query('SELECT pg_advisory_unlock(hashtext($1))',['haar-ads:'+ctx.account.external_account_id]);lease.release();}
  }
  async function cancel(actorId,id) {
    await auth.owner(actorId);const result=await pool.query("UPDATE meta_ad_action_requests SET status='cancelled',updated_at=NOW() WHERE id=$1 AND requested_by=$2 AND status IN ('pending','approved') RETURNING *",[id,actorId]);
    if(!result.rowCount)throw fail('ADS_CANCEL_INVALID','실행 전 승인 요청만 취소할 수 있습니다.');await adsAudit(pool,actorId,'ads.action.cancelled',id);return result.rows[0];
  }
  return {get,list,prepare,approve,execute,reconcile,cancel};
}
