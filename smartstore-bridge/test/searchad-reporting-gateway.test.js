import test from 'node:test';
import assert from 'node:assert/strict';

import { SearchAdOperationGateway } from '../src/naver/searchad/gateway.js';
import { SEARCHAD_REPORTING_OPERATIONS } from '../src/naver/searchad/reporting/operations.js';

const STAT_CREATE = SEARCHAD_REPORTING_OPERATIONS.statReport.create;
const MASTER_CREATE = SEARCHAD_REPORTING_OPERATIONS.masterReport.create;
const CAMPAIGN_CREATE = 'ncc.post.add_using_post_3__p_ncc_campaigns';

function reportOperation(operationKey, path) {
  return {
    operationKey,
    sourceId: operationKey.startsWith('master_report.') ? 'master-report' : 'report',
    sourceOperationId: operationKey,
    method: 'POST',
    path,
    rawPath: `/api${path}`,
    domain: 'stat_report',
    tags: ['Report'],
    summary: 'create',
    action: 'create',
    sideEffect: true,
    destructive: false,
    batch: false,
    risk: 'high',
    state: 'public_documented',
    tier: 'B',
    runtimeAllowlisted: true,
    requiredGate: 'creates',
    confirmation: 'CREATE_AD_ENTITY',
    capabilityKey: 'report.create',
    parameters: [],
    specRef: 'spec-reporting-1'
  };
}

function campaignOperation() {
  return {
    ...reportOperation(CAMPAIGN_CREATE, '/ncc/campaigns'),
    sourceId: 'ncc',
    domain: 'campaign',
    tags: ['Campaign'],
    capabilityKey: 'campaign.create'
  };
}

function makeGateway({ allowReportingJobs = true, mutateOperation } = {}) {
  const requests = [];
  const stat = reportOperation(STAT_CREATE, '/stat-reports');
  const master = reportOperation(MASTER_CREATE, '/master-reports');
  if (mutateOperation) mutateOperation(stat, master);
  const operations = new Map([
    [STAT_CREATE, stat],
    [MASTER_CREATE, master],
    [CAMPAIGN_CREATE, campaignOperation()]
  ]);
  const registry = {
    get(key) {
      const value = operations.get(key);
      if (!value) throw Object.assign(new Error('missing operation'), { code: 'SEARCHAD_OPERATION_NOT_FOUND', status: 404 });
      return value;
    },
    publicOperation(value) { return { ...value }; },
    status() { return { specRef: 'spec-reporting-1' }; }
  };
  const client = {
    async request(request) {
      requests.push(structuredClone(request));
      const data = request.path === '/master-reports'
        ? { id: 'master-job-1', item: 'Campaign', status: 'REGIST' }
        : { reportJobId: 101, reportTp: 'AD_DETAIL', status: 'REGIST' };
      return { status: 200, requestId: 'report-request-1', attempts: 1, durationMs: 2, headers: {}, data };
    }
  };
  const credentialsRegistry = {
    resolve(customerId) {
      assert.equal(customerId, '123');
      return { customerId, principalId: 'operator-report', role: 'operator' };
    },
    status() { return {}; }
  };
  const config = {
    enabled: true,
    configured: true,
    allowReads: true,
    allowWrites: false,
    allowCreates: false,
    allowBatchWrites: false,
    allowRollbacks: false,
    allowDeletes: false,
    allowActiveCanary: false,
    allowReportingJobs,
    allowUnverifiedOperations: false,
    automationMode: 'observe'
  };
  return {
    gateway: new SearchAdOperationGateway({ client, config, registry, credentialsRegistry, logger: { info() {} } }),
    requests
  };
}

test('ordinary gateway execute stays blocked for report POST when global create gate is OFF', async () => {
  const { gateway, requests } = makeGateway();
  await assert.rejects(
    () => gateway.execute(STAT_CREATE, { customerId: '123', body: { reportTp: 'AD_DETAIL' }, confirmation: 'CREATE_AD_ENTITY' }),
    error => error?.code === 'SEARCHAD_GATE_DISABLED'
  );
  assert.equal(requests.length, 0);
});

test('reporting execution requires its dedicated default-off gate', async () => {
  const { gateway, requests } = makeGateway({ allowReportingJobs: false });
  await assert.rejects(
    () => gateway.executeReporting(STAT_CREATE, { customerId: '123', body: { reportTp: 'AD_DETAIL' } }),
    error => error?.code === 'SEARCHAD_REPORTING_JOBS_DISABLED' && error?.status === 403
  );
  assert.equal(requests.length, 0);
});

test('reporting execution can POST only exact pinned stat/master report registration operations without opening ad create gate', async () => {
  const { gateway, requests } = makeGateway();
  const stat = await gateway.executeReporting(STAT_CREATE, { customerId: '123', body: { reportTp: 'AD_DETAIL' } });
  const master = await gateway.executeReporting(MASTER_CREATE, { customerId: '123', body: { item: 'Campaign' } });

  assert.equal(stat.data.reportJobId, 101);
  assert.equal(master.data.id, 'master-job-1');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(item => item.retrySafe), [false, false]);
  assert.deepEqual(requests.map(item => item.path), ['/stat-reports', '/master-reports']);
  assert.deepEqual(requests.map(item => item.method), ['POST', 'POST']);
});

test('reporting execution rejects ordinary ad creates even when reporting gate is ON', async () => {
  const { gateway, requests } = makeGateway();
  await assert.rejects(
    () => gateway.executeReporting(CAMPAIGN_CREATE, { customerId: '123', body: { campaignTp: 'WEB_SITE' } }),
    error => error?.code === 'SEARCHAD_REPORTING_OPERATION_SCOPE_FORBIDDEN' && error?.status === 403
  );
  assert.equal(requests.length, 0);
});

test('reporting execution never bypasses runtime allowlist or verification tier', async () => {
  const blocked = makeGateway({ mutateOperation(stat) { stat.runtimeAllowlisted = false; } });
  await assert.rejects(
    () => blocked.gateway.executeReporting(STAT_CREATE, { customerId: '123', body: { reportTp: 'AD_DETAIL' } }),
    error => error?.code === 'SEARCHAD_OPERATION_NOT_ALLOWLISTED'
  );
  assert.equal(blocked.requests.length, 0);

  const unverified = makeGateway({ mutateOperation(stat) { stat.tier = 'C'; } });
  await assert.rejects(
    () => unverified.gateway.executeReporting(STAT_CREATE, { customerId: '123', body: { reportTp: 'AD_DETAIL' } }),
    error => error?.code === 'SEARCHAD_OPERATION_UNVERIFIED'
  );
  assert.equal(unverified.requests.length, 0);
});
