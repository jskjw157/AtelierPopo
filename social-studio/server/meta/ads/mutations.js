import { AppError } from '../../http.js';
import { normalizeActId } from './client.js';
const OBJECTIVES={TRAFFIC:'OUTCOME_TRAFFIC',ENGAGEMENT:'OUTCOME_ENGAGEMENT',SALES:'OUTCOME_SALES'};
const FIELDS={
  campaign:'id,account_id,name,status,objective,daily_budget,lifetime_budget,spend_cap,start_time,stop_time',
  adset:'id,account_id,name,status,campaign_id,daily_budget,lifetime_budget,start_time,end_time,targeting,optimization_goal,billing_event,promoted_object,destination_type',
  ad:'id,account_id,name,status,campaign_id,adset_id,creative{id}'
};
const need=(condition,code,message)=>{if(!condition)throw new AppError(409,code,message);};
function subset(actual,expected) {
  if(Array.isArray(expected)) return Array.isArray(actual)&&JSON.stringify([...actual].sort())===JSON.stringify([...expected].sort());
  if(expected&&typeof expected==='object')return actual&&Object.entries(expected).every(([key,value])=>subset(actual[key],value));
  return actual===expected;
}
export function createAdsMutator({get,post,loadImage}) {
  const read=(ctx,path,fields)=>ctx.read(token=>get(path,token,{fields}));
  async function snapshotTarget(ctx,type,id) {
    need(Object.hasOwn(FIELDS,type)&&/^\d+$/.test(id),'ADS_TARGET_INVALID','광고 변경 대상이 올바르지 않습니다.');
    const data=await read(ctx,`/${id}`,FIELDS[type]);
    need(normalizeActId(String(data.account_id))===ctx.account.external_account_id,'ADS_WRONG_ACCOUNT','다른 광고 계정의 대상을 변경할 수 없습니다.');
    need(String(data.id)===id,'ADS_TARGET_INVALID','Meta 대상 ID가 요청과 일치하지 않습니다.');
    const keys=FIELDS[type].replace(/\{[^}]*\}/g,'').split(',');
    const target=Object.fromEntries(keys.map(key=>[key,data[key]??null]));
    const parents=[];
    if(type==='ad'&&data.adset_id)parents.push((await snapshotTarget(ctx,'adset',String(data.adset_id))).target);
    if(type!=='campaign'&&data.campaign_id)parents.push((await snapshotTarget(ctx,'campaign',String(data.campaign_id))).target);
    return {target,parents};
  }
  async function descendants(ctx,id,type) {
    const rows=[],seen=new Set();let after;
    for(let page=0;page<10;page++) {
      const r=await ctx.read(t=>get(`/${id}/${type==='adset'?'adsets':'ads'}`,t,{fields:FIELDS[type],limit:100,...(after?{after}:{})}));
      need(Array.isArray(r?.data),'ADS_RESPONSE_INVALID','하위 광고 목록을 확인할 수 없습니다.');
      for(const row of r.data) {
        need(normalizeActId(String(row.account_id))===ctx.account.external_account_id,'ADS_WRONG_ACCOUNT','하위 광고의 계정이 다릅니다.');
        const keys=FIELDS[type].replace(/\{[^}]*\}/g,'').split(',');
        rows.push(Object.fromEntries(keys.map(key=>[key,row[key]??null])));
      }
      if(!r.paging?.next)return rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
      after=r.paging?.cursors?.after;
      need(typeof after==='string'&&after&&!seen.has(after),'ADS_PAGING_INVALID','하위 광고 페이지 순서를 확인할 수 없습니다.');seen.add(after);
    }
    throw new AppError(409,'ADS_PAGE_LIMIT','하위 광고가 조회 한도를 넘었습니다. 일부 결과로 집행을 승인할 수 없습니다.');
  }
  async function snapshot(ctx,type,id) {
    const result=await snapshotTarget(ctx,type,id);
    result.affectedAdsets=type==='campaign'?await descendants(ctx,id,'adset'):[];
    result.affectedAds=type==='ad'?[result.target]:await descendants(ctx,id,'ad');
    result.creatives=[];
    const ids=[...new Set(result.affectedAds.map(a=>a.creative?.id).filter(Boolean))].sort();
    // Read all materially affected creatives before offering a delivery change.
    // A large account is rejected rather than silently approving a partial view.
    need(ids.length<=100,'ADS_CREATIVE_LIMIT','승인 대상 소재가 너무 많습니다. 광고세트나 광고 단위로 나눠 주세요.');
    for(const creativeId of ids) {
      const r=await read(ctx,`/${creativeId}`,'id,account_id,object_story_spec,asset_feed_spec,object_story_id,effective_object_story_id,source_instagram_media_id');
      need(normalizeActId(String(r.account_id))===ctx.account.external_account_id,'ADS_WRONG_ACCOUNT','광고 소재 계정이 다릅니다.');
      result.creatives.push(Object.fromEntries(['id','object_story_spec','asset_feed_spec','object_story_id','effective_object_story_id','source_instagram_media_id'].map(k=>[k,r[k]??null])));
    }
    return result;
  }
  async function preflight(ctx) {
    const account=await read(ctx,`/${ctx.account.external_account_id}`,'id,currency,account_status,user_tasks');
    need(normalizeActId(account.id)===ctx.account.external_account_id&&account.currency===ctx.account.currency,'ADS_ACCOUNT_CHANGED','광고 계정 또는 통화가 변경됐습니다.');
    need(account.account_status===1&&Array.isArray(account.user_tasks)&&account.user_tasks.some(t=>['ADVERTISE','MANAGE'].includes(t)),'ADS_ADVERTISER_REQUIRED','활성 광고 계정의 광고 운영 권한을 확인할 수 없습니다.');
  }
  async function verifyLaunch(ctx,d,ids,active,childrenActive=active) {
    need(ids.campaignId&&ids.adsetId&&ids.adId&&ids.creativeId,'ADS_VERIFY_REQUIRED','일부 Meta 객체 ID가 아직 확인되지 않았습니다.');
    const [campaign,adset,ad]=await Promise.all([snapshotTarget(ctx,'campaign',ids.campaignId),snapshotTarget(ctx,'adset',ids.adsetId),snapshotTarget(ctx,'ad',ids.adId)]);
    const expectedStatus=active?'ACTIVE':'PAUSED',childStatus=childrenActive?'ACTIVE':'PAUSED',budgetKey=d.budgetType==='daily'?'daily_budget':'lifetime_budget';
    need(campaign.target.status===expectedStatus&&campaign.target.objective===OBJECTIVES[d.objective],'ADS_VERIFY_REQUIRED','캠페인 상태 또는 목표를 다시 확인해야 합니다.');
    need(adset.target.status===childStatus&&String(adset.target.campaign_id)===ids.campaignId&&String(adset.target[budgetKey])===String(d.budgetAmountMinor)&&subset(adset.target.targeting,d.targeting),'ADS_VERIFY_REQUIRED','광고세트 상태·예산·타겟이 승인 내용과 일치하지 않습니다.');
    need(ad.target.status===childStatus&&String(ad.target.adset_id)===ids.adsetId&&String(ad.target.creative?.id)===ids.creativeId,'ADS_VERIFY_REQUIRED','광고 연결 또는 상태가 승인 내용과 일치하지 않습니다.');
    const seconds=value=>Math.floor(Date.parse(value)/1000);
    need(seconds(adset.target.start_time)===seconds(d.startAt)&&seconds(adset.target.end_time)===seconds(d.endAt),'ADS_VERIFY_REQUIRED','광고 일정이 승인 내용과 다릅니다.');
    need(Number(campaign.target.daily_budget||0)===0&&Number(campaign.target.lifetime_budget||0)===0,'ADS_VERIFY_REQUIRED','예상하지 않은 캠페인 공유 예산이 있습니다.');
    need(d.totalSpendLimitMinor===null?Number(campaign.target.spend_cap||0)===0:String(campaign.target.spend_cap)===String(d.totalSpendLimitMinor),'ADS_VERIFY_REQUIRED','캠페인 총 지출 한도를 확인할 수 없습니다.');
    need(adset.target.billing_event==='IMPRESSIONS'&&adset.target.optimization_goal===(d.objective==='SALES'?'OFFSITE_CONVERSIONS':d.objective==='ENGAGEMENT'?'POST_ENGAGEMENT':'LINK_CLICKS'),'ADS_VERIFY_REQUIRED','광고 최적화 방식이 승인 내용과 다릅니다.');
    if(d.objective==='SALES')need(subset(adset.target.promoted_object,{pixel_id:d.pixelId,custom_event_type:'PURCHASE'}),'ADS_VERIFY_REQUIRED','구매 측정 픽셀이 다릅니다.');
    const creative=await read(ctx,`/${ids.creativeId}`,'id,account_id,object_story_spec');
    need(normalizeActId(String(creative.account_id))===d.account.id&&subset(creative.object_story_spec,{
      page_id:d.identity.pageId,...(d.targeting.publisher_platforms.includes('instagram')?{instagram_user_id:d.identity.instagramUserId}:{}),link_data:{image_hash:ids.imageHash,link:d.landingUrl,message:d.primaryText,name:d.headline,
        call_to_action:{type:d.callToAction,value:{link:d.landingUrl}}}
    }),'ADS_VERIFY_REQUIRED','광고 이미지·구매 링크·문구가 승인 내용과 일치하지 않습니다.');
    return {configuredStatus:campaign.target.status};
  }
  async function execute(payload,ctx,checkpoint) {
    await preflight(ctx);
    async function write(stage,path,params) {
      await checkpoint(stage);return ctx.read(token=>post(path,token,params));
    }
    if(payload.actionType!=='launch') {
      const response=await write('target.update',`/${payload.targetId}`,payload.change);
      need(response?.success===true,'ADS_VERIFY_REQUIRED','Meta 변경 응답을 재확인해야 합니다.');
      const observed=await snapshot(ctx,payload.targetType,payload.targetId);
      need(Object.entries(payload.change).every(([key,value])=>String(observed.target[key])===String(value)),'ADS_VERIFY_REQUIRED','변경 결과가 승인 내용과 일치하지 않습니다.');
      return {targetId:payload.targetId,observed};
    }
    const d=payload.definition,base=`/${d.account.id}`,ids={};
    await checkpoint('image.load');const bytes=await loadImage(d.creative);
    const image=await write('image.upload',`${base}/adimages`,{bytes});
    const hashes=Object.values(image?.images||{}).map(item=>item.hash).filter(Boolean);
    need(hashes.length===1,'ADS_VERIFY_REQUIRED','광고 이미지 업로드 결과를 확인할 수 없습니다.');
    ids.imageHash=hashes[0];await checkpoint('image.uploaded',ids);
    async function create(stage,edge,params,key) {
      const result=await write(stage,`${base}/${edge}`,params);
      need(/^\d+$/.test(String(result?.id||'')),'ADS_VERIFY_REQUIRED','Meta 객체 ID를 확인하지 못했습니다.');
      ids[key]=String(result.id);await checkpoint(`${stage}.saved`,ids);return ids[key];
    }
    const name=`${d.campaignName} [haar:${payload.actionId}]`;
    await create('campaign.create','campaigns',{name,objective:OBJECTIVES[d.objective],special_ad_categories:[],status:'PAUSED',is_adset_budget_sharing_enabled:false,
      ...(d.totalSpendLimitMinor!==null?{spend_cap:String(d.totalSpendLimitMinor)}:{})},'campaignId');
    await create('adset.create','adsets',{name,campaign_id:ids.campaignId,status:'PAUSED',billing_event:'IMPRESSIONS',bid_strategy:'LOWEST_COST_WITHOUT_CAP',
      optimization_goal:d.objective==='SALES'?'OFFSITE_CONVERSIONS':d.objective==='ENGAGEMENT'?'POST_ENGAGEMENT':'LINK_CLICKS',
      destination_type:d.objective==='ENGAGEMENT'?'ON_AD':'WEBSITE',targeting:d.targeting,start_time:d.startAt,end_time:d.endAt,
      [d.budgetType==='daily'?'daily_budget':'lifetime_budget']:String(d.budgetAmountMinor),
      ...(d.objective==='SALES'?{promoted_object:{pixel_id:d.pixelId,custom_event_type:'PURCHASE'}}:{})},'adsetId');
    await create('creative.create','adcreatives',{name,object_story_spec:{page_id:d.identity.pageId,
      ...(d.targeting.publisher_platforms.includes('instagram')?{instagram_user_id:d.identity.instagramUserId}:{}),
      link_data:{image_hash:ids.imageHash,link:d.landingUrl,message:d.primaryText,name:d.headline,call_to_action:{type:d.callToAction,value:{link:d.landingUrl}}}},
      degrees_of_freedom_spec:{creative_features_spec:{standard_enhancements:{enroll_status:'OPT_OUT'}}}},'creativeId');
    await create('ad.create','ads',{name,adset_id:ids.adsetId,creative:{creative_id:ids.creativeId},status:'PAUSED'},'adId');
    await verifyLaunch(ctx,d,ids,false);
    await write('ad.activate',`/${ids.adId}`,{status:'ACTIVE'});
    await write('adset.activate',`/${ids.adsetId}`,{status:'ACTIVE'});
    // The parent remains paused while all child objects are assembled and checked.
    await verifyLaunch(ctx,d,ids,false,true);
    await write('campaign.activate',`/${ids.campaignId}`,{status:'ACTIVE'});
    return {...ids,...await verifyLaunch(ctx,d,ids,true)};
  }
  async function inspect(payload,ctx,ids) {
    if(payload.actionType==='launch')return {...ids,...await verifyLaunch(ctx,payload.definition,ids,true)};
    const observed=await snapshot(ctx,payload.targetType,payload.targetId);
    need(Object.entries(payload.change).every(([k,v])=>String(observed.target[k])===String(v)),'ADS_VERIFY_REQUIRED','승인된 변경의 완료 여부를 아직 확인할 수 없습니다.');
    return {targetId:payload.targetId,observed};
  }
  return {snapshot,preflight,execute,inspect};
}
