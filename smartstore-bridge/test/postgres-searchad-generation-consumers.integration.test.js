import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { SiblingCreateService } from '../src/naver/searchad/lifecycle/sibling-create-service.js';
import { SiblingPlanRetirementService } from '../src/naver/searchad/lifecycle/sibling-plan-retirement-service.js';
import { PostgresSiblingPlanRetirementRepository } from '../src/naver/searchad/lifecycle/postgres-sibling-plan-retirement-repository.js';
import { ChildFirstCleanupService } from '../src/naver/searchad/lifecycle/child-first-cleanup-service.js';
import { HierarchyReconcileService } from '../src/naver/searchad/lifecycle/hierarchy-reconcile-service.js';
import { PostgresHierarchyReconcileRepository } from '../src/naver/searchad/lifecycle/postgres-hierarchy-reconcile-repository.js';
import { DescendantInventoryService } from '../src/naver/searchad/lifecycle/descendant-inventory-service.js';
import { PostgresDescendantInventoryRepository } from '../src/naver/searchad/lifecycle/postgres-descendant-inventory-repository.js';
import { PartialKeywordInventoryService } from '../src/naver/searchad/lifecycle/partial-keyword-inventory-service.js';
import { PostgresPartialKeywordInventoryRepository } from '../src/naver/searchad/lifecycle/postgres-partial-keyword-inventory-repository.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { NaverSearchAdClient } from '../src/naver/searchad/client.js';
import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';
import { KEYWORD_FIELDS, CREATIVE_FIELDS } from '../src/naver/searchad/lifecycle/sibling-create-contract.js';

const logger = { info() {}, warn() {}, error() {} };
const context = { principal: { principalId: 'generation-consumer-admin', role: 'admin', customerIds: ['1001'] } };
const NOW = Date.parse('2026-09-29T00:00:00Z');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const specialized = error => error?.code === 'SEARCHAD_HIERARCHY_RECONCILE_SPECIALIZED_REQUIRED';
const stale = error => error?.code === 'SEARCHAD_HIERARCHY_RECONCILE_STALE';
const tables = ['searchad_hierarchy_canary_runs', 'searchad_hierarchy_objects', 'searchad_remote_object_ownership', 'searchad_write_change_plans', 'searchad_write_approvals', 'searchad_write_locks', 'searchad_write_attempts', 'searchad_hierarchy_events', 'searchad_risk_reservations', 'searchad_daily_risk_capacity'];

// Real PostgreSQL, producers, approvals, signing and consumers. Only upstream
// responses and authority fixtures are synthetic; global transport is blocked.
test('replacement generations retain their owning recovery coordinator and read-only inventory boundaries', { timeout: 240_000 }, async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { assert.notEqual(process.env.CI, 'true', 'CI requires PostgreSQL'); return t.skip('Local PostgreSQL not configured'); }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const originalFetch = globalThis.fetch; let escaped = 0;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => { globalThis.fetch = originalFetch; await closePostgresPool(admin); assert.equal(escaped, 0); });

  async function fixture(st, type = 'adgroup', { replacementSibling = false, partial = false } = {}) {
    const schema = `generation_consumer_${randomUUID().replaceAll('-', '')}`, pools = new Set();
    const f = { now: NOW, type, calls: [], transportErrors: [], remote: new Map(), deleted: new Set(), unavailableAfterDelete: false, retiredObjectIds: [] };
    await admin.query(`CREATE SCHEMA "${schema}"`);
    st.after(async () => { try { await Promise.all([...pools].map(closePostgresPool)); } finally { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } assert.deepEqual(f.transportErrors, []); });
    const scoped = new URL(url); scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
    f.connect = () => { const pool = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger }); pools.add(pool); return pool; };
    f.pool = f.connect();
    await runPostgresMigrations({ pool: f.pool, migrationsDir: path.resolve('migrations/postgres'), logger });
    f.registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
    f.config = loadSearchAdConfig({ NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret', NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_SEARCHAD_ALLOW_READS: 'true', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true' });
    f.credentials = new SearchAdCredentialsRegistry(f.config.topology);
    f.identity = { specSha: f.registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(f.credentials, '1001'), upstreamBaseUrl: 'https://api.searchad.naver.com' };
    await f.pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
    f.authority = async (operation, fields, lifecycle = 'create') => {
      const id = randomUUID(), eid = `synthetic-${randomUUID()}`;
      const values = [f.identity.specSha, f.identity.credentialFingerprint, f.identity.upstreamBaseUrl, JSON.stringify([operation]), JSON.stringify(fields), JSON.stringify([lifecycle]), new Date(f.now - 1000).toISOString(), new Date(f.now + 3600000).toISOString()];
      await f.pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`, [eid, ...values]);
      await f.pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture',$9,$10)`, [id, eid, ...values]);
      return id;
    };
    f.fetchImpl = async (value, init) => {
      const u = new URL(value), body = init.body ? JSON.parse(init.body) : null, headers = new Headers(init.headers);
      f.calls.push(`${init.method} ${u.pathname}`);
      try {
        assert.equal(u.origin, f.identity.upstreamBaseUrl); assert.equal(init.redirect, 'error'); assert.equal(headers.get('X-Customer'), '1001');
        assert.equal(headers.get('X-Signature'), createHmac('sha256', f.credentials.resolve('1001').secretKey).update(`${headers.get('X-Timestamp')}.${init.method}.${u.pathname}`).digest('base64'));
      } catch (error) { f.transportErrors.push(error.message); throw error; }
      if (init.method === 'POST' && u.pathname === '/ncc/campaigns') {
        f.rootRemote = { customerId: '1001', nccCampaignId: `cmp-${randomUUID()}`, ...body };
        f.remote.set(`/ncc/campaigns/${f.rootRemote.nccCampaignId}`, f.rootRemote); return json(f.rootRemote);
      }
      if (init.method === 'POST' && u.pathname === '/ncc/adgroups') {
        f.groupRemote = { customerId: '1001', nccAdgroupId: `grp-${randomUUID()}`, ...body };
        f.remote.set(`/ncc/adgroups/${f.groupRemote.nccAdgroupId}`, f.groupRemote); return json(f.groupRemote, 201);
      }
      if (init.method === 'POST' && u.pathname === '/ncc/keywords') {
        const batch = body.map(item => ({ nccKeywordId: `kw-${randomUUID()}`, keyword: item.keyword }));
        for (const row of batch) f.remote.set(`/ncc/keywords/${row.nccKeywordId}`, { customerId: '1001', nccAdgroupId: f.groupRemote.nccAdgroupId, ...row });
        return json(partial ? [batch[1]] : batch);
      }
      if (init.method === 'POST' && u.pathname === '/ncc/ads') {
        const row = { customerId: '1001', nccAdId: `ad-${randomUUID()}`, ...body };
        f.remote.set(`/ncc/ads/${row.nccAdId}`, row); return json(row, 201);
      }
      if (init.method === 'GET' && ['/ncc/adgroups', '/ncc/keywords', '/ncc/ads'].includes(u.pathname)) return json([]);
      if (init.method === 'GET' && f.remote.has(u.pathname)) {
        if (f.deleted.has(u.pathname)) return f.unavailableAfterDelete ? json({ code: 'UNAVAILABLE' }, 503) : json({ code: 'NOT_FOUND' }, 404);
        return json(f.remote.get(u.pathname));
      }
      if (init.method === 'DELETE' && f.remote.has(u.pathname)) { f.deleted.add(u.pathname); return json({ accepted: true }); }
      f.transportErrors.push(`Unexpected ${init.method} ${u.pathname}`); throw new Error('Unexpected fixture transport');
    };
    f.args = { pool: f.pool, registry: f.registry, credentialsRegistry: f.credentials, config: f.config, enabled: true, dailyBudget: 1000, riskUnits: 1, dailyCapacityUnits: 100, planTtlSeconds: 60, preflightMaxAgeMs: 5000, clock: () => f.now, fetchImpl: f.fetchImpl, logger, keywordTexts: ['consumer-first', 'consumer-second'] };
    const approval = new SearchAdApprovalService({ repository: new PostgresSearchAdWriteRepository({ pool: f.pool }), config: { approvalTtlSeconds: 300 }, clock: () => f.now });
    f.approve = id => approval.approve(id, { confirmation: 'APPROVE_SEARCHAD_CHANGE', actor: 'fixture-approver' });
    const rootCreator = new CampaignCreateService(f.args);
    const rp = await rootCreator.prepare({ customerId: '1001', activationId: await f.authority(OPS.campaign.create, ['campaign.campaignTp', 'campaign.name', 'campaign.userLock', 'campaign.dailyBudget']) }, context);
    f.root = await rootCreator.execute({ customerId: '1001', hierarchyRunId: rp.hierarchyRunId, hierarchyObjectId: rp.hierarchyObjectId, planId: rp.planId, executionToken: (await f.approve(rp.planId)).executionToken }, context);
    assert.equal(f.root.state, 'owned'); f.now += 1000;
    const groupCreator = new AdgroupCreateService(f.args);
    const gp = await groupCreator.prepare({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, parentObjectId: f.root.hierarchyObjectId, activationId: await f.authority(OPS.adgroup.create, ['adgroup.nccCampaignId', 'adgroup.name', 'adgroup.userLock']) }, context);
    f.group = await groupCreator.execute({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, parentObjectId: f.root.hierarchyObjectId, hierarchyObjectId: gp.hierarchyObjectId, planId: gp.planId, executionToken: (await f.approve(gp.planId)).executionToken }, context);
    assert.equal(f.group.state, 'owned'); f.now += 1000;
    f.target = f.group.hierarchyObjectId;
    if (type !== 'adgroup') {
      const creator = new SiblingCreateService(f.args), kind = type === 'keyword' ? 'keywords' : 'creative';
      const input = { customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, parentObjectId: f.group.hierarchyObjectId, activationId: await f.authority(OPS[type].create, type === 'keyword' ? KEYWORD_FIELDS : CREATIVE_FIELDS, type === 'keyword' ? 'batch_create' : 'create') };
      let plan = await creator[type === 'keyword' ? 'prepareKeywords' : 'prepareCreative'](input, context);
      if (replacementSibling) {
        await f.approve(plan.planId); f.now = Date.parse(plan.expiresAt);
        f.retiredObjectIds = (await f.pool.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 AND object_type=$2', [f.root.hierarchyRunId, type])).rows.map(row => row.hierarchy_object_id);
        const retirement = new SiblingPlanRetirementService({ repository: new PostgresSiblingPlanRetirementRepository({ pool: f.pool, dailyBudget: 1000, current: () => f.identity, clock: () => f.now }), enabled: true });
        await retirement.retire({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, parentObjectId: f.group.hierarchyObjectId, planId: plan.planId, kind, confirmation: type === 'keyword' ? 'RETIRE_EXPIRED_UNUSED_KEYWORD_PLAN' : 'RETIRE_EXPIRED_UNUSED_CREATIVE_PLAN' }, context);
        plan = await creator[type === 'keyword' ? 'replanKeywords' : 'replanCreative']({ ...input, predecessorPlanId: plan.planId, confirmation: type === 'keyword' ? 'REPLAN_EXPIRED_UNUSED_KEYWORD_PLAN' : 'REPLAN_EXPIRED_UNUSED_CREATIVE_PLAN' }, context);
      }
      const result = await creator.execute({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, parentObjectId: f.group.hierarchyObjectId, planId: plan.planId, kind, executionToken: (await f.approve(plan.planId)).executionToken }, context);
      assert.equal(result.state, partial ? 'manual_review' : 'owned');
      f.target = (await f.pool.query('SELECT hierarchy_object_id FROM searchad_hierarchy_objects WHERE hierarchy_run_id=$1 AND object_type=$2 AND remote_id IS NOT NULL ORDER BY hierarchy_object_id', [f.root.hierarchyRunId, type])).rows[0].hierarchy_object_id;
    }
    f.cleanup = new ChildFirstCleanupService(f.args);
    f.scope = { customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, hierarchyObjectId: f.target };
    f.newCleanup = async () => f.cleanup.prepare({ ...f.scope, activationId: await f.authority(OPS[type].delete, [], 'delete') }, context);
    f.pending = async generation => {
      const old = await f.newCleanup(); let plan = old;
      if (generation === 2) {
        await f.approve(old.planId); f.now = Date.parse(old.expiresAt);
        await f.cleanup.retirePlan({ ...f.scope, planId: old.planId, confirmation: 'RETIRE_EXPIRED_UNUSED_CLEANUP_PLAN' }, context);
        plan = await f.cleanup.replan({ ...f.scope, predecessorPlanId: old.planId, activationId: await f.authority(OPS[type].delete, [], 'delete'), confirmation: 'REPLAN_EXPIRED_UNUSED_CLEANUP_PLAN' }, context);
      }
      f.unavailableAfterDelete = true;
      const result = await f.cleanup.execute({ ...f.scope, planId: plan.planId, executionToken: (await f.approve(plan.planId)).executionToken, confirmation: plan.requiredConfirmation, secondConfirmation: plan.requiredSecondConfirmation }, context);
      assert.ok(['delete_unknown', 'delete_pending'].includes(result.state), JSON.stringify(result));
      assert.equal(f.calls.filter(call => call.startsWith('DELETE ')).length, 1);
      f.unavailableAfterDelete = false; f.calls.length = 0;
      return { old, plan };
    };
    const client = new NaverSearchAdClient({ baseUrl: f.config.baseUrl, credentialsRegistry: f.credentials, fetchImpl: f.fetchImpl, maxRetries: 0, clock: () => f.now, logger });
    f.gateway = new SearchAdOperationGateway({ client, registry: f.registry, credentialsRegistry: f.credentials, config: f.config, logger });
    f.read = descriptor => f.gateway.execute(descriptor.operationKey, descriptor);
    f.generic = (read = f.read, pool = f.pool) => new HierarchyReconcileService({ repository: new PostgresHierarchyReconcileRepository({ pool }), remote: { read }, contextResolver: () => f.identity, clock: () => f.now });
    f.state = async () => { const state = {}; for (const table of tables) state[table] = (await f.pool.query(`SELECT to_jsonb(t) AS row,t.xmin::text AS version FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows; return state; };
    f.calls.length = 0; return f;
  }

  for (const type of ['adgroup', 'keyword', 'creative']) for (const generation of [1, 2]) {
    await t.test(`${type} cleanup generation ${generation}: generic recovery refuses before GET; owning recovery settles the current plan once`, async st => {
      const f = await fixture(st, type), { old, plan } = await f.pending(generation);
      const before = await f.state();
      await assert.rejects(f.generic().reconcile(f.scope, context), specialized);
      assert.deepEqual(f.calls, []); assert.deepEqual(await f.state(), before);
      await f.pool.query("UPDATE searchad_canary_accounts SET suspended=true WHERE customer_id='1001'"); f.config.allowActiveCanary = false;
      const recovery = new ChildFirstCleanupService({ ...f.args, pool: f.connect(), enabled: false });
      const result = await recovery.reconcile({ ...f.scope, planId: plan.planId }, context);
      assert.equal(result.state, 'deleted'); assert.equal(f.calls.length, 1); assert.ok(f.calls[0].startsWith('GET '));
      const after = await f.state(), current = after.searchad_write_change_plans.find(item => item.row.plan_id === plan.planId);
      assert.equal(current.row.status, 'applied');
      if (generation === 2) assert.deepEqual(after.searchad_write_change_plans.find(item => item.row.plan_id === old.planId), before.searchad_write_change_plans.find(item => item.row.plan_id === old.planId));
      assert.deepEqual(after.searchad_write_approvals, before.searchad_write_approvals); assert.deepEqual(after.searchad_risk_reservations, before.searchad_risk_reservations);
      assert.equal((await recovery.reconcile({ ...f.scope, planId: plan.planId }, context)).state, 'deleted'); assert.equal(f.calls.length, 1);
    });
  }

  await t.test('corrupt predecessor cannot use generic recovery to bypass the owning generation proof', async st => {
    const f = await fixture(st), { old, plan } = await f.pending(2);
    await f.pool.query("UPDATE searchad_write_change_plans SET last_error_json='{}'::jsonb WHERE plan_id=$1", [old.planId]);
    const before = await f.state();
    await assert.rejects(f.generic().reconcile(f.scope, context), specialized);
    await assert.rejects(f.cleanup.reconcile({ ...f.scope, planId: plan.planId }, context), error => error?.code?.startsWith('SEARCHAD_CHILD_CLEANUP_'));
    assert.deepEqual(f.calls, []); assert.deepEqual(await f.state(), before);
  });

  await t.test('cleanup created during an existing generic read is rejected before observation settlement', async st => {
    const f = await fixture(st, 'keyword', { replacementSibling: true, partial: true }); let expected;
    const service = f.generic(async descriptor => { await f.newCleanup(); expected = await f.state(); return f.read(descriptor); });
    await assert.rejects(service.reconcile(f.scope, context), specialized);
    assert.ok(expected); assert.deepEqual(await f.state(), expected); assert.equal(f.calls.length, 1); assert.ok(f.calls[0].startsWith('GET '));
  });

  await t.test('an unavailable generic observation consumes its audit snapshot and cannot be appended twice', async st => {
    const f = await fixture(st, 'keyword', { replacementSibling: true, partial: true });
    const repository = new PostgresHierarchyReconcileRepository({ pool: f.pool });
    const snapshot = await repository.loadSnapshot(f.scope), observation = { kind: 'unavailable', observedAt: new Date(f.now).toISOString() };
    await repository.recordObservation(snapshot, observation); const before = await f.state();
    await assert.rejects(repository.recordObservation(snapshot, observation), stale);
    assert.deepEqual(await f.state(), before); assert.deepEqual(f.calls, []);
  });

  for (const [type, partial] of [['keyword', false], ['creative', false], ['keyword', true]]) {
    await t.test(`${type} replacement creation partial=${partial}: inventory preserves all generations and cannot unlock parents`, async st => {
      const f = await fixture(st, type, { replacementSibling: true, partial });
      const service = new DescendantInventoryService({ repository: new PostgresDescendantInventoryRepository({ pool: f.pool }), remote: { read: f.read }, contextResolver: () => f.identity, clock: () => f.now });
      const before = await f.state();
      const result = await service.scan({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, parentObjectId: f.group.hierarchyObjectId, childType: type }, context);
      assert.equal(result.kind, 'empty_unproven'); assert.equal(result.completeAbsence, false); assert.equal(result.changed, false);
      const after = await f.state();
      for (const table of tables.filter(table => table !== 'searchad_hierarchy_events')) assert.deepEqual(after[table], before[table], table);
      assert.equal(after.searchad_hierarchy_events.length, before.searchad_hierarchy_events.length + 1);
      for (const id of f.retiredObjectIds) {
        const state = await f.state(), reads = f.calls.length;
        const old = await f.generic().reconcile({ ...f.scope, hierarchyObjectId: id }, context);
        assert.equal(old.kind, 'not_pending'); assert.equal(old.changed, false); assert.equal(f.calls.length, reads); assert.deepEqual(await f.state(), state);
      }
      if (partial) {
        const partialService = new PartialKeywordInventoryService({ repository: new PostgresPartialKeywordInventoryRepository({ pool: f.pool }), remote: { read: f.read }, contextResolver: () => f.identity, clock: () => f.now });
        const state = await f.state();
        const observed = await partialService.inventory({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, adgroupObjectId: f.group.hierarchyObjectId }, context);
        assert.equal(observed.kind, 'empty_unproven'); assert.equal(observed.completeAbsence, false);
        const current = await f.state();
        for (const table of tables.filter(table => table !== 'searchad_hierarchy_events')) assert.deepEqual(current[table], state[table], table);
      }
      const activationId = await f.authority(OPS.adgroup.delete, [], 'delete'), calls = f.calls.length, state = await f.state();
      await assert.rejects(f.cleanup.prepare({ customerId: '1001', hierarchyRunId: f.root.hierarchyRunId, hierarchyObjectId: f.group.hierarchyObjectId, activationId }, context), error => error?.code === 'SEARCHAD_CHILD_CLEANUP_INVENTORY_UNPROVEN');
      assert.equal(f.calls.length, calls); assert.deepEqual(await f.state(), state);
    });
  }
});
