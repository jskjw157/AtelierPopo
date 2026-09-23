import { randomUUID } from 'node:crypto';
import { AppError } from '../../http.js';
import { validateDateRange } from './client.js';
import { adsAudit,inTransaction } from './storage.js';
const number = value => {
  if(!['string','number'].includes(typeof value) || !/^\d+(?:\.\d+)?$/.test(String(value))) return null;
  const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;
};
const count = value => {const v=number(value);return Number.isSafeInteger(v)?v:null;};
const PURCHASE_TYPES=['omni_purchase','purchase','offsite_conversion.fb_pixel_purchase'];
function series(items,type) {
  const values=Array.isArray(items)?items.filter(row=>row?.action_type===type):[];
  return {value:values.length===1?number(values[0].value):null,ambiguous:values.length>1};
}
export function normalizeInsightsRow(row,currency) {
  const warnings=[];
  const purchaseMetricSource=PURCHASE_TYPES.find(type=>Array.isArray(row.actions)&&row.actions.some(r=>r?.action_type===type))||null;
  const purchases=series(row.actions,purchaseMetricSource),value=series(row.action_values,purchaseMetricSource);
  const roas=series(row.purchase_roas,purchaseMetricSource);
  if(purchases.ambiguous) warnings.push('AMBIGUOUS_PURCHASE_ACTIONS');
  if(value.ambiguous) warnings.push('AMBIGUOUS_PURCHASE_VALUES');
  if(roas.ambiguous) warnings.push('AMBIGUOUS_PURCHASE_ROAS');
  return {
    accountId:row.account_id||null,campaignId:row.campaign_id||null,campaignName:row.campaign_name||null,
    adsetId:row.adset_id||null,adsetName:row.adset_name||null,adId:row.ad_id||null,adName:row.ad_name||null,
    dateStart:row.date_start||null,dateStop:row.date_stop||null,currency,
    spend:number(row.spend),impressions:count(row.impressions),reach:count(row.reach),clicks:count(row.clicks),
    ctr:number(row.ctr),cpc:number(row.cpc),cpm:number(row.cpm),
    purchases:purchases.value,purchaseValue:value.value,roas:roas.value,purchaseMetricSource,warnings
  };
}
export function createAdsInsights({pool,auth,graph}) {
  function envelope(ctx,range,rows=[],capturedAt=null) {
    return {accountId:ctx.account.external_account_id,currency:ctx.account.currency,timezone:ctx.account.timezone_name,...range,rows,capturedAt,
      attribution:'Meta unified attribution setting; all-click metrics; missing conversions are unavailable'};
  }
  async function sync(actorId,input) {
    const range=validateDateRange(input),ctx=await auth.context(actorId),id=randomUUID();
    const raw=await ctx.read(token=>graph.insights(ctx.account.external_account_id,token,range));
    const rows=raw.map(row=>normalizeInsightsRow(row,ctx.account.currency));
    const current=await auth.context(actorId);
    if(current.generation!==ctx.generation || current.account.external_account_id!==ctx.account.external_account_id)
      throw new AppError(409,'ADS_CONTEXT_CHANGED','조회 중 광고 계정이 변경됐습니다. 다시 조회해 주세요.');
    const saved=await inTransaction(pool,async client=>{
      const valid=await client.query(`SELECT a.external_account_id FROM meta_ad_connections c JOIN meta_ad_accounts a ON a.connection_generation=c.generation
        WHERE c.owner_user_id=$1 AND c.generation=$2 AND a.selected=TRUE AND a.accessible=TRUE AND a.external_account_id=$3 FOR UPDATE OF c,a`,[actorId,ctx.generation,ctx.account.external_account_id]);
      if(!valid.rowCount) throw new AppError(409,'ADS_CONTEXT_CHANGED','광고 계정이 변경됐습니다.');
      const result=await client.query(`INSERT INTO meta_ad_insight_runs(id,external_account_id,connection_generation,level,date_start,date_stop,metrics)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING captured_at`,[id,ctx.account.external_account_id,ctx.generation,range.level,range.since,range.until,JSON.stringify(rows)]);
      await adsAudit(client,actorId,'ads.insights.synced',ctx.account.external_account_id,{...range,rowCount:rows.length});
      return result.rows[0];
    });
    return envelope(ctx,range,rows,saved.captured_at);
  }
  async function latest(actorId,input) {
    const range=validateDateRange(input),ctx=await auth.context(actorId);
    const {rows}=await pool.query(`SELECT metrics,captured_at FROM meta_ad_insight_runs WHERE external_account_id=$1 AND connection_generation=$2
      AND level=$3 AND date_start=$4 AND date_stop=$5 ORDER BY captured_at DESC LIMIT 1`,[ctx.account.external_account_id,ctx.generation,range.level,range.since,range.until]);
    return envelope(ctx,range,rows[0]?.metrics||[],rows[0]?.captured_at||null);
  }
  return {sync,latest};
}
