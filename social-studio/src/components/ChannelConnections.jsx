import { useEffect, useState } from 'react';
import { api, formatDate } from '../lib/api.js';

export default function ChannelConnections({ onStatus }) {
  const [channels,setChannels] = useState([]), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  async function load() {
    try { const result = await api('/api/channels/status'); setChannels(result.channels); onStatus?.(result.channels); }
    catch(e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);
  async function connect(channel) {
    const approved = window.confirm(`${channel.name} 연결 권한\n${channel.scopes.join(', ')}\n\n${channel.note}\n\n공식 승인 화면으로 이동할까요? 연결만으로 게시하지 않습니다.`);
    if (!approved) return;
    setBusy(true); setError('');
    try { const { url } = await api(`/api/channels/${channel.platform}/connect`,{ method:'POST',body:JSON.stringify({consent:true}) }); window.location.assign(url); }
    catch(e) { setError(e.message); setBusy(false); }
  }
  async function disconnect(channel) {
    if (!window.confirm(`${channel.name} 로컬 연결을 해제하고 미전송 예약을 취소할까요? 플랫폼 권한 철회는 해당 플랫폼에서 할 수 있습니다.`)) return;
    setBusy(true);setError('');
    try { await api(`/api/channels/${channel.platform}/disconnect`,{method:'POST'});await load(); }
    catch(e) { setError(e.message); } finally {setBusy(false);}
  }
  return <section className="panel channel-connections">
    <div className="panel-heading"><div><h2>Threads · TikTok · X 연결</h2><p>공식 사용자 승인으로 연결합니다. 앱 비밀키와 토큰은 서버에만 보관합니다.</p></div><button type="button" className="button button-secondary" disabled={busy} onClick={load}>상태 새로고침</button></div>
    {error && <div role="alert" className="alert alert-error">{error}</div>}
    <div className="channel-card-grid">{channels.map(channel => <article className="channel-card" key={channel.platform}>
      <h3>{channel.name}</h3><p><strong>{channel.connection.account_name || '연결된 계정 없음'}</strong> · {channel.connection.status}</p>
      <p>{channel.note}</p><p>권한: <code>{channel.scopes.join(', ')}</code></p>
      <p>콜백: <code>{channel.callbackUrl}</code></p>
      <p>실제 업로드·게시: <strong>{channel.writesEnabled && channel.billingApproved ? '활성' : '비활성'}</strong></p>
      {channel.connection.expires_at && <p>토큰 만료: {formatDate(channel.connection.expires_at)}</p>}
      {(!channel.configured || !channel.connectEnabled) && <p className="helper">관리자가 앱 등록·콜백·서버 설정을 완료한 뒤 연결할 수 있습니다.</p>}
      {!channel.billingApproved && <p className="helper">X 비용·크레딧 사용 승인 필요</p>}
      <button type="button" className="button button-secondary" disabled={busy || !channel.configured || !channel.connectEnabled || !channel.billingApproved} onClick={()=>connect(channel)}>{channel.connection.status === 'disconnected' ? `${channel.name} 연결` : `${channel.name} 다시 연결`}</button>
      {channel.connection.status !== 'disconnected' && <button type="button" className="button button-danger" disabled={busy} onClick={()=>disconnect(channel)}>연결 해제</button>}
    </article>)}</div>
    <p className="helper">현재 assistant와의 직접 MCP 연결은 구성하지 않습니다. 이 화면은 Social Studio의 사용자 연결과 게시 상태만 다룹니다.</p>
  </section>;
}
