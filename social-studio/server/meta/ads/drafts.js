import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../http.js';
import { toMinorUnits } from './money.js';
import { payloadHash } from './canonical.js';
import { inTransaction,adsAudit,lockAdsContext } from './storage.js';
const text = max => z.string().trim().max(max);
const url = z.union([z.literal(''),z.string().url().refine(value=>{
  const parsed=new URL(value);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password;
},'구매 링크는 자격증명이 없는 HTTPS 주소여야 합니다.')]);
export const draftInputSchema=z.object({
  clientRequestId:z.string().uuid(),sourceType:z.enum(['media','post']),productId:z.string().uuid().nullable().optional().default(null),
  postVariantId:z.string().uuid().nullable().optional().default(null),mediaAssetIds:z.array(z.string().uuid()).max(1).default([]),
  campaignName:text(120).min(1),objective:z.enum(['TRAFFIC','ENGAGEMENT','SALES']),
  landingUrl:url.default(''),primaryText:text(2200).default(''),headline:text(100).default(''),
  callToAction:z.enum(['SHOP_NOW','LEARN_MORE']).default('SHOP_NOW'),
  budgetType:z.enum(['daily','lifetime']),budgetAmount:z.union([z.number().finite(),text(32).min(1)]),
  totalSpendLimit:z.union([z.number().finite(),text(32).min(1),z.null()]).default(null),
  startAt:z.string().datetime({offset:true}),endAt:z.string().datetime({offset:true}),
  countries:z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(10),
  ageMin:z.number().int().min(18).max(65).default(18),ageMax:z.number().int().min(18).max(65).default(65),
  placements:z.array(z.enum(['instagram','facebook'])).min(1).max(2),pixelId:z.string().regex(/^\d+$/).nullable().default(null)
}).strict();
function parse(value) {
  const result=draftInputSchema.safeParse(value);
  if(!result.success) throw new AppError(400,'ADS_DRAFT_INVALID','광고 초안 입력을 확인해 주세요.',result.error.flatten());
  return result.data;
}
function budget(value,currency) {
  try {const amount=toMinorUnits(value,currency);if(amount<=0)throw new Error('예산은 0보다 커야 합니다.');return amount;}
  catch(error){throw new AppError(400,'ADS_BUDGET_INVALID',error.message);}
}
export function createAdsDrafts({pool,auth,graph}) {
  async function resolve(actorId,input,ctx) {
    const {clientRequestId,...value}=parse(input);
    if(Date.parse(value.endAt)<=Date.parse(value.startAt)||value.ageMin>value.ageMax)
      throw new AppError(400,'ADS_DRAFT_INVALID','종료 시각 또는 연령 범위를 확인해 주세요.');
    let product=null,post=null,assetIds=value.mediaAssetIds;
    if(value.productId) {
      product=(await pool.query('SELECT id,name,price,product_url FROM products WHERE id=$1 AND active=TRUE',[value.productId])).rows[0];
      if(!product) throw new AppError(400,'ADS_PRODUCT_UNAVAILABLE','선택한 상품을 찾지 못했습니다.');
    }
    if(value.sourceType==='post') {
      post=(await pool.query("SELECT id,platform,caption,external_post_id,media_asset_ids FROM post_variants WHERE id=$1 AND publish_state='published'",[value.postVariantId])).rows[0];
      if(!post)throw new AppError(400,'ADS_POST_UNAVAILABLE','발행 완료된 게시물을 선택해 주세요.');
      assetIds=post.media_asset_ids;
    }
    if(assetIds.length!==1)throw new AppError(400,'ADS_MEDIA_UNAVAILABLE','1차 광고는 단일 상품 이미지 1장을 선택해 주세요.');
    const media=(await pool.query("SELECT id,checksum,mime_type,media_type,alt_text FROM media_assets WHERE id=$1 AND status='ready'",[assetIds[0]])).rows[0];
    if(!media) throw new AppError(400,'ADS_MEDIA_UNAVAILABLE','선택한 이미지가 준비 상태가 아닙니다.');
    if(media.media_type!=='image') throw new AppError(400,'ADS_FORMAT_UNSUPPORTED','영상 광고는 아직 검증되지 않았습니다. 단일 이미지를 선택해 주세요.');
    const landingUrl=value.landingUrl||product?.product_url||'';
    if(!landingUrl||!url.safeParse(landingUrl).success)throw new AppError(400,'ADS_LANDING_REQUIRED','상품 구매 링크를 확인해 주세요.');
    const identities=(await pool.query("SELECT platform,account_id,page_id FROM social_connections WHERE platform IN ('facebook','instagram') AND status='connected'")).rows;
    const page=identities.find(row=>row.platform==='facebook'),ig=identities.find(row=>row.platform==='instagram');
    const budgetAmountMinor=budget(value.budgetAmount,ctx.account.currency);
    const totalSpendLimitMinor=value.totalSpendLimit===null?null:budget(value.totalSpendLimit,ctx.account.currency);
    if(totalSpendLimitMinor!==null&&totalSpendLimitMinor<budgetAmountMinor) throw new AppError(400,'ADS_BUDGET_INVALID','총 지출 한도는 설정한 예산 이상이어야 합니다.');
    return {clientRequestId,definition:{input:value,account:{id:ctx.account.external_account_id,currency:ctx.account.currency,timezone:ctx.account.timezone_name,generation:ctx.generation},
      identity:{pageId:page?.page_id||null,instagramUserId:ig?.account_id||null},product:product||null,
      creative:{assetId:media.id,checksum:media.checksum,mimeType:media.mime_type,sourcePostId:post?.id||null,sourceMode:post?'copy_media':'media'},
      campaignName:value.campaignName,objective:value.objective,landingUrl,primaryText:value.primaryText||post?.caption||'',headline:value.headline||product?.name||'',
      callToAction:value.callToAction,budgetType:value.budgetType,budgetAmountMinor,totalSpendLimitMinor,
      startAt:new Date(value.startAt).toISOString(),endAt:new Date(value.endAt).toISOString(),
      targeting:{geo_locations:{countries:[...new Set(value.countries)].sort()},age_min:value.ageMin,age_max:value.ageMax,publisher_platforms:[...new Set(value.placements)].sort(),targeting_automation:{advantage_audience:0}},
      pixelId:value.pixelId}};
  }
  async function get(actorId,id,db=pool) {
    await auth.owner(actorId);
    const row=(await db.query('SELECT * FROM meta_ad_drafts WHERE id=$1 AND created_by=$2',[id,actorId])).rows[0];
    if(!row) throw new AppError(404,'ADS_DRAFT_NOT_FOUND','광고 초안을 찾지 못했습니다.');
    return row;
  }
  async function list(actorId) {
    await auth.owner(actorId);return (await pool.query('SELECT * FROM meta_ad_drafts WHERE created_by=$1 ORDER BY updated_at DESC LIMIT 100',[actorId])).rows;
  }
  async function create(actorId,input) {
    const ctx=await auth.context(actorId),{clientRequestId,definition:d}=await resolve(actorId,input,ctx);
    return inTransaction(pool,async client=>{
      await lockAdsContext(client,actorId,ctx);
      const result=await client.query(`INSERT INTO meta_ad_drafts(id,client_request_id,source_type,product_id,post_variant_id,media_asset_ids,campaign_name,objective,landing_url,
        call_to_action,primary_text,headline,audience,placements,start_at,end_at,budget_type,budget_amount_minor,currency,tracking,created_by,external_account_id,connection_generation,definition)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,$18,$19,$20::jsonb,$21,$22,$23,$24::jsonb)
        ON CONFLICT(client_request_id) DO NOTHING RETURNING *`,[randomUUID(),clientRequestId,d.input.sourceType,d.product?.id||null,d.creative.sourcePostId,JSON.stringify([d.creative.assetId]),
        d.campaignName,d.objective,d.landingUrl,d.callToAction,d.primaryText,d.headline,JSON.stringify(d.targeting),JSON.stringify(d.targeting.publisher_platforms),d.startAt,d.endAt,d.budgetType,d.budgetAmountMinor,d.account.currency,
        JSON.stringify({pixelId:d.pixelId}),actorId,d.account.id,ctx.generation,JSON.stringify(d)]);
      if(!result.rowCount) {
        const old=(await client.query('SELECT * FROM meta_ad_drafts WHERE client_request_id=$1 AND created_by=$2',[clientRequestId,actorId])).rows[0];
        if(!old || payloadHash(old.definition)!==payloadHash(d))throw new AppError(409,'ADS_IDEMPOTENCY_CONFLICT','동일한 요청 ID에 다른 광고 내용이 들어왔습니다.');
        return old;
      }
      await adsAudit(client,actorId,'ads.draft.created',result.rows[0].id,{accountId:d.account.id});return result.rows[0];
    });
  }
  async function update(actorId,id,{expectedRevision,...input}) {
    if(!Number.isInteger(expectedRevision)||expectedRevision<1)throw new AppError(400,'ADS_REVISION_REQUIRED','수정 전 초안 버전이 필요합니다.');
    const ctx=await auth.context(actorId),{definition:d}=await resolve(actorId,input,ctx);
    return inTransaction(pool,async client=>{
      await lockAdsContext(client,actorId,ctx);
      const old=(await client.query('SELECT * FROM meta_ad_drafts WHERE id=$1 AND created_by=$2 FOR UPDATE',[id,actorId])).rows[0];
      if(!old)throw new AppError(404,'ADS_DRAFT_NOT_FOUND','초안을 찾지 못했습니다.');
      if(old.revision!==expectedRevision)throw new AppError(409,'ADS_DRAFT_STALE','다른 수정이 저장됐습니다. 새로 조회해 주세요.');
      if(old.status!=='draft'||old.external_campaign_id)throw new AppError(409,'ADS_DRAFT_LOCKED','실행 중이거나 Meta에 생성된 초안은 수정할 수 없습니다.');
      const saved=await client.query(`UPDATE meta_ad_drafts SET definition=$3::jsonb,campaign_name=$4,objective=$5,landing_url=$6,budget_type=$7,budget_amount_minor=$8,
        currency=$9,external_account_id=$10,connection_generation=$11,primary_text=$12,headline=$13,start_at=$14,end_at=$15,source_type=$16,product_id=$17,post_variant_id=$18,media_asset_ids=$19::jsonb,call_to_action=$20,audience=$21::jsonb,placements=$22::jsonb,tracking=$23::jsonb,revision=revision+1,updated_at=NOW()
        WHERE id=$1 AND created_by=$2 RETURNING *`,[id,actorId,JSON.stringify(d),d.campaignName,d.objective,d.landingUrl,d.budgetType,d.budgetAmountMinor,d.account.currency,d.account.id,ctx.generation,d.primaryText,d.headline,d.startAt,d.endAt,d.input.sourceType,d.product?.id||null,d.creative.sourcePostId,JSON.stringify([d.creative.assetId]),d.callToAction,JSON.stringify(d.targeting),JSON.stringify(d.targeting.publisher_platforms),JSON.stringify({pixelId:d.pixelId})]);
      await client.query("UPDATE meta_ad_action_requests SET status='invalidated',updated_at=NOW() WHERE target_local_id=$1 AND status IN ('pending','approved')",[id]);
      await adsAudit(client,actorId,'ads.draft.updated',id,{revision:saved.rows[0].revision});return saved.rows[0];
    });
  }
  async function revalidate(actorId,id) {
    const ctx=await auth.context(actorId),draft=await get(actorId,id);
    const {definition}=await resolve(actorId,{...draft.definition.input,clientRequestId:draft.client_request_id},ctx);
    if(payloadHash(definition)!==payloadHash(draft.definition))throw new AppError(409,'ADS_DRAFT_CHANGED','상품·이미지·계정 정보가 변경됐습니다. 초안을 갱신하고 다시 승인해 주세요.');
    return draft;
  }
  async function validateLaunch(actorId,id) {
    const draft=await revalidate(actorId,id),d=draft.definition,ctx=await auth.context(actorId);
    if(draft.status!=='draft'||draft.external_campaign_id)throw new AppError(409,'ADS_DRAFT_LOCKED','이미 실행된 초안입니다.');
    if(Date.parse(d.startAt)<=Date.now()+60000)throw new AppError(400,'ADS_SCHEDULE_EXPIRED','시작 시간을 현재보다 최소 1분 이후로 갱신해 주세요.');
    if(!d.identity.pageId || (d.targeting.publisher_platforms.includes('instagram')&&!d.identity.instagramUserId))throw new AppError(409,'ADS_PAGE_REQUIRED','광고에 사용할 Facebook Page와 Instagram 계정을 연결해 주세요.');
    if(d.objective==='SALES' && (!d.pixelId || !(await ctx.read(token=>graph.pixels(d.account.id,token))).some(p=>p.id===d.pixelId)))
      throw new AppError(409,'ADS_SALES_TRACKING_REQUIRED','구매 최적화에 사용할 수 있는 픽셀을 확인해 주세요.');
    return draft;
  }
  return {create,update,list,get,revalidate,validateLaunch};
}
