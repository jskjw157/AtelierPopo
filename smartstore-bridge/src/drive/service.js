import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { publicDriveConfig } from './config.js';
import {
  GOOGLE_FOLDER_MIME,
  GOOGLE_SHORTCUT_MIME,
  GoogleDriveClient,
  GoogleDriveError
} from './client.js';
import { DriveRootBoundary, DriveBoundaryError } from './boundary.js';

export const DRIVE_CONFIRMATIONS = Object.freeze({
  WRITE: 'WRITE_DRIVE_ITEM',
  MOVE: 'MOVE_DRIVE_ITEM',
  TRASH: 'TRASH_DRIVE_ITEM',
  RESTORE: 'RESTORE_DRIVE_ITEM',
  DELETE: 'PERMANENTLY_DELETE_DRIVE_ITEM',
  PERMISSION: 'CHANGE_DRIVE_PERMISSION',
  PROBE: 'RUN_DRIVE_WRITE_CANARY'
});

const NAME_PATTERN = /^[^\u0000-\u001F\u007F]{1,255}$/u;
const PERMISSION_ROLES = new Set(['reader', 'commenter', 'writer']);
const PERMISSION_TYPES = new Set(['user', 'group', 'domain', 'anyone']);
const GOOGLE_NATIVE_PREFIX = 'application/vnd.google-apps.';
const NATIVE_FILE_MIME_TYPES = Object.freeze({
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation'
});

function asInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeName(value, label = 'name') {
  const name = String(value || '').trim();
  if (!NAME_PATTERN.test(name) || name === '.' || name === '..') {
    throw new DriveServiceError('DRIVE_INVALID_NAME', `${label} 형식이 올바르지 않습니다.`);
  }
  return name;
}

function requireConfirmation(actual, expected, secondActual, secondExpected) {
  if (String(actual || '') !== expected) {
    throw new DriveServiceError('DRIVE_INVALID_CONFIRMATION', `confirmation 값은 정확히 ${expected}여야 합니다.`);
  }
  if (secondExpected !== undefined && String(secondActual || '') !== String(secondExpected)) {
    throw new DriveServiceError('DRIVE_INVALID_SECOND_CONFIRMATION', 'secondConfirmation은 대상 fileId와 정확히 일치해야 합니다.');
  }
}

function decodeInlineContent({ contentBase64, text, encoding = 'utf8' }) {
  if (contentBase64 !== undefined && text !== undefined) {
    throw new DriveServiceError('DRIVE_MULTIPLE_CONTENT_SOURCES', 'contentBase64와 text는 동시에 사용할 수 없습니다.');
  }
  if (contentBase64 !== undefined) {
    try {
      return Buffer.from(String(contentBase64), 'base64');
    } catch {
      throw new DriveServiceError('DRIVE_INVALID_BASE64', 'contentBase64가 올바르지 않습니다.');
    }
  }
  if (text !== undefined) return Buffer.from(String(text), encoding);
  throw new DriveServiceError('DRIVE_CONTENT_REQUIRED', 'contentBase64 또는 text가 필요합니다.');
}

function publicFile(file) {
  if (!file) return null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents || [],
    trashed: Boolean(file.trashed),
    driveId: file.driveId || null,
    size: file.size !== undefined ? String(file.size) : null,
    md5Checksum: file.md5Checksum || null,
    sha1Checksum: file.sha1Checksum || null,
    sha256Checksum: file.sha256Checksum || null,
    createdTime: file.createdTime || null,
    modifiedTime: file.modifiedTime || null,
    webViewLink: file.webViewLink || null,
    shortcutDetails: file.shortcutDetails || null,
    capabilities: file.capabilities || null
  };
}

export class DriveServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DriveServiceError';
    this.code = code;
    this.details = details;
  }
}

export class GoogleDriveService {
  constructor({ config, client, boundary, logger = console, localUploadRoots = [] }) {
    this.config = config;
    this.logger = logger;
    this.localUploadRoots = [...new Set((localUploadRoots || []).filter(Boolean).map(value => path.resolve(value)))];
    this.client = client || (config?.enabled ? new GoogleDriveClient({
      authMode: config.authMode,
      serviceAccount: config.serviceAccount,
      userOAuth: config.userOAuth,
      scope: config.scope,
      apiBaseUrl: config.apiBaseUrl,
      uploadBaseUrl: config.uploadBaseUrl,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries
    }) : null);
    this.boundary = boundary || (this.client ? new DriveRootBoundary({
      client: this.client,
      allowedRootIds: config.allowedRootIds,
      cacheTtlMs: config.boundaryCacheTtlMs
    }) : null);
  }

  assertEnabled() {
    if (!this.config?.enabled || !this.client || !this.boundary) {
      throw new DriveServiceError('DRIVE_NOT_CONFIGURED', 'Google Drive 연동이 설정되지 않았습니다.');
    }
  }

  assertWriteFlag(flag, code, message) {
    this.assertEnabled();
    if (!this.config[flag]) throw new DriveServiceError(code, message);
  }

  assertUploadSize(buffer) {
    if (buffer.length > this.config.maxUploadBytes) {
      throw new DriveServiceError('DRIVE_UPLOAD_TOO_LARGE', `업로드 파일은 최대 ${this.config.maxUploadBytes}바이트까지 허용됩니다.`, {
        size: buffer.length,
        maxUploadBytes: this.config.maxUploadBytes
      });
    }
  }

  assertLocalFileAllowed(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new DriveServiceError('DRIVE_LOCAL_FILE_NOT_FOUND', `업로드할 로컬 파일을 찾을 수 없습니다: ${resolved}`);
    }
    if (!this.localUploadRoots.length) {
      throw new DriveServiceError('DRIVE_LOCAL_UPLOAD_ROOT_NOT_CONFIGURED', 'Drive 내부 업로드에 사용할 로컬 허용 루트가 설정되지 않았습니다.');
    }
    const allowed = this.localUploadRoots.some(root => {
      const relative = path.relative(root, resolved);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    });
    if (!allowed) {
      throw new DriveServiceError('DRIVE_LOCAL_PATH_OUTSIDE_ALLOWED_ROOT', '허용된 로컬 작업 폴더 밖의 파일은 Drive로 업로드할 수 없습니다.', {
        filePath: resolved,
        allowedRoots: this.localUploadRoots
      });
    }
    const stat = fs.statSync(resolved);
    if (stat.size > this.config.maxUploadBytes) {
      throw new DriveServiceError('DRIVE_UPLOAD_TOO_LARGE', `업로드 파일은 최대 ${this.config.maxUploadBytes}바이트까지 허용됩니다.`, {
        size: stat.size,
        maxUploadBytes: this.config.maxUploadBytes
      });
    }
    return { filePath: resolved, stat };
  }

  async assertCreateOwnershipCapability(parentId) {
    if (!this.config.requireUserOAuthForMyDriveCreates || this.config.authMode === 'user-oauth') return;
    const parent = await this.client.getFile(parentId, { fields: 'id,name,mimeType,driveId,parents' });
    if (parent.driveId) return;
    throw new DriveServiceError(
      'DRIVE_MY_DRIVE_CREATE_REQUIRES_USER_OAUTH',
      '서비스 계정은 저장용량이 없어 일반 My Drive에서 새 파일을 소유할 수 없습니다. Hostinger에 사용자 OAuth refresh token을 설정하거나 Shared Drive를 사용해야 합니다.',
      {
        parentId,
        parentName: parent.name,
        authMode: this.config.authMode,
        requiredAuthMode: 'user-oauth'
      }
    );
  }

  async status({ verifyRemote = false } = {}) {
    const status = {
      configured: publicDriveConfig(this.config),
      token: this.client?.tokenProvider?.status?.() || null,
      remote: null
    };
    if (!verifyRemote || !this.config?.enabled) return status;
    try {
      const root = await this.client.getFile(this.config.rootFolderId);
      const [catalog, finalDetail] = await Promise.all([
        this.config.catalogFolderId ? this.client.getFile(this.config.catalogFolderId).catch(error => ({ error })) : null,
        this.config.finalDetailFolderId ? this.client.getFile(this.config.finalDetailFolderId).catch(error => ({ error })) : null
      ]);
      status.remote = {
        ok: true,
        root: publicFile(root),
        createCredentialCompatible: this.config.authMode === 'user-oauth' || Boolean(root.driveId),
        createCredentialWarning: this.config.authMode === 'service-account' && !root.driveId
          ? '일반 My Drive 새 파일 생성에는 사용자 OAuth가 필요합니다.'
          : null,
        catalog: catalog?.error ? { ok: false, error: catalog.error.message } : publicFile(catalog),
        finalDetail: finalDetail?.error ? { ok: false, error: finalDetail.error.message } : publicFile(finalDetail)
      };
    } catch (error) {
      status.remote = {
        ok: false,
        error: error.message,
        code: error.code || null,
        status: error.status || null
      };
    }
    return status;
  }

  async getFile(fileId) {
    this.assertEnabled();
    await this.boundary.assertInsideRoot(fileId, { operation: 'read' });
    return publicFile(await this.client.getFile(fileId));
  }

  async listChildren(parentId, { pageSize = 100, pageToken, includeTrashed = false } = {}) {
    this.assertEnabled();
    await this.boundary.assertDestination(parentId, { operation: 'list-children' });
    const response = await this.client.listChildren(parentId, {
      pageSize: asInteger(pageSize, 100, { min: 1, max: 1000 }),
      pageToken,
      includeTrashed
    });
    return {
      nextPageToken: response.nextPageToken || null,
      files: (response.files || []).map(publicFile)
    };
  }

  async searchTree({ query = '', mimeType, rootId = this.config.rootFolderId, limit = 100, maxNodes = 5000 } = {}) {
    this.assertEnabled();
    await this.boundary.assertDestination(rootId, { operation: 'search-tree' });
    const normalized = String(query || '').trim().toLocaleLowerCase('ko-KR');
    const safeLimit = asInteger(limit, 100, { min: 1, max: 1000 });
    const safeMaxNodes = asInteger(maxNodes, 5000, { min: 1, max: 50_000 });
    const queue = [rootId];
    const visited = new Set();
    const results = [];
    let scanned = 0;

    while (queue.length && results.length < safeLimit && scanned < safeMaxNodes) {
      const parentId = queue.shift();
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      let pageToken;
      do {
        const response = await this.client.listChildren(parentId, { pageSize: 1000, pageToken });
        for (const file of response.files || []) {
          scanned += 1;
          if (file.mimeType === GOOGLE_FOLDER_MIME && !file.trashed) queue.push(file.id);
          const nameMatches = !normalized || String(file.name || '').toLocaleLowerCase('ko-KR').includes(normalized);
          const mimeMatches = !mimeType || file.mimeType === mimeType;
          if (nameMatches && mimeMatches) results.push(publicFile(file));
          if (results.length >= safeLimit || scanned >= safeMaxNodes) break;
        }
        pageToken = response.nextPageToken;
      } while (pageToken && results.length < safeLimit && scanned < safeMaxNodes);
    }

    return {
      rootId,
      query: normalized,
      mimeType: mimeType || null,
      scanned,
      truncated: queue.length > 0 || scanned >= safeMaxNodes,
      files: results.slice(0, safeLimit)
    };
  }

  async listPermissions(fileId) {
    this.assertEnabled();
    await this.boundary.assertInsideRoot(fileId, { operation: 'list-permissions' });
    const response = await this.client.listPermissions(fileId);
    return response.permissions || [];
  }

  async downloadInline(fileId, { exportMimeType, maxBytes = this.config.maxInlineDownloadBytes } = {}) {
    this.assertEnabled();
    await this.boundary.assertInsideRoot(fileId, { operation: 'download' });
    const file = await this.client.getFile(fileId);
    const safeMax = Math.min(
      this.config.maxInlineDownloadBytes,
      asInteger(maxBytes, this.config.maxInlineDownloadBytes, { min: 1, max: this.config.maxInlineDownloadBytes })
    );
    let data;
    let mimeType = file.mimeType;
    if (file.mimeType?.startsWith(GOOGLE_NATIVE_PREFIX)) {
      if (file.mimeType === GOOGLE_FOLDER_MIME || file.mimeType === GOOGLE_SHORTCUT_MIME) {
        throw new DriveServiceError('DRIVE_FILE_NOT_DOWNLOADABLE', '폴더 또는 바로가기는 파일 내용으로 다운로드할 수 없습니다.');
      }
      if (!exportMimeType) {
        throw new DriveServiceError('DRIVE_EXPORT_MIME_REQUIRED', 'Google 문서 파일은 exportMimeType이 필요합니다.');
      }
      mimeType = exportMimeType;
      data = await this.client.exportFile(fileId, exportMimeType);
    } else {
      if (Number(file.size || 0) > safeMax) {
        throw new DriveServiceError('DRIVE_INLINE_DOWNLOAD_TOO_LARGE', `인라인 다운로드는 최대 ${safeMax}바이트까지 허용됩니다.`, {
          size: file.size,
          maxBytes: safeMax
        });
      }
      data = await this.client.downloadFile(fileId);
    }
    if (data.length > safeMax) {
      throw new DriveServiceError('DRIVE_INLINE_DOWNLOAD_TOO_LARGE', `인라인 다운로드는 최대 ${safeMax}바이트까지 허용됩니다.`, {
        size: data.length,
        maxBytes: safeMax
      });
    }
    return {
      file: publicFile(file),
      mimeType,
      size: data.length,
      contentBase64: data.toString('base64')
    };
  }

  async createFolder({ name, parentId = this.config.rootFolderId, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    const safeName = normalizeName(name, '폴더명');
    await this.boundary.assertDestination(parentId, { operation: 'create-folder' });
    await this.assertCreateOwnershipCapability(parentId);
    const file = await this.client.createFolder({ name: safeName, parentId });
    this.boundary.invalidate(file.id);
    return publicFile(file);
  }

  async createNativeFile({ type, name, parentId = this.config.rootFolderId, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    const normalizedType = String(type || '').trim().toLowerCase();
    const mimeType = NATIVE_FILE_MIME_TYPES[normalizedType];
    if (!mimeType) {
      throw new DriveServiceError('DRIVE_INVALID_NATIVE_FILE_TYPE', 'type은 document, spreadsheet, presentation 중 하나여야 합니다.');
    }
    const safeName = normalizeName(name, '파일명');
    await this.boundary.assertDestination(parentId, { operation: 'create-native-file' });
    await this.assertCreateOwnershipCapability(parentId);
    const file = await this.client.createFileMetadata({
      name: safeName,
      parentId,
      mimeType,
      appProperties: { atelierManaged: 'true', atelierNativeType: normalizedType }
    });
    this.boundary.invalidate(file.id);
    return publicFile(file);
  }

  async uploadInline({ name, parentId = this.config.rootFolderId, mimeType, contentBase64, text, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    const safeName = normalizeName(name, '파일명');
    await this.boundary.assertDestination(parentId, { operation: 'upload' });
    await this.assertCreateOwnershipCapability(parentId);
    const buffer = decodeInlineContent({ contentBase64, text });
    this.assertUploadSize(buffer);
    const file = await this.client.uploadBuffer({
      name: safeName,
      parentId,
      mimeType: String(mimeType || 'application/octet-stream'),
      buffer,
      appProperties: { atelierManaged: 'true' }
    });
    this.boundary.invalidate(file.id);
    return publicFile(file);
  }

  async uploadLocalFile({ filePath, name, parentId = this.config.rootFolderId, mimeType, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    const local = this.assertLocalFileAllowed(filePath);
    await this.boundary.assertDestination(parentId, { operation: 'upload-local-file' });
    await this.assertCreateOwnershipCapability(parentId);
    const file = await this.client.uploadLocalFile({
      filePath: local.filePath,
      name: name ? normalizeName(name, '파일명') : path.basename(local.filePath),
      parentId,
      mimeType,
      appProperties: { atelierManaged: 'true' }
    });
    this.boundary.invalidate(file.id);
    return publicFile(file);
  }

  async replaceLocalFile(fileId, { filePath, mimeType, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    const local = this.assertLocalFileAllowed(filePath);
    const boundary = await this.boundary.assertInsideRoot(fileId, { operation: 'replace-local-file', allowRoot: false });
    if (boundary.file.mimeType === GOOGLE_FOLDER_MIME) {
      throw new DriveServiceError('DRIVE_FOLDER_CONTENT_REPLACE_NOT_ALLOWED', '폴더의 내용은 파일처럼 교체할 수 없습니다.');
    }
    const file = await this.client.replaceLocalFileContent({
      fileId,
      filePath: local.filePath,
      mimeType: mimeType || boundary.file.mimeType || 'application/octet-stream'
    });
    this.boundary.invalidate(fileId);
    return publicFile(file);
  }

  async replaceInline(fileId, { mimeType, contentBase64, text, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    const boundary = await this.boundary.assertInsideRoot(fileId, { operation: 'replace-content', allowRoot: false });
    if (boundary.file.mimeType === GOOGLE_FOLDER_MIME) {
      throw new DriveServiceError('DRIVE_FOLDER_CONTENT_REPLACE_NOT_ALLOWED', '폴더의 내용은 파일처럼 교체할 수 없습니다.');
    }
    const buffer = decodeInlineContent({ contentBase64, text });
    this.assertUploadSize(buffer);
    const file = await this.client.replaceBufferContent({
      fileId,
      mimeType: String(mimeType || boundary.file.mimeType || 'application/octet-stream'),
      buffer
    });
    this.boundary.invalidate(fileId);
    return publicFile(file);
  }

  async rename(fileId, { name, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    await this.boundary.assertInsideRoot(fileId, { operation: 'rename', allowRoot: false });
    const file = await this.client.renameFile(fileId, normalizeName(name, '새 파일명'));
    this.boundary.invalidate(fileId);
    return publicFile(file);
  }

  async move(fileId, { parentId, confirmation }) {
    this.assertWriteFlag('allowMoves', 'DRIVE_MOVES_DISABLED', 'ATELIER_DRIVE_ALLOW_MOVES=false라 Drive 이동이 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.MOVE);
    await this.boundary.assertMove(fileId, parentId);
    const current = await this.client.getFile(fileId);
    const removeParentIds = (current.parents || []).filter(id => id !== parentId);
    const file = await this.client.moveFile(fileId, { addParentId: parentId, removeParentIds });
    this.boundary.clear();
    return publicFile(file);
  }

  async copy(fileId, { name, parentId = this.config.rootFolderId, confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.WRITE);
    await Promise.all([
      this.boundary.assertInsideRoot(fileId, { operation: 'copy-source' }),
      this.boundary.assertDestination(parentId, { operation: 'copy-destination' })
    ]);
    await this.assertCreateOwnershipCapability(parentId);
    const file = await this.client.copyFile(fileId, {
      name: name ? normalizeName(name, '복사 파일명') : undefined,
      parentId,
      appProperties: { atelierManaged: 'true' }
    });
    this.boundary.invalidate(file.id);
    return publicFile(file);
  }

  async trash(fileId, { confirmation, secondConfirmation }) {
    this.assertWriteFlag('allowTrash', 'DRIVE_TRASH_DISABLED', 'ATELIER_DRIVE_ALLOW_TRASH=false라 휴지통 이동이 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.TRASH, secondConfirmation, fileId);
    await this.boundary.assertInsideRoot(fileId, { operation: 'trash', allowRoot: false });
    const file = await this.client.trashFile(fileId);
    this.boundary.invalidate(fileId);
    return publicFile(file);
  }

  async restore(fileId, { confirmation, secondConfirmation }) {
    this.assertWriteFlag('allowTrash', 'DRIVE_TRASH_DISABLED', 'ATELIER_DRIVE_ALLOW_TRASH=false라 복원이 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.RESTORE, secondConfirmation, fileId);
    await this.boundary.assertInsideRoot(fileId, { operation: 'restore', allowRoot: false });
    const file = await this.client.restoreFile(fileId);
    this.boundary.invalidate(fileId);
    return publicFile(file);
  }

  async permanentlyDelete(fileId, { confirmation, secondConfirmation }) {
    this.assertWriteFlag(
      'allowPermanentDelete',
      'DRIVE_PERMANENT_DELETE_DISABLED',
      'ATELIER_DRIVE_ALLOW_PERMANENT_DELETE=false라 영구 삭제가 차단되어 있습니다.'
    );
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.DELETE, secondConfirmation, fileId);
    await this.boundary.assertInsideRoot(fileId, { operation: 'permanent-delete', allowRoot: false });
    await this.client.deleteFile(fileId);
    this.boundary.clear();
    return { deleted: true, fileId };
  }

  async createPermission(fileId, input) {
    this.assertWriteFlag(
      'allowPermissionChanges',
      'DRIVE_PERMISSION_CHANGES_DISABLED',
      'ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=false라 공유 권한 변경이 차단되어 있습니다.'
    );
    requireConfirmation(input.confirmation, DRIVE_CONFIRMATIONS.PERMISSION, input.secondConfirmation, fileId);
    await this.boundary.assertInsideRoot(fileId, { operation: 'create-permission' });
    const role = String(input.role || '').trim();
    const type = String(input.type || 'user').trim();
    if (!PERMISSION_ROLES.has(role)) {
      throw new DriveServiceError('DRIVE_INVALID_PERMISSION_ROLE', 'role은 reader, commenter, writer 중 하나여야 합니다.');
    }
    if (!PERMISSION_TYPES.has(type)) {
      throw new DriveServiceError('DRIVE_INVALID_PERMISSION_TYPE', 'type은 user, group, domain, anyone 중 하나여야 합니다.');
    }
    if (type === 'anyone' && input.allowFileDiscovery === undefined) input.allowFileDiscovery = false;
    return this.client.createPermission(fileId, {
      type,
      role,
      emailAddress: input.emailAddress,
      domain: input.domain,
      allowFileDiscovery: input.allowFileDiscovery,
      sendNotificationEmail: Boolean(input.sendNotificationEmail),
      emailMessage: input.emailMessage,
      transferOwnership: false
    });
  }

  async deletePermission(fileId, permissionId, input) {
    this.assertWriteFlag(
      'allowPermissionChanges',
      'DRIVE_PERMISSION_CHANGES_DISABLED',
      'ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES=false라 공유 권한 변경이 차단되어 있습니다.'
    );
    requireConfirmation(input.confirmation, DRIVE_CONFIRMATIONS.PERMISSION, input.secondConfirmation, permissionId);
    await this.boundary.assertInsideRoot(fileId, { operation: 'delete-permission' });
    await this.client.deletePermission(fileId, permissionId);
    return { deleted: true, fileId, permissionId };
  }

  async verifyTree({ rootId = this.config.rootFolderId, maxNodes = 20_000 } = {}) {
    this.assertEnabled();
    await this.boundary.assertDestination(rootId, { operation: 'verify-tree' });
    const queue = [rootId];
    const visited = new Set();
    const summary = { files: 0, folders: 0, trashed: 0, bytes: 0, truncated: false };
    const safeMax = asInteger(maxNodes, 20_000, { min: 1, max: 200_000 });

    while (queue.length && visited.size < safeMax) {
      const parentId = queue.shift();
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      let pageToken;
      do {
        const response = await this.client.listChildren(parentId, {
          pageSize: 1000,
          pageToken,
          includeTrashed: true
        });
        for (const file of response.files || []) {
          if (file.mimeType === GOOGLE_FOLDER_MIME) {
            summary.folders += 1;
            if (!file.trashed) queue.push(file.id);
          } else {
            summary.files += 1;
            summary.bytes += Number(file.size || 0);
          }
          if (file.trashed) summary.trashed += 1;
          if (visited.size + summary.files + summary.folders >= safeMax) {
            summary.truncated = true;
            break;
          }
        }
        pageToken = response.nextPageToken;
      } while (pageToken && !summary.truncated);
      if (summary.truncated) break;
    }
    return { rootId, ...summary, visitedFolders: visited.size };
  }

  async runWriteCanary({ confirmation }) {
    this.assertWriteFlag('allowWrites', 'DRIVE_WRITES_DISABLED', 'ATELIER_DRIVE_ALLOW_WRITES=false라 Drive 쓰기가 차단되어 있습니다.');
    requireConfirmation(confirmation, DRIVE_CONFIRMATIONS.PROBE);
    const result = {
      read: false,
      create: false,
      upload: false,
      replace: false,
      rename: false,
      move: false,
      copy: false,
      trash: false,
      restore: false,
      permanentDelete: false,
      permissionRead: false,
      permissionWrite: null,
      cleanup: false,
      checkedAt: new Date().toISOString(),
      steps: []
    };
    let canaryFolder;
    let textFile;
    let childFolder;
    let copyFile;

    const record = (step, ok, details = {}) => {
      result.steps.push({ step, ok, ...details });
      return ok;
    };

    try {
      const root = await this.client.getFile(this.config.rootFolderId);
      result.read = record('read-root', true, { rootId: root.id, rootName: root.name, driveId: root.driveId || null });
      await this.assertCreateOwnershipCapability(this.config.rootFolderId);

      canaryFolder = await this.client.createFolder({
        name: `__HAAR_DRIVE_CANARY__${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        parentId: this.config.rootFolderId,
        appProperties: { atelierCanary: 'true' }
      });
      result.create = record('create-folder', true, { fileId: canaryFolder.id });
      this.boundary.clear();

      textFile = await this.client.uploadBuffer({
        name: 'canary.txt',
        parentId: canaryFolder.id,
        mimeType: 'text/plain',
        buffer: Buffer.from('HAAR Google Drive write canary\n', 'utf8'),
        appProperties: { atelierCanary: 'true' }
      });
      result.upload = record('upload-file', true, { fileId: textFile.id });
      this.boundary.clear();

      textFile = await this.client.replaceBufferContent({
        fileId: textFile.id,
        mimeType: 'text/plain',
        buffer: Buffer.from('HAAR Google Drive write canary updated\n', 'utf8')
      });
      result.replace = record('replace-content', true, { fileId: textFile.id });

      textFile = await this.client.renameFile(textFile.id, 'canary-renamed.txt');
      result.rename = record('rename-file', true, { fileId: textFile.id });

      childFolder = await this.client.createFolder({
        name: 'moved',
        parentId: canaryFolder.id,
        appProperties: { atelierCanary: 'true' }
      });
      textFile = await this.client.moveFile(textFile.id, {
        addParentId: childFolder.id,
        removeParentIds: textFile.parents || [canaryFolder.id]
      });
      result.move = record('move-file', true, { fileId: textFile.id, parentId: childFolder.id });
      this.boundary.clear();

      copyFile = await this.client.copyFile(textFile.id, {
        name: 'canary-copy.txt',
        parentId: canaryFolder.id,
        appProperties: { atelierCanary: 'true' }
      });
      result.copy = record('copy-file', true, { fileId: copyFile.id });

      textFile = await this.client.trashFile(textFile.id);
      result.trash = record('trash-file', Boolean(textFile.trashed), { fileId: textFile.id });
      textFile = await this.client.restoreFile(textFile.id);
      result.restore = record('restore-file', !textFile.trashed, { fileId: textFile.id });

      const permissions = await this.client.listPermissions(canaryFolder.id);
      result.permissionRead = record('list-permissions', Array.isArray(permissions.permissions), {
        count: permissions.permissions?.length || 0
      });

      if (this.config.canaryPermissionEmail && this.config.allowPermissionChanges) {
        const permission = await this.client.createPermission(canaryFolder.id, {
          type: 'user',
          role: 'reader',
          emailAddress: this.config.canaryPermissionEmail,
          sendNotificationEmail: false
        });
        await this.client.deletePermission(canaryFolder.id, permission.id);
        result.permissionWrite = record('permission-add-delete', true, { permissionId: permission.id });
      }

      if (this.config.allowPermanentDelete) {
        await this.client.deleteFile(canaryFolder.id);
        result.permanentDelete = record('permanent-delete-canary-folder', true, { fileId: canaryFolder.id });
        canaryFolder = null;
        result.cleanup = true;
      } else if (this.config.allowTrash) {
        await this.client.trashFile(canaryFolder.id);
        result.cleanup = record('trash-canary-folder', true, { fileId: canaryFolder.id });
        canaryFolder = null;
      }
    } catch (error) {
      record('failed', false, {
        error: error.message,
        code: error.code || null,
        status: error.status || null
      });
      throw new DriveServiceError('DRIVE_CANARY_FAILED', 'Google Drive 쓰기 Canary가 실패했습니다.', {
        result,
        cause: {
          message: error.message,
          code: error.code || null,
          status: error.status || null
        }
      });
    } finally {
      if (canaryFolder?.id) {
        try {
          if (this.config.allowPermanentDelete) await this.client.deleteFile(canaryFolder.id);
          else if (this.config.allowTrash) await this.client.trashFile(canaryFolder.id);
          result.cleanup = true;
        } catch (cleanupError) {
          record('cleanup-failed', false, {
            fileId: canaryFolder.id,
            error: cleanupError.message
          });
        }
      }
      this.boundary.clear();
    }
    return result;
  }
}

export function normalizeDriveError(error) {
  if (error instanceof DriveServiceError || error instanceof DriveBoundaryError) return error;
  if (error instanceof GoogleDriveError) {
    return new DriveServiceError(error.code || 'GOOGLE_DRIVE_API_ERROR', error.message, {
      status: error.status,
      reason: error.reason,
      requestId: error.requestId,
      retryAfter: error.retryAfter
    });
  }
  return error;
}

export { publicFile };
