import test from 'node:test';
import assert from 'node:assert/strict';
import { DriveRootBoundary, DriveBoundaryError } from '../src/drive/boundary.js';

function fakeClient(graph) {
  return {
    async getFile(id) {
      if (!graph[id]) {
        const error = new Error('not found');
        error.status = 404;
        throw error;
      }
      return graph[id];
    }
  };
}

test('boundary accepts descendants and rejects outside files', async () => {
  const root = 'root_1234567890';
  const boundary = new DriveRootBoundary({
    client: fakeClient({
      [root]: { id: root, name: 'root', parents: [] },
      folder_1234567890: { id: 'folder_1234567890', parents: [root] },
      file_123456789000: { id: 'file_123456789000', parents: ['folder_1234567890'] },
      outside_123456789: { id: 'outside_123456789', parents: [] }
    }),
    allowedRootIds: [root]
  });
  const resolved = await boundary.assertInsideRoot('file_123456789000');
  assert.equal(resolved.rootId, root);
  await assert.rejects(
    () => boundary.assertInsideRoot('outside_123456789'),
    error => error instanceof DriveBoundaryError && error.code === 'DRIVE_PATH_OUTSIDE_ALLOWED_ROOT'
  );
});

test('boundary prevents destructive action on configured root', async () => {
  const root = 'root_1234567890';
  const boundary = new DriveRootBoundary({
    client: fakeClient({ [root]: { id: root, parents: [] } }),
    allowedRootIds: [root]
  });
  await assert.rejects(
    () => boundary.assertInsideRoot(root, { allowRoot: false, operation: 'delete' }),
    error => error.code === 'DRIVE_ROOT_OPERATION_NOT_ALLOWED'
  );
});

test('fresh boundary checks do not trust cached parent metadata for writes', async () => {
  // Given
  const root = 'root_1234567890';
  const graph = {
    [root]: { id: root, parents: [] },
    file_123456789000: { id: 'file_123456789000', parents: [root] }
  };
  const boundary = new DriveRootBoundary({ client: fakeClient(graph), allowedRootIds: [root] });
  await boundary.assertInsideRoot('file_123456789000');
  graph.file_123456789000 = { id: 'file_123456789000', parents: [] };

  // When / Then
  await assert.rejects(
    () => boundary.assertInsideRoot('file_123456789000', { operation: 'rename', fresh: true }),
    error => error.code === 'DRIVE_PATH_OUTSIDE_ALLOWED_ROOT'
  );
});
