import { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../App.jsx';

export default function LoginPage() {
  const { setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await api('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ email, password })
      });
      setUser(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-editorial">
        <span className="eyebrow">HAAR INTERNAL</span>
        <h1>한 번의 준비로,<br />채널마다 정확하게.</h1>
        <p>주얼리 콘텐츠를 저장하고 검토한 뒤 Instagram과 Facebook Page에 안전하게 발행합니다.</p>
        <div className="editorial-line" />
        <small>Social publishing · Scheduling · Audit</small>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <span className="login-lock"><LockKeyhole size={20} /></span>
          <div><span className="eyebrow">ADMIN ACCESS</span><h2>HAAR Social Studio</h2><p>승인된 관리자 계정으로 로그인하세요.</p></div>
          <label>이메일<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
          <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          {error ? <div className="alert alert-error">{error}</div> : null}
          <button className="button button-primary button-wide" disabled={submitting}>{submitting ? '확인 중…' : <>로그인 <ArrowRight size={17} /></>}</button>
          <small className="muted">계정 정보는 서버의 암호화된 환경 변수로 관리됩니다.</small>
        </form>
      </section>
    </div>
  );
}
