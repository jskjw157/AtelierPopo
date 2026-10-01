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
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const CUSTOMER = '1001';
const origin = 'https://api.searchad.naver.com';
const keys = {
  generic: 'hierarchy-generic-'.repeat(4),
  reader: 'hierarchy-reader-'.repeat(4),
  admin: 'hierarchy-admin-'.repeat(4)
};
const logger = { info() {}, warn() {}, error() {} };
const createFields = ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];

test('public hierarchy root lifecycle composes bootstrap, activation, approval, restart and one bounded create', { timeout: 180_000 }, async t => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    assert.notEqual(process.env.CI, 'true', 'CI requires real PostgreSQL');
    return t.skip('TEST_DATABASE_URL is required');
  }

  const adminPool = createPostgresPool({ connectionString: databaseUrl, sslMode: 'disable', logger });
  const schema = `hierarchy_http_${randomUUID().replaceAll('-', '')}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-hierarchy-http-'));
  const nativeFetch = globalThis.fetch;
  const savedEnv = new Map();
  let pool;
  let current;
  let createdSchema = false;
  let forbiddenCalls = 0;
  const upstreamCalls = [];

  const setEnv = (key, value) => {
    if (!savedEnv.has(key)) savedEnv.set(key, process.env[key]);
    process.env[key] = value;
  };
  const scopedUrl = () => {
    const url = new URL(databaseUrl);
    url.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    return url.toString();
  };
  const call = async (role, method, route, body) => {
    const token = keys[role];
    const response = await nativeFetch(`http://127.0.0.1:${current.api.server.address().port}${route}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };

  const simulatedUpstream = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.origin !== origin) {
      forbiddenCalls += 1;
      throw new Error('Unexpected upstream origin');
    }
    const customerId = init.headers['X-Customer'];
    assert.equal(customerId, CUSTOMER);
    assert.ok(init.headers['X-Signature']);
    assert.equal(init.redirect, 'error');

    if (init.method === 'POST' && parsed.pathname === '/ncc/campaigns') {
      const body = JSON.parse(init.body);
      upstreamCalls.push({ method: 'POST', pathname: parsed.pathname, body });
      return new Response(JSON.stringify({
        ...body,
        customerId: Number(CUSTOMER),
        nccCampaignId: 'cmp-hierarchy-http'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'GET' && parsed.pathname === '/ncc/campaigns/cmp-hierarchy-http') {
      upstreamCalls.push({ method: 'GET', pathname: parsed.pathname });
      return new Response(JSON.stringify({
        customerId: Number(CUSTOMER),
        nccCampaignId: 'cmp-hierarchy-http',
        campaignTp: 'WEB_SITE',
        name: upstreamCalls.find(item => item.method === 'POST')?.body?.name,
        userLock: true,
        dailyBudget: 1000
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    forbiddenCalls += 1;
    throw new Error(`Unexpected upstream request ${init.method} ${parsed.pathname}`);
  };

  async function start() {
    const app = await bootstrapV05(path.join(dir, 'config.json'), { env, fetchImpl: simulatedUpstream });
    const api = createHttpApiV05({ app, env, logger });
    await api.listen({ host: '127.0.0.1', port: 0 });
    current = { app, api };
    return current;
  }

  let env;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    pool = createPostgresPool({ connectionString: scopedUrl(), sslMode: 'disable', logger });
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });

    const catalogRoot = path.join(dir, 'catalog');
    fs.mkdirSync(catalogRoot);
    fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
      source: 'hierarchy-http-fixture', total_products: 0, total_completed: 0, products: {}
    }));
    const templateFile = path.join(dir, 'template.json');
    fs.writeFileSync(templateFile, '{}');
    const raw = JSON.parse(fs.readFileSync('config/atelier-popo.example.json', 'utf8'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      ...raw,
      catalogRoot,
      templateFile,
      workDir: dir,
      databasePath: path.join(dir, 'ledger.sqlite')
    }));

    for (const [name, value] of Object.entries({
      NAVER_CLIENT_ID: 'hierarchy-commerce',
      NAVER_CLIENT_SECRET: 'hierarchy-commerce-secret',
      NAVER_ALLOW_WRITES: 'false',
      ATELIER_WORK_DIR: dir,
      ATELIER_DATABASE_PATH: path.join(dir, 'ledger.sqlite'),
      ATELIER_CATALOG_ROOT: catalogRoot,
      ATELIER_TEMPLATE_FILE: templateFile
    })) setEnv(name, value);
    globalThis.fetch = async () => {
      forbiddenCalls += 1;
      throw new Error('Uninjected real external fetch');
    };

    env = {
      ATELIER_API_KEY: keys.generic,
      ATELIER_SEARCHAD_READER_API_KEY: keys.reader,
      ATELIER_SEARCHAD_READER_CUSTOMERS: CUSTOMER,
      ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'hierarchy-reader',
      ATELIER_SEARCHAD_ADMIN_API_KEY: keys.admin,
      ATELIER_SEARCHAD_ADMIN_CUSTOMERS: CUSTOMER,
      ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'hierarchy-admin',
      NAVER_SEARCHAD_ACCESS_LICENSE: 'hierarchy-fixture-license',
      NAVER_SEARCHAD_SECRET_KEY: 'hierarchy-fixture-secret',
      NAVER_SEARCHAD_CUSTOMER_ID: CUSTOMER,
      DATABASE_URL: scopedUrl(),
      ATELIER_POSTGRES_SSL_MODE: 'disable',
      ATELIER_CATALOG_PROVIDER: 'local',
      ATELIER_HTTP_ALLOW_WRITES: 'true',
      ATELIER_WRITE_RATE_LIMIT_PER_MINUTE: '1000',
      ATELIER_SEARCHAD_MAX_RETRIES: '0',
      ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres',
      ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true',
      ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
      ATELIER_SEARCHAD_ALLOW_READS: 'true',
      ATELIER_SEARCHAD_ALLOW_WRITES: 'false',
      ATELIER_SEARCHAD_ALLOW_CREATES: 'false',
      ATELIER_SEARCHAD_ALLOW_BATCH_WRITES: 'false',
      ATELIER_SEARCHAD_ALLOW_ROLLBACK: 'false',
      ATELIER_SEARCHAD_ALLOW_DELETES: 'false',
      ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true',
      ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
      ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000',
      ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '2000',
      ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '500',
      ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-01',
      ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-02'
    };

    await start();
    assert.equal(current.app.searchAdActivationRuntime?.status().ready, true);
    assert.equal(current.app.searchAdHierarchyRuntime?.status().ready, true);
    const hierarchyReadiness = current.api.readiness().searchAdHierarchy;
    assert.equal(hierarchyReadiness.required, true);
    assert.equal(hierarchyReadiness.initialized, true);
    assert.equal(hierarchyReadiness.ready, true);

    const activationRuntime = current.app.searchAdActivationRuntime;
    const evidenceId = randomUUID();
    const now = Date.now();
    await activationRuntime.repository.createEvidence({
      evidenceId,
      evidenceType: 'active_canary',
      customerId: CUSTOMER,
      specSha: current.app.searchAdRegistry.status().specRef,
      credentialFingerprint: credentialFingerprintForCustomer(current.app.searchAdCredentials, CUSTOMER),
      upstreamBaseUrl: origin,
      operationKeys: [OPS.campaign.create],
      fieldScope: createFields,
      lifecycleKinds: ['create'],
      result: 'verified',
      sourceRunId: 'synthetic-hierarchy-http-fixture',
      details: { fixtureOnly: true },
      createdAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 600_000).toISOString()
    });
    const activation = await call('admin', 'POST', '/api/v1/searchad/activations', { evidenceId });
    assert.equal(activation.status, 201, JSON.stringify(activation));

    const readerDenied = await call('reader', 'POST', '/api/v1/searchad/hierarchy/campaigns/prepare', {
      customerId: CUSTOMER,
      activationId: activation.body.activationId
    });
    assert.equal(readerDenied.status, 403);
    assert.equal(upstreamCalls.length, 0);

    const prepared = await call('admin', 'POST', '/api/v1/searchad/hierarchy/campaigns/prepare', {
      customerId: CUSTOMER,
      activationId: activation.body.activationId
    });
    assert.equal(prepared.status, 201, JSON.stringify(prepared));
    for (const key of ['hierarchyRunId', 'hierarchyObjectId', 'planId']) {
      assert.match(prepared.body[key], /^[0-9a-f-]{36}$/i);
    }
    assert.equal(upstreamCalls.length, 0, 'prepare is local-only');

    await current.api.close();
    current = null;
    await start();
    assert.equal(current.app.searchAdHierarchyRuntime?.status().ready, true);

    const approved = await call('admin', 'POST', `/api/v1/searchad/changes/${prepared.body.planId}/approve`, {
      confirmation: 'APPROVE_SEARCHAD_CHANGE'
    });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    assert.equal(typeof approved.body.executionToken, 'string');

    const executed = await call('admin', 'POST',
      `/api/v1/searchad/hierarchy/campaigns/${prepared.body.hierarchyRunId}/${prepared.body.hierarchyObjectId}/${prepared.body.planId}/execute`,
      { customerId: CUSTOMER, executionToken: approved.body.executionToken });
    assert.equal(executed.status, 200, JSON.stringify(executed));
    assert.equal(executed.body.state, 'owned');
    assert.equal(executed.body.remoteId, 'cmp-hierarchy-http');
    assert.deepEqual(upstreamCalls.map(item => item.method), ['POST', 'GET']);

    const replay = await call('admin', 'POST',
      `/api/v1/searchad/hierarchy/campaigns/${prepared.body.hierarchyRunId}/${prepared.body.hierarchyObjectId}/${prepared.body.planId}/execute`,
      { customerId: CUSTOMER, executionToken: approved.body.executionToken });
    assert.notEqual(replay.status, 200);
    assert.deepEqual(upstreamCalls.map(item => item.method), ['POST', 'GET']);
    assert.equal(forbiddenCalls, 0);
  } finally {
    try { await current?.api.close(); } catch {}
    globalThis.fetch = nativeFetch;
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (pool) await closePostgresPool(pool);
    if (createdSchema) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await closePostgresPool(adminPool);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
