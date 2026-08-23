import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, FilePenLine, RefreshCw } from 'lucide-react';
import { api, formatDate } from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError('');
    try { setData(await api('/api/dashboard')); } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const cards = data ? [
    ['초안', data.counts.drafts, FilePenLine, '검토 전 콘텐츠'],
    ['예약', data.counts.scheduled, CalendarClock, '발행 대기 중'],
    ['발행 완료', data.counts.published, CheckCircle2, '실제 게시된 건'],
    ['실패', data.counts.failed, AlertTriangle, '조치가 필요한 건']
  ] : [];

  return (
    <div className="page-wrap">
      <header className="page-header"><div><span className="eyebrow">OVERVIEW</span><h1>대시보드</h1><p>실제 저장된 게시 상태와 계정 건강 상태만 표시합니다.</p></div><button className="button button-secondary" onClick={load}><RefreshCw size={16} />새로고침</button></header>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {loading ? <div className="skeleton-grid">{[1,2,3,4].map((i)=><div className="skeleton-card" key={i}/>)}</div> : null}
      {data ? <>
        <section className="stat-grid">{cards.map(([label,value,Icon,desc])=><article className="stat-card" key={label}><div><span>{label}</span><strong>{value}</strong><small>{desc}</small></div><Icon size={22}/></article>)}</section>
        <section className="dashboard-grid">
          <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CONNECTIONS</span><h2>계정 연결 상태</h2></div></div><div className="connection-list">{['instagram','facebook'].map((platform)=>{const item=data.connections.connections[platform]; return <div className="connection-row" key={platform}><div><strong>{platform==='instagram'?'Instagram':'Facebook Page'}</strong><span>{item.account_name || '연결된 계정 없음'}</span></div><StatusBadge value={item.status}/></div>})}</div>{!data.connections.configured?<div className="alert alert-warning">Meta 환경 변수 설정이 필요합니다: {data.connections.missing.join(', ')}</div>:null}</article>
          <article className="panel"><div className="panel-heading"><div><span className="eyebrow">SCHEDULER</span><h2>예약 발행 엔진</h2></div><StatusBadge value={data.scheduler.active?'completed':data.scheduler.configured?'disconnected':'not_configured'}/></div><dl className="definition-list"><div><dt>CRON 설정</dt><dd>{data.scheduler.configured?'설정됨':'설정 안 됨'}</dd></div><div><dt>마지막 실행</dt><dd>{formatDate(data.scheduler.lastRun?.started_at)}</dd></div><div><dt>최근 결과</dt><dd>{data.scheduler.lastRun?.status || '실행 기록 없음'}</dd></div></dl><p className="helper">CRON_SECRET만 입력했다고 활성 상태로 표시하지 않습니다. 실제 성공 실행 기록이 있어야 활성으로 판단합니다.</p></article>
        </section>
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">CAMPAIGNS</span><h2>최근 캠페인</h2></div></div>{data.recentCampaigns?.length?<div className="campaign-list">{data.recentCampaigns.map(item=><article key={item.id}><div><strong>{item.title}</strong><span>{item.product_name||'상품 연결 없음'} · 채널 {item.variant_count}개</span></div><StatusBadge value={item.status}/>{['draft','reviewed','scheduled','failed'].includes(item.status)?<Link className="button button-ghost" to={`/compose?campaign=${item.id}`}>열기</Link>:null}</article>)}</div>:<EmptyState title="캠페인이 없습니다" description="콘텐츠 작성에서 첫 캠페인을 저장해 주세요."/>}</section>
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">ACTIVITY</span><h2>최근 활동</h2></div></div>{data.recentActivity.length?<div className="table-wrap"><table><thead><tr><th>작업</th><th>대상</th><th>시간</th></tr></thead><tbody>{data.recentActivity.map((item,index)=><tr key={`${item.created_at}-${index}`}><td>{item.action}</td><td>{item.entity_type}{item.entity_id?` · ${item.entity_id.slice(0,8)}`:''}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table></div>:<EmptyState title="아직 활동 기록이 없습니다" description="계정을 연결하거나 콘텐츠를 저장하면 기록이 쌓입니다."/>}</section>
      </>:null}
    </div>
  );
}
