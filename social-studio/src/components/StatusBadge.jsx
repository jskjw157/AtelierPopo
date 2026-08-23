const labels = {
  not_configured: '설정 필요', disconnected: '연결 안 됨', connecting: '연결 중', connected: '연결됨',
  expired: '토큰 만료', permission_error: '권한 오류', api_error: 'API 오류',
  draft: '초안', reviewed: '발행 대기', scheduled: '예약', queued: '재시도 대기',
  publishing: '발행 중', published: '발행 완료', partially_published: '일부 발행', failed: '실패', cancelled: '취소',
  completed: '완료', completed_with_errors: '일부 실패', running: '실행 중'
};

export default function StatusBadge({ value }) {
  const positive = ['connected', 'published', 'completed'].includes(value);
  const warning = ['scheduled', 'queued', 'reviewed', 'connecting', 'running'].includes(value);
  const negative = ['failed', 'partially_published', 'expired', 'permission_error', 'api_error', 'completed_with_errors'].includes(value);
  return (
    <span className={`status-badge ${positive ? 'status-positive' : warning ? 'status-warning' : negative ? 'status-negative' : ''}`}>
      {labels[value] || value || '—'}
    </span>
  );
}
