import path from 'node:path';

function asBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/$/, '');
}


function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validEncryptionKey(value) {
  if (/^[a-f0-9]{64}$/i.test(value)) return true;
  try {
    return Buffer.from(value, 'base64').length === 32;
  } catch {
    return false;
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';
const appBaseUrlInput = process.env.APP_BASE_URL || (nodeEnv === 'production' ? '' : 'http://localhost:3000');

export const config = {
  nodeEnv,
  port: Number(process.env.PORT || 3000),
  appBaseUrl: normalizeBaseUrl(appBaseUrlInput),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: asBoolean(process.env.DATABASE_SSL),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  mediaSigningSecret: process.env.MEDIA_SIGNING_SECRET || '',
  cronSecret: process.env.CRON_SECRET || '',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './data/uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024),
  meta: {
    graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    redirectUri:
      process.env.META_REDIRECT_URI ||
      (appBaseUrlInput ? `${normalizeBaseUrl(appBaseUrlInput)}/api/meta/callback` : ''),
    scopes: (process.env.META_SCOPES ||
      'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
  }
};

export function coreMissingConfig() {
  const required = {
    APP_BASE_URL: config.appBaseUrl,
    DATABASE_URL: config.databaseUrl,
    ADMIN_EMAIL: config.adminEmail,
    ADMIN_PASSWORD_HASH: config.adminPasswordHash,
    SESSION_SECRET: config.sessionSecret,
    TOKEN_ENCRYPTION_KEY: config.tokenEncryptionKey,
    MEDIA_SIGNING_SECRET: config.mediaSigningSecret
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

export function metaMissingConfig() {
  const required = {
    META_APP_ID: config.meta.appId,
    META_APP_SECRET: config.meta.appSecret,
    META_REDIRECT_URI: config.meta.redirectUri,
    META_GRAPH_VERSION: config.meta.graphVersion,
    APP_BASE_URL: config.appBaseUrl
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}



export function coreConfigErrors() {
  const errors = [];
  if (config.appBaseUrl && !isHttpUrl(config.appBaseUrl)) errors.push('APP_BASE_URL_INVALID');
  if (config.sessionSecret && config.sessionSecret.length < 32) errors.push('SESSION_SECRET_TOO_SHORT');
  if (config.mediaSigningSecret && config.mediaSigningSecret.length < 32) errors.push('MEDIA_SIGNING_SECRET_TOO_SHORT');
  if (config.cronSecret && config.cronSecret.length < 32) errors.push('CRON_SECRET_TOO_SHORT');
  if (config.tokenEncryptionKey && !validEncryptionKey(config.tokenEncryptionKey)) errors.push('TOKEN_ENCRYPTION_KEY_INVALID');
  if (config.adminPasswordHash && !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(config.adminPasswordHash)) errors.push('ADMIN_PASSWORD_HASH_INVALID');
  return errors;
}

export function isProduction() {
  return config.nodeEnv === 'production';
}
