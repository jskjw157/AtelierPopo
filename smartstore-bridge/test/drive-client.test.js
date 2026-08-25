import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleDriveClient } from '../src/drive/client.js';

test('Drive client classifies a transport failure after a write as an unknown outcome', async () => {
  // Given
  const client = new GoogleDriveClient({
    tokenProvider: { async get() { return 'synthetic-token'; } },
    fetchImpl: async () => { throw new Error('socket closed after upload'); },
    maxRetries: 0
  });

  // When / Then
  await assert.rejects(
    () => client.request('POST', '/files', { json: { name: 'x' }, retrySafe: false }),
    error => error.code === 'DRIVE_WRITE_OUTCOME_UNKNOWN'
  );
});
