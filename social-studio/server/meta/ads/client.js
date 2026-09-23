import { AppError } from '../../http.js';
export function normalizeActId(id) {
  if(typeof id !== 'string' || !/^(?:act_)?\d+$/.test(id)) throw new AppError(400,'ADS_ACCOUNT_ID_INVALID','광고 계정 ID가 올바르지 않습니다.');
  return id.startsWith('act_') ? id : `act_${id}`;
}
export function validateDateRange({ since, until, level = 'campaign' }) {
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  if(!valid(since) || !valid(until) || since > until || Date.parse(until)-Date.parse(since)>92*86400000 || !['account','campaign','adset','ad'].includes(level))
    throw new AppError(400,'ADS_DATE_RANGE_INVALID','조회 단위와 날짜를 확인해 주세요. 한 번에 최대 93일을 조회할 수 있습니다.');
  return { since,until,level };
}
const ACCOUNT_FIELDS = 'id,name,currency,timezone_name,account_status,business{id},user_tasks';
const HIERARCHY_FIELDS = {
  campaigns: 'id,account_id,name,objective,status,effective_status,daily_budget,lifetime_budget,spend_cap,start_time,stop_time,updated_time',
  adsets: 'id,account_id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal,billing_event',
  ads: 'id,account_id,name,adset_id,campaign_id,status,effective_status,creative{id,name},updated_time'
};
const INSIGHT_FIELDS = 'account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,impressions,reach,clicks,ctr,cpc,cpm,actions,action_values,purchase_roas';
export function createAdsClient({ get, maxPages = 10 }) {
  async function list(path, token, params = {}) {
    const rows=[], seen=new Set(); let after;
    for(let page=0; page<maxPages; page+=1) {
      const payload=await get(path,token,{...params,limit:100,...(after?{after}:{})});
      if(!Array.isArray(payload?.data)) throw new AppError(502,'ADS_RESPONSE_INVALID','Meta 목록 응답을 확인할 수 없습니다.');
      rows.push(...payload.data);
      if(!payload.paging?.next) return rows;
      after=payload.paging?.cursors?.after;
      if(typeof after!=='string' || !after || seen.has(after)) throw new AppError(502,'ADS_PAGING_INVALID','Meta 페이지 순서가 올바르지 않습니다. 일부 데이터로 합산하지 않았습니다.');
      seen.add(after);
    }
    throw new AppError(502,'ADS_PAGE_LIMIT','조회량 제한에 도달했습니다. 일부 결과를 전체 결과로 표시하지 않았습니다.');
  }
  return {
    listAccounts: token => list('/me/adaccounts',token,{fields:ACCOUNT_FIELDS}),
    account: (id,token) => get(`/${normalizeActId(id)}`,token,{fields:ACCOUNT_FIELDS}),
    async hierarchy(id,token) {
      const entries=await Promise.all(Object.entries(HIERARCHY_FIELDS).map(async([type,fields])=>
        [type,await list(`/${normalizeActId(id)}/${type}`,token,{fields})]));
      return Object.fromEntries(entries);
    },
    insights(id,token,input) {
      const {since,until,level}=validateDateRange(input);
      return list(`/${normalizeActId(id)}/insights`,token,{fields:INSIGHT_FIELDS,level,time_range:{since,until},use_unified_attribution_setting:true});
    },
    pixels: (id,token) => list(`/${normalizeActId(id)}/adspixels`,token,{fields:'id,name,last_fired_time'})
  };
}
