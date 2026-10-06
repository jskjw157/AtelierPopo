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
const keys = Object.fromEntries(['generic', 'reader', 'operator', 'executor', 'admin'].map(role => [role, `compose-${role}-`.repeat(5)]));
const CUSTOMER = '1001';
const OTHER = '2002';

// No permission/guard/service doubles. Upstream responses and immutable evidence
// are synthetic CI inputs, NEVER proof of a live account's authorization.
test('application role HTTP composes real PostgreSQL activation and the current async mutation path', { timeout: 180_000 }, async t => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) return t.skip('TEST_DATABASE_URL is required');
  const adminPool = createPostgresPool({ connectionString: databaseUrl, sslMode: 'disable', logger });
  const nativeFetch = globalThis.fetch;
  const savedEnv = new Map();
  let forbiddenCalls = 0;
  globalThis.fetch = async () => { forbiddenCalls += 1; throw new Error('Real upstream access is forbidden'); };
  const setEnv = (name, value) => {
    if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
    process.env[name] = value;
  };

  async function fixture(st, { missingDatabase = false, incompleteSchema = false } = {}) {
    const schema = `composition_${randomUUID().replaceAll('-', '')}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-composition-'));
    let created = false;
    let pool;
    let current;
    st.after(async () => {
      try { await current?.api.close(); }
      finally {
        try { if (pool) await closePostgresPool(pool); }
        finally {
          if (created) await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    const scoped = new URL(databaseUrl);
    scoped.searchParams.set('options', `-csearch_path=${schema}`);
    pool = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger });
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    if (!incompleteSchema) await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    const catalogRoot = path.join(dir, 'catalog');
    fs.mkdirSync(catalogRoot);
    fs.writeFileSync(path.join(catalogRoot, 'catalog_manifest.json'), JSON.stringify({ source: 'composition-fixture', total_products: 0, total_completed: 0, products: {} }));
    const templateFile = path.join(dir, 'template.json');
    fs.writeFileSync(templateFile, '{}');
    const raw = JSON.parse(fs.readFileSync('config/atelier-popo.example.json', 'utf8'));
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ ...raw, catalogRoot, templateFile, workDir: dir, databasePath: path.join(dir, 'ledger.sqlite') }));
    for (const [name, value] of Object.entries({ NAVER_CLIENT_ID: 'compose-commerce', NAVER_CLIENT_SECRET: 'compose-commerce-secret', NAVER_ALLOW_WRITES: 'false',
      ATELIER_WORK_DIR: dir, ATELIER_DATABASE_PATH: path.join(dir, 'ledger.sqlite'), ATELIER_CATALOG_ROOT: catalogRoot, ATELIER_TEMPLATE_FILE: templateFile })) setEnv(name, value);

    let env = {
      ATELIER_API_KEY: keys.generic,
      NAVER_SEARCHAD_ACCESS_LICENSE: 'compose-fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'compose-fixture-secret',
      NAVER_SEARCHAD_CUSTOMERS_JSON: JSON.stringify([CUSTOMER, OTHER]),
      ATELIER_CATALOG_PROVIDER: 'local', ATELIER_POSTGRES_SSL_MODE: 'disable',
      ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres', ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED: 'true',
      ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS: 'true', ATELIER_HTTP_ALLOW_WRITES: 'true',
      ATELIER_SEARCHAD_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_ALLOW_ROLLBACK: 'true',
      ATELIER_SEARCHAD_ALLOW_CREATES: 'false', ATELIER_SEARCHAD_ALLOW_BATCH_WRITES: 'false',
      ATELIER_SEARCHAD_ALLOW_DELETES: 'false', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'false',
      ATELIER_SEARCHAD_MAX_RETRIES: '0', ATELIER_WRITE_RATE_LIMIT_PER_MINUTE: '1000',
      ...(!missingDatabase ? { DATABASE_URL: scoped.toString() } : {})
    };
    for (const role of ['reader', 'operator', 'executor', 'admin']) {
      env[`ATELIER_SEARCHAD_${role.toUpperCase()}_API_KEY`] = keys[role];
      env[`ATELIER_SEARCHAD_${role.toUpperCase()}_CUSTOMERS`] = role === 'admin' ? `${CUSTOMER},${OTHER}` : CUSTOMER;
      env[`ATELIER_SEARCHAD_${role.toUpperCase()}_PRINCIPAL_ID`] = `compose-${role}`;
    }
    const states = new Map([CUSTOMER, OTHER].map(id => [id, { nccCampaignId: `cmp-${id}`, dailyBudget: 1000, userLock: true }]));
    const calls = [];
    let failMutation = false;
    const simulatedUpstream = async (url, init) => {
      const parsed = new URL(url);
      const customerId = init.headers['X-Customer'];
      assert.equal(parsed.origin, origin);
      assert.ok(states.has(customerId));
      assert.equal(parsed.pathname, `/ncc/campaigns/cmp-${customerId}`);
      assert.ok(init.headers['X-Signature']);
      assert.ok(['GET', 'PUT'].includes(init.method));
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ method: init.method, customerId, body });
      if (init.method === 'PUT') {
        states.set(customerId, { ...states.get(customerId), ...body });
        if (failMutation) { failMutation = false; throw Object.assign(new Error('Synthetic reset after apply'), { code: 'ECONNRESET' }); }
      }
      return new Response(JSON.stringify(states.get(customerId)), { status: 200,
        headers: { 'content-type': 'application/json', 'x-request-id': `composition-${calls.length}` } });
    };
    async function start() {
      const app = await bootstrapV05(configPath, { env, fetchImpl: simulatedUpstream });
      const api = createHttpApiV05({ app, env, logger });
      current = { app, api };
      await api.listen({ host: '127.0.0.1', port: 0 });
    }
    const call = async (role, method, route, body) => {
      const response = await nativeFetch(`http://127.0.0.1:${current.api.server.address().port}${route}`, {
        method, headers: { ...(role ? { Authorization: `Bearer ${keys[role]}` } : {}), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    };
    await start();
    const mutations = () => calls.filter(row => row.method === 'PUT');
    const planInput = (customerId = CUSTOMER, dailyBudget = 900) => {
      const registry = current.app.searchAdRegistry;
      const update = registry.get(CANARY_OPERATION_KEYS.updateCampaign);
      const read = registry.findByPath('GET', '/ncc/campaigns/{campaignId}') || registry.findByPath('GET', '/ncc/campaigns/{nccCampaignId}');
      assert.ok(read);
      const pathParams = { campaignId: `cmp-${customerId}`, nccCampaignId: `cmp-${customerId}` };
      const descriptor = body => ({ operationKey: update.operationKey, pathParams, query: { fields: 'budget' }, body, confirmation: update.confirmation });
      return { customerId, createdBy: 'spoofed-planner', reason: 'disposable application composition test',
        mutation: descriptor({ nccCampaignId: `cmp-${customerId}`, dailyBudget, userLock: true }),
        verification: { read: { operationKey: read.operationKey, pathParams }, expectedPatch: { dailyBudget } },
        rollback: { mutation: descriptor({ nccCampaignId: `cmp-${customerId}`, userLock: true }), bodyFromBefore: { dailyBudget: 'dailyBudget' } } };
    };
    const approve = async (customerId = CUSTOMER, role = 'operator', approvalRole = 'executor', dailyBudget = 900) => {
      const planned = await call(role, 'POST', '/api/v1/searchad/changes/plan', planInput(customerId, dailyBudget));
      assert.equal(planned.status, 201, JSON.stringify(planned));
      assert.equal(planned.body.created_by, `compose-${role}`);
      const id = planned.body.plan_id;
      const approved = await call(approvalRole, 'POST', `/api/v1/searchad/changes/${id}/approve`, { actor: 'spoofed-approver', confirmation: 'APPROVE_SEARCHAD_CHANGE' });
      assert.equal(approved.status, 200, JSON.stringify(approved));
      assert.equal(typeof approved.body.executionToken, 'string');
      assert.equal((await pool.query('SELECT actor FROM searchad_write_approvals WHERE plan_id=$1', [id])).rows[0].actor, `compose-${approvalRole}`);
      assert.equal(current.app.searchAdWriteRuntime.status().storage.runtime, 'postgres');
      assert.equal(current.app.searchAdWriteRuntime.repository.constructor.name, 'PostgresSearchAdWriteRepository');
      return { planId: id, customerId, executionToken: approved.body.executionToken, idempotencyKey: `composition-${id}` };
    };
    const seed = async ({ evidenceType = 'active_canary', fieldScope = ['campaign.dailyBudget', 'campaign.userLock'], customerId = CUSTOMER, expired = false } = {}) => {
      const runtime = current.app.searchAdActivationRuntime;
      const now = Date.now();
      const evidence = await runtime.repository.createEvidence({ evidenceId: randomUUID(), evidenceType, customerId,
        specSha: runtime.status().specSha, upstreamBaseUrl: origin,
        credentialFingerprint: credentialFingerprintForCustomer(current.app.searchAdCredentials, customerId),
        operationKeys: [CANARY_OPERATION_KEYS.updateCampaign], fieldScope, result: 'verified',
        sourceRunId: 'synthetic-ci-not-live', details: { fixtureOnly: true, secretKey: 'private-evidence-secret' },
        createdAt: new Date(now - 120_000).toISOString(), expiresAt: new Date(now + (expired ? -60_000 : 600_000)).toISOString() });
      if (expired) {
        // Historical expired grant is a negative fixture, not a bypass of the
        // activation API. All non-expired grants are issued through real HTTP.
        await runtime.repository.createActivation({ ...evidence, activationId: randomUUID(),
          activatedByPrincipalId: 'historical-ci-fixture', activatedAt: evidence.createdAt });
      } else {
        const activated = await call('admin', 'POST', '/api/v1/searchad/activations', { evidenceId: evidence.evidenceId });
        assert.equal(activated.status, 201, JSON.stringify(activated));
        assert.equal(activated.body.activatedByPrincipalId, 'compose-admin');
      }
      return evidence;
    };
    const execute = (input, generic = false, role = 'executor') => call(role, 'POST', generic
      ? `/api/v1/searchad/operations/${encodeURIComponent(CANARY_OPERATION_KEYS.updateCampaign)}/execute`
      : `/api/v1/searchad/changes/${input.planId}/execute`, input);
    const tokenUsed = async input => (await pool.query('SELECT used_at FROM searchad_write_approvals WHERE plan_id=$1', [input.planId])).rows[0].used_at;
    const assertDenied = async (input, code, generic = false) => {
      const before = mutations().length;
      const result = await execute(input, generic);
      assert.ok(result.status >= 400, JSON.stringify(result));
      assert.equal(result.body.error.code, code, JSON.stringify(result));
      assert.equal(await tokenUsed(input), null);
      assert.equal((await pool.query('SELECT status FROM searchad_write_change_plans WHERE plan_id=$1', [input.planId])).rows[0].status, 'approved');
      assert.equal(mutations().length, before);
      assert.equal(Number((await pool.query('SELECT count(*) AS n FROM searchad_write_locks WHERE plan_id=$1', [input.planId])).rows[0].n), 0);
    };
    return { get app() { return current.app; }, get api() { return current.api; }, pool, schema, calls, call, seed, approve, execute, tokenUsed, assertDenied, mutations, planInput,
      failMutation() { failMutation = true; }, setBudget(value) { states.get(CUSTOMER).dailyBudget = value; },
      async restart(overrides = {}) { await current.api.close(); env = { ...env, ...overrides }; await start(); } };
  }

  try {
    for (const scenario of [
      { name: 'absent grant', seed: null, code: 'SEARCHAD_ACTIVATION_REQUIRED' },
      { name: 'Passive-only grant', seed: { evidenceType: 'passive_capability' }, code: 'SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED' },
      { name: 'expired historical grant', seed: { expired: true }, code: 'SEARCHAD_ACTIVATION_REQUIRED' },
      { name: 'field-scope mismatch', seed: { fieldScope: ['campaign.userLock'] }, code: 'SEARCHAD_ACTIVATION_FIELD_SCOPE_MISMATCH' },
      { name: 'credential rotation across actual reboot', seed: {}, rotate: true, code: 'SEARCHAD_ACTIVATION_CONTEXT_MISMATCH' }
    ]) await t.test(`${scenario.name}: both HTTP execution routes preserve approval and release PG lock`, async st => {
      const h = await fixture(st);
      if (scenario.seed) await h.seed(scenario.seed);
      const input = await h.approve();
      if (scenario.rotate) await h.restart({ NAVER_SEARCHAD_SECRET_KEY: 'rotated-fixture-secret' });
      await h.assertDenied(input, scenario.code);
      await h.assertDenied(input, scenario.code, true);
    });

    await t.test('role and Customer isolation use persisted PG plans/evidence and cannot leak or execute foreign work', async st => {
      const h = await fixture(st);
      const ownEvidence = await h.seed();
      const foreignEvidence = await h.seed({ customerId: OTHER });
      const own = await h.approve();
      const foreign = await h.approve(OTHER, 'admin', 'admin');
      const before = h.calls.length;
      assert.equal((await h.execute(own, false, 'reader')).status, 403);
      assert.equal((await h.execute(own, true, 'operator')).status, 403);
      assert.equal((await h.execute(own, false, 'generic')).status, 401);
      assert.equal((await h.call('reader', 'POST', '/api/v1/searchad/changes/plan', h.planInput())).status, 403);
      assert.equal((await h.call('operator', 'POST', '/api/v1/searchad/activations', { evidenceId: ownEvidence.evidenceId })).status, 403);
      for (const suffix of ['', '/approve', '/execute', '/rollback', '/reconcile']) {
        const method = suffix ? 'POST' : 'GET';
        const denied = await h.call('executor', method, `/api/v1/searchad/changes/${foreign.planId}${suffix}`, suffix ? foreign : undefined);
        const missing = await h.call('executor', method, `/api/v1/searchad/changes/${randomUUID()}${suffix}`, suffix ? foreign : undefined);
        assert.equal(denied.status, 404, JSON.stringify(denied));
        assert.equal(missing.status, 404, JSON.stringify(missing));
        assert.equal(denied.body.error.code, missing.body.error.code);
      }
      assert.equal((await h.execute(foreign, true)).status, 404);
      assert.equal((await h.call('reader', 'GET', `/api/v1/searchad/evidence/${foreignEvidence.evidenceId}`)).status, 404);
      const listed = await h.call('reader', 'GET', '/api/v1/searchad/changes');
      assert.deepEqual(listed.body.items.map(row => row.plan_id), [own.planId]);
      const evidence = await h.call('reader', 'GET', '/api/v1/searchad/evidence');
      assert.deepEqual(evidence.body.items.map(row => row.evidenceId), [ownEvidence.evidenceId]);
      assert.equal(JSON.stringify(evidence.body).includes('private-evidence-secret'), false);
      assert.equal(JSON.stringify(listed.body).includes(own.executionToken), false);
      assert.equal(h.calls.length, before);
      assert.equal(await h.tokenUsed(own), null);
      assert.equal(await h.tokenUsed(foreign), null);
      assert.equal(h.mutations().length, 0);
    });

    await t.test('suspend survives reboot; resume permits the same token once and rollback revalidates activation', async st => {
      const h = await fixture(st);
      const evidence = await h.seed();
      const input = await h.approve();
      assert.equal((await h.call('admin', 'POST', `/api/v1/searchad/accounts/${CUSTOMER}/suspend`, {})).status, 200);
      await h.assertDenied(input, 'SEARCHAD_ACCOUNT_SUSPENDED');
      const oldRuntime = h.app.searchAdActivationRuntime;
      await h.restart();
      await assert.rejects(() => oldRuntime.repository.listEvidence({ customerIds: [CUSTOMER] }));
      assert.equal((await h.call('reader', 'GET', `/api/v1/searchad/evidence/${evidence.evidenceId}`)).status, 200);
      await h.assertDenied(input, 'SEARCHAD_ACCOUNT_SUSPENDED', true);
      assert.equal((await h.call('admin', 'POST', `/api/v1/searchad/accounts/${CUSTOMER}/resume`, {})).status, 200);
      const applied = await h.execute(input, true);
      assert.equal(applied.status, 200, JSON.stringify(applied));
      assert.equal(applied.body.result.status, 'applied');
      assert.ok(await h.tokenUsed(input));
      const replay = await h.execute(input);
      assert.equal(replay.body.error.code, 'SEARCHAD_CHANGE_PLAN_NOT_EXECUTABLE');
      assert.equal(h.mutations().length, 1);
      await h.call('admin', 'POST', `/api/v1/searchad/accounts/${CUSTOMER}/suspend`, {});
      const body = { confirmation: 'ROLLBACK_SEARCHAD_CHANGE', idempotencyKey: `rollback-${input.planId}` };
      const rollbackPath = `/api/v1/searchad/changes/${input.planId}/rollback`;
      const denied = await h.call('executor', 'POST', rollbackPath, body);
      assert.equal(denied.body.error.code, 'SEARCHAD_ACCOUNT_SUSPENDED');
      assert.equal(h.mutations().length, 1);
      await h.call('admin', 'POST', `/api/v1/searchad/accounts/${CUSTOMER}/resume`, {});
      const rolledBack = await h.call('executor', 'POST', rollbackPath, body);
      assert.equal(rolledBack.status, 200, JSON.stringify(rolledBack));
      assert.equal(rolledBack.body.status, 'rolled_back');
      assert.equal(h.mutations().length, 2);
      assert.equal(h.mutations()[1].body.dailyBudget, 1000);
    });

    await t.test('unknown outcome is never retried and read-only HTTP reconcile works after reboot with writes OFF and account suspended', async st => {
      const h = await fixture(st);
      await h.seed();
      const input = await h.approve();
      h.failMutation();
      const unknown = await h.execute(input);
      assert.equal(unknown.body.error.code, 'SEARCHAD_UNKNOWN_OUTCOME', JSON.stringify(unknown));
      assert.equal(h.mutations().length, 1);
      await h.call('admin', 'POST', `/api/v1/searchad/accounts/${CUSTOMER}/suspend`, {});
      await h.restart({ ATELIER_HTTP_ALLOW_WRITES: 'false', ATELIER_SEARCHAD_ALLOW_WRITES: 'false' });
      const denied = await h.execute(input);
      assert.equal(denied.body.error.code, 'HTTP_WRITES_DISABLED');
      const reconciled = await h.call('executor', 'POST', `/api/v1/searchad/changes/${input.planId}/reconcile`, {});
      assert.equal(reconciled.status, 200, JSON.stringify(reconciled));
      assert.equal(reconciled.body.status, 'applied_reconciled');
      assert.equal(h.mutations().length, 1);
    });

    await t.test('actual shared-store increase fails with unavailable net loss and consumed authority', async st => {
      const h = await fixture(st);
      await h.seed();
      const input = await h.approve(CUSTOMER, 'operator', 'executor', 1200);
      const denied = await h.execute(input);
      assert.equal(denied.status, 409, JSON.stringify(denied));
      assert.equal(denied.body.error.code, 'SEARCHAD_CIRCUIT_DENIED');
      assert.deepEqual(denied.body.error.details.reasons, ['LOSS_EVIDENCE_UNAVAILABLE']);
      assert.equal(h.mutations().length, 0);
      const consumedAt = await h.tokenUsed(input);
      assert.ok(consumedAt);
      const detail = await h.call('reader', 'GET', `/api/v1/searchad/changes/${input.planId}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.status, 'failed');
      assert.equal(detail.body.last_error_json.code, 'SEARCHAD_CIRCUIT_DENIED');
      await h.restart();
      const beforeReplay = h.calls.length;
      const replay = await h.execute(input, true);
      assert.equal(replay.status, 409);
      assert.equal(replay.body.error.code, 'SEARCHAD_CHANGE_PLAN_NOT_EXECUTABLE');
      assert.equal(h.calls.length, beforeReplay);
      assert.deepEqual(await h.tokenUsed(input), consumedAt);
      assert.equal(h.mutations().length, 0);
    });

    await t.test('drift in the composed HTTP path blocks mutation and preserves the unused token', async st => {
      const h = await fixture(st);
      await h.seed();
      const input = await h.approve();
      h.setBudget(1100);
      const drift = await h.execute(input);
      assert.equal(drift.status, 409, JSON.stringify(drift));
      assert.equal(await h.tokenUsed(input), null);
      assert.equal(h.mutations().length, 0);
      assert.equal(Number((await h.pool.query('SELECT count(*) AS n FROM searchad_write_locks WHERE plan_id=$1', [input.planId])).rows[0].n), 0);
    });

    for (const scenario of [
      { name: 'complete schema', options: {}, ready: true },
      { name: 'missing DATABASE_URL', options: { missingDatabase: true }, ready: false },
      { name: 'incomplete schema', options: { incompleteSchema: true }, ready: false }
    ]) await t.test(`actual bootstrap public readiness: ${scenario.name}`, async st => {
      const h = await fixture(st, scenario.options);
      const health = await h.call(null, 'GET', '/health/ready');
      assert.equal(health.status, scenario.ready ? 200 : 503, JSON.stringify(health));
      assert.equal(health.body.ok, scenario.ready);
      assert.equal(h.api.readiness().ready, scenario.ready);
      assert.deepEqual(health.body.searchAdActivation, { required: true, initialized: scenario.ready, ready: scenario.ready });
      assert.equal(/compose-fixture|credential|fingerprint|databaseUrl|startupError|customerId|1001|2002/.test(JSON.stringify(health.body)), false);
      assert.equal(h.calls.length, 0);
      assert.equal(h.app.searchAdWriteRuntime, undefined);
      if (scenario.options.incompleteSchema) {
        assert.equal((await adminPool.query('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema=$1', [h.schema])).rows[0].n, 0);
      }
    });
    assert.equal(forbiddenCalls, 0, 'no code may fall through to a real external fetch');
  } finally {
    globalThis.fetch = nativeFetch;
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await closePostgresPool(adminPool);
  }
});
