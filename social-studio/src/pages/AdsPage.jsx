import {useEffect,useState} from 'react';
import {RefreshCw,ShieldCheck} from 'lucide-react';
import {api} from '../lib/api.js';
import {AdsAccounts} from '../components/ads/AdsAccounts.jsx';
import {AdsApprovals} from '../components/ads/AdsApprovals.jsx';
import {AdsDraftForm} from '../components/ads/AdsDraftForm.jsx';
import {AdsInsights} from '../components/ads/AdsInsights.jsx';
import {AdsCampaigns} from '../components/ads/AdsCampaigns.jsx';
import {amount,date,statusLabel} from '../components/ads/format.js';
const base='/api/meta/ads';
function defaultRange(){return {since:new Date(Date.now()-6*86400000).toISOString().slice(0,10),until:new Date().toISOString().slice(0,10),level:'campaign'};}
export default function AdsPage(){
 const [status,setStatus]=useState(null),[accounts,setAccounts]=useState([]),[drafts,setDrafts]=useState([]),[actions,setActions]=useState([]);
 const [tab,setTab]=useState('overview'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [range,setRange]=useState(defaultRange),[insights,setInsights]=useState(null),[hierarchy,setHierarchy]=useState(null);
 const [sources,setSources]=useState({products:[],media:[],posts:[],pixels:[]}),[editing,setEditing]=useState(null);
 const account=status?.selectedAccount;
 async function load(){
  const [s,a,d,r]=await Promise.all([api(base+'/status'),api(base+'/accounts'),api(base+'/drafts'),api(base+'/actions')]);
  setStatus(s);setAccounts(a.accounts);setDrafts(d.drafts);setActions(r.actions);return s;
 }
 useEffect(()=>{let active=true;setBusy(true);load().catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setBusy(false)});return()=>{active=false};},[]);
 useEffect(()=>{
  setInsights(null);if(!account||!status.readable)return;
  let active=true;api(base+'/insights?'+new URLSearchParams(range)).then(r=>{if(active)setInsights(r)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false};
 },[account?.external_account_id,range.since,range.until,range.level,status?.readable]);
 useEffect(()=>{setHierarchy(null);setEditing(null)},[account?.external_account_id]);
 useEffect(()=>{
  if(tab!=='drafts'||!account)return;let active=true;
  Promise.all([api('/api/products'),api('/api/media'),api('/api/campaigns')]).then(([p,m,c])=>{
    if(active)setSources(old=>({...old,products:p.products,media:m.media,posts:c.campaigns.flatMap(c=>c.variants||[]).filter(p=>p.publishState==='published'&&p.format==='image')}));
  }).catch(e=>{if(active)setError(e.message)});
  api(base+'/tracking').then(r=>{if(active)setSources(old=>({...old,pixels:r.pixels}))}).catch(()=>{if(active)setSources(old=>({...old,pixels:[]}))});
  return()=>{active=false};
 },[tab,account?.external_account_id]);
 async function run(work,success){if(busy)return false;setBusy(true);setError('');setMessage('');try{await work();await load();if(success)setMessage(success);return true}catch(e){setError(e.message);return false}finally{setBusy(false)}}
 const post=(path,body={})=>api(base+path,{method:'POST',body:JSON.stringify(body)});
 async function prepare(input){await run(async()=>{await post('/actions',input);setTab('approvals')},'승인 요청을 준비했습니다. 아직 Meta를 변경하지 않았습니다.');}
 async function save(input){return run(async()=>{if(editing)await api(base+'/drafts/'+editing.id,{method:'PUT',body:JSON.stringify(input)});else await post('/drafts',input);setEditing(null)},'로컬 초안을 저장했습니다. 광고비는 발생하지 않습니다.');}
 const connection=<AdsAccounts {...{status,accounts,busy}} onConnect={()=>run(async()=>{const r=await post('/connect');window.location.assign(r.url);})}
  onDiscover={()=>run(()=>post('/accounts/sync'),'광고 계정 목록을 조회했습니다.')}
  onSelect={id=>run(async()=>{await post('/accounts/'+encodeURIComponent(id)+'/select');setHierarchy(null);setInsights(null)},'광고 계정을 선택했습니다.')}
  onTest={()=>run(async()=>{const r=await post('/test');if(!r.readTestPassed)throw new Error('광고 조회를 확인하지 못했습니다.')},'광고 계정 읽기 연결을 확인했습니다. 실제 집행 검증은 별도입니다.')}
  onDisconnect={()=>{if(window.confirm('광고 연결만 해제할까요? SNS 게시 연결은 유지됩니다.'))run(()=>post('/disconnect'),'광고 연결을 해제했습니다.');}}/>;
 return <div className="page-wrap ads-page"><header className="page-header"><div><span className="eyebrow">HAAR · META ADS</span><h1>광고 관리</h1><p>상품에서 광고까지. 조회와 초안을 먼저, 집행은 정확한 승인 후에.</p></div><button className="button button-secondary" disabled={busy} onClick={()=>run(load)}><RefreshCw size={16}/>새로고침</button></header>
  {error?<div className="alert alert-error" role="alert">{error}</div>:null}{message?<div className="alert alert-success" role="status">{message}</div>:null}
  <div className="ads-safety"><ShieldCheck size={22}/><div><strong>{status?.executionEnabled?'승인된 작업만 실행 가능':'광고 집행 잠금 켜짐'}</strong><span>조회·초안 저장으로 광고가 시작되지 않습니다. 실행 오류는 중복 요청하지 않고 먼저 결과를 조회합니다.</span></div></div>
  <div className="ads-tabs" role="tablist" aria-label="광고 관리 메뉴">{[['overview','계정·성과'],['campaigns','기존 광고'],['drafts','광고 초안'],['approvals','승인']].map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)} className={tab===key?'active':''}>{label}{key==='approvals'?` (${actions.filter(a=>['pending','approved','verification_required'].includes(a.status)).length})`:''}</button>)}</div>
  <div className="ads-stack" aria-busy={busy}>
   {tab==='overview'?<>{connection}{account&&status?.readable?<AdsInsights data={insights} {...{range,busy}} onRange={setRange} onSync={()=>run(async()=>setInsights(await post('/insights/sync',range)),'성과를 동기화했습니다.')}/>:null}<section className="panel"><h2>ChatGPT 읽기 연결</h2><p>서버의 <code>/mcp</code>는 인증된 읽기 도구만 제공합니다. 연결 등록과 인증 설정이 완료돼야 채팅에서 사용할 수 있습니다. 승인·집행 도구는 공개하지 않습니다.</p></section></>:null}
   {tab==='campaigns'?(account?<AdsCampaigns data={hierarchy} {...{busy}} onRefresh={()=>run(async()=>setHierarchy(await api(base+'/campaigns')))} onPrepare={prepare}/>:connection):null}
   {tab==='drafts'?(account?<><AdsDraftForm key={editing?.id||'new'} {...sources} {...{account,busy}} draft={editing} onSave={save} onCancel={editing?()=>setEditing(null):undefined}/>
    <section className="panel"><h2>저장한 초안 · {drafts.length}</h2>{drafts.length?drafts.map(d=><article key={d.id} className="ads-draft-row"><div><h3>{d.campaign_name}</h3><p>{statusLabel[d.status]||d.status} · {amount(d.definition?.budgetAmountMinor,d.currency,true)} · {d.budget_type==='daily'?'일예산':'총예산'}<br/>{date(d.start_at,d.definition?.account?.timezone)} ~ {date(d.end_at,d.definition?.account?.timezone)} · {d.external_account_id}</p></div><div className="form-actions left"><button className="button button-secondary" disabled={busy||d.status!=='draft'} onClick={()=>setEditing(d)}>초안 수정</button><button className="button button-primary" disabled={busy||d.status!=='draft'||d.external_account_id!==account.external_account_id} onClick={()=>prepare({actionType:'launch',draftId:d.id})}>집행 승인 요청</button></div></article>):<p>저장한 광고 초안이 없습니다.</p>}</section></>:connection):null}
   {tab==='approvals'?<AdsApprovals {...{actions,busy}} executionEnabled={status?.executionEnabled===true} onAction={(id,kind,body)=>run(()=>post('/actions/'+encodeURIComponent(id)+'/'+kind,body),kind==='approve'?'승인을 기록했습니다. 실행은 별도입니다.':kind==='execute'?'Meta에 요청한 설정을 다시 조회해 확인했습니다. 실제 광고 심사·게재 상태는 기존 광고 탭에서 확인하세요.':'요청 상태를 갱신했습니다.')}/>:null}
  </div>
 </div>;
}
