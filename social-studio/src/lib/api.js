function cookie(name) {
  const found = document.cookie
    .split('; ')
    .find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : '';
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (!['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) {
    const csrf = cookie('haar_csrf');
    if (csrf) headers.set('x-csrf-token', csrf);
  }

  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `요청 실패 (${response.status})`);
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }
  return payload;
}

export function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date).replace(/\. /g, '.').replace('.', '.');
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function classNames(...values) {
  return values.filter(Boolean).join(' ');
}
