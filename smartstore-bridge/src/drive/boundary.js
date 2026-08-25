import { GoogleDriveError } from './client.js';

export class DriveBoundaryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DriveBoundaryError';
    this.code = code;
    this.details = details;
  }
}

export class DriveRootBoundary {
  constructor({ client, allowedRootIds, cacheTtlMs = 5 * 60_000, maxDepth = 100 }) {
    if (!client) throw new Error('DriveRootBoundary에는 client가 필요합니다.');
    this.client = client;
    this.allowedRootIds = new Set((allowedRootIds || []).filter(Boolean));
    this.cacheTtlMs = cacheTtlMs;
    this.maxDepth = maxDepth;
    this.cache = new Map();
  }

  clear() {
    this.cache.clear();
  }

  invalidate(fileId) {
    this.cache.delete(String(fileId));
  }

  async getNode(fileId, { fresh = false } = {}) {
    const id = String(fileId || '').trim();
    if (!id) throw new DriveBoundaryError('DRIVE_INVALID_FILE_ID', 'Google Drive fileId가 필요합니다.');
    const cached = this.cache.get(id);
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.file;
    try {
      const file = await this.client.getFile(id, {
        fields: 'id,name,mimeType,parents,trashed,driveId,shortcutDetails,capabilities(canEdit,canCopy,canDelete,canShare,canTrash,canUntrash)'
      });
      this.cache.set(id, { file, expiresAt: Date.now() + this.cacheTtlMs });
      return file;
    } catch (error) {
      if (error instanceof GoogleDriveError && error.status === 404) {
        throw new DriveBoundaryError('DRIVE_FILE_NOT_FOUND', `Google Drive 파일을 찾을 수 없습니다: ${id}`, { fileId: id });
      }
      throw error;
    }
  }

  async resolve(fileId, { fresh = false } = {}) {
    const startId = String(fileId || '').trim();
    if (!startId) throw new DriveBoundaryError('DRIVE_INVALID_FILE_ID', 'Google Drive fileId가 필요합니다.');
    if (!this.allowedRootIds.size) {
      throw new DriveBoundaryError('DRIVE_ALLOWED_ROOT_NOT_CONFIGURED', 'Google Drive 허용 루트가 설정되지 않았습니다.');
    }
    if (this.allowedRootIds.has(startId)) {
      const root = await this.getNode(startId, { fresh });
      return {
        allowed: true,
        rootId: startId,
        file: root,
        chain: [startId],
        depth: 0
      };
    }

    const queue = [{ id: startId, chain: [startId], depth: 0 }];
    const visited = new Set();
    let startFile = null;

    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      if (current.depth > this.maxDepth) {
        throw new DriveBoundaryError('DRIVE_ANCESTOR_DEPTH_EXCEEDED', 'Google Drive 상위 폴더 탐색 깊이를 초과했습니다.', {
          fileId: startId,
          maxDepth: this.maxDepth
        });
      }

      const node = await this.getNode(current.id, { fresh });
      if (!startFile) startFile = node;
      for (const parentId of node.parents || []) {
        const nextChain = [...current.chain, parentId];
        if (this.allowedRootIds.has(parentId)) {
          return {
            allowed: true,
            rootId: parentId,
            file: startFile,
            chain: nextChain,
            depth: current.depth + 1
          };
        }
        if (!visited.has(parentId)) {
          queue.push({ id: parentId, chain: nextChain, depth: current.depth + 1 });
        }
      }
    }

    return {
      allowed: false,
      rootId: null,
      file: startFile,
      chain: [startId],
      depth: null
    };
  }

  async assertInsideRoot(fileId, { operation = 'access', allowRoot = true, fresh = false } = {}) {
    const result = await this.resolve(fileId, { fresh });
    if (!result.allowed) {
      throw new DriveBoundaryError(
        'DRIVE_PATH_OUTSIDE_ALLOWED_ROOT',
        '허용된 HAAR Google Drive 루트 밖의 파일에는 접근할 수 없습니다.',
        { fileId, operation, allowedRootIds: [...this.allowedRootIds] }
      );
    }
    if (!allowRoot && this.allowedRootIds.has(String(fileId))) {
      throw new DriveBoundaryError(
        'DRIVE_ROOT_OPERATION_NOT_ALLOWED',
        'HAAR Google Drive 루트 자체에는 이 작업을 수행할 수 없습니다.',
        { fileId, operation }
      );
    }
    return result;
  }

  async assertDestination(parentId, { operation = 'write', fresh = false } = {}) {
    return this.assertInsideRoot(parentId, { operation, allowRoot: true, fresh });
  }

  async assertMove(fileId, newParentId, { fresh = false } = {}) {
    const [source, destination] = await Promise.all([
      this.assertInsideRoot(fileId, { operation: 'move-source', allowRoot: false, fresh }),
      this.assertDestination(newParentId, { operation: 'move-destination', fresh })
    ]);
    return { source, destination };
  }
}
