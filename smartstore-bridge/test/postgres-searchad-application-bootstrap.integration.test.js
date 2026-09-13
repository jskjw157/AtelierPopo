import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootstrapV05 } from '../src/bootstrap-v05.js';
import { createHttpApiV05 } from '../src/http/server-v05.js';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';

const CUSTOMER = '1001';
const GENERIC_KEY = 'bootstrap-generic-'.repeat(4);
const READER_KEY = 'bootstrap-reader-'.repeat(4);
const ADMIN_KEY = 'bootstrap-admin-'.repeat(4);
const logger = { info() {}, warn() {}, error() {} };

test('real application bootstrap initializes activation, scopes control HTTP and closes owned PostgreSQL resources', async t => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) return t.skip('TEST_DATABASE_URL is required');
  const id = randomUUID().replaceAll('-', '');
  const readySchema = `bootstrap_ready_${id}`;
  const emptySchema = `bootstrap_empty_${id}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-bootstrap-'));
  const adminPool = createPostgresPool({ connectionString: databaseUrl, sslMode: 'disable', logger });
  let migrationPool;
  let createdReady = false;
  let createdEmpty = false;
  const savedEnv = new Map();
  const setEnv = (key, value) => { savedEnv.set(key, process.env[key]); process.env[key] = value; };
  const nativeFetch = globalThis.fetch;
  let upstreamCalls = 0;
  const forbiddenUpstream = async () => { upstreamCalls += 1; throw new Error('Upstream requests are forbidden in bootstrap tests'); };
  const scopedUrl = schema => {
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    return url.toString();
  };
  const baseEnv = {
    ATELIER_API_KEY: GENERIC_KEY,
    ATELIER_SEARCHAD_READER_API_KEY: READER_KEY,
    ATELIER_SEARCHAD_READER_CUSTOMERS: CUSTOMER,
    ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'bootstrap-reader',
    ATELIER_SEARCHAD_ADMIN_API_KEY: ADMIN_KEY,
    ATELIER_SEARCHAD_ADMIN_CUSTOMERS: CUSTOMER,
    ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'bootstrap-admin',
    NAVER_SEARCHAD_ACCESS_LICENSE: 'bootstrap-fixture-license',
    NAVER_SEARCHAD_SECRET_KEY: 'bootstrap-fixture-secret',
    NAVER_SEARCHAD_CUSTOMER_ID: CUSTOMER,
    ATELIER_CATALOG_PROVIDER: 'local',
    ATELIER_POSTGRES_SSL_MODE: 'disable',
    ATELIER_HTTP_ALLOW_WRITES: 'false',
    ATELIER_SEARCHAD_ALLOW_WRITES: 'false',
    ATELIER_SEARCHAD_ALLOW_CREATES: 'false',
    ATELIER_SEARCHAD_ALLOW_DELETES: 'false',
    ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'false'
  };
  let configPath;
  async function start(env) {
    const app = await bootstrapV05(configPath, { env, fetchImpl: forbiddenUpstream });
    const api = createHttpApiV05({ app, env, logger });
    await api.listen({ host: '127.0.0.1', port: 0 });
    const call = async (token, method, route, body) => {
      const response = await nativeFetch(`http://127.0.0.1:${api.server.address().port}${route}`, {
        method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    };
    return { app, api, call };
  }
  try {
    await adminPool.query(`CREATE SCHEMA "${readySchema}"`);
    createdReady = true;
    await adminPool.query(`CREATE SCHEMA "${emptySchema}"`);
    createdEmpty = true;
    migrationPool = createPostgresPool({ connectionString: scopedUrl(readySchema), sslMode: 'disable', logger });
    assert.equal((await migrationPool.query('SELECT current_schema() AS name')).rows[0].name, readySchema);
    await runPostgresMigrations({ pool: migrationPool, migrationsDir: path.resolve('migrations/postgres'), logger });
    const catalogRoot = path.join(dir, 'catalog');
    fs.mkdirSync(catalogRoot);
    fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({ source: 'bootstrap-fixture', total_products: 0, total_completed: 0, products: {} }));
    const templateFile = path.join(dir, 'template.json');
    fs.writeFileSync(templateFile, '{}');
    const raw = JSON.parse(fs.readFileSync('config/atelier-popo.example.json', 'utf8'));
    configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ ...raw, catalogRoot, templateFile, workDir: dir, databasePath: path.join(dir, 'ledger.sqlite') }));
    setEnv('NAVER_CLIENT_ID', 'bootstrap-commerce-fixture');
    setEnv('NAVER_CLIENT_SECRET', 'bootstrap-commerce-fixture-secret');
    setEnv('NAVER_ALLOW_WRITES', 'false');
    setEnv('ATELIER_WORK_DIR', dir);
    setEnv('ATELIER_DATABASE_PATH', path.join(dir, 'ledger.sqlite'));
    setEnv('ATELIER_CATALOG_ROOT', catalogRoot);
    setEnv('ATELIER_TEMPLATE_FILE', templateFile);
    globalThis.fetch = forbiddenUpstream;

    await t.test('complete 0008 schema wires actual capability service, activation HTTP and owned pool shutdown', async () => {
      const h = await start({ ...baseEnv, DATABASE_URL: scopedUrl(readySchema) });
      try {
        assert.equal(h.app.searchAdActivationStartupError, null);
        assert.equal(h.app.searchAdActivationRuntime?.status().ready, true);
        assert.equal(h.api.readiness().searchAdActivation.ready, true);
        const listed = await h.call(READER_KEY, 'GET', '/api/v1/searchad/evidence');
        assert.equal(listed.status, 200, JSON.stringify(listed));
        assert.deepEqual(listed.body.items, []);
        assert.equal((await h.call(GENERIC_KEY, 'GET', '/api/v1/searchad/evidence')).status, 401);
        const suspended = await h.call(ADMIN_KEY, 'POST', `/api/v1/searchad/accounts/${CUSTOMER}/suspend`, {});
        assert.equal(suspended.status, 200, JSON.stringify(suspended));
        assert.equal(suspended.body.suspended, true);
        const control = await h.call(READER_KEY, 'GET', '/api/v1/searchad/accounts/control-status');
        assert.equal(control.status, 200);
        assert.equal(control.body.items.find(row => row.customerId === CUSTOMER).suspended, true);
        assert.equal(upstreamCalls, 0);
        assert.equal(h.app.searchAdConfig.allowWrites, false);
        assert.equal(h.app.searchAdConfig.allowActiveCanary, false);
        await Promise.all([h.api.close(), h.api.close()]);
        await assert.rejects(() => h.app.searchAdActivationRuntime.repository.listEvidence({ customerIds: [CUSTOMER], limit: 1 }));
        assert.equal((await migrationPool.query('SELECT 1 AS alive')).rows[0].alive, 1);
      } finally { await h.api.close(); }
    });

    await t.test('missing DATABASE_URL remains unavailable without upstream I/O', async () => {
      const h = await start({ ...baseEnv });
      try {
        assert.equal(h.app.searchAdActivationRuntime, null);
        assert.equal(h.app.searchAdActivationStartupError?.code, 'SEARCHAD_ACTIVATION_DATABASE_REQUIRED');
        assert.equal(h.api.readiness().searchAdActivation.ready, false);
        const result = await h.call(READER_KEY, 'GET', '/api/v1/searchad/evidence');
        assert.equal(result.status, 503);
        assert.equal(upstreamCalls, 0);
      } finally { await h.api.close(); }
    });

    await t.test('an incomplete isolated schema fails closed without automatic migration', async () => {
      const h = await start({ ...baseEnv, DATABASE_URL: scopedUrl(emptySchema) });
      try {
        assert.equal(h.app.searchAdActivationRuntime, null);
        assert.equal(h.app.searchAdActivationStartupError?.code, 'SEARCHAD_ACTIVATION_SCHEMA_NOT_READY');
        assert.equal(h.api.readiness().searchAdActivation.ready, false);
        const result = await h.call(READER_KEY, 'GET', '/api/v1/searchad/evidence');
        assert.equal(result.status, 503);
        const tables = await adminPool.query('SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema=$1', [emptySchema]);
        assert.equal(tables.rows[0].count, 0);
        assert.equal(upstreamCalls, 0);
      } finally { await h.api.close(); }
    });
  } finally {
    globalThis.fetch = nativeFetch;
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (migrationPool) await closePostgresPool(migrationPool);
    if (createdReady) await adminPool.query(`DROP SCHEMA "${readySchema}" CASCADE`);
    if (createdEmpty) await adminPool.query(`DROP SCHEMA "${emptySchema}" CASCADE`);
    await closePostgresPool(adminPool);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
