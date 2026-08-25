import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createGoogleTokenProvider } from './auth.js';

const DEFAULT_FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'parents',
  'trashed',
  'driveId',
  'size',
  'md5Checksum',
  'sha1Checksum',
  'sha256Checksum',
  'createdTime',
  'modifiedTime',
  'webViewLink',
  'webContentLink',
  'iconLink',
  'thumbnailLink',
  'shortcutDetails',
  'capabilities(canEdit,canCopy,canDelete,canDownload,canMoveItemIntoTeamDrive,canMoveItemOutOfDrive,canShare,canTrash,canUntrash)'
].join(',');

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendQuery(url, query = {}) {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const child of value) url.searchParams.append(key, String(child));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

async function parseResponse(response, responseType) {
  if (responseType === 'raw') return response;
  if (responseType === 'stream') return response.body;
  if (responseType === 'buffer') return Buffer.from(await response.arrayBuffer());
  if (responseType === 'text') return response.text();
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function headersObject(headers) {
  const result = {};
  headers.forEach((value, key) => { result[key] = value; });
  return result;
}

function errorMessage(data, status) {
  return data?.error?.message || data?.message || data?.raw || `Google Drive API HTTP ${status}`;
}

export class GoogleDriveError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GoogleDriveError';
    this.status = options.status;
    this.code = options.code || 'GOOGLE_DRIVE_API_ERROR';
    this.reason = options.reason;
    this.errors = options.errors;
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
    this.body = options.body;
  }
}

export class GoogleDriveClient {
  constructor(options) {
    this.apiBaseUrl = String(options.apiBaseUrl || 'https://www.googleapis.com/drive/v3').replace(/\/$/, '');
    this.uploadBaseUrl = String(options.uploadBaseUrl || 'https://www.googleapis.com/upload/drive/v3').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = Number(options.timeoutMs || 60_000);
    this.maxRetries = Number(options.maxRetries ?? 4);
    this.tokenProvider = options.tokenProvider || createGoogleTokenProvider({
      authMode: options.authMode || (options.userOAuth ? 'user-oauth' : 'service-account'),
      serviceAccount: options.serviceAccount,
      userOAuth: options.userOAuth,
      scope: options.scope,
      fetchImpl: this.fetchImpl,
      timeoutMs: Math.min(this.timeoutMs, 30_000)
    });
  }

  buildUrl(apiPath, { base = 'api', query } = {}) {
    const baseUrl = base === 'upload' ? this.uploadBaseUrl : this.apiBaseUrl;
    const url = /^https?:\/\//i.test(String(apiPath))
      ? new URL(apiPath)
      : new URL(`${baseUrl}${apiPath}`);
    appendQuery(url, query);
    return url;
  }

  async request(method, apiPath, {
    base = 'api',
    query,
    json,
    body,
    headers = {},
    responseType = 'json',
    retrySafe,
    returnMeta = false,
    timeoutMs = this.timeoutMs
  } = {}) {
    const normalizedMethod = String(method).toUpperCase();
    const url = this.buildUrl(apiPath, { base, query });
    const safe = retrySafe ?? ['GET', 'HEAD'].includes(normalizedMethod);
    let refreshed = false;

    for (let attempt = 0; ; attempt += 1) {
      const accessToken = await this.tokenProvider.get();
      const requestHeaders = new Headers({
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...headers
      });
      let requestBody = body;
      if (json !== undefined) {
        requestHeaders.set('Content-Type', 'application/json; charset=UTF-8');
        requestBody = JSON.stringify(json);
      }

      let response;
      try {
        const init = {
          method: normalizedMethod,
          headers: requestHeaders,
          body: requestBody,
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs)
        };
        if (requestBody && typeof requestBody.pipe === 'function') init.duplex = 'half';
        response = await this.fetchImpl(url, init);
      } catch (error) {
        if (safe && attempt < this.maxRetries) {
          await sleep(Math.min(15_000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 300));
          continue;
        }
        const wrapped = new GoogleDriveError(`Google Drive 요청 결과를 확인할 수 없습니다: ${error.message}`, {
          code: safe
            ? (error.name === 'TimeoutError' ? 'GOOGLE_DRIVE_TIMEOUT' : 'GOOGLE_DRIVE_NETWORK_ERROR')
            : 'DRIVE_WRITE_OUTCOME_UNKNOWN'
        });
        wrapped.cause = error;
        throw wrapped;
      }

      if (response.status === 401 && !refreshed) {
        refreshed = true;
        this.tokenProvider.clear();
        await response.arrayBuffer().catch(() => {});
        continue;
      }

      if (!response.ok && safe && [429, 500, 502, 503, 504].includes(response.status) && attempt < this.maxRetries) {
        const retryAfterSeconds = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : Math.min(30_000, 750 * (2 ** attempt)) + Math.floor(Math.random() * 500);
        await response.arrayBuffer().catch(() => {});
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const data = await parseResponse(response, 'json');
        const firstError = data?.error?.errors?.[0] || {};
        throw new GoogleDriveError(errorMessage(data, response.status), {
          status: response.status,
          code: data?.error?.status || data?.error?.code || 'GOOGLE_DRIVE_API_ERROR',
          reason: firstError.reason,
          errors: data?.error?.errors,
          requestId: response.headers.get('x-guploader-uploadid') || response.headers.get('x-request-id'),
          retryAfter: response.headers.get('retry-after'),
          body: data
        });
      }

      const data = await parseResponse(response, responseType);
      if (!returnMeta) return data;
      return {
        data,
        status: response.status,
        headers: headersObject(response.headers),
        url: response.url
      };
    }
  }

  get(apiPath, options) { return this.request('GET', apiPath, options); }
  post(apiPath, options) { return this.request('POST', apiPath, options); }
  patch(apiPath, options) { return this.request('PATCH', apiPath, options); }
  delete(apiPath, options) { return this.request('DELETE', apiPath, options); }

  listFiles({
    q,
    pageSize = 100,
    pageToken,
    orderBy = 'folder,name_natural',
    fields = `nextPageToken,incompleteSearch,files(${DEFAULT_FILE_FIELDS})`,
    spaces = 'drive',
    corpora,
    driveId,
    includeItemsFromAllDrives = true,
    supportsAllDrives = true
  } = {}) {
    return this.get('/files', {
      query: {
        q,
        pageSize,
        pageToken,
        orderBy,
        fields,
        spaces,
        corpora,
        driveId,
        includeItemsFromAllDrives,
        supportsAllDrives
      }
    });
  }

  getFile(fileId, { fields = DEFAULT_FILE_FIELDS } = {}) {
    return this.get(`/files/${encodeURIComponent(fileId)}`, {
      query: { fields, supportsAllDrives: true }
    });
  }

  async listAllFiles(options = {}) {
    const files = [];
    let pageToken;
    do {
      const response = await this.listFiles({ ...options, pageToken });
      files.push(...(response.files || []));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return files;
  }

  listChildren(parentId, options = {}) {
    const clauses = [`'${escapeDriveQueryValue(parentId)}' in parents`];
    if (options.includeTrashed !== true) clauses.push('trashed = false');
    if (options.q) clauses.push(`(${options.q})`);
    return this.listFiles({
      ...options,
      q: clauses.join(' and ')
    });
  }

  searchByName(name, { parentId, mimeType, exact = true, includeTrashed = false, ...options } = {}) {
    const operator = exact ? '=' : 'contains';
    const clauses = [`name ${operator} '${escapeDriveQueryValue(name)}'`];
    if (parentId) clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
    if (mimeType) clauses.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
    if (!includeTrashed) clauses.push('trashed = false');
    return this.listFiles({ ...options, q: clauses.join(' and ') });
  }

  listPermissions(fileId, { fields = 'permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery,deleted,pendingOwner)' } = {}) {
    return this.get(`/files/${encodeURIComponent(fileId)}/permissions`, {
      query: { fields, supportsAllDrives: true }
    });
  }

  downloadFile(fileId, { responseType = 'buffer', acknowledgeAbuse = false } = {}) {
    return this.get(`/files/${encodeURIComponent(fileId)}`, {
      query: { alt: 'media', acknowledgeAbuse, supportsAllDrives: true },
      responseType
    });
  }

  exportFile(fileId, mimeType, { responseType = 'buffer' } = {}) {
    return this.get(`/files/${encodeURIComponent(fileId)}/export`, {
      query: { mimeType },
      responseType
    });
  }

  createFolder({ name, parentId, appProperties, description }) {
    return this.post('/files', {
      query: { fields: DEFAULT_FILE_FIELDS, supportsAllDrives: true },
      json: {
        name,
        mimeType: GOOGLE_FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
        ...(appProperties ? { appProperties } : {}),
        ...(description ? { description } : {})
      },
      retrySafe: false
    });
  }

  createFileMetadata({ name, parentId, mimeType, appProperties, description }) {
    return this.post('/files', {
      query: { fields: DEFAULT_FILE_FIELDS, supportsAllDrives: true },
      json: {
        name,
        mimeType,
        ...(parentId ? { parents: [parentId] } : {}),
        ...(appProperties ? { appProperties } : {}),
        ...(description ? { description } : {})
      },
      retrySafe: false
    });
  }

  async uploadBuffer({ name, parentId, mimeType = 'application/octet-stream', buffer, appProperties, description }) {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const boundary = `atelier_${crypto.randomBytes(16).toString('hex')}`;
    const metadata = {
      name,
      ...(parentId ? { parents: [parentId] } : {}),
      ...(appProperties ? { appProperties } : {}),
      ...(description ? { description } : {})
    };
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      'utf8'
    );
    const suffix = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const body = Buffer.concat([prefix, data, suffix]);
    return this.post('/files', {
      base: 'upload',
      query: {
        uploadType: 'multipart',
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true
      },
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body,
      retrySafe: false
    });
  }

  async createResumableSession({
    fileId,
    name,
    parentId,
    mimeType = 'application/octet-stream',
    contentLength,
    appProperties,
    description
  }) {
    const metadata = {
      ...(name ? { name } : {}),
      ...(parentId && !fileId ? { parents: [parentId] } : {}),
      ...(appProperties ? { appProperties } : {}),
      ...(description ? { description } : {})
    };
    const apiPath = fileId ? `/files/${encodeURIComponent(fileId)}` : '/files';
    const method = fileId ? 'PATCH' : 'POST';
    const response = await this.request(method, apiPath, {
      base: 'upload',
      query: {
        uploadType: 'resumable',
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true
      },
      headers: {
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(contentLength)
      },
      json: metadata,
      responseType: 'text',
      returnMeta: true,
      retrySafe: false
    });
    const location = response.headers.location;
    if (!location) throw new Error('Google Drive resumable upload Location 헤더가 없습니다.');
    return location;
  }

  async uploadLocalFile({ filePath, name = path.basename(filePath), parentId, mimeType, appProperties, description }) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`업로드 대상이 파일이 아닙니다: ${filePath}`);
    const resolvedMime = mimeType || 'application/octet-stream';
    const sessionUrl = await this.createResumableSession({
      name,
      parentId,
      mimeType: resolvedMime,
      contentLength: stat.size,
      appProperties,
      description
    });
    return this.request('PUT', sessionUrl, {
      headers: {
        'Content-Type': resolvedMime,
        'Content-Length': String(stat.size)
      },
      body: fs.createReadStream(filePath),
      retrySafe: false,
      timeoutMs: Math.max(this.timeoutMs, 15 * 60_000)
    });
  }

  async replaceLocalFileContent({ fileId, filePath, mimeType }) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`교체 대상이 파일이 아닙니다: ${filePath}`);
    const resolvedMime = mimeType || 'application/octet-stream';
    const sessionUrl = await this.createResumableSession({
      fileId,
      mimeType: resolvedMime,
      contentLength: stat.size
    });
    return this.request('PUT', sessionUrl, {
      headers: {
        'Content-Type': resolvedMime,
        'Content-Length': String(stat.size)
      },
      body: fs.createReadStream(filePath),
      retrySafe: false,
      timeoutMs: Math.max(this.timeoutMs, 15 * 60_000)
    });
  }

  replaceBufferContent({ fileId, mimeType = 'application/octet-stream', buffer }) {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    return this.patch(`/files/${encodeURIComponent(fileId)}`, {
      base: 'upload',
      query: {
        uploadType: 'media',
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true
      },
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(data.length)
      },
      body: data,
      retrySafe: false
    });
  }

  updateMetadata(fileId, metadata, { addParents, removeParents } = {}) {
    return this.patch(`/files/${encodeURIComponent(fileId)}`, {
      query: {
        addParents,
        removeParents,
        fields: DEFAULT_FILE_FIELDS,
        supportsAllDrives: true
      },
      json: metadata,
      retrySafe: false
    });
  }

  renameFile(fileId, name) {
    return this.updateMetadata(fileId, { name });
  }

  moveFile(fileId, { addParentId, removeParentIds = [] }) {
    return this.updateMetadata(fileId, {}, {
      addParents: addParentId,
      removeParents: removeParentIds.join(',')
    });
  }

  copyFile(fileId, { name, parentId, appProperties, description } = {}) {
    return this.post(`/files/${encodeURIComponent(fileId)}/copy`, {
      query: { fields: DEFAULT_FILE_FIELDS, supportsAllDrives: true },
      json: {
        ...(name ? { name } : {}),
        ...(parentId ? { parents: [parentId] } : {}),
        ...(appProperties ? { appProperties } : {}),
        ...(description ? { description } : {})
      },
      retrySafe: false
    });
  }

  trashFile(fileId) {
    return this.updateMetadata(fileId, { trashed: true });
  }

  restoreFile(fileId) {
    return this.updateMetadata(fileId, { trashed: false });
  }

  deleteFile(fileId) {
    return this.delete(`/files/${encodeURIComponent(fileId)}`, {
      query: { supportsAllDrives: true },
      responseType: 'text',
      retrySafe: false
    });
  }

  createPermission(fileId, {
    type = 'user',
    role,
    emailAddress,
    domain,
    allowFileDiscovery,
    sendNotificationEmail = false,
    emailMessage,
    transferOwnership = false
  }) {
    return this.post(`/files/${encodeURIComponent(fileId)}/permissions`, {
      query: {
        supportsAllDrives: true,
        sendNotificationEmail,
        emailMessage,
        transferOwnership,
        fields: 'id,type,role,emailAddress,domain,displayName,allowFileDiscovery,pendingOwner'
      },
      json: {
        type,
        role,
        ...(emailAddress ? { emailAddress } : {}),
        ...(domain ? { domain } : {}),
        ...(allowFileDiscovery !== undefined ? { allowFileDiscovery } : {})
      },
      retrySafe: false
    });
  }

  deletePermission(fileId, permissionId) {
    return this.delete(`/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, {
      query: { supportsAllDrives: true },
      responseType: 'text',
      retrySafe: false
    });
  }
}

export function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export {
  DEFAULT_FILE_FIELDS,
  GOOGLE_FOLDER_MIME,
  GOOGLE_SHORTCUT_MIME
};
