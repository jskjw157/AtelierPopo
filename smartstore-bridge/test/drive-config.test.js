import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_SCOPE, loadDriveConfig } from '../src/drive/config.js';

function credentials() {
  return {
    type: 'service_account',
    project_id: 'haar-test',
    private_key_id: 'kid',
    private_key: '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n',
    client_email: 'drive@test.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token'
  };
}

test('loadDriveConfig reads Base64 credentials and full-write flags', () => {
  const env = {
    ATELIER_DRIVE_PROVIDER: 'google-drive',
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify(credentials())).toString('base64'),
    GOOGLE_DRIVE_SCOPE: DRIVE_SCOPE,
    GOOGLE_DRIVE_ROOT_FOLDER_ID: '1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD',
    GOOGLE_DRIVE_CATALOG_FOLDER_ID: '1OxlupopKo8BR-8_fDE72LEknRbWIoGoS',
    GOOGLE_DRIVE_FINAL_DETAIL_FOLDER_ID: '1YKzTg8rGoyRFGihPAvybKjkaZpk56y3Y',
    ATELIER_DRIVE_ALLOW_WRITES: 'true',
    ATELIER_DRIVE_ALLOW_MOVES: 'true',
    ATELIER_DRIVE_ALLOW_TRASH: 'true',
    ATELIER_DRIVE_ALLOW_PERMANENT_DELETE: 'true',
    ATELIER_DRIVE_ALLOW_PERMISSION_CHANGES: 'true'
  };
  const config = loadDriveConfig(env);
  assert.equal(config.enabled, true);
  assert.equal(config.serviceAccount.clientEmail, 'drive@test.iam.gserviceaccount.com');
  assert.equal(config.allowWrites, true);
  assert.equal(config.allowPermanentDelete, true);
  assert.deepEqual(config.allowedRootIds, ['1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD']);
});

test('loadDriveConfig rejects read-only scope for full-write provider', () => {
  assert.throws(() => loadDriveConfig({
    ATELIER_DRIVE_PROVIDER: 'google-drive',
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify(credentials())).toString('base64'),
    GOOGLE_DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: '1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD'
  }), /전체 쓰기 통합/);
});

test('loadDriveConfig prefers user OAuth in auto mode for My Drive writes', () => {
  const config = loadDriveConfig({
    ATELIER_DRIVE_PROVIDER: 'google-drive',
    GOOGLE_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'refresh-token',
    GOOGLE_OAUTH_USER_EMAIL: 'owner@example.com',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: '1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD'
  });
  assert.equal(config.authMode, 'user-oauth');
  assert.equal(config.userOAuth.userEmail, 'owner@example.com');
});
