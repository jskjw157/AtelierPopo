import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { bootstrapV05 } from '../../src/bootstrap-v05.js';
import { createHttpApiV05 } from '../../src/http/server-v05.js';
import { createPostgresPool, closePostgresPool } from '../../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../../src/infrastructure/postgres/migrator.js';
import { now, responseFixture } from './searchad-completion-fixture.js';
export const completionReaderKey = 'completion-pg-reader-'.repeat(4);
export const completionOperatorKey = 'completion-pg-operator-'.repeat(4);
const logger = { info() {}, warn() {}, error() {} };
export async function postgresCompletionFixture(t) {
  const schema = `completion_${randomUUID().replaceAll('-', '')}`;
  const admin = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable', logger });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-completion-'));
  const apps = new Set(), pools = new Set(), saved = new Map();
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  t.after(async () => {
    for (const api of apps) await api.close();
    for (const pool of pools) await closePostgresPool(pool);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await closePostgresPool(admin);
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const connect = () => { const pool = createPostgresPool({ connectionString: url.toString(), sslMode: 'disable', logger }); pools.add(pool); return pool; };
  const pool = connect(); await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
  const catalogRoot = path.join(dir, 'catalog'); fs.mkdirSync(catalogRoot);
  fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({ source: 'completion-fixture', total_products: 0, total_completed: 0, products: {} }));
  const templateFile = path.join(dir, 'template.json'); fs.writeFileSync(templateFile, '{}');
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ ...JSON.parse(fs.readFileSync('config/atelier-popo.example.json', 'utf8')), catalogRoot, templateFile, workDir: dir, databasePath: path.join(dir, 'ledger.sqlite') }));
  const settings = { NAVER_CLIENT_ID: 'completion-fixture', NAVER_CLIENT_SECRET: 'completion-fixture-secret', NAVER_ALLOW_WRITES: 'false', ATELIER_WORK_DIR: dir, ATELIER_DATABASE_PATH: path.join(dir, 'ledger.sqlite'), ATELIER_CATALOG_ROOT: catalogRoot, ATELIER_TEMPLATE_FILE: templateFile };
  for (const [key, value] of Object.entries(settings)) { saved.set(key, process.env[key]); process.env[key] = value; }
  const env = { ...settings, ATELIER_API_KEY: 'completion-pg-generic-'.repeat(4), ATELIER_SEARCHAD_READER_API_KEY: completionReaderKey, ATELIER_SEARCHAD_READER_CUSTOMERS: '1001', ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'completion-reader', ATELIER_SEARCHAD_OPERATOR_API_KEY: completionOperatorKey, ATELIER_SEARCHAD_OPERATOR_CUSTOMERS: '1001', ATELIER_SEARCHAD_OPERATOR_PRINCIPAL_ID: 'completion-operator', NAVER_SEARCHAD_ACCESS_LICENSE: 'completion-license', NAVER_SEARCHAD_SECRET_KEY: 'completion-secret', NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_CATALOG_PROVIDER: 'local', ATELIER_POSTGRES_SSL_MODE: 'disable', ATELIER_HTTP_ALLOW_WRITES: 'false', ATELIER_SEARCHAD_ALLOW_WRITES: 'false', ATELIER_SEARCHAD_ALLOW_CREATES: 'false', ATELIER_SEARCHAD_ALLOW_DELETES: 'false', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'false', DATABASE_URL: url.toString() };
  const calls = [];
  async function start({ response = responseFixture(), appEnv = {}, allowedPaths = ['/stats'], allowedMethods = {}, clock = () => now, blobStorage = null, beforeResponse = async () => {} } = {}) {
    const effectiveEnv = { ...env, ...appEnv };
    const app = await bootstrapV05(configPath, { env: effectiveEnv, clock, blobStorage, fetchImpl: async (requestUrl, init) => {
      const target = new URL(requestUrl); assert.equal(target.origin, 'https://api.searchad.naver.com'); assert.ok(allowedPaths.includes(target.pathname), 'closed fixture rejects unlisted paths'); assert.ok((allowedMethods[target.pathname] || (['/stat-reports','/master-reports'].includes(target.pathname) ? ['GET','POST'] : ['GET'])).includes(init.method), 'closed fixture rejects unlisted methods'); assert.equal(init.redirect, 'error'); assert.equal(init.headers['X-Customer'], '1001'); assert.equal(init.headers['X-Timestamp'], String(clock())); assert.equal(init.headers['X-Signature'], createHmac('sha256', 'completion-secret').update(`${clock()}.${init.method}.${target.pathname}`).digest('base64'));
      calls.push({ path: target.pathname, method: init.method, query: target.searchParams.toString(), body: init.body });
      await beforeResponse({ target, init });
      if (response instanceof Error) throw response;
      if(typeof response==='function')return response({target,init});
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'completion-pg-upstream' } });
    } });
    const api = createHttpApiV05({ app, env: effectiveEnv, logger }); apps.add(api); await api.listen({ host: '127.0.0.1', port: 0 });
    const call = async (token, method, route, body, raw = false) => { const result = await fetch(`http://127.0.0.1:${api.server.address().port}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: result.status, body: raw && result.ok ? await result.text() : await result.json() }; };
    return { app, api, call };
  }
  return { pool, connect, start, calls, databaseUrl: url.toString() };
}
