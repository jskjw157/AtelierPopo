import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_CONFIRMATIONS, GoogleDriveService } from '../src/drive/service.js';

function setup() {
  const root = 'root_1234567890';
  const files = new Map([[root, { id: root, name: 'root', mimeType: 'application/vnd.google-apps.folder', parents: [] }]]);
  let counter = 0;
  const client = {
    tokenProvider: { status: () => ({ configured: true }) },
    async getFile(id) {
      const file = files.get(id);
      if (!file) throw new Error(`missing ${id}`);
      return structuredClone(file);
    },
    async createFolder({ name, parentId }) {
      const id = `folder_${String(++counter).padStart(12, '0')}`;
      const file = { id, name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId], trashed: false };
      files.set(id, file);
      return structuredClone(file);
    },
    async createFileMetadata({ name, parentId, mimeType }) {
      const id = `native_${String(++counter).padStart(12, '0')}`;
      const file = { id, name, mimeType, parents: [parentId], trashed: false };
      files.set(id, file);
      return structuredClone(file);
    },
    async uploadBuffer({ name, parentId, mimeType, buffer }) {
      const id = `file_${String(++counter).padStart(12, '0')}`;
      const file = { id, name, mimeType, parents: [parentId], size: String(buffer.length), trashed: false };
      files.set(id, file);
      return structuredClone(file);
    },
    async trashFile(id) {
      const file = files.get(id);
      file.trashed = true;
      return structuredClone(file);
    },
    async restoreFile(id) {
      const file = files.get(id);
      file.trashed = false;
      return structuredClone(file);
    },
    async deleteFile(id) { files.delete(id); },
    async listPermissions() { return { permissions: [] }; }
  };
  const config = {
    enabled: true,
    provider: 'google-drive',
    scope: 'https://www.googleapis.com/auth/drive',
    serviceAccount: { clientEmail: 'test@example.com' },
    rootFolderId: root,
    allowedRootIds: [root],
    allowWrites: true,
    allowMoves: true,
    allowTrash: true,
    allowPermanentDelete: true,
    allowPermissionChanges: true,
    maxUploadBytes: 1024,
    maxInlineDownloadBytes: 1024,
    boundaryCacheTtlMs: 1000
  };
  return { service: new GoogleDriveService({ config, client }), files, root };
}

test('Drive service requires explicit write confirmation', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.createFolder({ name: 'test', confirmation: 'WRONG' }),
    error => error.code === 'DRIVE_INVALID_CONFIRMATION'
  );
  const folder = await service.createFolder({
    name: 'test',
    confirmation: DRIVE_CONFIRMATIONS.WRITE
  });
  assert.equal(folder.name, 'test');
});

test('trash and permanent delete require target id as second confirmation', async () => {
  const { service, files } = setup();
  const file = await service.uploadInline({
    name: 'x.txt',
    text: 'hello',
    mimeType: 'text/plain',
    confirmation: DRIVE_CONFIRMATIONS.WRITE
  });
  await assert.rejects(
    () => service.trash(file.id, { confirmation: DRIVE_CONFIRMATIONS.TRASH, secondConfirmation: 'wrong' }),
    error => error.code === 'DRIVE_INVALID_SECOND_CONFIRMATION'
  );
  const trashed = await service.trash(file.id, {
    confirmation: DRIVE_CONFIRMATIONS.TRASH,
    secondConfirmation: file.id
  });
  assert.equal(trashed.trashed, true);
  await service.permanentlyDelete(file.id, {
    confirmation: DRIVE_CONFIRMATIONS.DELETE,
    secondConfirmation: file.id
  });
  assert.equal(files.has(file.id), false);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('internal local upload accepts only configured local roots', async () => {
  const { service, root } = setup();
  const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-drive-upload-'));
  const allowedFile = path.join(allowedRoot, 'allowed.txt');
  fs.writeFileSync(allowedFile, 'hello');
  service.localUploadRoots = [allowedRoot];
  service.config.authMode = 'user-oauth';
  service.client.uploadLocalFile = async ({ filePath, name, parentId }) => ({
    id: 'uploaded_file_12345',
    name,
    mimeType: 'text/plain',
    parents: [parentId],
    size: String(fs.statSync(filePath).size),
    trashed: false
  });
  const uploaded = await service.uploadLocalFile({
    filePath: allowedFile,
    parentId: root,
    confirmation: DRIVE_CONFIRMATIONS.WRITE
  });
  assert.equal(uploaded.name, 'allowed.txt');

  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-drive-outside-'));
  const outsideFile = path.join(outsideRoot, 'outside.txt');
  fs.writeFileSync(outsideFile, 'no');
  await assert.rejects(
    () => service.uploadLocalFile({
      filePath: outsideFile,
      parentId: root,
      confirmation: DRIVE_CONFIRMATIONS.WRITE
    }),
    error => error.code === 'DRIVE_LOCAL_PATH_OUTSIDE_ALLOWED_ROOT'
  );
});


test('Drive service creates Google native files with an allowlisted type', async () => {
  const { service } = setup();
  service.config.authMode = 'user-oauth';
  const file = await service.createNativeFile({
    type: 'document',
    name: 'HAAR 문서',
    confirmation: DRIVE_CONFIRMATIONS.WRITE
  });
  assert.equal(file.mimeType, 'application/vnd.google-apps.document');
  await assert.rejects(
    () => service.createNativeFile({
      type: 'unknown',
      name: 'bad',
      confirmation: DRIVE_CONFIRMATIONS.WRITE
    }),
    error => error.code === 'DRIVE_INVALID_NATIVE_FILE_TYPE'
  );
});

test('Drive service rejects malformed Base64 instead of uploading corrupted bytes', async () => {
  // Given
  const { service } = setup();

  // When / Then
  await assert.rejects(
    () => service.uploadInline({
      name: 'bad.bin',
      contentBase64: '@@@not-base64@@@',
      confirmation: DRIVE_CONFIRMATIONS.WRITE
    }),
    error => error.code === 'DRIVE_INVALID_BASE64'
  );
});

test('Drive service never permits world-writable sharing', async () => {
  // Given
  const { service, root } = setup();

  // When / Then
  await assert.rejects(
    () => service.createPermission(root, {
      type: 'anyone',
      role: 'writer',
      confirmation: DRIVE_CONFIRMATIONS.PERMISSION,
      secondConfirmation: root
    }),
    error => error.code === 'DRIVE_PUBLIC_WRITE_NOT_ALLOWED'
  );
});

test('Drive canary refuses to start when cleanup gates are disabled', async () => {
  // Given
  const { service, files } = setup();
  service.config.allowTrash = false;
  service.config.allowPermanentDelete = false;

  // When / Then
  await assert.rejects(
    () => service.runWriteCanary({ confirmation: DRIVE_CONFIRMATIONS.PROBE }),
    error => error.code === 'DRIVE_TRASH_DISABLED'
  );
  assert.equal(files.size, 1);
});
