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
  generic: 'hierarchy-inventory-generic-'.repeat(4),
  reader: 'hierarchy-inventory-reader-'.repeat(4),
  admin: 'hierarchy-inventory-admin-'.repeat(4)
};
const logger = { info() {}, warn() {}, error() {} };
const campaignFields = ['campaign.campaignTp','campaign.name','campaign.userLock','campaign.dailyBudget'];

test('public hierarchy descendant inventory is GET-only, Customer-scoped, sanitized, and never proves absence', { timeout: 180_000 }, async t => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    assert.notEqual(process.env.CI, 'true', 'CI requires real PostgreSQL');
    return t.skip('TEST_DATABASE_URL is required');
  }

  const adminPool = createPostgresPool({ connectionString: databaseUrl, sslMode: 'disable', logger });
  const schema = `hierarchy_inventory_http_${randomUUID().replaceAll('-', '')}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-hierarchy-inventory-http-'));
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
        nccCampaignId: 'cmp-hierarchy-inventory-http'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'GET' && parsed.pathname === '/ncc/campaigns/cmp-hierarchy-inventory-http') {
      upstreamCalls.push({ method: 'GET', pathname: parsed.pathname });
      return new Response(JSON.stringify({
        customerId: Number(CUSTOMER),
        nccCampaignId: 'cmp-hierarchy-inventory-http',
        campaignTp: 'WEB_SITE',
        name: rootBody?.name,
        userLock: true,
        dailyBudget: 1000
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'POST' && parsed.pathname === '/ncc/adgroups') {
      adgroupBody = JSON.parse(init.body);
      upstreamCalls.push({ method: 'POST', pathname: parsed.pathname, body: adgroupBody });
      assert.equal(adgroupBody.nccCampaignId, 'cmp-hierarchy-inventory-http');
      assert.equal(adgroupBody.userLock, true);
      return new Response(JSON.stringify({
        ...adgroupBody,
        customerId: Number(CUSTOMER),
        nccAdgroupId: 'grp-hierarchy-inventory-http'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'GET' && parsed.pathname === '/ncc/adgroups/grp-hierarchy-inventory-http') {
      upstreamCalls.push({ method: 'GET', pathname: parsed.pathname });
      return new Response(JSON.stringify({
        ...adgroupBody,
        customerId: Number(CUSTOMER),
        nccAdgroupId: 'grp-hierarchy-inventory-http'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'GET' && parsed.pathname === '/ncc/keywords') {
      upstreamCalls.push({ method: 'GET', pathname: parsed.pathname, query: Object.fromEntries(parsed.searchParams) });
      assert.equal(parsed.searchParams.get('nccAdgroupId'), 'grp-hierarchy-inventory-http');
      assert.equal(parsed.searchParams.get('recordSize'), '1000');
      if (!parsed.searchParams.has('baseSearchId')) {
        assert.equal(parsed.searchParams.has('selector'), false);
        return new Response(JSON.stringify([{
          customerId: Number(CUSTOMER),
          nccAdgroupId: 'grp-hierarchy-inventory-http',
          nccKeywordId: 'kw-external-1',
          keyword: 'external-observation-only'
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      assert.equal(parsed.searchParams.get('baseSearchId'), 'kw-external-1');
      assert.equal(parsed.searchParams.get('selector'), 'NEXT');
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (init.method === 'GET' && parsed.pathname === '/ncc/ads') {
      upstreamCalls.push({ method: 'GET', pathname: parsed.pathname, query: Object.fromEntries(parsed.searchParams) });
      assert.equal(parsed.searchParams.get('nccAdgroupId'), 'grp-hierarchy-inventory-http');
      return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
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
      sourceRunId: 'synthetic-hierarchy-inventory-http-fixture',
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
      source: 'hierarchy-inventory-http-fixture', total_products: 0, total_completed: 0, products: {}
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
      NAVER_CLIENT_ID: 'hierarchy-inventory-commerce',
      NAVER_CLIENT_SECRET: 'hierarchy-inventory-commerce-secret',
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
      ATELIER_SEARCHAD_READER_PRINCIPAL_ID: 'hierarchy-inventory-reader',
      ATELIER_SEARCHAD_ADMIN_API_KEY: keys.admin,
      ATELIER_SEARCHAD_ADMIN_CUSTOMERS: CUSTOMER,
      ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'hierarchy-inventory-admin',
      NAVER_SEARCHAD_ACCESS_LICENSE: 'hierarchy-inventory-fixture-license',
      NAVER_SEARCHAD_SECRET_KEY: 'hierarchy-inventory-fixture-secret',
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
    assert.equal(rootExecuted.body.remoteId, 'cmp-hierarchy-inventory-http');
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
    assert.equal(childExecuted.body.remoteId, 'grp-hierarchy-inventory-http');
    assert.equal(childExecuted.body.parentObjectId, rootPrepared.body.hierarchyObjectId);
    assert.deepEqual(upstreamCalls.map(item => `${item.method} ${item.pathname}`), [
      'POST /ncc/campaigns',
      'GET /ncc/campaigns/cmp-hierarchy-inventory-http',
      'GET /ncc/campaigns/cmp-hierarchy-inventory-http',
      'POST /ncc/adgroups',
      'GET /ncc/adgroups/grp-hierarchy-inventory-http'
    ]);

    const replay = await call('admin', 'POST', childRoute, {
      customerId: CUSTOMER,
      executionToken: childApproved.body.executionToken
    });
    assert.notEqual(replay.status, 200);
    assert.equal(upstreamCalls.filter(item => item.method === 'POST' && item.pathname === '/ncc/adgroups').length, 1);

    // Restart with the public HTTP mutation switch OFF. Inventory is a remote
    // observation plus immutable local audit only, not a mutation permission.
    await current.api.close();
    current = null;
    env.ATELIER_HTTP_ALLOW_WRITES = 'false';
    await start();
    assert.equal(current.app.searchAdHierarchyRuntime?.status().scope.inventoryScan, true);

    const suspended = await call('admin', 'POST', `/api/v1/searchad/accounts/${CUSTOMER}/suspend`, {});
    assert.equal(suspended.status, 200, JSON.stringify(suspended));
    assert.equal(suspended.body.suspended, true);

    const inventoryBody = {
      customerId: CUSTOMER,
      hierarchyRunId: rootPrepared.body.hierarchyRunId,
      parentObjectId: childPrepared.body.hierarchyObjectId,
      childType: 'keyword'
    };
    const beforeInventoryReads = upstreamCalls.length;

    const inventoryReaderDenied = await call('reader', 'POST', '/api/v1/searchad/hierarchy/inventory/scan', inventoryBody);
    assert.equal(inventoryReaderDenied.status, 403);
    assert.equal(upstreamCalls.length, beforeInventoryReads);

    const overrideDenied = await call('admin', 'POST', '/api/v1/searchad/hierarchy/inventory/scan', {
      ...inventoryBody,
      remoteId: 'caller-forged-remote-id'
    });
    assert.equal(overrideDenied.status, 400);
    assert.equal(upstreamCalls.length, beforeInventoryReads);

    const observed = await call('admin', 'POST', '/api/v1/searchad/hierarchy/inventory/scan', inventoryBody);
    assert.equal(observed.status, 200, JSON.stringify(observed));
    assert.deepEqual(observed.body, {
      hierarchyRunId: rootPrepared.body.hierarchyRunId,
      parentObjectId: childPrepared.body.hierarchyObjectId,
      parentType: 'adgroup',
      childType: 'keyword',
      kind: 'present_remote_descendants',
      count: 1,
      completeAbsence: false,
      changed: false,
      scan: {
        requests: 2,
        acceptedPages: 2,
        termination: 'empty_page_observed',
        snapshotConsistency: 'unproven'
      }
    });
    assert.equal(Object.hasOwn(observed.body, 'remoteIds'), false);

    const keywordReads = upstreamCalls.slice(beforeInventoryReads);
    assert.deepEqual(keywordReads.map(item => `${item.method} ${item.pathname}`), [
      'GET /ncc/keywords',
      'GET /ncc/keywords'
    ]);

    const event = (await pool.query(
      "SELECT details_json FROM searchad_hierarchy_events WHERE hierarchy_run_id=$1 AND hierarchy_object_id=$2 AND phase='descendant_inventory' ORDER BY created_at DESC,event_id DESC LIMIT 1",
      [rootPrepared.body.hierarchyRunId, childPrepared.body.hierarchyObjectId]
    )).rows[0];
    assert.deepEqual({
      readOnly: event.details_json.readOnly,
      count: event.details_json.count,
      completeAbsence: event.details_json.completeAbsence,
      localMapping: event.details_json.localMapping,
      cleanupAuthority: event.details_json.cleanupAuthority,
      termination: event.details_json.scan?.termination,
      snapshotConsistency: event.details_json.scan?.snapshotConsistency
    }, {
      readOnly: true,
      count: 1,
      completeAbsence: false,
      localMapping: false,
      cleanupAuthority: false,
      termination: 'empty_page_observed',
      snapshotConsistency: 'unproven'
    });
    assert.equal(JSON.stringify(event.details_json).includes('kw-external-1'), false);

    const emptyCreative = await call('admin', 'POST', '/api/v1/searchad/hierarchy/inventory/scan', {
      ...inventoryBody,
      childType: 'creative'
    });
    assert.equal(emptyCreative.status, 200, JSON.stringify(emptyCreative));
    assert.equal(emptyCreative.body.kind, 'empty_unproven');
    assert.equal(emptyCreative.body.count, 0);
    assert.equal(emptyCreative.body.completeAbsence, false);
    assert.equal(emptyCreative.body.changed, false);
    assert.deepEqual(emptyCreative.body.scan, {
      requests: 1,
      acceptedPages: 1,
      termination: 'single_response_observed',
      snapshotConsistency: 'unproven'
    });
    assert.equal(Object.hasOwn(emptyCreative.body, 'remoteIds'), false);
    assert.equal(upstreamCalls.at(-1).method, 'GET');
    assert.equal(upstreamCalls.at(-1).pathname, '/ncc/ads');
    assert.equal(upstreamCalls.slice(beforeInventoryReads).some(item => item.method !== 'GET'), false);
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
