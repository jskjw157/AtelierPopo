import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';
import { PostgresSearchAdWriteRepository } from '../src/naver/searchad/write/postgres-repository.js';
import { SearchAdApprovalService } from '../src/naver/searchad/write/approval-service.js';
import { CampaignCreateService } from '../src/naver/searchad/lifecycle/campaign-create-service.js';
import { CampaignCleanupService } from '../src/naver/searchad/lifecycle/campaign-cleanup-service.js';
import { AdgroupCreateService } from '../src/naver/searchad/lifecycle/adgroup-create-service.js';
import { SiblingCreateService } from '../src/naver/searchad/lifecycle/sibling-create-service.js';
import { ChildFirstCleanupService } from '../src/naver/searchad/lifecycle/child-first-cleanup-service.js';
import { DescendantInventoryService } from '../src/naver/searchad/lifecycle/descendant-inventory-service.js';
import { PostgresDescendantInventoryRepository } from '../src/naver/searchad/lifecycle/postgres-descendant-inventory-repository.js';
import { PostgresSearchAdLifecycleRepository } from '../src/naver/searchad/lifecycle/postgres-repository.js';
import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { loadSearchAdConfig } from '../src/naver/searchad/config.js';
import { SearchAdCredentialsRegistry } from '../src/naver/searchad/auth.js';
import { credentialFingerprintForCustomer } from '../src/naver/searchad/canary/credential-fingerprint.js';
import { SEARCHAD_HIERARCHY_OPERATIONS as OPS } from '../src/naver/searchad/lifecycle/operations.js';

const NOW = Date.parse('2026-09-19T10:00:00Z');
const logger = { info() {}, warn() {}, error() {} };
const context = { principal: { principalId: 'inventory-fence-admin', role: 'admin', customerIds: ['1001'] } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const ROOT_FIELDS = ['campaign.campaignTp', 'campaign.name', 'campaign.userLock', 'campaign.dailyBudget'];
const GROUP_FIELDS = ['adgroup.nccCampaignId', 'adgroup.name', 'adgroup.userLock'];

test('inventory observations cannot be ignored by a subsequent parent cleanup', { timeout: 180_000 }, async t => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    assert.notEqual(process.env.CI, 'true', 'CI requires PostgreSQL');
    return t.skip('Local PostgreSQL not configured');
  }
  const admin = createPostgresPool({ connectionString: url, sslMode: 'disable', logger });
  const schema = `inventory_fence_${randomUUID().replaceAll('-', '')}`;
  let pool;
  let escaped = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { escaped++; throw new Error('External transport forbidden'); };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    try { if (pool) await closePostgresPool(pool); }
    finally { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await closePostgresPool(admin); }
    assert.equal(escaped, 0);
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scoped = new URL(url);
  scoped.searchParams.set('options', `-csearch_path=${schema} -ctimezone=UTC`);
  pool = createPostgresPool({ connectionString: scoped.toString(), sslMode: 'disable', logger });
  await runPostgresMigrations({ pool, migrationsDir: path.resolve('migrations/postgres'), logger });
  const registry = loadSearchAdSpecRegistry('specs/naver-searchad/current.json');
  const config = loadSearchAdConfig({
    NAVER_SEARCHAD_ACCESS_LICENSE: 'fixture-license', NAVER_SEARCHAD_SECRET_KEY: 'fixture-secret',
    NAVER_SEARCHAD_CUSTOMER_ID: '1001', ATELIER_SEARCHAD_ALLOW_READS: 'true', ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY: 'true'
  });
  const credentials = new SearchAdCredentialsRegistry(config.topology);
  const identity = { specSha: registry.status().specRef, credentialFingerprint: credentialFingerprintForCustomer(credentials, '1001'), upstreamBaseUrl: 'https://api.searchad.naver.com' };
  await pool.query("INSERT INTO searchad_canary_accounts(customer_id,suspended) VALUES('1001',false)");
  const approvals = new SearchAdApprovalService({ repository: new PostgresSearchAdWriteRepository({ pool }), config: { approvalTtlSeconds: 300 }, clock: () => NOW });
  const approve = planId => approvals.approve(planId, { confirmation: 'APPROVE_SEARCHAD_CHANGE', actor: 'fixture-approver' });
  const storage = new PostgresSearchAdLifecycleRepository({ pool });

  async function authority(operation, fields, kind = 'create') {
    const activationId = randomUUID(), evidenceId = `synthetic-${randomUUID()}`;
    const start = new Date(NOW - 1000).toISOString(), end = new Date(NOW + 3600000).toISOString();
    await pool.query(`INSERT INTO searchad_verification_evidence(evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,result,created_at,expires_at) VALUES($1,'active_canary','1001',$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,'verified',$8,$9)`, [evidenceId, identity.specSha, identity.credentialFingerprint, identity.upstreamBaseUrl, JSON.stringify([operation]), JSON.stringify(fields), JSON.stringify([kind]), start, end]);
    await pool.query(`INSERT INTO searchad_activation_grants(activation_id,evidence_id,evidence_type,customer_id,spec_sha,credential_fingerprint,upstream_base_url,operation_keys_json,field_scope_json,lifecycle_kinds_json,activated_by_principal_id,activated_at,expires_at) VALUES($1,$2,'active_canary','1001',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'fixture-authority',$9,$10)`, [activationId, evidenceId, identity.specSha, identity.credentialFingerprint, identity.upstreamBaseUrl, JSON.stringify([operation]), JSON.stringify(fields), JSON.stringify([kind]), start, end]);
    return activationId;
  }

  async function graph({ withGroup = true, withKeyword = false } = {}) {
    const remotes = new Map(), deleted = new Set(), calls = [];
    let beforeRead = null;
    const fetchImpl = async (urlValue, init) => {
      const u = new URL(urlValue), body = init.body ? JSON.parse(init.body) : null;
      assert.equal(u.origin, identity.upstreamBaseUrl); assert.equal(init.redirect, 'error');
      calls.push(`${init.method} ${u.pathname}`);
      if (init.method === 'GET' && beforeRead) { const hook = beforeRead; beforeRead = null; await hook(); }
      if (init.method === 'POST' && ['/ncc/campaigns', '/ncc/adgroups'].includes(u.pathname)) {
        const root = u.pathname === '/ncc/campaigns', id = `${root ? 'cmp' : 'grp'}-${randomUUID()}`;
        const row = { customerId: '1001', [root ? 'nccCampaignId' : 'nccAdgroupId']: id, ...body };
        remotes.set(`${u.pathname}/${id}`, row); return json(row, root ? 200 : 201);
      }
      if (init.method === 'POST' && u.pathname === '/ncc/keywords') {
        const rows = body.map(item => ({ nccKeywordId: `kw-${randomUUID()}`, keyword: item.keyword }));
        for (const row of rows) remotes.set(`/ncc/keywords/${row.nccKeywordId}`, { customerId: '1001', nccAdgroupId: u.searchParams.get('nccAdgroupId'), ...row });
        return json(rows);
      }
      if (init.method === 'DELETE' && remotes.has(u.pathname)) { deleted.add(u.pathname); return json({ accepted: true }); }
      if (init.method === 'GET' && remotes.has(u.pathname)) return deleted.has(u.pathname) ? json({ code: 'NOT_FOUND' }, 404) : json(remotes.get(u.pathname));
      throw new Error(`Unexpected fixture transport ${init.method} ${u.pathname}`);
    };
    const args = { pool, registry, credentialsRegistry: credentials, config, enabled: true, dailyBudget: 1000, riskUnits: 1, dailyCapacityUnits: 1000, planTtlSeconds: 300, preflightMaxAgeMs: 5000, clock: () => NOW, fetchImpl, logger };
    const campaign = new CampaignCreateService(args);
    const rootPlan = await campaign.prepare({ customerId: '1001', activationId: await authority(OPS.campaign.create, ROOT_FIELDS) }, context);
    const root = await campaign.execute({ customerId: '1001', hierarchyRunId: rootPlan.hierarchyRunId, hierarchyObjectId: rootPlan.hierarchyObjectId, planId: rootPlan.planId, executionToken: (await approve(rootPlan.planId)).executionToken }, context);
    let group = null, leaf = null;
    if (withGroup) {
      const service = new AdgroupCreateService(args);
      const plan = await service.prepare({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: root.hierarchyObjectId, activationId: await authority(OPS.adgroup.create, GROUP_FIELDS) }, context);
      group = await service.execute({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: root.hierarchyObjectId, hierarchyObjectId: plan.hierarchyObjectId, planId: plan.planId, executionToken: (await approve(plan.planId)).executionToken }, context);
    }
    if (withKeyword) {
      const service = new SiblingCreateService({ ...args, keywordTexts: ['haar-fence'] });
      const plan = await service.prepareKeywords({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: group.hierarchyObjectId, activationId: await authority(OPS.keyword.create, ['keyword.keyword'], 'batch_create') }, context);
      const result = await service.execute({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: group.hierarchyObjectId, planId: plan.planId, executionToken: (await approve(plan.planId)).executionToken, kind: 'keywords' }, context);
      assert.equal(result.state, 'owned');
      leaf = { hierarchyObjectId: plan.objectIds[0] };
    }
    const cleanup = withGroup ? new ChildFirstCleanupService(args) : new CampaignCleanupService(args);
    async function planningInput(target, type) {
      return { customerId: '1001', hierarchyRunId: root.hierarchyRunId, hierarchyObjectId: target.hierarchyObjectId, activationId: await authority(OPS[type].delete, [], 'delete') };
    }
    async function approved(target, type) {
      const plan = await cleanup.prepare(await planningInput(target, type), context);
      return { customerId: '1001', hierarchyRunId: root.hierarchyRunId, hierarchyObjectId: target.hierarchyObjectId, planId: plan.planId, executionToken: (await approve(plan.planId)).executionToken, confirmation: plan.requiredConfirmation, secondConfirmation: plan.requiredSecondConfirmation };
    }
    async function observe(target, childType, kind = 'empty') {
      const inventory = new DescendantInventoryService({
        repository: new PostgresDescendantInventoryRepository({ pool }), contextResolver: async () => identity, clock: () => NOW,
        remote: { read: async descriptor => {
          if (kind === 'outage') throw new Error('fixture-secret-outage');
          const query = descriptor.query, idKey = { adgroup: 'nccAdgroupId', keyword: 'nccKeywordId', creative: 'nccAdId' }[childType];
          const parentKey = childType === 'adgroup' ? 'nccCampaignId' : 'nccAdgroupId';
          return { operation: { operationKey: descriptor.operationKey, sideEffect: false }, upstream: { status: 200 }, data: kind === 'present' ? [{ customerId: '1001', [parentKey]: query[parentKey], [idKey]: `unmanaged-${childType}` }] : [] };
        } }
      });
      return inventory.inventory({ customerId: '1001', hierarchyRunId: root.hierarchyRunId, parentObjectId: target.hierarchyObjectId, childType }, context);
    }
    async function state() {
      const values = {};
      for (const table of ['searchad_hierarchy_canary_runs', 'searchad_hierarchy_objects', 'searchad_remote_object_ownership', 'searchad_write_change_plans', 'searchad_write_approvals', 'searchad_risk_reservations', 'searchad_daily_risk_capacity', 'searchad_write_attempts']) {
        values[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
      }
      return values;
    }
    return { root, group, leaf, cleanup, planningInput, approved, observe, state, calls, setBeforeRead: hook => { beforeRead = hook; } };
  }

  for (const kind of ['present', 'empty', 'outage']) {
    await t.test(`${kind} keyword inventory blocks a new adgroup cleanup plan`, async () => {
      const g = await graph();
      await g.observe(g.group, 'keyword', kind);
      const input = await g.planningInput(g.group, 'adgroup'), before = await g.state();
      g.calls.length = 0;
      await assert.rejects(g.cleanup.prepare(input, context), error => error?.code === 'SEARCHAD_CHILD_CLEANUP_INVENTORY_UNPROVEN');
      assert.deepEqual(g.calls, []); assert.deepEqual(await g.state(), before);
    });
  }

  await t.test('an already approved adgroup plan is fenced by later creative inventory', async () => {
    const g = await graph(), input = await g.approved(g.group, 'adgroup');
    await g.observe(g.group, 'creative');
    const before = await g.state(); g.calls.length = 0;
    await assert.rejects(g.cleanup.execute(input, context), error => error?.code === 'SEARCHAD_CHILD_CLEANUP_INVENTORY_UNPROVEN');
    assert.deepEqual(g.calls, []); assert.deepEqual(await g.state(), before, 'no token/risk/intent consumption');
  });

  await t.test('childless campaign cleanup cannot bypass observed unmanaged adgroups', async () => {
    const g = await graph({ withGroup: false });
    await g.observe(g.root, 'adgroup', 'present');
    const input = await g.planningInput(g.root, 'campaign'), before = await g.state(); g.calls.length = 0;
    await assert.rejects(g.cleanup.prepare(input, context), error => error?.code === 'SEARCHAD_CAMPAIGN_CLEANUP_INVENTORY_UNPROVEN');
    assert.deepEqual(g.calls, []); assert.deepEqual(await g.state(), before);
  });

  await t.test('approved childless campaign cleanup is fenced before any remote read or DELETE', async () => {
    const g = await graph({ withGroup: false }), input = await g.approved(g.root, 'campaign');
    await g.observe(g.root, 'adgroup');
    const before = await g.state(); g.calls.length = 0;
    await assert.rejects(g.cleanup.execute(input, context), error => error?.code === 'SEARCHAD_CAMPAIGN_CLEANUP_INVENTORY_UNPROVEN');
    assert.deepEqual(g.calls, []); assert.deepEqual(await g.state(), before);
  });

  await t.test('managed child deletion proof does not override later campaign inventory uncertainty', async () => {
    const g = await graph();
    assert.equal((await g.cleanup.execute(await g.approved(g.group, 'adgroup'), context)).state, 'deleted');
    const input = await g.approved(g.root, 'campaign');
    await g.observe(g.root, 'adgroup', 'outage');
    const before = await g.state(); g.calls.length = 0;
    await assert.rejects(g.cleanup.execute(input, context), error => error?.code === 'SEARCHAD_CHILD_CLEANUP_INVENTORY_UNPROVEN');
    assert.deepEqual(g.calls, []); assert.deepEqual(await g.state(), before);
  });

  await t.test('known owned keyword cleanup remains usable while its parent is fenced', async () => {
    const g = await graph({ withKeyword: true });
    await g.observe(g.group, 'keyword', 'present');
    const input = await g.approved(g.leaf, 'keyword'); g.calls.length = 0;
    assert.equal((await g.cleanup.execute(input, context)).state, 'deleted');
    assert.equal(g.calls.filter(call => call.startsWith('DELETE /ncc/keywords/')).length, 1);
    const parentInput = await g.planningInput(g.group, 'adgroup');
    await assert.rejects(g.cleanup.prepare(parentInput, context), error => error?.code === 'SEARCHAD_CHILD_CLEANUP_INVENTORY_UNPROVEN');
  });

  await t.test('an inventory observation arriving during preflight prevents claim and mutation', async () => {
    const g = await graph(), input = await g.approved(g.group, 'adgroup');
    const before = await g.state(); g.calls.length = 0;
    g.setBeforeRead(() => g.observe(g.group, 'creative'));
    await assert.rejects(g.cleanup.execute(input, context), error => ['SEARCHAD_CHILD_CLEANUP_STALE', 'SEARCHAD_CHILD_CLEANUP_INVENTORY_UNPROVEN'].includes(error?.code));
    assert.equal(g.calls.some(call => call.startsWith('DELETE ')), false);
    assert.deepEqual(await g.state(), before);
  });

  await t.test('legacy inventory and a forged completeAbsence flag cannot become cleanup proof', async () => {
    const g = await graph();
    assert.equal((await g.cleanup.execute(await g.approved(g.group, 'adgroup'), context)).state, 'deleted');
    await storage.addEvent({ eventId: randomUUID(), hierarchyRunId: g.root.hierarchyRunId, hierarchyObjectId: g.group.hierarchyObjectId, customerId: '1001', phase: 'partial_keyword_inventory', status: 'observed_empty_unproven', operationKey: null, lifecycleKind: null, details: { completeAbsence: true, cleanupAuthority: true }, createdAt: new Date(NOW).toISOString() });
    const input = await g.planningInput(g.root, 'campaign'); g.calls.length = 0;
    await assert.rejects(g.cleanup.prepare(input, context), error => error?.code === 'SEARCHAD_CHILD_CLEANUP_INVENTORY_UNPROVEN');
    assert.deepEqual(g.calls, []);
  });

  await t.test('inventory in another run does not block an unrelated bounded cleanup', async () => {
    const target = await graph(), other = await graph({ withGroup: false });
    await other.observe(other.root, 'adgroup', 'present');
    target.calls.length = 0;
    assert.equal((await target.cleanup.execute(await target.approved(target.group, 'adgroup'), context)).state, 'deleted');
    assert.equal(target.calls.filter(call => call.startsWith('DELETE ')).length, 1);
  });
});
