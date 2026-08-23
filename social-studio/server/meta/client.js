import { config } from '../config.js';
import { safeErrorMessage } from '../security.js';

export class MetaApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MetaApiError';
    this.status = details.httpStatus || 502;
    this.code = 'META_API_ERROR';
    this.metaCode = details.metaCode;
    this.metaSubcode = details.metaSubcode;
    this.requestId = details.requestId;
    this.isTransient = Boolean(details.isTransient);
    this.details = {
      metaCode: this.metaCode,
      metaSubcode: this.metaSubcode,
      requestId: this.requestId,
      transient: this.isTransient
    };
  }
}

function graphUrl(pathname) {
  const cleanPath = String(pathname).replace(/^\//, '');
  return new URL(`https://graph.facebook.com/${config.meta.graphVersion}/${cleanPath}`);
}

function encodeParams(params) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form;
}

function transientMetaCode(code) {
  return [1, 2, 4, 17, 32, 341, 613].includes(Number(code));
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 500) };
  }

  if (!response.ok || payload.error) {
    const metaError = payload.error || {};
    const message = safeErrorMessage(metaError.error_user_msg || metaError.message || `Meta API HTTP ${response.status}`);
    throw new MetaApiError(message, {
      httpStatus: response.status >= 500 ? 502 : 400,
      metaCode: metaError.code,
      metaSubcode: metaError.error_subcode,
      requestId: metaError.fbtrace_id || response.headers.get('x-fb-trace-id'),
      isTransient: Boolean(metaError.is_transient) || response.status >= 500 || transientMetaCode(metaError.code)
    });
  }
  return payload;
}

export async function graphGet(pathname, accessToken, params = {}) {
  const url = graphUrl(pathname);
  const query = encodeParams({ ...params, access_token: accessToken });
  url.search = query.toString();
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000)
  });
  return parseResponse(response);
}

export async function graphPost(pathname, accessToken, params = {}) {
  const url = graphUrl(pathname);
  const body = encodeParams({ ...params, access_token: accessToken });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body,
    signal: AbortSignal.timeout(60_000)
  });
  return parseResponse(response);
}

export async function exchangeCodeForToken(code) {
  return graphGet('/oauth/access_token', '', {
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    redirect_uri: config.meta.redirectUri,
    code
  });
}

export async function exchangeForLongLivedToken(shortLivedToken) {
  return graphGet('/oauth/access_token', '', {
    grant_type: 'fb_exchange_token',
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    fb_exchange_token: shortLivedToken
  });
}

export async function debugToken(inputToken) {
  return graphGet('/debug_token', `${config.meta.appId}|${config.meta.appSecret}`, {
    input_token: inputToken
  });
}

export function buildMetaOAuthUrl(state) {
  const url = new URL(`https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', config.meta.appId);
  url.searchParams.set('redirect_uri', config.meta.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', config.meta.scopes.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('auth_type', 'rerequest');
  return url.toString();
}
