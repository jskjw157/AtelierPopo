import { useEffect, useState } from 'react';
import { api, formatDate } from '../lib/api.js';
import ChannelConnections from '../components/ChannelConnections.jsx';

const names = { threads:'Threads',tiktok:'TikTok',x:'X' };
const formats = { threads:[['text','텍스트'],['image','이미지 1장'],['carousel','이미지 2~10장'],['video','영상 1개']],tiktok:[['video','영상 초안 1개']],x:[['text','텍스트'],['image','이미지 1~4장']] };
const states = { draft:'초안',queued:'전송 대기',scheduled:'예약',publishing:'전송 시작',processing:'플랫폼 처리 중',published:'게시 완료',awaiting_user:'TikTok에서 최종 게시 필요',failed:'전송 전 오류',uncertain:'결과 불확실 · 재전송 잠김',cancelled:'취소됨' };

export default function ChannelsPage() {
  const [channels,setChannels] = useState([]), [media,setMedia] = useState([]), [posts,setPosts] = useState([]);
  const [platform,setPlatform] = useState('threads'), [format,setFormat] = useState('text'), [caption,setCaption] = useState('');
  const [selected,setSelected] = useState([]), [mode,setMode] = useState('draft'), [scheduledAt,setScheduledAt] = useState(''), [consent,setConsent] = useState(false);
  const [requestId,setRequestId] = useState(()=>crypto.randomUUID()), [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('');
  const channel = channels.find(c=>c.platform===platform);
  const maySend = channel?.connection.status === 'connected' && channel?.writesEnabled && channel?.billingApproved && channel?.connectEnabled;
  async function load() { const [m,p] = await Promise.all([api('/api/media'),api('/api/channels/posts')]);setMedia(m.media);setPosts(p.posts); }
  useEffect(()=>{load().catch(e=>setError(e.message)); const params=new URLSearchParams(window.location.search);if(params.has('connection_error'))setError('계정 연결에 실패했습니다. 승인·만료·서버 설정을 확인하고 다시 연결해 주세요.');if(params.has('connected'))setMessage('계정 연결을 저장했습니다. 실제 업로드·게시는 별도로 승인해야 합니다.');},[]);
  function changed() { setRequestId(crypto.randomUUID());setConsent(false);setMessage(''); }
  function choosePlatform(value) { changed();setPlatform(value);setFormat(formats[value][0][0]);setSelected([]); }
  async function submit(e) {
    e.preventDefault();setError('');setMessage('');
    const target=channel?.connection.account_name || '연결되지 않음';
    if (!window.confirm(`${names[platform]} · 대상: ${target}\n${mode==='draft'?'초안 저장':mode==='schedule'?'선택한 시간에 한 번 전송':platform==='tiktok'?'받은 편지함에 업로드, TikTok에서 최종 게시 필요':'실제 게시'}\n\n${caption}\n미디어 ${selected.length}개\n이 내용으로 진행할까요?`)) return;
    setBusy(true);
    try {
      const result = await api('/api/channels/posts',{method:'POST',body:JSON.stringify({clientRequestId:requestId,platform,format,caption,mediaAssetIds:selected,mode,scheduledAt:mode==='schedule'?new Date(scheduledAt).toISOString():null,consent,accountGeneration:channel?.connection.generation || null})});
      setMessage(`처리 결과: ${states[result.dispatch?.state || result.post.state]}${result.duplicate?' (기존 요청 확인)':''}`);
      await load();
    } catch(e) { setError(e.message); } finally {setBusy(false);}
  }
  async function action(post,type) {
    if(type==='cancel'&&!window.confirm('미전송 요청을 취소할까요?'))return;
    setBusy(true);setError('');
    try { await api(`/api/channels/posts/${post.id}/${type}`,{method:'POST'});await load(); }
    catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  function loadDraft(post) {changed();setPlatform(post.platform);setFormat(post.format);setCaption(post.caption);setSelected(post.media_asset_ids);setMode('draft');setMessage('초안을 복사했습니다. 대상과 내용을 다시 확인한 후 새 요청으로 저장합니다.');}
  return <div className="page-wrap"><header className="page-header"><div><span className="eyebrow">CHANNELS</span><h1>새 채널 게시</h1><p>Threads·X 게시와 TikTok 영상 초안 업로드를 준비합니다. 예약은 지정한 시간에 한 번 전송합니다.</p></div></header>
    <ChannelConnections onStatus={setChannels}/>
    {error&&<div role="alert" className="alert alert-error">{error}</div>}{message&&<div role="status" className="alert alert-success">{message}</div>}
    <form className="panel" onSubmit={submit}><fieldset disabled={busy} className="channel-fieldset"><legend>게시 내용과 대상 확인</legend>
      <div className="form-grid"><label>채널<select value={platform} onChange={e=>choosePlatform(e.target.value)}>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <label>형식<select value={format} onChange={e=>{changed();setFormat(e.target.value);setSelected([]);}}>{formats[platform].map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label></div>
      <p>전송 대상: <strong>{channel?.connection.account_name || '연결되지 않음'}</strong></p>
      {platform==='tiktok'&&<div className="alert alert-warning">공개 자동게시 기능이 아닙니다. 영상 수신 후 TikTok 알림에서 검토·편집·공개범위를 선택하고 최종 게시해야 합니다. 아래 문구는 내부 메모이며 영상 초안 API에 전달되지 않습니다.</div>}
      <label>{platform==='tiktok'?'내부 문구 메모':'최종 본문'}<textarea rows={5} value={caption} onChange={e=>{changed();setCaption(e.target.value);}}/></label>
      {format!=='text'&&<div className="channel-media-grid">{media.filter(a=>a.media_type===(format==='video'?'video':'image')).map(asset=><label className="channel-media-choice" key={asset.id}><input type="checkbox" checked={selected.includes(asset.id)} onChange={()=>{changed();setSelected(v=>v.includes(asset.id)?v.filter(id=>id!==asset.id):[...v,asset.id]);}}/>{asset.media_type==='image'?<img src={`/api/media/${asset.id}/preview`} alt=""/>:<video src={`/api/media/${asset.id}/preview`} preload="metadata" muted/>}<span>{asset.original_name}</span></label>)}</div>}
      <label>동작<select value={mode} onChange={e=>{changed();setMode(e.target.value);}}><option value="draft">초안 저장</option><option value="publish">{platform==='tiktok'?'지금 초안 업로드':'지금 게시'}</option><option value="schedule">한 번 예약 전송</option></select></label>
      {mode==='schedule'&&<label>예약 시간 (현재 브라우저 시간대)<input type="datetime-local" required value={scheduledAt} onChange={e=>{changed();setScheduledAt(e.target.value);}}/></label>}
      {!maySend&&<p className="helper">실계정 연결·운영 전송 승인 전에는 초안 저장만 가능합니다.</p>}
      <label className="channel-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>위 대상·본문·미디어·예약 시각을 확인했으며 선택한 동작에 동의합니다.{platform==='x'?' X API 과금이 발생할 수 있습니다.':''}{platform==='tiktok'?' TikTok에서 최종 게시가 필요함을 확인했습니다.':''}</label>
      <button type="submit" className="button button-primary" disabled={!consent || busy || (mode!=='draft'&&!maySend)}>{busy?'처리 중…':'최종 확인'}</button>
    </fieldset></form>
    <section className="panel"><div className="panel-heading"><h2>새 채널 예약·전송 기록</h2><button className="button button-secondary" disabled={busy} onClick={()=>load().catch(e=>setError(e.message))}>기록 새로고침</button></div>
      <p className="helper">결과 불확실 상태는 자동 재전송하지 않습니다. 플랫폼에서 원래 게시 여부를 확인해야 합니다. 기존 Instagram/Facebook 기록은 예약 캘린더와 활동 기록에서 확인할 수 있습니다.</p>
      {posts.map(post=><article className="channel-history" key={post.id}><strong>{names[post.platform]} · {states[post.state]}</strong><p className="channel-caption">{post.caption}</p><p>{post.scheduled_at?`예약: ${formatDate(post.scheduled_at)}`:`생성: ${formatDate(post.created_at)}`} · {post.media_asset_ids.length}개 미디어</p>{post.last_error&&<p role="status">오류 코드: {post.last_error}</p>}{post.permalink&&<a href={post.permalink} rel="noreferrer" target="_blank">플랫폼 게시물 열기</a>}{post.state==='processing'&&<button className="button button-secondary" disabled={busy} onClick={()=>action(post,'status')}>처리 상태 확인</button>}{['draft','queued','scheduled'].includes(post.state)&&<button className="button button-secondary" disabled={busy} onClick={()=>action(post,'cancel')}>미전송 요청 취소</button>}{post.state==='draft'&&<button className="button button-secondary" disabled={busy} onClick={()=>loadDraft(post)}>초안 불러오기</button>}</article>)}
      {!posts.length&&<p>아직 저장된 새 채널 요청이 없습니다.</p>}
    </section>
  </div>;
}
