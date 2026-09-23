import {useState} from 'react';
import {amount,date,statusLabel,actionLabel,objectiveLabel} from './format.js';

function ApprovalCard({item,executionEnabled,onAction,busy}){
  const [confirmed,setConfirmed]=useState(false),s=item.summary||{},currency=s.account?.currency||s.currency;
  const expired=Date.parse(item.expires_at)<=Date.now(),canConfirm=['pending','approved'].includes(item.status);
  async function act(kind,body={}){await onAction(item.id,kind,body);setConfirmed(false);}
  return <article className="panel ads-approval">
    <div className="ads-heading"><div><span className="eyebrow">{actionLabel[item.action_type]}</span><h2>{s.campaignName||s.before?.target?.name||s.targetId||item.id}</h2></div><span className="ads-state">{statusLabel[item.status]||item.status}{expired&&canConfirm?' · 만료':''}</span></div>
    <dl className="ads-details">
      <div><dt>광고 계정</dt><dd>{s.account?.id||s.accountId} · {currency}</dd></div>
      {s.objective?<div><dt>목표</dt><dd>{objectiveLabel[s.objective]}</dd></div>:null}
      {s.budgetAmountMinor!==undefined?<div><dt>{s.budgetType==='daily'?'일예산 (평균)':'총예산'}</dt><dd>{amount(s.budgetAmountMinor,currency,true)}</dd></div>:null}
      {s.change?<div><dt>변경 내용</dt><dd>{s.change.status||amount(s.change.daily_budget||s.change.lifetime_budget,currency,true)}{s.change.daily_budget?' / 일':''}</dd></div>:null}
      {s.startAt?<div><dt>운영 기간 · {s.account?.timezone}</dt><dd>{date(s.startAt,s.account?.timezone)} ~ {date(s.endAt,s.account?.timezone)}</dd></div>:null}
      {s.targeting?<div><dt>대상 / 게재 위치</dt><dd>{s.targeting.geo_locations?.countries?.join(', ')} · {s.targeting.age_min}–{s.targeting.age_max}세 · {s.targeting.publisher_platforms?.join(', ')}</dd></div>:null}
      {s.maximumAdBudgetMinor!=null?<div><dt>광고 예산 상한 (세금 별도)</dt><dd>{amount(s.maximumAdBudgetMinor,currency,true)}</dd></div>:null}
      <div><dt>승인 유효 시각</dt><dd>{date(item.expires_at)} (이 브라우저 시각)</dd></div>
    </dl>
    {s.creative?.assetId?<img className="ads-preview" src={`/api/media/${encodeURIComponent(s.creative.assetId)}/preview`} alt="승인할 광고 이미지"/>:null}
    {s.headline?<h3>{s.headline}</h3>:null}{s.primaryText?<p className="ads-copy">{s.primaryText}</p>:null}
    {s.landingUrl?.startsWith('https://')?<a href={s.landingUrl} target="_blank" rel="noreferrer">상품 구매 링크</a>:null}
    {s.creative?.sourceMode==='copy_media'?<p className="helper">기존 게시물의 사진·문구를 복사한 별도 광고입니다. 기존 게시물의 좋아요·댓글은 승계하지 않습니다.</p>:null}
    <p className="helper">{s.notice}</p>
    <details><summary>전체 승인 내용 · {item.payload_hash?.slice(0,12)}</summary><pre className="ads-json">{JSON.stringify(s,null,2)}</pre></details>
    {item.sanitized_error?<p role="alert" className="text-warning">{item.sanitized_error}</p>:null}
    {canConfirm?<label className="ads-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={expired||busy}/>위 대상·사진·구매 링크·예산·기간을 확인했어요.</label>:null}
    <div className="form-actions left">
      {item.status==='pending'?<button className="button button-primary" disabled={!confirmed||expired||busy} onClick={()=>act('approve',{expectedHash:item.payload_hash,confirmed:true})}>승인</button>:null}
      {item.status==='approved'?<button className="button button-primary" disabled={!executionEnabled||!confirmed||expired||busy} onClick={()=>act('execute',{confirmed:true})}>승인된 작업 실행</button>:null}
      {canConfirm?<button className="button button-secondary" disabled={busy} onClick={()=>act('cancel')}>요청 취소</button>:null}
      {['executing','verification_required'].includes(item.status)?<button className="button button-secondary" disabled={busy} onClick={()=>act('reconcile')}>Meta 결과 재조회 (집행 없음)</button>:null}
    </div>
    {item.status==='approved'&&!executionEnabled?<p className="helper">서버 집행 잠금이 켜져 있어 실행할 수 없습니다. 승인만으로 광고가 시작되지는 않습니다.</p>:null}
  </article>;
}
export function AdsApprovals({actions,executionEnabled,onAction,busy}){
  return <div className="ads-stack">{!actions.length?<section className="panel"><h2>승인 요청이 없습니다</h2><p>초안이나 기존 광고에서 작업을 준비하면, 정확한 대상과 예산이 여기에 표시됩니다.</p></section>:actions.map(item=><ApprovalCard key={`${item.id}:${item.status}`} {...{item,executionEnabled,onAction,busy}}/>)}</div>;
}
