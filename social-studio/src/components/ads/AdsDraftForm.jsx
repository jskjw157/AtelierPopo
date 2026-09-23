import {useEffect,useState} from 'react';
const localInput=iso=>{const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
function initial(draft){return draft?{...draft.definition.input,clientRequestId:draft.client_request_id,startAt:localInput(draft.definition.startAt),endAt:localInput(draft.definition.endAt)}:{
 clientRequestId:crypto.randomUUID(),sourceType:'media',productId:null,postVariantId:null,mediaAssetIds:[],campaignName:'',objective:'TRAFFIC',landingUrl:'',primaryText:'',headline:'',callToAction:'SHOP_NOW',budgetType:'lifetime',budgetAmount:'',totalSpendLimit:null,startAt:localInput(Date.now()+3600000),endAt:localInput(Date.now()+8*86400000),countries:['KR'],ageMin:18,ageMax:65,placements:['instagram'],pixelId:null};}
export function AdsDraftForm({account,products,media,posts,pixels,onSave,onCancel,busy,draft}){
 const [form,setForm]=useState(()=>initial(draft)),[error,setError]=useState('');
 useEffect(()=>setForm(initial(draft)),[draft?.id,draft?.revision]);
 const set=(key,value)=>setForm(f=>({...f,[key]:value}));
 async function submit(e){e.preventDefault();setError('');try{const result=await onSave({...form,startAt:new Date(form.startAt).toISOString(),endAt:new Date(form.endAt).toISOString(),...(draft?{expectedRevision:draft.revision}:{})});if(result!==false&&!draft)setForm(initial());}catch(e){setError(e.message);}}
 return <form className="panel" onSubmit={submit}><span className="eyebrow">LOCAL DRAFT</span><h2>{draft?'광고 초안 수정':'새 광고 초안'}</h2><p>여기에 저장해도 Meta 광고는 생성·집행되지 않습니다. 통화: {account?.currency} · 계정 시간대: {account?.timezone_name}</p>
  {error?<div className="alert alert-error" role="alert">{error}</div>:null}
  <div className="ads-form-grid">
   <label>상품<select value={form.productId||''} onChange={e=>{const p=products.find(p=>p.id===e.target.value);setForm(f=>({...f,productId:p?.id||null,landingUrl:p?.product_url||'',headline:p?.name||'',campaignName:f.campaignName||p?.name||''}));}}><option value="">상품 선택 (직접 링크 입력 가능)</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>캠페인 이름<input required maxLength={120} value={form.campaignName} onChange={e=>set('campaignName',e.target.value)}/></label>
   <label>소재 출처<select value={form.sourceType} onChange={e=>set('sourceType',e.target.value)}><option value="media">미디어 라이브러리 이미지</option><option value="post">기존 게시물 사진·문구 복사</option></select></label>
   {form.sourceType==='media'?<label>광고 이미지<select required value={form.mediaAssetIds[0]||''} onChange={e=>set('mediaAssetIds',[e.target.value])}><option value="">단일 이미지 선택</option>{media.filter(m=>m.media_type==='image').map(m=><option key={m.id} value={m.id}>{m.original_name||m.alt_text||m.id}</option>)}</select></label>:<label>발행된 게시물<select required value={form.postVariantId||''} onChange={e=>set('postVariantId',e.target.value)}><option value="">단일 이미지 게시물 선택</option>{posts.map(p=><option key={p.id} value={p.id}>{p.platform} · {p.caption?.slice(0,50)||p.id}</option>)}</select></label>}
   <label className="ads-full">상품 구매 링크<input type="url" required value={form.landingUrl} onChange={e=>set('landingUrl',e.target.value)} placeholder="https://haar.co.kr/product/..."/></label>
   <label>광고 목표<select value={form.objective} onChange={e=>set('objective',e.target.value)}><option value="TRAFFIC">트래픽</option><option value="ENGAGEMENT">참여</option><option value="SALES" disabled={!pixels.length}>구매 (사용 가능한 픽셀 필요)</option></select></label>
   <label>클릭 버튼<select value={form.callToAction} onChange={e=>set('callToAction',e.target.value)}><option value="SHOP_NOW">지금 구매하기</option><option value="LEARN_MORE">더 알아보기</option></select></label>
   {form.objective==='SALES'?<label className="ads-full">구매 측정 픽셀<select required value={form.pixelId||''} onChange={e=>set('pixelId',e.target.value||null)}><option value="">픽셀 선택</option>{pixels.map(p=><option key={p.id} value={p.id}>{p.name||p.id}</option>)}</select></label>:null}
   <label className="ads-full">광고 제목<input maxLength={100} value={form.headline} onChange={e=>set('headline',e.target.value)}/></label>
   <label className="ads-full">본문<textarea rows={4} maxLength={2200} value={form.primaryText} onChange={e=>set('primaryText',e.target.value)}/></label>
   <label>예산 방식<select value={form.budgetType} onChange={e=>{set('budgetType',e.target.value);set('totalSpendLimit',null);}}><option value="lifetime">총예산</option><option value="daily">일예산 (평균)</option></select></label>
   <label>예산 ({account?.currency})<input required inputMode="decimal" value={form.budgetAmount} onChange={e=>set('budgetAmount',e.target.value)}/></label>
   {form.budgetType==='daily'?<label className="ads-full">캠페인 총 지출 한도 (선택 · {account?.currency})<input inputMode="decimal" value={form.totalSpendLimit??''} onChange={e=>set('totalSpendLimit',e.target.value||null)}/></label>:null}
   <label>시작 (브라우저 현지 시각)<input type="datetime-local" required value={form.startAt} onChange={e=>set('startAt',e.target.value)}/></label>
   <label>종료 (브라우저 현지 시각)<input type="datetime-local" required value={form.endAt} onChange={e=>set('endAt',e.target.value)}/></label>
   <label>국가 코드<input required value={form.countries.join(',')} onChange={e=>set('countries',e.target.value.toUpperCase().split(',').map(s=>s.trim()))} placeholder="KR"/></label>
   <label>게재 위치<select value={form.placements.join(',')} onChange={e=>set('placements',e.target.value.split(','))}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="instagram,facebook">Instagram + Facebook</option></select></label>
   <label>최소 연령<input type="number" min={18} max={65} value={form.ageMin} onChange={e=>set('ageMin',Number(e.target.value))}/></label><label>최대 연령<input type="number" min={18} max={65} value={form.ageMax} onChange={e=>set('ageMax',Number(e.target.value))}/></label>
  </div>
  <p className="helper">단일 이미지 광고만 지원합니다. 게시물 복사는 별도 광고이며 기존 반응은 승계하지 않습니다. 일예산×기간은 확정 지출 상한이 아닙니다. 날짜는 승인 화면에서 광고 계정 시간대로 다시 확인합니다.</p>
  <div className="form-actions left"><button className="button button-primary" disabled={busy||!account}>초안 저장</button>{onCancel?<button type="button" className="button button-secondary" onClick={onCancel}>수정 닫기</button>:null}</div>
 </form>;
}
