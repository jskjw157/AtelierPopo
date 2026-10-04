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
import { CANARY_OPERATION_KEYS } from '../src/naver/searchad/canary/production-recipe.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';

const logger = { info() {}, warn() {}, error() {} };
const origin = 'https://api.searchad.naver.com';
const customerId = '1001';
const keys = Object.fromEntries(['generic', 'admin', 'executor'].map(role => [role, `application-fence-${role}-`.repeat(4)]));

// Actual application bootstrap, role HTTP, native activation and account control.
// Only upstream replies and the explicitly marked authority evidence are synthetic.
// The claim/authorization wrappers create scheduling gaps, not permission doubles.
test('application send fence uses native account storage independently of plan storage and restart', { timeout: 120000 }, async t => {
  if (!process.env.TEST_DATABASE_URL) return t.skip('TEST_DATABASE_URL is required');
  const adminPool = createPostgresPool({ connectionString: process.env.TEST_DATABASE_URL, sslMode: 'disable', logger });
  const nativeFetch = globalThis.fetch;
  const savedEnv = new Map();
  let forbiddenCalls = 0;
  globalThis.fetch = async () => { forbiddenCalls += 1; throw new Error('Live transport is forbidden'); };
  const setEnv = (name, value) => {
    if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
    process.env[name] = value;
  };

  async function fixture(st, storage = 'sqlite', canary = false) {
    const schema = `app_fence_${randomUUID().replaceAll('-', '')}`;
    const planSchema = `${schema}_plans`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-app-fence-'));
    const schemas = [];
    let pool, planPool, current;
    st.after(async () => {
      try { await current?.api.close(); }
      finally {
        try { if (planPool) await closePostgresPool(planPool); }
        finally {
          try { if (pool) await closePostgresPool(pool); }
          finally {
            for (const name of schemas.reverse()) await adminPool.query(`DROP SCHEMA "${name}" CASCADE`);
            fs.rmSync(dir, { recursive: true, force: true });
          }
        }
      }
    });
    async function database(name) {
      await adminPool.query(`CREATE SCHEMA "${name}"`); schemas.push(name);
      const url = new URL(process.env.TEST_DATABASE_URL);
      url.searchParams.set('options', `-csearch_path=${name}`);
      const p = createPostgresPool({ connectionString: url.toString(), sslMode: 'disable', logger });
      await runPostgresMigrations({ pool: p, migrationsDir: path.resolve('migrations/postgres'), logger });
      return { pool: p, url: url.toString() };
    }
    const control = await database(schema); pool = control.pool;
    let planUrl;
    if (storage === 'postgres') {
      const plans = await database(planSchema); planPool = plans.pool; planUrl = plans.url;
      // A deliberately stale mirror cannot overrule the native activation database.
      await planPool.query('INSERT INTO searchad_canary_accounts(customer_id,suspended,updated_at) VALUES($1,false,now())', [customerId]);
    }
    const catalogRoot = path.join(dir, 'catalog'); fs.mkdirSync(catalogRoot);
    fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({ source: 'fixture', total_products: 0, total_completed: 0, products: {} }));
    const templateFile = path.join(dir, 'template.json'); fs.writeFileSync(templateFile, '{}');
    const configPath = path.join(dir, 'config.json');
    const raw = JSON.parse(fs.readFileSync('config/atelier-popo.example.json', 'utf8'));
    fs.writeFileSync(configPath, JSON.stringify({ ...raw, catalogRoot, templateFile, workDir: dir, databasePath: path.join(dir, 'ledger.sqlite') }));
    for (const [name, value] of Object.entries({ NAVER_CLIENT_ID: 'fixture-commerce', NAVER_CLIENT_SECRET: 'fixture-commerce-secret', NAVER_ALLOW_WRITES: 'false',
      ATELIER_WORK_DIR: dir, ATELIER_DATABASE_PATH: path.join(dir, 'ledger.sqlite'), ATELIER_CATALOG_ROOT: catalogRoot, ATELIER_TEMPLATE_FILE: templateFile })) setEnv(name, value);
    let env = {
      ATELIER_API_KEY: keys.generic, DATABASE_URL: control.url,
      NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret',
      NAVER_SEARCHAD_CUSTOMERS_JSON: JSON.stringify([customerId]), ATELIER_CATALOG_PROVIDER: 'local',
      ATELIER_POSTGRES_SSL_MODE: 'disable', ATELIER_SEARCHAD_WRITE_STORAGE: storage,
      ATELIER_SEARCHAD_WRITE_DB_PATH: path.join(dir, 'searchad.sqlite'),
      ...(planUrl ? { ATELIER_SEARCHAD_WRITE_DATABASE_URL: planUrl } : {}),
      ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true', ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true',
      ATELIER_HTTP_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_ALLOW_ROLLBACK: 'true',
      ATELIER_SEARCHAD_ALLOW_CREATES: 'false', ATELIER_SEARCHAD_ALLOW_DELETES: 'false', ATELIER_SEARCHAD_ALLOW_BATCH_WRITES: 'false',
      ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: String(canary), ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
      ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000', ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '1200', ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-12', ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-12',
      ATELIER_SEARCHAD_MAX_RETRIES: '0', ATELIER_WRITE_RATE_LIMIT_PER_MINUTE: '1000'
    };
    for (const role of ['admin', 'executor']) {
      env[`ATELIER_SEARCHAD_${role.toUpperCase()}_API_KEY`] = keys[role];
      env[`ATELIER_SEARCHAD_${role.toUpperCase()}_CUSTOMERS`] = customerId;
      env[`ATELIER_SEARCHAD_${role.toUpperCase()}_PRINCIPAL_ID`] = `fixture-${role}`;
    }
    let state = { nccCampaignId: 'cmp-fixture', dailyBudget: 1000, userLock: true };
    const calls = [], transportFailures = [];
    const simulatedUpstream = async (url, init) => {
      try {
        assert.equal(new URL(url).origin, origin);
        assert.equal(new URL(url).pathname, '/ncc/campaigns/cmp-fixture');
        assert.equal(init.headers['X-Customer'], customerId);
        assert.ok(init.headers['X-Signature']);
        assert.ok(['GET', 'PUT'].includes(init.method));
      } catch (error) { transportFailures.push(error.message); throw error; }
      calls.push(init.method);
      if (init.method === 'PUT') state = { ...state, ...JSON.parse(init.body) };
      return new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    async function start() {
      const app = await bootstrapV05(configPath, { env, fetchImpl: simulatedUpstream });
      const api = createHttpApiV05({ app, env, logger }); current = { app, api };
      assert.equal(app.searchAdActivationStartupError, null);
      assert.equal(app.searchAdActivationRuntime.status().ready, true);
      if (canary) assert.equal(app.searchAdActiveCanaryRuntime.status().ready, true);
      await api.listen({ host: '127.0.0.1', port: 0 });
    }
    const call = async (role, method, route, body) => {
      const response = await nativeFetch(`http://127.0.0.1:${current.api.server.address().port}${route}`, {
        method, headers: { Authorization: `Bearer ${keys[role]}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    };
    const account = async action => {
      const result = await call('admin', 'POST', `/api/v1/searchad/accounts/${customerId}/${action}`, {});
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal((await pool.query('SELECT suspended FROM searchad_canary_accounts WHERE customer_id=$1', [customerId])).rows[0].suspended, action === 'suspend');
      if (planPool) assert.equal((await planPool.query('SELECT suspended FROM searchad_canary_accounts WHERE customer_id=$1', [customerId])).rows[0].suspended, false);
    };
    const seed = async (passive = false) => {
      const app = current.app, runtime = app.searchAdActivationRuntime, now = Date.now();
      const recipe = app.searchAdActiveCanaryRuntime?.recipe;
      const evidence = await runtime.repository.createEvidence({ evidenceId: randomUUID(), customerId,
        evidenceType: passive ? 'passive_capability' : 'active_canary', specSha: runtime.status().specSha, upstreamBaseUrl: origin,
        credentialFingerprint: credentialFingerprintForCustomer(app.searchAdCredentials, customerId),
        operationKeys: passive ? [...recipe.requiredOperationKeys] : [CANARY_OPERATION_KEYS.updateCampaign],
        fieldScope: passive ? [...recipe.verifiedOperationScope.fieldScope] : ['campaign.dailyBudget', 'campaign.userLock'],
        result: 'verified', sourceRunId: 'synthetic-ci-not-live', details: { fixtureOnly: true },
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600000).toISOString() });
      if (!passive) assert.equal((await call('admin', 'POST', '/api/v1/searchad/activations', { evidenceId: evidence.evidenceId })).status, 201);
      return evidence.evidenceId;
    };
    const approve = async () => {
      const registry = current.app.searchAdRegistry, update = registry.get(CANARY_OPERATION_KEYS.updateCampaign);
      const read = registry.findByPath('GET', '/ncc/campaigns/{campaignId}') || registry.findByPath('GET', '/ncc/campaigns/{nccCampaignId}');
      const pathParams = { campaignId: 'cmp-fixture', nccCampaignId: 'cmp-fixture' };
      const descriptor = body => ({ operationKey: update.operationKey, pathParams, query: { fields: 'budget' }, body, confirmation: update.confirmation });
      const planned = await call('admin', 'POST', '/api/v1/searchad/changes/plan', { customerId, reason: 'application send fence fixture',
        mutation: descriptor({ nccCampaignId: 'cmp-fixture', dailyBudget: 1200, userLock: true }),
        verification: { read: { operationKey: read.operationKey, pathParams }, expectedPatch: { dailyBudget: 1200 } },
        rollback: { mutation: descriptor({ nccCampaignId: 'cmp-fixture', userLock: true }), bodyFromBefore: { dailyBudget: 'dailyBudget' } } });
      assert.equal(planned.status, 201, JSON.stringify(planned));
      const approval = await call('executor', 'POST', `/api/v1/searchad/changes/${planned.body.plan_id}/approve`, { confirmation: 'APPROVE_SEARCHAD_CHANGE' });
      assert.equal(approval.status, 200, JSON.stringify(approval));
      assert.equal(current.app.searchAdWriteRuntime.status().storage.runtime, storage);
      return { planId: planned.body.plan_id, customerId, ...approval.body, idempotencyKey: randomUUID() };
    };
    const tokenUsed = async input => (await current.app.searchAdWriteRuntime.repository.getApproval(input.approvalId)).used_at;
    const execute = (input, generic = false) => call('executor', 'POST', generic
      ? `/api/v1/searchad/operations/${encodeURIComponent(CANARY_OPERATION_KEYS.updateCampaign)}/execute`
      : `/api/v1/searchad/changes/${input.planId}/execute`, { planId: input.planId, customerId, executionToken: input.executionToken, idempotencyKey: input.idempotencyKey });
    await start();
    st.after(() => assert.deepEqual(transportFailures, [], 'transport contract failures cannot be swallowed by production error handling'));
    return { get app() { return current.app; }, pool, planPool, call, account, seed, approve, tokenUsed, execute, calls,
      mutations: () => calls.filter(method => method !== 'GET').length,
      async restart(overrides = {}) { await current.api.close(); env = { ...env, ...overrides }; await start(); } };
  }

  try {
    for (const storage of ['sqlite', 'postgres']) {
      for (const generic of [false, true]) await t.test(`${storage} / generic=${generic}: suspension committed after real claim prevents HTTP PUT`, async st => {
        const h = await fixture(st, storage); await h.seed(); const input = await h.approve();
        const claim = h.app.searchAdWriteRuntime.approvalService.claim.bind(h.app.searchAdWriteRuntime.approvalService);
        let gapReached = false;
        h.app.searchAdWriteRuntime.approvalService.claim = async (...args) => {
          const result = await claim(...args); await h.account('suspend'); gapReached = true; return result;
        };
        const denied = await h.execute(input, generic);
        assert.equal(gapReached, true, JSON.stringify(denied));
        assert.equal(h.mutations(), 0, 'APPLICATION_SENT_AFTER_COMMITTED_SUSPENSION');
        assert.ok(denied.status >= 400, JSON.stringify(denied));
        assert.ok(await h.tokenUsed(input));
        const oldRuntime = h.app.searchAdActivationRuntime;
        await h.restart({ ATELIER_HTTP_ALLOW_WRITES: 'false', ATELIER_SEARCHAD_ALLOW_WRITES: 'false' });
        assert.notEqual(h.app.searchAdActivationRuntime, oldRuntime);
        await assert.rejects(() => oldRuntime.repository.listEvidence({ customerIds: [customerId] }));
        const recovered = await h.call('executor', 'POST', `/api/v1/searchad/changes/${input.planId}/reconcile`, {});
        assert.equal(recovered.status, 200, JSON.stringify(recovered));
        assert.equal(recovered.body.status, 'not_applied');
        assert.ok(await h.tokenUsed(input));
        await h.account('resume'); await h.restart({ ATELIER_HTTP_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_ALLOW_WRITES: 'true' });
        assert.ok((await h.execute(input, !generic)).status >= 400);
        assert.equal(h.mutations(), 0);
      });

      await t.test(`${storage}: HTTP rollback rechecks native account state after authorization`, async st => {
        const h = await fixture(st, storage); await h.seed(); const input = await h.approve();
        const applied = await h.execute(input); assert.equal(applied.status, 200, JSON.stringify(applied));
        assert.equal(h.mutations(), 1);
        const service = h.app.searchAdWriteRuntime.executionService, authorize = service.assertActivation.bind(service);
        let gapReached = false;
        service.assertActivation = async (...args) => { const result = await authorize(...args); await h.account('suspend'); gapReached = true; return result; };
        const denied = await h.call('executor', 'POST', `/api/v1/searchad/changes/${input.planId}/rollback`, {
          confirmation: 'ROLLBACK_SEARCHAD_CHANGE', idempotencyKey: randomUUID() });
        assert.equal(gapReached, true, JSON.stringify(denied));
        assert.equal(h.mutations(), 1, 'APPLICATION_ROLLBACK_SENT_AFTER_COMMITTED_SUSPENSION');
        assert.ok(denied.status >= 400, JSON.stringify(denied));
        assert.ok(await h.tokenUsed(input));
      });

      await t.test(`${storage}: a pre-claim suspension survives restart without consuming approval`, async st => {
        const h = await fixture(st, storage); await h.seed(); const input = await h.approve();
        await h.account('suspend'); await h.restart();
        const denied = await h.execute(input, true);
        assert.equal(denied.body.error?.code, 'SEARCHAD_ACCOUNT_SUSPENDED', JSON.stringify(denied));
        assert.equal(await h.tokenUsed(input), null); assert.equal(h.mutations(), 0);
        await h.account('resume'); const applied = await h.execute(input);
        assert.equal(applied.status, 200, JSON.stringify(applied)); assert.equal(h.mutations(), 1);
        assert.ok(await h.tokenUsed(input));
      });
    }

    await t.test('bootstrapped Canary preserves suspended account on restart and cannot reserve risk or send', async st => {
      const h = await fixture(st, 'sqlite', true); const evidenceId = await h.seed(true);
      await h.account('suspend'); await h.restart();
      const runtime = h.app.searchAdActiveCanaryRuntime;
      const riskBefore = (await h.pool.query('SELECT count(*)::int AS n FROM searchad_risk_reservations')).rows[0].n;
      const outcome = await runtime.service.start({ customerId, passiveEvidenceId: evidenceId }, {
        principal: { principalId: 'fixture-admin', role: 'admin', customerIds: [customerId] }, requestId: randomUUID() }).catch(error => error);
      assert.equal(outcome?.code, 'SEARCHAD_CANARY_ACCOUNT_SUSPENDED');
      assert.equal(h.calls.length, 0);
      assert.equal((await h.pool.query('SELECT count(*)::int AS n FROM searchad_risk_reservations')).rows[0].n, riskBefore);
      assert.equal((await h.pool.query('SELECT suspended FROM searchad_canary_accounts WHERE customer_id=$1', [customerId])).rows[0].suspended, true);
    });
    assert.equal(forbiddenCalls, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    for (const [name, value] of savedEnv) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await closePostgresPool(adminPool);
  }
});
