import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postgresCompletionFixture, completionReaderKey, completionOperatorKey } from './helpers/postgres-searchad-completion-fixture.js';
import { now } from './helpers/searchad-completion-fixture.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { LocalReportStorage } from '../src/naver/searchad/reporting/blob-storage.js';
import { autoFacts } from './helpers/searchad-limited-auto-fixture.js';
import { autoWindow } from '../src/naver/searchad/automation/eligibility.js';
import { CAMPAIGN_WRITE } from '../src/naver/searchad/automation/recipes.js';
import { main as startHeadlessWorker } from '../src/searchad-worker.js';

const adminKey = 'completion-acceptance-admin-'.repeat(4);
const executorKey = 'completion-acceptance-executor-'.repeat(4);
const iso = value => new Date(value).toISOString();
const roles = {
  ATELIER_SEARCHAD_ADMIN_API_KEY: adminKey,
  ATELIER_SEARCHAD_ADMIN_CUSTOMERS: '1001',
  ATELIER_SEARCHAD_ADMIN_PRINCIPAL_ID: 'completion-admin',
  ATELIER_SEARCHAD_EXECUTOR_API_KEY: executorKey,
  ATELIER_SEARCHAD_EXECUTOR_CUSTOMERS: '1001',
  ATELIER_SEARCHAD_EXECUTOR_PRINCIPAL_ID: 'completion-executor'
};
function native(t) {
  if (process.env.TEST_DATABASE_URL) return true;
  assert.notEqual(process.env.CI, 'true', 'CI acceptance requires native PostgreSQL');
  t.skip('TEST_DATABASE_URL required'); return false;
}
async function activation(f, server, { operationKey, fieldScope, lifecycleKinds = [], expiresAt = now + 600_000 }) {
  const evidence = await server.app.searchAdActivationRuntime.repository.createEvidence({
    evidenceId: randomUUID(), evidenceType: 'active_canary', customerId: '1001',
    specSha: server.app.searchAdRegistry.status().specRef,
    credentialFingerprint: credentialFingerprintForCustomer(server.app.searchAdCredentials, '1001'),
    upstreamBaseUrl: 'https://api.searchad.naver.com', operationKeys: [operationKey], fieldScope,
    lifecycleKinds, result: 'verified', sourceRunId: 'synthetic-completion-not-live',
    details: { fixtureOnly: true }, createdAt: iso(now - 1000), expiresAt: iso(expiresAt)
  });
  const result = await server.call(adminKey, 'POST', '/api/v1/searchad/activations', { evidenceId: evidence.evidenceId });
  assert.equal(result.status, 201, JSON.stringify(result)); return result.body.activationId;
}

test('native bootstrap hierarchy preserves SQL DATE risk calendar under KST clients', async t => {
  if (!native(t)) return;
  const f = await postgresCompletionFixture(t); let campaign, time = now;
  const server = await f.start({
    clock: () => time,
    appEnv: { ...roles, ATELIER_HTTP_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres',
      ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true', ATELIER_SEARCHAD_ACTIVATION_MODE: 'canary',
      ATELIER_SEARCHAD_CANARY_DAILY_BUDGET_KRW: '1000', ATELIER_SEARCHAD_CANARY_BUDGET_DELTA_KRW: '100',
      ATELIER_SEARCHAD_CANARY_MAX_DAILY_BUDGET_KRW: '2000', ATELIER_SEARCHAD_CANARY_MAX_BUDGET_DELTA_KRW: '500',
      ATELIER_SEARCHAD_CANARY_STATS_SINCE: '2026-09-01', ATELIER_SEARCHAD_CANARY_STATS_UNTIL: '2026-09-02' },
    allowedPaths: ['/ncc/campaigns', '/ncc/campaigns/cmp-calendar'],
    allowedMethods: { '/ncc/campaigns': ['POST'] },
    response: ({ init }) => {
      if (init.method === 'POST') campaign = { ...JSON.parse(init.body), customerId: 1001, nccCampaignId: 'cmp-calendar' };
      return Response.json(campaign);
    }
  });
  assert.equal(server.app.searchAdHierarchyRuntime.status().ready, true);
  const activationId = await activation(f, server, { operationKey: OPS.campaign.create,
    fieldScope: ['campaign.campaignTp', 'campaign.name', 'campaign.userLock', 'campaign.dailyBudget'], lifecycleKinds: ['create'] });
  const prepared = await server.call(adminKey, 'POST', '/api/v1/searchad/hierarchy/campaigns/prepare', { customerId: '1001', activationId });
  assert.equal(prepared.status, 201, JSON.stringify(prepared));
  const approved = await server.call(adminKey, 'POST', `/api/v1/searchad/changes/${prepared.body.planId}/approve`, { confirmation: 'APPROVE_SEARCHAD_CHANGE' });
  assert.equal(approved.status, 200, JSON.stringify(approved));
  const execute = `/api/v1/searchad/hierarchy/campaigns/${prepared.body.hierarchyRunId}/${prepared.body.hierarchyObjectId}/${prepared.body.planId}/execute`;
  const outcome = await server.call(adminKey, 'POST', execute, { customerId: '1001', executionToken: approved.body.executionToken });
  assert.equal(outcome.status, 200, JSON.stringify(outcome));
  assert.equal(outcome.body.state, 'owned');
  const risk = (await f.pool.query('SELECT risk_date::text AS risk_date,state FROM searchad_risk_reservations')).rows;
  assert.deepEqual(risk, [{ risk_date: '2026-10-05', state: 'consumed' }]);
  assert.deepEqual(f.calls.map(call => call.method), ['POST', 'GET']);
  assert.notEqual((await server.call(adminKey, 'POST', execute, { customerId: '1001', executionToken: approved.body.executionToken })).status, 200);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  time = now + 600_001;
  const expired = await server.call(adminKey, 'POST', '/api/v1/searchad/hierarchy/campaigns/prepare', { customerId: '1001', activationId });
  assert.equal(expired.status, 403); assert.equal(expired.body.error.code, 'SEARCHAD_CAMPAIGN_CREATE_AUTHORITY_REQUIRED');
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('composed completion status retains descriptive operational blockers', async t => {
  if (!native(t)) return;
  const f = await postgresCompletionFixture(t), server = await f.start();
  const status = server.app.searchAdCompletionRuntime.status();
  assert.equal(status.automation.defaultMode, 'observe');
  assert.equal(status.automation.autoAvailable, false);
  assert.ok(status.blockers.some(blocker => blocker.code === 'parent_remote_absence_unproven'));
  assert.ok(status.blockers.some(blocker => blocker.code === 'live_validation_not_performed'));
  assert.ok(status.blockers.some(blocker => blocker.code === 'actual_profitability_unavailable'));
  assert.ok(status.blockers.some(blocker => blocker.code === 'estimate_read_capability_unavailable'));
  assert.ok(status.blockers.every(blocker => blocker.descriptiveOnly === true && blocker.executionAuthority === false));
  const hierarchy = server.app.searchAdHierarchyRuntime.status();
  assert.equal(hierarchy.scope.cleanup, false);
  assert.equal((await server.call(completionReaderKey, 'GET', '/api/v1/searchad/validation/operations?customerId=1001')).body.total, 126);
});

test('actual bootstrap missing database or required storage is unready and headless worker fails closed', async t => {
  if (!native(t)) return;
  const f = await postgresCompletionFixture(t);
  for (const [name, appEnv] of [
    ['database', { DATABASE_URL: '' }],
    ['required storage', { ATELIER_SEARCHAD_REPORT_INGESTION_REQUIRED: 'true', ATELIER_SEARCHAD_REPORT_CLOCK_UNCERTAINTY_MS: '1000', ATELIER_SEARCHAD_REPORT_ROLLOUT_UNCERTAINTY_MS: '1000' }]
  ]) await t.test(name, async () => {
    const server = await f.start({ appEnv });
    const ready = await server.call(completionReaderKey, 'GET', '/health/ready');
    assert.equal(ready.status, 503); assert.equal(ready.body.searchAdCompletion.ready, false);
    assert.deepEqual(Object.keys(ready.body.searchAdCompletion).sort(), ['initialized', 'ready', 'required']);
    assert.equal(JSON.stringify(ready.body).includes('postgresql:'), false); assert.equal(f.calls.length, 0);
    await server.api.close(); await server.app.close();
  });
  const appEnv = { DATABASE_URL: '', ATELIER_SEARCHAD_WORKER_ENABLED: 'true', ATELIER_SEARCHAD_WORKER_CUSTOMERS: '1001', ATELIER_SEARCHAD_WORKER_PRINCIPAL_ID: 'completion-worker' };
  await assert.rejects(() => startHeadlessWorker({ env: { ...f.env, ...appEnv }, clock: () => now,
    bootstrap: async () => (await f.start({ appEnv, headless: true })).app,
    logger: { info() {}, error() {} } }), { code: 'SEARCHAD_WORKER_CONFIG' });
  const requiredStorage = { ...appEnv, DATABASE_URL: f.databaseUrl, ATELIER_SEARCHAD_REPORT_INGESTION_REQUIRED: 'true' };
  await assert.rejects(() => startHeadlessWorker({ env: { ...f.env, ...requiredStorage }, clock: () => now,
    bootstrap: async () => (await f.start({ appEnv: requiredStorage, headless: true })).app,
    logger: { info() {}, error() {} } }), { code: 'SEARCHAD_WORKER_STARTUP' });
  assert.equal(f.calls.length, 0);
});

test('one composed Customer workflow crosses HTTP, native sources, standalone worker and restart', { timeout: 180_000 }, async t => {
  if (!native(t)) return;
  const f = await postgresCompletionFixture(t), root = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-acceptance-'));
  const storage = new LocalReportStorage({ root }), nativeFetch = globalThis.fetch, logs = [], responses = [], tokens = [];
  const originalWrite = process.stderr.write; let forbidden = 0, time = now, server, workerProcess, loseVerification = false;
  const jobs = new Map(), commerceCalls = [], cafeCalls = [], state = { nccCampaignId: 'cmp-1', dailyBudget: 1000, userLock: false };
  globalThis.fetch = async (url, init) => {
    if (new URL(url).origin.startsWith('http://127.0.0.1:')) return nativeFetch(url, init);
    forbidden++; throw new Error('Uninjected outbound call rejected');
  };
  process.stderr.write = function (chunk, ...args) { logs.push(String(chunk)); return originalWrite.call(this, chunk, ...args); };
  t.after(async () => {
    await workerProcess?.close(); globalThis.fetch = nativeFetch; process.stderr.write = originalWrite;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const appEnv = { ...roles, ATELIER_HTTP_ALLOW_WRITES: 'true', ATELIER_WRITE_RATE_LIMIT_PER_MINUTE: '1000',
    ATELIER_SEARCHAD_WRITE_STORAGE: 'postgres', ATELIER_SEARCHAD_ALLOW_WRITES: 'true', ATELIER_SEARCHAD_AUTOMATION_ENABLED: 'true',
    ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS: 'true', ATELIER_SEARCHAD_REPORT_CLOCK_UNCERTAINTY_MS: '1000',
    ATELIER_SEARCHAD_REPORT_ROLLOUT_UNCERTAINTY_MS: '1000', ATELIER_COMMERCE_ALLOW_UNVERIFIED_OPERATIONS: 'true',
    ATELIER_SEARCHAD_ALLOW_UNVERIFIED_OPERATIONS: 'true', ATELIER_SEARCHAD_WORKER_ENABLED: 'true',
    ATELIER_SEARCHAD_WORKER_CUSTOMERS: '1001', ATELIER_SEARCHAD_WORKER_PRINCIPAL_ID: 'completion-worker',
    CAFE24_MALL_ID: 'fixturemall', CAFE24_CLIENT_ID: 'completion-cafe-app', CAFE24_CLIENT_SECRET: 'completion-cafe-secret',
    CAFE24_ACCESS_TOKEN: 'completion-cafe-token', CAFE24_ACCESS_TOKEN_EXPIRES_AT: '2030-01-01T00:00:00Z',
    CAFE24_TOKEN_STORE_PATH: path.join(root, 'unused-cafe-token.json') };
  const options = { appEnv, clock: () => time, blobStorage: storage,
    allowedPaths: ['/stats', '/keywordstool', '/ncc/campaigns/cmp-1', '/stat-reports', '/report-download', ...Array.from({ length: 40 }, (_, i) => `/stat-reports/${i + 1}`)],
    allowedMethods: { '/ncc/campaigns/cmp-1': ['GET', 'PUT'] },
    response: ({ target, init }) => {
      if (target.pathname === '/stats') return Response.json({ summaryStatResponse: { cycleBaseTm: iso(time + 9 * 3600000).replaceAll(/[^0-9]/g, '').slice(0, 12), data: [{ id: 'cmp-1', salesAmt: 110, impCnt: 100, clkCnt: 4, ccnt: 4, convAmt: 7000 }] } });
      if (target.pathname === '/keywordstool') return Response.json({ keywordList: [{ relKeyword: 'silver ring' }] });
      if (target.pathname === '/report-download') {
        const job = [...jobs.values()].find(row => row.token === target.searchParams.get('authtoken'));
        assert.ok(job); return new Response(`${job.date}\t1001\tcmp-1\tgrp-1\tkw-1\tad-1\tbiz-1\t1\tP\t100\t2\t110\t100\t0\n`);
      }
      if (target.pathname.startsWith('/stat-reports')) {
        if (init.method === 'POST') {
          const body = JSON.parse(init.body), date = `${body.statDt.slice(0, 4)}-${body.statDt.slice(4, 6)}-${body.statDt.slice(6, 8)}`, id = jobs.size + 1;
          const token = `temporary-completion-token-${id}`;
          const response = { reportJobId: id, reportTp: 'AD', statDt: iso(Date.parse(`${date}T00:00:00+09:00`)), status: 'BUILT', updateTm: iso(time), downloadUrl: `https://api.searchad.naver.com/report-download?authtoken=${token}&fileVersion=v2` };
          jobs.set(String(id), { date, token, response }); return Response.json(response);
        }
        return Response.json(jobs.get(target.pathname.split('/').at(-1)).response);
      }
      if (init.method === 'PUT') { Object.assign(state, JSON.parse(init.body)); loseVerification = true; }
      else if (loseVerification) { loseVerification = false; throw new TypeError('Synthetic verification response loss after accepted mutation'); }
      return Response.json(state);
    }
  };
  const fixtureData = name => JSON.parse(fs.readFileSync(`test/fixtures/searchad-profitability/${name}.json`, 'utf8'));
  function attachCommerce(app) {
    app.client.tokenProvider.cached = { accessToken: 'completion-commerce-token', issuedAt: Date.now(), expiresIn: 3600 };
    app.client.fetchImpl = async (url, init) => {
      assert.equal(init.method, 'GET'); assert.equal(new URL(url).origin, 'https://api.commerce.naver.com');
      const file = { '/external/v2/products/channel-products/123': 'naver-product', '/external/v1/pay-order/seller/product-orders': 'naver-orders', '/external/v1/pay-settle/settle/case': 'naver-settlements' }[new URL(url).pathname];
      assert.ok(file, 'closed Commerce path list'); commerceCalls.push(file); return Response.json(fixtureData(file));
    };
    app.searchAdCompletionRuntime.commerceProviders.get('haar_own_mall').client.fetchImpl = async (url, init) => {
      assert.equal(init.method, 'GET'); assert.equal(new URL(url).origin, 'https://fixturemall.cafe24api.com');
      const file = { '/api/v2/admin/products/123': 'cafe24-product', '/api/v2/admin/products/123/variants': 'cafe24-variants' }[new URL(url).pathname];
      assert.ok(file, 'closed Cafe24 path list'); cafeCalls.push(file); return Response.json(fixtureData(file));
    };
  }
  async function start() { server = await f.start(options); attachCommerce(server.app); return server; }
  async function call(token, method, route, body, raw = false) {
    const result = await server.call(token, method, route, body, raw); responses.push(result.body); return result;
  }
  const ok = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result)); return result.body; };
  const scoped = { customerId: '1001' }, productId = randomUUID(), range = autoWindow(now), scope = { ...scoped, haarProductId: productId, ...range };
  await start();
  const runtime = () => server.app.searchAdCompletionRuntime;
  let latestJob, observedRun, approvedRun, nativeAuto, syntheticAuto;
  const policyInput = (mode, extras = {}) => ({ ...scoped, entityType: 'campaign', entityId: 'cmp-1', mode, enabled: true,
    recipe: { kind: 'campaign_budget', dailyBudgetKrw: 800 }, reason: 'offline composed acceptance', ...extras });
  const createPolicy = async (mode, extras) => ok(await call(adminKey, 'POST', '/api/v1/searchad/automation/policies', policyInput(mode, extras)), 201);
  const evaluate = async policy => ok(await call(completionOperatorKey, 'POST', '/api/v1/searchad/automation/evaluate', { ...scoped, policyId: policy.policyId }));
  const delegation = () => { const { customerId, policyRevision, authorizedByPrincipalId, authorizedAt, ...value } = autoFacts(now).policy.delegation; return value; };
  await t.test('readiness and role documentation are scoped without probing upstream', async () => {
    const ready = ok(await call(completionReaderKey, 'GET', '/health/ready'));
    assert.deepEqual(ready.searchAdCompletion, { required: true, initialized: true, ready: true });
    assert.deepEqual(ready.searchAdWorker, { required: true, initialized: true, ready: true });
    assert.equal(f.calls.length, 0);
    for (const role of ['reader', 'operator', 'executor', 'admin']) ok(await call(completionReaderKey, 'GET', `/openapi-searchad-completion-${role}.json`));
  });
  await t.test('report registration poll ingest and selected D+3 history use the real HTTP owners', async () => {
    for (const date of autoFacts().history.generations.map(row => row.statDate)) {
      const start = Date.parse(`${date}T00:00:00+09:00`), instants = [1, 2, 3].map(slot => start + slot * 86400000 + 12 * 3600000);
      if (instants.at(-1) < now) instants.push(now);
      for (const at of instants) {
        time = at;
        latestJob = ok(await call(completionOperatorKey, 'POST', '/api/v1/searchad/reporting/jobs', { ...scoped, kind: 'stat', reportType: 'AD', statDate: date, intentKey: `completion:${date}:${at}` }), 201);
        const route = `/api/v1/searchad/reporting/jobs/${latestJob.reportJobId}`;
        ok(await call(completionOperatorKey, 'POST', `${route}/poll`, scoped));
        ok(await call(completionOperatorKey, 'POST', `${route}/ingest`, scoped));
        ok(await call(completionOperatorKey, 'POST', `${route}/evaluate`, scoped));
      }
    }
    time = now;
    const selected = await runtime().repository.selectedIngestions(f.pool, { customerId: '1001', reportType: 'AD', identity: runtime().identityResolver('1001') });
    assert.equal(selected.length, 7); assert.ok(selected.every(row => row.quality === 'stabilized_by_policy'));
    assert.equal(ok(await call(completionReaderKey, 'GET', '/api/v1/searchad/reporting/metrics?customerId=1001')).available, true);
    const bytes = ok(await call(completionReaderKey, 'GET', `/api/v1/searchad/reporting/jobs/${latestJob.reportJobId}/content?customerId=1001`, undefined, true));
    assert.ok(bytes.includes('cmp-1')); assert.equal(bytes.includes('temporary-completion-token'), false);
    ok(await call(completionOperatorKey, 'POST', '/api/v1/searchad/reporting/stats', { ...scoped, entityType: 'campaign', entityId: 'cmp-1', since: '2026-10-05', until: '2026-10-05' }), 201);
  });
  await t.test('HAAR mappings and configured Commerce/Cafe24 providers preserve partial profitability', async () => {
    await f.pool.query("INSERT INTO haar_products(haar_product_id,product_name) VALUES($1,'completion ring')", [productId]);
    for (const channelId of ['haar_naver_smartstore', 'haar_own_mall']) {
      await f.pool.query("INSERT INTO channel_products(channel_id,haar_product_id,channel_product_no,remote_product_id,channel_product_key,product_name) VALUES($1,$2,'123','123',$3,'ring')", [channelId, productId, `${channelId}:123`]);
      ok(await call(adminKey, 'POST', '/api/v1/searchad/customer-channel-bindings', { ...scoped, channelId }));
      ok(await call(adminKey, 'POST', '/api/v1/searchad/product-mappings', { ...scoped, haarProductId: productId, channelProductKey: `${channelId}:123`, entityType: 'campaign', entityId: 'cmp-1', method: 'manual', validFrom: '2026-09-01T00:00:00Z' }));
    }
    ok(await call(completionOperatorKey, 'POST', '/api/v1/searchad/product-evidence/collect', scope));
    ok(await call(completionOperatorKey, 'POST', '/api/v1/searchad/recommendations/generate', scope));
    const profit = ok(await call(completionReaderKey, 'GET', `/api/v1/searchad/profitability/products/${productId}?customerId=1001&since=${range.since}&until=${range.until}`));
    assert.equal(profit.quality, 'partial'); assert.equal(profit.metrics.contributionKrw, null);
    assert.ok(profit.missingReasons.includes('MANUAL_MAPPING_UNVERIFIED'));
    assert.ok(commerceCalls.includes('naver-product') && commerceCalls.includes('naver-orders') && commerceCalls.includes('naver-settlements'));
    assert.deepEqual(cafeCalls.sort(), ['cafe24-product', 'cafe24-variants']);
    assert.equal(f.calls.filter(call => call.path.includes('estimate')).length, 0);
    const recommendations = ok(await call(completionReaderKey, 'GET', `/api/v1/searchad/recommendations?customerId=1001&haarProductId=${productId}&since=${range.since}&until=${range.until}`));
    assert.ok(recommendations.recommendations.length > 0);
    assert.ok(recommendations.recommendations.every(row => !row.executable && !row.liveVerified && !row.outcomeVerified));
  });
  await t.test('observe approve and native limited-auto retain actual production blockers', async () => {
    await f.pool.query("INSERT INTO searchad_circuit_policies(customer_id,policy_json) VALUES('1001',$1)", [{ customerDailySpendCeilingGrossKrw: 100000 }]);
    observedRun = await evaluate(await createPolicy('observe')); assert.equal(observedRun.state, 'observed');
    approvedRun = await evaluate(await createPolicy('approve')); assert.equal(approvedRun.state, 'blocked');
    assert.ok(approvedRun.decision.reasons.includes('SPEND_EVIDENCE_UNAVAILABLE'), JSON.stringify(approvedRun));
    assert.notEqual((await call(completionOperatorKey, 'POST', `/api/v1/searchad/automation/runs/${approvedRun.runId}/prepare`, scoped)).status, 200);
    nativeAuto = await evaluate(await createPolicy('limited_auto', { delegation: delegation() }));
    assert.equal(nativeAuto.state, 'blocked'); assert.equal(nativeAuto.decision.selected.auto.history.generations.length, 7);
    assert.equal(nativeAuto.decision.reasons.includes('SEVEN_COMPLETE_KST_DAYS_REQUIRED'), false);
    assert.ok(nativeAuto.decision.reasons.includes('PROFITABILITY_UNAVAILABLE'));
    assert.equal(nativeAuto.decision.selected.auto.capability.estimateReason, 'ESTIMATE_READ_CAPABILITY_UNAVAILABLE');
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
  });
  await t.test('positive bounded-auto private source facts run real eligibility approval activation and writer', async () => {
    // Only this positive software fixture supplies synthetic financial facts.
    // The seven-day generation history came through actual native ingestion.
    runtime().automationRepository.autoEvidenceSelector = { async select(policy) {
      const value = autoFacts(now); value.policy = policy; value.evidence.identity = runtime().identityResolver('1001');
      value.history = nativeAuto.decision.selected.auto.history; return value;
    } };
    runtime().circuitService.spendEvidence = { async select() { return { spendGrossKrw: 100, baselineGrossKrw: 100, validUntil: now + 86400000 }; } };
    await activation(f, server, { operationKey: CAMPAIGN_WRITE, fieldScope: ['campaign.dailyBudget', 'campaign.userLock'] });
    const policy = await createPolicy('limited_auto', { delegation: delegation() }); syntheticAuto = await evaluate(policy);
    assert.equal(syntheticAuto.state, 'ready', JSON.stringify(syntheticAuto));
    const approvalService = server.app.searchAdWriteRuntime.approvalService, approve = approvalService.approve.bind(approvalService);
    approvalService.approve = async (...args) => { const result = await approve(...args); tokens.push(result.executionToken); return result; };
    const route = `/api/v1/searchad/automation/runs/${syntheticAuto.runId}/execute-auto`;
    for (const token of [completionReaderKey, completionOperatorKey]) assert.equal((await call(token, 'POST', route, scoped)).status, 403);
    const results = await Promise.all([call(executorKey, 'POST', route, scoped), call(executorKey, 'POST', route, scoped)]);
    assert.ok(results.every(result => result.status === 409), JSON.stringify(results));
    const held = ok(await call(completionReaderKey, 'GET', `/api/v1/searchad/automation/runs/${syntheticAuto.runId}?customerId=1001`));
    assert.ok(['unknown_outcome', 'manual_review'].includes(held.state)); assert.equal(state.dailyBudget, 800);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
    const counts = (await f.pool.query('SELECT (SELECT count(*)::int FROM searchad_write_approvals) approvals,(SELECT count(*)::int FROM searchad_write_execution_claims) claims')).rows[0];
    assert.deepEqual(counts, { approvals: 1, claims: 1 });
    assert.equal(tokens.length, 1); assert.equal(typeof tokens[0], 'string');
    const circuit = ok(await call(completionReaderKey, 'GET', '/api/v1/searchad/circuit?customerId=1001'));
    assert.ok(circuit); assert.ok((await f.pool.query('SELECT count(*)::int n FROM searchad_circuit_events')).rows[0].n > 0);
  });
  await t.test('standalone worker reconstructs bootstrap and consumes one duplicate-safe schedule slot', async () => {
    const body = { ...scoped, scheduleId: 'completion-stats', kind: 'collect_stats', enabled: true, startAt: iso(now), payload: { entityType: 'campaign', entityId: 'cmp-1' } };
    ok(await call(adminKey, 'POST', '/api/v1/searchad/worker/schedules', body), 201);
    ok(await call(adminKey, 'POST', '/api/v1/searchad/worker/schedules', body), 201);
    const before = f.calls.filter(call => call.path === '/stats').length;
    workerProcess = await startHeadlessWorker({ env: { ...f.env, ...appEnv }, clock: () => time,
      bootstrap: async () => { const result = await f.start({ ...options, headless: true }); attachCommerce(result.app); return result.app; },
      logger: { info() {}, warn() {}, error() {} } });
    assert.notEqual(workerProcess.app, server.app); assert.equal(workerProcess.app.searchAdWriteRuntime, undefined);
    await workerProcess.worker.runOnce(); await workerProcess.close();
    assert.equal(f.calls.filter(call => call.path === '/stats').length, before + 1);
    await runtime().workerRuntime.scheduler.tick();
    assert.equal((await f.pool.query("SELECT count(*)::int n FROM searchad_worker_jobs WHERE schedule_id='completion-stats'")).rows[0].n, 1);
    assert.equal((await f.pool.query("SELECT state FROM searchad_worker_jobs WHERE schedule_id='completion-stats'")).rows[0].state, 'succeeded');
    assert.equal(ok(await call(adminKey, 'GET', '/api/v1/searchad/worker/jobs?customerId=1001')).items.length, 1);
  });
  await t.test('role Customer identity and parent cleanup boundaries deny authority', async () => {
    const route = `/api/v1/searchad/reporting/jobs/${latestJob.reportJobId}`;
    assert.equal((await call(completionReaderKey, 'GET', `${route}?customerId=2002`)).status, 403);
    assert.equal((await call(completionReaderKey, 'POST', '/api/v1/searchad/reporting/stats', scoped)).status, 403);
    assert.equal((await call(completionOperatorKey, 'POST', '/api/v1/searchad/automation/policies', policyInput('observe'))).status, 403);
    assert.equal((await call(completionReaderKey, 'GET', '/api/v1/searchad/worker/jobs?customerId=1001')).status, 403);
    for (const field of ['identity', 'evidence', 'provider', 'quality', 'executionToken']) assert.equal((await call(completionOperatorKey, 'POST', '/api/v1/searchad/recommendations/generate', { ...scope, [field]: {} })).status, 400);
    const principal = server.app.searchAdCredentials.principals.values().next().value, original = principal.secretKey;
    principal.secretKey = 'expired-completion-identity';
    assert.equal((await call(completionReaderKey, 'GET', `${route}/content?customerId=1001`, undefined, true)).status, 409);
    principal.secretKey = original;
    assert.equal(runtime().status().blockers.find(row => row.code === 'parent_remote_absence_unproven').executionAuthority, false);
    assert.equal(server.app.searchAdHierarchyRuntime.status().scope.cleanup, false);
    for (const parent of ['campaigns', 'adgroups']) assert.equal((await call(adminKey, 'DELETE', `/api/v1/searchad/hierarchy/${parent}/cmp-1`, scoped)).status, 404);
    assert.equal((await f.pool.query('SELECT count(*)::int n FROM searchad_hierarchy_objects')).rows[0].n, 0, 'empty local inventory establishes no parent deletion authority');
  });
  await t.test('Circuit pause keeps GET reconciliation and original rollback gate across full restart', async () => {
    const paused = ok(await call(adminKey, 'POST', '/api/v1/searchad/circuit/pause', { ...scoped, reason: 'offline recovery review' })); assert.ok(paused);
    const run = ok(await call(completionReaderKey, 'GET', `/api/v1/searchad/automation/runs/${syntheticAuto.runId}?customerId=1001`));
    const before = f.calls.length;
    ok(await call(executorKey, 'POST', `/api/v1/searchad/changes/${run.planId}/reconcile`, scoped));
    assert.ok(f.calls.slice(before).every(call => call.method === 'GET'));
    assert.notEqual((await call(executorKey, 'POST', `/api/v1/searchad/changes/${run.planId}/rollback`, { ...scoped, confirmation: 'ROLLBACK_SEARCHAD_CHANGE', idempotencyKey: 'completion-rollback' })).status, 200);
    const prior = server.app; await server.api.close(); await prior.close();
    await assert.rejects(() => prior.searchAdCompletionRuntime.statsService.collect({ ...scoped, entityType: 'campaign', entityId: 'cmp-1', since: '2026-10-05', until: '2026-10-05' }, { principal: { role: 'operator', customerIds: ['1001'] } }), { code: 'SEARCHAD_REPORTING_NOT_READY' });
    await start();
    const recovered = ok(await call(completionReaderKey, 'GET', `/api/v1/searchad/automation/runs/${syntheticAuto.runId}?customerId=1001`)); assert.equal(recovered.planId, run.planId); assert.equal(recovered.state, 'applied_reconciled');
    const snapshot = ok(await call(completionReaderKey, 'GET', '/api/v1/searchad/circuit?customerId=1001')); assert.equal(snapshot.state.manualPaused, true);
    const count = f.calls.length;
    ok(await call(completionOperatorKey, 'POST', `/api/v1/searchad/reporting/jobs/${latestJob.reportJobId}/reconcile`, scoped));
    const settled = await call(executorKey, 'POST', `/api/v1/searchad/changes/${run.planId}/reconcile`, scoped);
    assert.equal(settled.status, 409); assert.equal(settled.body.error.code, 'SEARCHAD_CHANGE_PLAN_NOT_RECONCILABLE');
    assert.ok(f.calls.slice(count).every(call => call.method === 'GET'));
    assert.notEqual((await call(executorKey, 'POST', `/api/v1/searchad/automation/runs/${syntheticAuto.runId}/execute-auto`, scoped)).status, 200);
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
    assert.equal(server.app.searchAdHierarchyRuntime.status().scope.cleanup, false);
    for (const parent of ['campaigns', 'adgroups']) assert.equal((await call(adminKey, 'DELETE', `/api/v1/searchad/hierarchy/${parent}/cmp-1`, scoped)).status, 404);
    assert.ok(runtime().status().blockers.some(row => row.code === 'actual_profitability_unavailable'));
  });
  await t.test('responses logs and every persisted SearchAd row omit credentials PII URLs and raw tokens', async () => {
    const tables = (await f.pool.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename LIKE 'searchad_%' ORDER BY tablename")).rows;
    const rows = [];
    for (const { tablename } of tables) rows.push((await f.pool.query(`SELECT row_to_json(r) value FROM "${tablename}" r`)).rows);
    const contents = [JSON.stringify(responses), logs.join(''), JSON.stringify(rows)];
    for (const secret of ['completion-secret', 'completion-license', 'completion-cafe-secret', 'completion-cafe-token', 'completion-commerce-token', 'temporary-completion-token', 'authtoken=', 'PRIVATE_BUYER', '01012345678', ...tokens]) {
      for (const content of contents) assert.equal(content.includes(secret), false, 'private fixture value absent');
    }
    assert.equal(forbidden, 0);
  });
});
