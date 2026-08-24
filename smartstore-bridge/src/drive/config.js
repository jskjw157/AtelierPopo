import fs from 'node:fs';
import path from 'node:path';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DEFAULT_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DEFAULT_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/drive/v3';
const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,256}$/;

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function asInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('object required');
    }
    return value;
  } catch (error) {
    throw new Error(`${label}가 올바른 JSON 객체가 아닙니다: ${error.message}`);
  }
}

function decodeBase64Json(value, label) {
  let decoded;
  try {
    decoded = Buffer.from(String(value), 'base64').toString('utf8');
  } catch (error) {
    throw new Error(`${label} Base64 디코딩에 실패했습니다: ${error.message}`);
  }
  return parseJson(decoded, label);
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim();
}

export function loadGoogleServiceAccount(env = process.env) {
  let raw = null;
  let source = null;

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    raw = decodeBase64Json(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
    source = 'base64-env';
  } else if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    raw = parseJson(env.GOOGLE_SERVICE_ACCOUNT_JSON, 'GOOGLE_SERVICE_ACCOUNT_JSON');
    source = 'json-env';
  } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credentialsPath = path.resolve(env.GOOGLE_APPLICATION_CREDENTIALS);
    if (!fs.existsSync(credentialsPath)) {
      throw new Error(`Google 서비스 계정 파일을 찾을 수 없습니다: ${credentialsPath}`);
    }
    raw = parseJson(fs.readFileSync(credentialsPath, 'utf8'), 'GOOGLE_APPLICATION_CREDENTIALS');
    source = 'file';
  }

  if (!raw) return null;

  const serviceAccount = {
    type: raw.type || 'service_account',
    projectId: raw.project_id || '',
    privateKeyId: raw.private_key_id || '',
    privateKey: normalizePrivateKey(raw.private_key),
    clientEmail: String(raw.client_email || '').trim(),
    clientId: String(raw.client_id || '').trim(),
    tokenUri: String(raw.token_uri || DEFAULT_TOKEN_URL).trim(),
    source
  };

  if (serviceAccount.type !== 'service_account') {
    throw new Error(`지원하지 않는 Google 자격증명 유형입니다: ${serviceAccount.type}`);
  }
  if (!serviceAccount.clientEmail || !serviceAccount.privateKey) {
    throw new Error('Google 서비스 계정의 client_email 또는 private_key가 비어 있습니다.');
  }
  if (!serviceAccount.privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Google 서비스 계정 private_key 형식이 올바르지 않습니다.');
  }
  return serviceAccount;
}

export function loadGoogleUserOAuth(env = process.env) {
  const clientId = String(env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();
  if (!clientId && !clientSecret && !refreshToken) return null;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google 사용자 OAuth에는 GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN이 모두 필요합니다.');
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    tokenUri: String(env.GOOGLE_OAUTH_TOKEN_URI || DEFAULT_TOKEN_URL).trim(),
    userEmail: String(env.GOOGLE_OAUTH_USER_EMAIL || '').trim(),
    source: 'refresh-token-env'
  };
}

function normalizeFolderId(value, label, { required = false } = {}) {
  const id = String(value || '').trim();
  if (!id) {
    if (required) throw new Error(`${label}가 설정되지 않았습니다.`);
    return '';
  }
  if (!FILE_ID_PATTERN.test(id)) {
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  }
  return id;
}

export function loadDriveConfig(env = process.env) {
  const serviceAccount = loadGoogleServiceAccount(env);
  const userOAuth = loadGoogleUserOAuth(env);
  const provider = String(env.ATELIER_DRIVE_PROVIDER || (serviceAccount || userOAuth ? 'google-drive' : 'disabled'))
    .trim()
    .toLowerCase();
  const enabled = provider === 'google-drive';
  const requestedAuthMode = String(env.GOOGLE_DRIVE_AUTH_MODE || 'auto').trim().toLowerCase();
  const authMode = requestedAuthMode === 'auto'
    ? (userOAuth ? 'user-oauth' : (serviceAccount ? 'service-account' : 'none'))
    : requestedAuthMode;
  if (!['none', 'service-account', 'user-oauth'].includes(authMode)) {
    throw new Error(`GOOGLE_DRIVE_AUTH_MODE 값이 올바르지 않습니다: ${authMode}`);
  }
  if (enabled && authMode === 'service-account' && !serviceAccount) {
    throw new Error('GOOGLE_DRIVE_AUTH_MODE=service-account이지만 서비스 계정 자격증명이 없습니다.');
  }
  if (enabled && authMode === 'user-oauth' && !userOAuth) {
    throw new Error('GOOGLE_DRIVE_AUTH_MODE=user-oauth이지만 사용자 OAuth refresh token 자격증명이 없습니다.');
  }
  if (enabled && authMode === 'none') {
    throw new Error('ATELIER_DRIVE_PROVIDER=google-drive이지만 Google 인증 자격증명이 없습니다.');
  }

  const rootFolderId = normalizeFolderId(env.GOOGLE_DRIVE_ROOT_FOLDER_ID, 'GOOGLE_DRIVE_ROOT_FOLDER_ID', {
    required: enabled
  });
  const catalogFolderId = normalizeFolderId(env.GOOGLE_DRIVE_CATALOG_FOLDER_ID, 'GOOGLE_DRIVE_CATALOG_FOLDER_ID');
  const finalDetailFolderId = normalizeFolderId(
    env.GOOGLE_DRIVE_FINAL_DETAIL_FOLDER_ID,
    'GOOGLE_DRIVE_FINAL_DETAIL_FOLDER_ID'
  );
  const extraRoots = String(env.GOOGLE_DRIVE_ALLOWED_ROOT_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map((value, index) => normalizeFolderId(value, `GOOGLE_DRIVE_ALLOWED_ROOT_IDS[${index}]`));
  const allowedRootIds = [...new Set([rootFolderId, ...extraRoots].filter(Boolean))];
  const scope = String(env.GOOGLE_DRIVE_SCOPE || DRIVE_SCOPE).trim();
  if (enabled && scope !== DRIVE_SCOPE) {
    throw new Error(`Google Drive 전체 쓰기 통합에는 scope=${DRIVE_SCOPE}가 필요합니다.`);
  }

  return {
    enabled,
    provider,
    authMode,
    scope,
    serviceAccount,
    userOAuth,
    apiBaseUrl: String(env.GOOGLE_DRIVE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, ''),
    uploadBaseUrl: String(env.GOOGLE_DRIVE_UPLOAD_BASE_URL || DEFAULT_UPLOAD_BASE_URL).replace(/\/$/, ''),
    rootFolderId,
    catalogFolderId,
    finalDetailFolderId,
    allowedRootIds,
    allowWrites: asBoolean(env.ATELIER_DRIVE_ALLOW_WRITES, false),
    allowMoves: asBoolean(env.ATELIER_DRIVE_ALLOW_MOVES, false),
    allowTrash: asBoolean(env.ATELIER_DRIVE_ALLOW_TRASH, false),
    allowPermanentDelete: asBoolean(env.ATELIER_DRIVE_ALLOW_PERMANENT_DELETE, false),
    allowPermissionChanges: asBoolean(env.ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES, false),
    requireUserOAuthForMyDriveCreates: asBoolean(env.ATELIER_DRIVE_REQUIRE_USER_OAUTH_FOR_MY_DRIVE_CREATES, true),
    maxUploadBytes: asInteger(env.ATELIER_DRIVE_MAX_UPLOAD_BYTES, 1024 * 1024 * 1024, {
      min: 1024,
      max: 5 * 1024 * 1024 * 1024
    }),
    maxJsonBodyBytes: asInteger(env.ATELIER_DRIVE_MAX_JSON_BODY_BYTES, 16 * 1024 * 1024, {
      min: 64 * 1024,
      max: 64 * 1024 * 1024
    }),
    maxInlineDownloadBytes: asInteger(env.ATELIER_DRIVE_MAX_INLINE_DOWNLOAD_BYTES, 10 * 1024 * 1024, {
      min: 1024,
      max: 64 * 1024 * 1024
    }),
    requestTimeoutMs: asInteger(env.ATELIER_DRIVE_REQUEST_TIMEOUT_MS, 60_000, {
      min: 5_000,
      max: 15 * 60_000
    }),
    maxRetries: asInteger(env.ATELIER_DRIVE_MAX_RETRIES, 4, { min: 0, max: 8 }),
    boundaryCacheTtlMs: asInteger(env.ATELIER_DRIVE_BOUNDARY_CACHE_TTL_MS, 5 * 60_000, {
      min: 1_000,
      max: 60 * 60_000
    }),
    cacheDir: path.resolve(env.ATELIER_DRIVE_CACHE_DIR || '/tmp/atelier-drive-cache'),
    cacheTtlSeconds: asInteger(env.ATELIER_DRIVE_CACHE_TTL_SECONDS, 3600, {
      min: 0,
      max: 30 * 24 * 3600
    }),
    canaryPermissionEmail: String(env.GOOGLE_DRIVE_CANARY_PERMISSION_EMAIL || '').trim()
  };
}

export function publicDriveConfig(config) {
  return {
    enabled: Boolean(config?.enabled),
    provider: config?.provider || 'disabled',
    authMode: config?.authMode || 'none',
    scope: config?.scope || null,
    rootFolderId: config?.rootFolderId || null,
    catalogFolderId: config?.catalogFolderId || null,
    finalDetailFolderId: config?.finalDetailFolderId || null,
    allowedRootCount: config?.allowedRootIds?.length || 0,
    serviceAccountConfigured: Boolean(config?.serviceAccount),
    serviceAccountEmail: config?.serviceAccount?.clientEmail || null,
    userOAuthConfigured: Boolean(config?.userOAuth),
    userOAuthEmail: config?.userOAuth?.userEmail || null,
    credentialSource: config?.authMode === 'user-oauth'
      ? config?.userOAuth?.source || null
      : config?.serviceAccount?.source || null,
    writesEnabled: Boolean(config?.allowWrites),
    movesEnabled: Boolean(config?.allowMoves),
    trashEnabled: Boolean(config?.allowTrash),
    permanentDeleteEnabled: Boolean(config?.allowPermanentDelete),
    permissionChangesEnabled: Boolean(config?.allowPermissionChanges),
    requireUserOAuthForMyDriveCreates: Boolean(config?.requireUserOAuthForMyDriveCreates),
    maxUploadBytes: config?.maxUploadBytes || 0,
    maxInlineDownloadBytes: config?.maxInlineDownloadBytes || 0
  };
}

export { DRIVE_SCOPE, FILE_ID_PATTERN };
