import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/infrastructure/ledger.js';
import { CatalogRepository } from '../src/application/catalog-repository.js';
import { createHttpApiV03 } from '../src/http/server-v03.js';

const API_KEY = 'd'.repeat(48);
const ROOT_ID = '1tPsrn29CjAkIg9oloSn5ftwQKyjEPzQD';
const silentLogger = { info() {}, warn() {}, error() {} };

function createFixture({ drive = true, httpWrites = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-http-drive-'));
  const catalogRoot = path.join(dir, 'catalog');
  fs.mkdirSync(catalogRoot, { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
    source: 'fixture', total_products: 0, total_completed: 0, products: {}
  }));
  const templateFile = path.join(dir, 'template.json');
  fs.writeFileSync(templateFile, '{}');
  const databasePath = path.join(dir, 'work.sqlite');
  const ledger = new Ledger(databasePath);
  const catalogRepository = new CatalogRepository(catalogRoot);
  const calls = [];
  const driveConfig = {
    enabled: drive,
    provider: drive ? 'google-drive' : 'disabled',
    authMode: drive ? 'user-oauth' : 'none',
    scope: drive ? 'https://www.googleapis.com/auth/drive' : null,
    rootFolderId: drive ? ROOT_ID : '',
    catalogFolderId: '',
    finalDetailFolderId: '',
    allowedRootIds: drive ? [ROOT_ID] : [],
    serviceAccount: null,
    userOAuth: drive ? { clientId: 'client', clientSecret: 'secret', refreshToken: 'refresh', userEmail: 'owner@example.com' } : null,
    allowWrites: drive,
    allowMoves: drive,
    allowTrash: drive,
    allowPermanentDelete: drive,
    allowPermissionChanges: drive,
    requireUserOAuthForMyDriveCreates: true,
    maxUploadBytes: 1024 * 1024,
    maxJsonBodyBytes: 1024 * 1024,
    maxInlineDownloadBytes: 1024 * 1024,
    cacheTtlSeconds: 3600,
    cacheDir: path.join(dir, 'drive-cache')
  };
  const driveService = drive ? {
    async status({ verifyRemote }) {
      calls.push({ method: 'status', verifyRemote });
      return { configured: { enabled: true, authMode: 'user-oauth' }, remote: verifyRemote ? { ok: true } : null };
    },
    async createFolder(input) {
      calls.push({ method: 'createFolder', input });
      return { id: 'createdFolder1234567890', name: input.name, parents: [input.parentId] };
    }
  } : null;
  const app = {
    config: {
      catalogRoot,
      templateFile,
      workDir: dir,
      databasePath,
      categories: {},
      writeConfirmation: 'REGISTER',
      naver: { clientId: 'client', clientSecret: 'secret', tokenType: 'SELF', allowWrites: false }
    },
    ledger,
    catalogRepository,
    productService: {
      enqueueCatalog() { return { total: 0, queued: 0, failed: 0, failures: [] }; },
      runBatch() { return { requested: 0, succeeded: 0, failed: 0, results: [] }; }
    },
    productsApi: {},
    driveConfig,
    driveService,
    catalogProvider: 'local',
    catalogMaterializer: null,
    driveStartupError: null
  };
  const env = {
    ATELIER_API_KEY: API_KEY,
    ATELIER_HTTP_ALLOW_WRITES: String(httpWrites),
    ATELIER_HTTP_ALLOW_BATCH_WRITES: 'false',
    ATELIER_TRUST_PROXY: 'false'
  };
  return { dir, app, env, calls };
}

async function startFixture(options) {
  const fixture = createFixture(options);
  const api = createHttpApiV03({ app: fixture.app, env: fixture.env, logger: silentLogger });
  const address = await api.listen({ host: '127.0.0.1', port: 0 });
  return { ...fixture, api, baseUrl: `http://127.0.0.1:${address.port}` };
}

function authorized(baseUrl, pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

test('v0.3 OpenAPI exposes Drive read/write operations', async () => {
  const fixture = await startFixture();
  try {
    const response = await fetch(`${fixture.baseUrl}/openapi.json`);
    assert.equal(response.status, 200);
    const spec = await response.json();
    assert.equal(spec.info.version, '0.3.0');
    assert.ok(spec.paths['/api/v1/drive/status']);
    assert.ok(spec.paths['/api/v1/drive/files/upload']);
    assert.ok(spec.paths['/api/v1/drive/files/{fileId}/delete']);
    const createFolder = spec.paths['/api/v1/drive/folders'].post;
    assert.equal(createFolder.operationId, 'createGoogleDriveFolder');
    assert.ok(createFolder.requestBody.content['application/json'].schema.required.includes('idempotencyKey'));
    assert.ok(createFolder.responses['202']);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('Drive routes require API key and return configured status', async () => {
  const fixture = await startFixture();
  try {
    const noAuth = await fetch(`${fixture.baseUrl}/api/v1/drive/status?verifyRemote=false`);
    assert.equal(noAuth.status, 401);
    const response = await authorized(fixture.baseUrl, '/api/v1/drive/status?verifyRemote=false');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.drive.configured.authMode, 'user-oauth');
    assert.deepEqual(fixture.calls[0], { method: 'status', verifyRemote: false });
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('Drive folder create is asynchronous and idempotent', async () => {
  // Given
  const fixture = await startFixture();
  try {
    const request = {
      method: 'POST',
      body: JSON.stringify({
        name: '테스트 폴더',
        parentId: ROOT_ID,
        confirmation: 'WRITE_DRIVE_ITEM',
        idempotencyKey: 'drive-folder-test-001'
      })
    };

    // When
    const response = await authorized(fixture.baseUrl, '/api/v1/drive/folders', request);

    // Then
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.operation.operationType, 'drive:create-folder');
    assert.equal(await fixture.api.operationQueue.onIdle(), true);
    assert.equal(fixture.calls[0].method, 'createFolder');
    assert.equal(fixture.calls[0].input.parentId, ROOT_ID);
    assert.equal(fixture.calls[0].input.confirmation, 'WRITE_DRIVE_ITEM');

    const replay = await authorized(fixture.baseUrl, '/api/v1/drive/folders', request);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).reused, true);
    assert.equal(fixture.calls.length, 1);

    const conflict = await authorized(fixture.baseUrl, '/api/v1/drive/folders', {
      method: 'POST',
      body: JSON.stringify({
        name: '다른 폴더',
        parentId: ROOT_ID,
        confirmation: 'WRITE_DRIVE_ITEM',
        idempotencyKey: 'drive-folder-test-001'
      })
    });
    assert.equal(conflict.status, 409);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('Drive writes obey the HTTP master write switch', async () => {
  // Given
  const fixture = await startFixture({ httpWrites: false });

  // When
  const response = await authorized(fixture.baseUrl, '/api/v1/drive/folders', {
    method: 'POST',
    body: JSON.stringify({
      name: '차단 대상',
      parentId: ROOT_ID,
      confirmation: 'WRITE_DRIVE_ITEM',
      idempotencyKey: 'drive-folder-disabled-001'
    })
  });

  // Then
  try {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'HTTP_WRITES_DISABLED');
    assert.equal(fixture.calls.length, 0);
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('Drive route returns 503 when integration is disabled', async () => {
  const fixture = await startFixture({ drive: false });
  try {
    const response = await authorized(fixture.baseUrl, '/api/v1/drive/status');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'DRIVE_NOT_CONFIGURED');
  } finally {
    await fixture.api.close();
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
});
