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
import { ADGROUP_CREATE_FIELDS } from '../src/naver/searchad/lifecycle/adgroup-create-contract.js';

const CUSTOMER = '1001';
const origin = 'https://api.searchad.naver.com';
const keys = {
  generic: 'hierarchy-adgroup-generic-'.repeat(4),
  reader: 'hierarchy-adgroup-reader-'.repeat(4),
  admin: 'hierarchy-adgroup-admin-'.repeat(4)
};
const logger = { info() {}, warn() {}, error() {} };
const campaignFields = ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];

test('public hierarchy adgroup lifecycle preserves root provenance across restart and sends once', { timeout: 180_000 }, async t => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    assert.notEqual(process.env.CI, 'true', 'CI requires real PostgreSQL');
    return t.skip('TEST_DATABASE_URL is required');
  }

  const adminPool = createPostgresPool({ connectionString: databaseUrl, sslMode: 'disable', logger });
  const schema = `hierarchy_adgroup_http_${randomUUID().replaceAll('-', '')}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-hierarchy-adgroup-http-'));
  const nativeFetch = globalThis.fetch;
  const savedEnv = new Map();
  let pool;
  let current;
  let createdSchema = false;
  let forbiddenCalls = 0;
  const upstreamCalls = [];
  let rootBody = null;
  let adgroupBody = null;

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
    const customerId = new Headers(init.headers).get('X-Customer');
    assert.equal(customerId, CUSTOMER);
    assert.ok(new Headers(init.headers).get('X-Signature'));
    assert.equal(init.redirect, 'error');

    if (init.method === 'POST' && parsed.pathname === '/ncc/campaigns') {
      rootBody = JSON.parse(init.body);
      upstreamCalls.push({ method: 'POST', pathname: parsed.pathname, body: rootBody });
      return new Response(JSON.stringify({
        ...rootBody,
        customerId: Number(CUSTOMER),
        nccCampaignId: 'cmp-hierarchy-adgroup-http'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'GET' && parsed.pathname === '/ncc/campaigns/cmp-hierarchy-adgroup-http') {
      upstreamCalls.push({ method: 'GET', pathname: parsed.pathname });
      return new Response(JSON.stringify({
        customerId: Number(CUSTOMER),
        nccCampaignId: 'cmp-hierarchy-adgroup-http',
        campaignTp: 'WEB_SITE',
        name: rootBody?.name,
        userLock: true,
        dailyBudget: 1000
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'POST' && parsed.pathname === '/ncc/adgroups') {
      adgroupBody = JSON.parse(init.body);
      upstreamCalls.push({ method: 'POST', pathname: parsed.pathname, body: adgroupBody });
      assert.equal(adgroupBody.nccCampaignId, 'cmp-hierarchy-adgroup-http');
      assert.equal(adgroupBody.userLock, true);
      return new Response(JSON.stringify({
        ...adgroupBody,
        customerId: Number(CUSTOMER),
        nccAdgroupId: 'grp-hierarchy-adgroup-http'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'GET' && parsed.pathname === '/ncc/adgroups/grp-hierarchy-adgroup-http') {
      upstreamCalls.push({ method: 'GET', pathname: parsed.pathname });
      return new Response(JSON.stringify({
        ...adgroupBody,
        customerId: Number(CUSTOMER),
        nccAdgroupId: 'grp-hierarchy-adgroup-http'
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

  const createEvidenceAndActivation = async ({ operationKey, fieldScope }) => {
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
      operationKeys: [operationKey],
      fieldScope,
      lifecycleKinds: ['create'],
      result: 'verified',
      sourceRunId: 'synthetic-hierarchy-adgroup-http-fixture',
      details: { fixtureOnly: true },
      createdAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 600_000).toISOString()
    });
    const activation = await call('admin', 'POST', '/api/v1/searchad/activations', { evidenceId });
    assert.equal(activation.status, 201, JSON.stringify(activation));
    return activation.body.activationId;
  };

  let env;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    pool = createPostgresPool({ connectionString: scopedUrl(), sslMode: 'disable', logger });
    await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });

    const catalogRoot = path.join(dir, 'catalog');
    fs.mkdirSync(catalogRoot);
    fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({
      source: 'hierarchy-adgroup-http-fixture', total_products: 0, total_completed: 0, products: {}
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
      NAVER_CLIENT_ID: 'hierarchy-adgroup-commerce',
      NAVER_CLIENT_SECRET: 'hierarchy-adgroup-commerce-secret',
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
      ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'hierarchy-adgroup-reader',
      ATELIER_SEARCHAD_ADMIN_API_KEY: keys.admin,
      ATELIER_SEARCHAD_ADMIN_CUSTOMERS: CUSTOMER,
      ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'hierarchy-adgroup-admin',
      NAVER_SEARCHAD_ACCESS_LICENSE: 'hierarchy-adgroup-fixture-license',
      NAVER_SEARCHAD_SECRET_KEY: 'hierarchy-adgroup-fixture-secret',
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
    assert.equal(current.app.searchAdHierarchyRuntime?.status().ready, true);

    const rootActivationId = await createEvidenceAndActivation({
      operationKey: OPS.campaign.create,
      fieldScope: campaignFields
    });
    const rootPrepared = await call('admin', 'POST', '/api/v1/searchad/hierarchy/campaigns/prepare', {
      customerId: CUSTOMER,
      activationId: rootActivationId
    });
    assert.equal(rootPrepared.status, 201, JSON.stringify(rootPrepared));
    const rootApproved = await call('admin', 'POST', `/api/v1/searchad/changes/${rootPrepared.body.planId}/approve`, {
      confirmation: 'APPROVE_SEARCHAD_CHANGE'
    });
    assert.equal(rootApproved.status, 200, JSON.stringify(rootApproved));
    const rootExecuted = await call('admin', 'POST',
      `/api/v1/searchad/hierarchy/campaigns/${rootPrepared.body.hierarchyRunId}/${rootPrepared.body.hierarchyObjectId}/${rootPrepared.body.planId}/execute`,
      { customerId: CUSTOMER, executionToken: rootApproved.body.executionToken });
    assert.equal(rootExecuted.status, 200, JSON.stringify(rootExecuted));
    assert.equal(rootExecuted.body.state, 'owned');
    assert.equal(rootExecuted.body.remoteId, 'cmp-hierarchy-adgroup-http');
    assert.deepEqual(upstreamCalls.map(item => item.method), ['POST', 'GET']);

    const adgroupActivationId = await createEvidenceAndActivation({
      operationKey: OPS.adgroup.create,
      fieldScope: ADGROUP_CREATE_FIELDS
    });

    assert.equal(current.app.searchAdHierarchyRuntime?.status().scope.adgroupCreate, true);

    const readerDenied = await call('reader', 'POST', '/api/v1/searchad/hierarchy/adgroups/prepare', {
      customerId: CUSTOMER,
      hierarchyRunId: rootPrepared.body.hierarchyRunId,
      parentObjectId: rootPrepared.body.hierarchyObjectId,
      activationId: adgroupActivationId
    });
    assert.equal(readerDenied.status, 403);
    assert.deepEqual(upstreamCalls.map(item => item.method), ['POST', 'GET']);

    const childPrepared = await call('admin', 'POST', '/api/v1/searchad/hierarchy/adgroups/prepare', {
      customerId: CUSTOMER,
      hierarchyRunId: rootPrepared.body.hierarchyRunId,
      parentObjectId: rootPrepared.body.hierarchyObjectId,
      activationId: adgroupActivationId
    });
    assert.equal(childPrepared.status, 201, JSON.stringify(childPrepared));
    assert.equal(childPrepared.body.parentObjectId, rootPrepared.body.hierarchyObjectId);
    assert.deepEqual(upstreamCalls.map(item => item.method), ['POST', 'GET'], 'adgroup prepare must remain local-only');

    await current.api.close();
    current = null;
    await start();
    assert.equal(current.app.searchAdHierarchyRuntime?.status().scope.adgroupCreate, true);

    const childApproved = await call('admin', 'POST', `/api/v1/searchad/changes/${childPrepared.body.planId}/approve`, {
      confirmation: 'APPROVE_SEARCHAD_CHANGE'
    });
    assert.equal(childApproved.status, 200, JSON.stringify(childApproved));

    const childRoute = `/api/v1/searchad/hierarchy/adgroups/${childPrepared.body.hierarchyRunId}/${childPrepared.body.parentObjectId}/${childPrepared.body.hierarchyObjectId}/${childPrepared.body.planId}/execute`;
    const childExecuted = await call('admin', 'POST', childRoute, {
      customerId: CUSTOMER,
      executionToken: childApproved.body.executionToken
    });
    assert.equal(childExecuted.status, 200, JSON.stringify(childExecuted));
    assert.equal(childExecuted.body.state, 'owned');
    assert.equal(childExecuted.body.remoteId, 'grp-hierarchy-adgroup-http');
    assert.equal(childExecuted.body.parentObjectId, rootPrepared.body.hierarchyObjectId);
    assert.deepEqual(upstreamCalls.map(item => `${item.method} ${item.pathname}`), [
      'POST /ncc/campaigns',
      'GET /ncc/campaigns/cmp-hierarchy-adgroup-http',
      'GET /ncc/campaigns/cmp-hierarchy-adgroup-http',
      'POST /ncc/adgroups',
      'GET /ncc/adgroups/grp-hierarchy-adgroup-http'
    ]);

    const replay = await call('admin', 'POST', childRoute, {
      customerId: CUSTOMER,
      executionToken: childApproved.body.executionToken
    });
    assert.notEqual(replay.status, 200);
    assert.equal(upstreamCalls.filter(item => item.method === 'POST' && item.pathname === '/ncc/adgroups').length, 1);
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
