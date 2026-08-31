import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { api } from '../lib/api.js';

const initialForm = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
};

function passwordByteLength(value) {
  return new TextEncoder().encode(value).length;
}

export default function PasswordChangeCard() {
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!form.currentPassword) {
      setError('현재 비밀번호를 입력해 주세요.');
      return;
    }
    if (form.newPassword.length < 12) {
      setError('새 비밀번호는 12자 이상이어야 합니다.');
      return;
    }
    if (passwordByteLength(form.newPassword) > 72) {
      setError('새 비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      setError('새 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (form.currentPassword === form.newPassword) {
      setError('현재 비밀번호와 다른 비밀번호를 사용해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm(initialForm);
      setMessage(result.message);
      window.setTimeout(() => {
        window.location.assign('/login?passwordChanged=1');
      }, 700);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel full-span">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SECURITY</span>
          <h2>관리자 비밀번호 변경</h2>
          <p>현재 비밀번호를 확인한 뒤 새 비밀번호를 서버에 안전하게 저장합니다.</p>
        </div>
        <KeyRound size={22} />
      </div>

      <form className="form-grid" onSubmit={submit}>
        <label>
          현재 비밀번호
          <input
            type="password"
            value={form.currentPassword}
            onChange={(event) => update('currentPassword', event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <div className="architecture-note">
          <KeyRound size={20} />
          <div>
            <strong>비밀번호 기준</strong>
            <p>12자 이상, UTF-8 기준 72바이트 이하이며 현재 비밀번호와 달라야 합니다.</p>
          </div>
        </div>
        <label>
          새 비밀번호
          <input
            type="password"
            value={form.newPassword}
            onChange={(event) => update('newPassword', event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
          <small className="helper">현재 {form.newPassword.length}자 · {passwordByteLength(form.newPassword)}바이트</small>
        </label>
        <label>
          새 비밀번호 확인
          <input
            type="password"
            value={form.confirmPassword}
            onChange={(event) => update('confirmPassword', event.target.value)}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>

        {error ? <div className="alert alert-error full-span" role="alert">{error}</div> : null}
        {message ? <div className="alert alert-success full-span" role="status">{message}</div> : null}

        <div className="form-actions">
          <button className="button button-primary" disabled={submitting}>
            <LogOut size={16} />
            {submitting ? '변경 중…' : '비밀번호 변경 후 다시 로그인'}
          </button>
        </div>
      </form>
    </section>
  );
}
