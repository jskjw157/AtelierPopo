import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

import { SearchAdReportJobService } from '../src/naver/searchad/reporting/report-job-service.js';
import { SEARCHAD_REPORTING_OPERATIONS } from '../src/naver/searchad/reporting/operations.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function sha256Json(value) {
  const canonicalize = item => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonicalize(item[key])]));
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function conflict(existing) {
  const error = new Error('conflicting report intent');
  error.code = 'SEARCHAD_REPORT_INTENT_CONFLICT';
  error.status = 409;
  error.details = { existingReportIntentId: existing?.reportIntentId || null };
  return error;
}

class FakeRepository {
  constructor() {
    this.intents = new Map();
    this.keyIndex = new Map();
    this.events = [];
    this.sequence = [];
  }

  key(customerId, reportKind, intentKey) {
    return `${customerId}|${reportKind}|${intentKey}`;
  }

  async createOrGetReportIntent(row) {
    const key = this.key(row.customerId, row.reportKind, row.intentKey);
    const existingId = this.keyIndex.get(key);
    if (existingId) {
      const existing = this.intents.get(existingId);
      if (existing.requestSha256 !== row.requestSha256 || existing.operationKey !== row.operationKey) {
        throw conflict(existing);
      }
      return clone(existing);
    }
    const saved = clone(row);
    this.intents.set(saved.reportIntentId, saved);
    this.keyIndex.set(key, saved.reportIntentId);
    this.sequence.push(`create:${saved.status}`);
    return clone(saved);
  }

  async claimReportDispatch(reportIntentId, customerId, updatedAt) {
    const current = this.intents.get(reportIntentId);
    if (!current || current.customerId !== customerId) return { claimed: false, intent: null };
    if (current.status !== 'planned') return { claimed: false, intent: clone(current) };
    current.status = 'dispatching';
    current.updatedAt = updatedAt;
    this.sequence.push('claim:dispatching');
    return { claimed: true, intent: clone(current) };
  }

  async getReportIntent(reportIntentId, customerId = null) {
    const current = this.intents.get(reportIntentId);
    if (!current || (customerId != null && current.customerId !== String(customerId))) return null;
    return clone(current);
  }

  async updateReportIntent(reportIntentId, patch, customerId = null) {
    const current = this.intents.get(reportIntentId);
    if (!current || (customerId != null && current.customerId !== String(customerId))) return null;
    Object.assign(current, clone(patch));
    this.sequence.push(`update:${current.status}`);
    return clone(current);
  }

  async appendReportEvent(row) {
    const saved = clone(row);
    this.events.push(saved);
    this.sequence.push(`event:${saved.phase}:${saved.status}`);
    return saved;
  }

  seed(row) {
    const saved = clone(row);
    this.intents.set(saved.reportIntentId, saved);
    this.keyIndex.set(this.key(saved.customerId, saved.reportKind, saved.intentKey), saved.reportIntentId);
    return saved;
  }
}

function operation(operationKey, { sideEffect, method, path }) {
  return {
    operationKey,
    method,
    path,
    sideEffect,
    runtimeAllowlisted: true,
    state: 'public_documented',
    tier: 'B'
  };
}

function makeFixture({ postHandler, readHandler } = {}) {
  const repository = new FakeRepository();
  const posts = [];
  const reads = [];
  const operations = new Map([
    [SEARCHAD_REPORTING_OPERATIONS.statReport.create, operation(SEARCHAD_REPORTING_OPERATIONS.statReport.create, { sideEffect: true, method: 'POST', path: '/stat-reports' })],
    [SEARCHAD_REPORTING_OPERATIONS.statReport.list, operation(SEARCHAD_REPORTING_OPERATIONS.statReport.list, { sideEffect: false, method: 'GET', path: '/stat-reports' })],
    [SEARCHAD_REPORTING_OPERATIONS.statReport.get, operation(SEARCHAD_REPORTING_OPERATIONS.statReport.get, { sideEffect: false, method: 'GET', path: '/stat-reports/{reportJobId}' })],
    [SEARCHAD_REPORTING_OPERATIONS.masterReport.create, operation(SEARCHAD_REPORTING_OPERATIONS.masterReport.create, { sideEffect: true, method: 'POST', path: '/master-reports' })],
    [SEARCHAD_REPORTING_OPERATIONS.masterReport.list, operation(SEARCHAD_REPORTING_OPERATIONS.masterReport.list, { sideEffect: false, method: 'GET', path: '/master-reports' })],
    [SEARCHAD_REPORTING_OPERATIONS.masterReport.get, operation(SEARCHAD_REPORTING_OPERATIONS.masterReport.get, { sideEffect: false, method: 'GET', path: '/master-reports/{id}' })]
  ]);
  const gateway = {
    get(key) {
      const value = operations.get(key);
      if (!value) throw Object.assign(new Error('missing operation'), { code: 'SEARCHAD_OPERATION_NOT_FOUND' });
      return value;
    },
    async executeReporting(operationKey, input) {
      const snapshot = { operationKey, input: clone(input) };
      posts.push(snapshot);
      repository.sequence.push('post');
      if (postHandler) return postHandler(snapshot, repository);
      if (operationKey === SEARCHAD_REPORTING_OPERATIONS.masterReport.create) {
        return {
          upstream: { requestId: 'master-post-1' },
          data: {
            id: 'master-job-1', item: input.body.item, fromTime: input.body.fromTime,
            status: 'REGIST', downloadUrl: 'https://api.searchad.naver.com/report-download?job=master-job-1'
          }
        };
      }
      return {
        upstream: { requestId: 'stat-post-1' },
        data: {
          reportJobId: 101, reportTp: input.body.reportTp,
          status: 'REGIST', downloadUrl: 'https://api.searchad.naver.com/report-download?job=101'
        }
      };
    },
    async execute(operationKey, input) {
      const snapshot = { operationKey, input: clone(input) };
      reads.push(snapshot);
      repository.sequence.push('get');
      if (readHandler) return readHandler(snapshot, repository);
      return { upstream: { requestId: 'read-1' }, data: [] };
    }
  };
  let now = Date.parse('2026-09-11T08:10:00.000Z');
  const service = new SearchAdReportJobService({
    repository,
    gateway,
    clock: () => now
  });
  return {
    repository,
    gateway,
    service,
    posts,
    reads,
    setNow(value) { now = Date.parse(value); }
  };
}

const operator = {
  principal: {
    principalId: 'operator-report',
    role: 'operator',
    customerIds: ['100']
  },
  requestId: 'request-report'
};

test('report registration rejects caller-supplied remote result fields before repository or remote I/O', async () => {
  const fixture = makeFixture();
  await assert.rejects(
    () => fixture.service.registerStatReport({
      customerId: '100', intentKey: 'daily', reportType: 'AD_DETAIL', returnedJobId: 'caller-job'
    }, operator),
    error => error?.code === 'SEARCHAD_REPORT_JOB_INPUT_INVALID' && error?.status === 400
  );
  assert.equal(fixture.repository.intents.size, 0);
  assert.equal(fixture.posts.length, 0);
  assert.equal(fixture.reads.length, 0);
});

test('stat report registration persists dispatching before POST, stores only response-returned id/url, and same intent never POSTs twice', async () => {
  const fixture = makeFixture({
    postHandler(snapshot, repository) {
      const current = [...repository.intents.values()][0];
      assert.equal(current.status, 'dispatching');
      assert.equal(snapshot.operationKey, SEARCHAD_REPORTING_OPERATIONS.statReport.create);
      assert.deepEqual(snapshot.input.body, { reportTp: 'AD_DETAIL' });
      return {
        upstream: { requestId: 'post-stat-1' },
        data: {
          reportJobId: 777,
          reportTp: 'AD_DETAIL',
          status: 'REGIST',
          downloadUrl: 'https://api.searchad.naver.com/report-download?token=server-only'
        }
      };
    }
  });

  const first = await fixture.service.registerStatReport({
    customerId: '100', intentKey: 'daily-20260910', reportType: 'AD_DETAIL'
  }, operator);
  const second = await fixture.service.registerStatReport({
    customerId: '100', intentKey: 'daily-20260910', reportType: 'AD_DETAIL'
  }, operator);

  assert.equal(first.status, 'registered');
  assert.equal(first.returnedJobId, '777');
  assert.equal(first.persistedDownloadUrl, 'https://api.searchad.naver.com/report-download?token=server-only');
  assert.equal(second.reportIntentId, first.reportIntentId);
  assert.equal(second.status, 'registered');
  assert.equal(fixture.posts.length, 1);
  assert.ok(fixture.repository.sequence.indexOf('claim:dispatching') < fixture.repository.sequence.indexOf('post'));
});

test('same Customer/kind/intent key with a different canonical request conflicts without a second POST', async () => {
  const fixture = makeFixture();
  await fixture.service.registerStatReport({
    customerId: '100', intentKey: 'same-key', reportType: 'AD_DETAIL'
  }, operator);

  await assert.rejects(
    () => fixture.service.registerStatReport({
      customerId: '100', intentKey: 'same-key', reportType: 'AD'
    }, operator),
    error => error?.code === 'SEARCHAD_REPORT_INTENT_CONFLICT' && error?.status === 409
  );
  assert.equal(fixture.posts.length, 1);
});

test('ambiguous POST timeout becomes unknown_outcome and a repeated registration never resends POST', async () => {
  const fixture = makeFixture({
    postHandler() {
      const error = new Error('socket timed out after write');
      error.code = 'ETIMEDOUT';
      throw error;
    }
  });

  await assert.rejects(
    () => fixture.service.registerStatReport({
      customerId: '100', intentKey: 'ambiguous', reportType: 'AD_DETAIL'
    }, operator),
    error => error?.code === 'SEARCHAD_REPORT_JOB_UNKNOWN_OUTCOME' && error?.status === 409
  );
  const intent = [...fixture.repository.intents.values()][0];
  assert.equal(intent.status, 'unknown_outcome');
  assert.equal(fixture.posts.length, 1);

  const again = await fixture.service.registerStatReport({
    customerId: '100', intentKey: 'ambiguous', reportType: 'AD_DETAIL'
  }, operator);
  assert.equal(again.status, 'unknown_outcome');
  assert.equal(fixture.posts.length, 1);
});

test('restart from persisted dispatching state never replays the non-idempotent POST', async () => {
  const fixture = makeFixture();
  const request = { reportTp: 'AD_DETAIL' };
  const reportIntentId = randomUUID();
  fixture.repository.seed({
    reportIntentId,
    customerId: '100',
    reportKind: 'stat',
    intentKey: 'restart-dispatching',
    operationKey: SEARCHAD_REPORTING_OPERATIONS.statReport.create,
    request,
    requestSha256: sha256Json(request),
    status: 'dispatching',
    returnedJobId: null,
    persistedDownloadUrl: null,
    createdByPrincipalId: 'operator-report',
    requestId: 'old-request',
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:00:01.000Z',
    lastError: null
  });

  const result = await fixture.service.registerStatReport({
    customerId: '100', intentKey: 'restart-dispatching', reportType: 'AD_DETAIL'
  }, operator);
  assert.equal(result.reportIntentId, reportIntentId);
  assert.equal(result.status, 'dispatching');
  assert.equal(fixture.posts.length, 0);
});

test('GET-only reconcile resolves exactly one matching stat job and never calls reporting POST', async () => {
  const fixture = makeFixture({
    postHandler() {
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      throw error;
    },
    readHandler(snapshot) {
      assert.equal(snapshot.operationKey, SEARCHAD_REPORTING_OPERATIONS.statReport.list);
      return {
        upstream: { requestId: 'list-stat-1' },
        data: [
          {
            reportJobId: 901,
            reportTp: 'AD_DETAIL',
            status: 'BUILT',
            downloadUrl: 'https://api.searchad.naver.com/report-download?job=901'
          }
        ]
      };
    }
  });

  await assert.rejects(
    () => fixture.service.registerStatReport({
      customerId: '100', intentKey: 'reconcile-one', reportType: 'AD_DETAIL'
    }, operator),
    error => error?.code === 'SEARCHAD_REPORT_JOB_UNKNOWN_OUTCOME'
  );
  const reportIntentId = [...fixture.repository.intents.keys()][0];
  const postCount = fixture.posts.length;

  const reconciled = await fixture.service.reconcile(reportIntentId, operator);
  assert.equal(reconciled.status, 'reconciled');
  assert.equal(reconciled.returnedJobId, '901');
  assert.equal(reconciled.persistedDownloadUrl, 'https://api.searchad.naver.com/report-download?job=901');
  assert.equal(fixture.posts.length, postCount);
  assert.equal(fixture.reads.length, 1);
  assert.equal(fixture.reads[0].operationKey, SEARCHAD_REPORTING_OPERATIONS.statReport.list);
});

test('GET-only reconcile sends zero or multiple matches to manual_review instead of guessing a job id', async () => {
  for (const matches of [
    [],
    [
      { reportJobId: 1, reportTp: 'AD_DETAIL', status: 'REGIST' },
      { reportJobId: 2, reportTp: 'AD_DETAIL', status: 'RUNNING' }
    ]
  ]) {
    const fixture = makeFixture({
      readHandler() { return { upstream: { requestId: 'list' }, data: clone(matches) }; }
    });
    const request = { reportTp: 'AD_DETAIL' };
    const reportIntentId = randomUUID();
    fixture.repository.seed({
      reportIntentId,
      customerId: '100', reportKind: 'stat', intentKey: `manual-${matches.length}`,
      operationKey: SEARCHAD_REPORTING_OPERATIONS.statReport.create,
      request, requestSha256: sha256Json(request), status: 'unknown_outcome',
      returnedJobId: null, persistedDownloadUrl: null,
      createdByPrincipalId: 'operator-report', requestId: 'old-request',
      createdAt: '2026-09-11T08:00:00.000Z', updatedAt: '2026-09-11T08:00:01.000Z', lastError: null
    });

    const result = await fixture.service.reconcile(reportIntentId, operator);
    assert.equal(result.status, 'manual_review');
    assert.equal(result.returnedJobId, null);
    assert.equal(fixture.posts.length, 0);
    assert.equal(fixture.reads.length, 1);
  }
});

test('master report registration uses the response id/downloadUrl and preserves validated fromTime request semantics', async () => {
  const fixture = makeFixture();
  const result = await fixture.service.registerMasterReport({
    customerId: '100',
    intentKey: 'master-campaign-delta',
    item: 'Campaign',
    fromTime: '2026-09-10T00:00:00.000Z'
  }, operator);

  assert.equal(result.status, 'registered');
  assert.equal(result.returnedJobId, 'master-job-1');
  assert.equal(result.persistedDownloadUrl, 'https://api.searchad.naver.com/report-download?job=master-job-1');
  assert.equal(fixture.posts.length, 1);
  assert.equal(fixture.posts[0].operationKey, SEARCHAD_REPORTING_OPERATIONS.masterReport.create);
  assert.deepEqual(fixture.posts[0].input.body, {
    item: 'Campaign',
    fromTime: '2026-09-10T00:00:00.000Z'
  });
});
