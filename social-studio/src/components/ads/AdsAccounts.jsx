import {useState} from 'react';
import {date} from './format.js';
export function AdsAccounts({status,accounts,onConnect,onDiscover,onSelect,onTest,onDisconnect,busy}){
 const [choice,setChoice]=useState('');
 return <section className="panel"><div className="ads-heading"><div><span className="eyebrow">META MARKETING</span><h2>광고 계정 연결</h2></div><span className="ads-state">{status?.readable?'광고 조회 권한 있음':'광고 권한 연결 필요'}</span></div>
  <p>게시용 Facebook·Instagram 연결과 별도로 광고 권한을 승인합니다. 기존 SNS 게시 연결은 유지됩니다.</p>
  <dl className="ads-details"><div><dt>광고 관리 권한</dt><dd>{status?.managementGranted?'승인됨 (실제 집행은 별도 검증)':'미승인'}</dd></div><div><dt>현재 계정</dt><dd>{status?.selectedAccount?.name||'선택 안 됨'}</dd></div><div><dt>통화 / 시간대</dt><dd>{status?.selectedAccount?.currency||'—'} / {status?.selectedAccount?.timezone_name||'—'}</dd></div><div><dt>토큰 만료</dt><dd>{date(status?.tokenExpiresAt)}</dd></div></dl>
  <div className="form-actions left"><button className="button button-primary" disabled={busy} onClick={onConnect}>Meta 광고 권한 연결</button><button className="button button-secondary" disabled={busy||!status?.readable} onClick={onDiscover}>계정 목록 조회</button><button className="button button-secondary" disabled={busy||!status?.selectedAccount} onClick={onTest}>읽기 연결 테스트</button></div>
  {accounts.length?<div className="ads-filters"><label>운영할 광고 계정<select value={choice||status?.selectedAccount?.external_account_id||''} onChange={e=>setChoice(e.target.value)}><option value="">선택</option>{accounts.map(a=><option key={a.external_account_id} value={a.external_account_id}>{a.name} · {a.currency} · {a.external_account_id}</option>)}</select></label><button className="button button-secondary" disabled={busy||!(choice||status?.selectedAccount)} onClick={()=>onSelect(choice||status.selectedAccount.external_account_id)}>선택 저장</button></div>:null}
  <p className="helper">승인된 권한: {status?.scopes?.join(', ')||'없음'}<br/>계정 선택이나 재연결 시 기존 승인 요청은 무효가 될 수 있습니다. 페이지·인스타 연결 정보와 광고 토큰을 혼용하지 않습니다.</p>
  {status?.connected?<button className="button button-ghost" disabled={busy} onClick={onDisconnect}>광고 연결만 해제</button>:null}
 </section>;
}
