import test from 'node:test';
import assert from 'node:assert/strict';

import { ActiveCanaryService } from '../src/naver/searchad/canary/active-canary-service.js';

const HOUR = 60 * 60 * 1000;

function makeRepository({ evidenceOverrides = {}, accountOverrides = {} } = {}) {
  const runs = new Map();
  const objects = new Map();
  const events = [];
  const generatedEvidence = [];
  const passiveEvidence = {
    evidenceId: 'passive-1',
    evidenceType: 'passive_capability',
    customerId: '123',
    specSha: 'spec-1',
    credentialFingerprint: 'cred-1',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    result: 'verified',
    operationKeys: ['campaign.create', 'campaign.read', 'campaign.update', 'campaign.delete', 'stats.read'],
    fieldScope: ['campaign.userLock', 'campaign.budget'],
    expiresAt: '2026-09-20T00:00:00.000Z',
    ...evidenceOverrides
  };
  const account = {
    customerId: '123',
    suspended: false,
    ...accountOverrides
  };

  return {
    events,
    generatedEvidence,
    async getEvidence(id) {
      return id === passiveEvidence.evidenceId ? structuredClone(passiveEvidence) : null;
    },
    async getAccount(customerId) {
      return customerId === account.customerId ? structuredClone(account) : null;
    },
    async findActiveRun(customerId) {
      return [...runs.values()].find(run => run.customerId === customerId && !['passed', 'failed', 'blocked', 'spend_detected', 'expired'].includes(run.status)) || null;
    },
    async createRun(run) {
      runs.set(run.canaryRunId, structuredClone(run));
      return structuredClone(run);
    },
    async getRun(runId) {
      const run = runs.get(runId);
      return run ? structuredClone(run) : null;
    },
    async updateRun(runId, patch) {
      const current = runs.get(runId);
      if (!current) throw new Error(`missing run ${runId}`);
      const next = { ...current, ...structuredClone(patch) };
      runs.set(runId, next);
      return structuredClone(next);
    },
    async settleMutation(runId, patch, event) {
      const result = await this.updateRun(runId, patch); await this.addEvent(event); return result;
    },
    async addEvent(event) {
      events.push(structuredClone(event));
    },
    async addObject(object) {
      const list = objects.get(object.canaryRunId) || [];
      list.push(structuredClone(object));
      objects.set(object.canaryRunId, list);
    },
    async updateObject(runId, remoteId, patch) {
      const list = objects.get(runId) || [];
      const index = list.findIndex(item => item.remoteId === remoteId);
      if (index < 0) throw new Error(`missing object ${runId}:${remoteId}`);
      list[index] = { ...list[index], ...structuredClone(patch) };
      objects.set(runId, list);
      return structuredClone(list[index]);
    },
    async listObjects(runId) {
      return structuredClone(objects.get(runId) || []);
    },
    async createEvidence(evidence) {
      generatedEvidence.push(structuredClone(evidence));
      return structuredClone(evidence);
    }
  };
}

function recipe() {
  return {
    id: 'stopped_web_site_campaign_v1',
    requiredOperationKeys: ['campaign.create', 'campaign.read', 'campaign.update', 'campaign.delete', 'stats.read'],
    verifiedOperationScope: {
      operationKeys: ['campaign.create', 'campaign.read', 'campaign.update', 'campaign.delete'],
      fieldScope: ['campaign.userLock', 'campaign.budget'],
      lifecycleKinds: ['create', 'delete'],
      campaignType: 'WEB_SITE'
    },
    beforeSpendRead({ customerId, remoteId }) {
      return { operationKey: 'stats.read', input: { customerId, campaignId: remoteId, phase: 'before' } };
    },
    createCampaign({ customerId, canaryRunId }) {
      return {
        operationKey: 'campaign.create',
        input: {
          customerId,
          body: { campaignTp: 'WEB_SITE', userLock: true, name: `HAAR_CANARY_${canaryRunId}` }
        }
      };
    },
    extractCampaignId(result) {
      return result?.body?.nccCampaignId || null;
    },
    readCampaign({ customerId, remoteId }) {
      return { operationKey: 'campaign.read', input: { customerId, pathParams: { campaignId: remoteId } } };
    },
    assertCreatedStopped(snapshot) {
      return snapshot?.nccCampaignId && snapshot?.campaignTp === 'WEB_SITE' && snapshot?.userLock === true;
    },
    budgetMutation({ customerId, remoteId, before }) {
      return {
        operationKey: 'campaign.update',
        input: {
          customerId,
          pathParams: { campaignId: remoteId },
          body: { budget: Number(before.budget) + 100 }
        }
      };
    },
    assertBudgetMutation(before, after) {
      return Number(after?.budget) === Number(before?.budget) + 100 && after?.userLock === true;
    },
    budgetRestore({ customerId, remoteId, before }) {
      return {
        operationKey: 'campaign.update',
        input: {
          customerId,
          pathParams: { campaignId: remoteId },
          body: { budget: Number(before.budget) }
        }
      };
    },
    assertBudgetRestored(before, after) {
      return Number(after?.budget) === Number(before?.budget) && after?.userLock === true;
    },
    cleanupCampaign({ customerId, remoteId }) {
      return { operationKey: 'campaign.delete', input: { customerId, pathParams: { campaignId: remoteId } } };
    },
    assertCleanup(readResult) {
      return readResult == null;
    },
    afterSpendRead({ customerId, remoteId }) {
      return { operationKey: 'stats.read', input: { customerId, campaignId: remoteId, phase: 'after' } };
    },
    parseSpend(result) {
      return typeof result?.cost === 'number' && Number.isFinite(result.cost) && result.cost >= 0
        ? result.cost
        : Number.NaN;
    }
  };
}

function makeRemote({ failCreate = false, baselineSpend = 0, afterSpend = 0, missingBaseline = false } = {}) {
  const calls = [];
  let campaign = null;
  return {
    calls,
    async read(descriptor) {
      calls.push({ type: 'read', operationKey: descriptor.operationKey, input: structuredClone(descriptor.input) });
      if (descriptor.operationKey === 'stats.read') {
        assert.equal(descriptor.input.campaignId, 'cmp-returned-1');
        if (descriptor.input.phase === 'before') {
          assert.ok(campaign, 'baseline stats must not be read before returned campaign is created');
          if (missingBaseline) return {};
          return { cost: baselineSpend };
        }
        if (descriptor.input.phase === 'after') return { cost: afterSpend };
        throw new Error(`unexpected stats phase ${descriptor.input.phase}`);
      }
      if (descriptor.operationKey === 'campaign.read') return campaign ? structuredClone(campaign) : null;
      throw new Error(`unexpected read ${descriptor.operationKey}`);
    },
    async mutate(descriptor) {
      calls.push({ type: 'mutate', operationKey: descriptor.operationKey, input: structuredClone(descriptor.input) });
      if (descriptor.operationKey === 'campaign.create') {
        if (failCreate) {
          const error = new Error('upstream unavailable after send');
          error.status = 503;
          throw error;
        }
        campaign = {
          nccCampaignId: 'cmp-returned-1',
          campaignTp: 'WEB_SITE',
          userLock: true,
          budget: 1000
        };
        return { body: { nccCampaignId: campaign.nccCampaignId } };
      }
      if (descriptor.operationKey === 'campaign.update') {
        assert.equal(descriptor.input.pathParams.campaignId, 'cmp-returned-1');
        campaign = { ...campaign, budget: descriptor.input.body.budget };
        return { body: structuredClone(campaign) };
      }
      if (descriptor.operationKey === 'campaign.delete') {
        assert.equal(descriptor.input.pathParams.campaignId, 'cmp-returned-1');
        campaign = null;
        return { body: {} };
      }
      throw new Error(`unexpected mutate ${descriptor.operationKey}`);
    }
  };
}

function makeService(options = {}) {
  let now = Date.parse('2026-09-10T00:00:00.000Z');
  const repository = options.repository || makeRepository(options.repositoryOptions);
  const remote = options.remote || makeRemote(options.remoteOptions);
  const config = {
    allowActiveCanary: true,
    activationMode: 'canary',
    observationPeriodMs: 48 * HOUR,
    specSha: 'spec-1',
    credentialFingerprint: 'cred-1',
    upstreamBaseUrl: 'https://api.searchad.naver.com',
    ...options.config
  };
  const service = new ActiveCanaryService({
    repository,
    remote,
    recipe: recipe(),
    config,
    credentialFingerprintResolver: options.credentialFingerprintResolver,
    clock: () => now
  });
  return {
    service,
    repository,
    remote,
    setNow(value) { now = typeof value === 'number' ? value : Date.parse(value); },
    advance(ms) { now += ms; }
  };
}

const admin = { principalId: 'admin-1', role: 'admin', customerIds: ['123'] };

test('Active Canary start is Admin-only and customer-scoped', async () => {
  const { service, remote } = makeService();

  await assert.rejects(
    service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: { ...admin, role: 'executor' } }),
    error => error?.code === 'SEARCHAD_CANARY_ADMIN_REQUIRED'
  );
  await assert.rejects(
    service.start({ customerId: '999', passiveEvidenceId: 'passive-1' }, { principal: admin }),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN'
  );
  assert.equal(remote.calls.length, 0);
});

test('Active Canary rejects disabled/mismatched activation gates before remote I/O', async () => {
  for (const config of [
    { allowActiveCanary: false },
    { activationMode: 'prevalidation' }
  ]) {
    const { service, remote } = makeService({ config });
    await assert.rejects(
      service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin }),
      error => ['SEARCHAD_ACTIVE_CANARY_DISABLED', 'SEARCHAD_CANARY_MODE_REQUIRED'].includes(error?.code)
    );
    assert.equal(remote.calls.length, 0);
  }
});

test('Active Canary requires matching immutable passive evidence and rejects client execution overrides', async () => {
  const invalid = makeService({ repositoryOptions: { evidenceOverrides: { credentialFingerprint: 'other' } } });
  await assert.rejects(
    invalid.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin }),
    error => error?.code === 'SEARCHAD_CANARY_EVIDENCE_MISMATCH'
  );
  assert.equal(invalid.remote.calls.length, 0);

  const normal = makeService();
  await assert.rejects(
    normal.service.start({
      customerId: '123',
      passiveEvidenceId: 'passive-1',
      operationKey: 'campaign.delete',
      remoteId: 'existing-campaign',
      passed: true
    }, { principal: admin }),
    error => error?.code === 'SEARCHAD_CANARY_INPUT_INVALID'
  );
  assert.equal(normal.remote.calls.length, 0);
});

test('Customer-specific credential fingerprint resolver is authoritative for evidence matching and run binding', async () => {
  const invalid = makeService({
    credentialFingerprintResolver: customerId => customerId === '123' ? 'cred-resolved' : 'other'
  });
  await assert.rejects(
    invalid.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin }),
    error => error?.code === 'SEARCHAD_CANARY_EVIDENCE_MISMATCH'
  );
  assert.equal(invalid.remote.calls.length, 0);

  const valid = makeService({
    repositoryOptions: { evidenceOverrides: { credentialFingerprint: 'cred-resolved' } },
    credentialFingerprintResolver: () => 'cred-resolved'
  });
  const run = await valid.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin });
  assert.equal(run.credentialFingerprint, 'cred-resolved');
});

test('stopped WEB_SITE Canary reads baseline stats only after returned ID read-back, then restores and cleans up', async () => {
  const { service, repository, remote } = makeService();
  const run = await service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin });

  assert.equal(run.status, 'spend_check_pending');
  assert.equal(run.remoteId, 'cmp-returned-1');
  assert.equal(repository.generatedEvidence.length, 0);

  const createIndex = remote.calls.findIndex(call => call.type === 'mutate' && call.operationKey === 'campaign.create');
  const createdReadIndex = remote.calls.findIndex(call => call.type === 'read' && call.operationKey === 'campaign.read');
  const baselineStatIndex = remote.calls.findIndex(call => call.type === 'read' && call.operationKey === 'stats.read' && call.input.phase === 'before');
  assert.ok(createIndex >= 0);
  assert.ok(createdReadIndex > createIndex);
  assert.ok(baselineStatIndex > createdReadIndex);
  assert.equal(remote.calls[baselineStatIndex].input.campaignId, 'cmp-returned-1');

  assert.deepEqual(
    remote.calls.filter(call => call.type === 'mutate').map(call => call.operationKey),
    ['campaign.create', 'campaign.update', 'campaign.update', 'campaign.delete']
  );
  for (const call of remote.calls.filter(call => ['campaign.update', 'campaign.delete'].includes(call.operationKey))) {
    assert.equal(call.input.pathParams.campaignId, 'cmp-returned-1');
  }
  const objects = await repository.listObjects(run.canaryRunId);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].remoteId, 'cmp-returned-1');
  assert.equal(objects[0].cleanupStatus, 'deleted_verified');
});

test('missing baseline spend is never treated as zero and no budget mutation follows', async () => {
  const fx = makeService({ remoteOptions: { missingBaseline: true } });
  await assert.rejects(
    fx.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin }),
    error => error?.code === 'SEARCHAD_CANARY_SPEND_UNVERIFIED'
  );
  assert.deepEqual(
    fx.remote.calls.filter(call => call.type === 'mutate').map(call => call.operationKey),
    ['campaign.create']
  );
  const unresolved = await fx.repository.findActiveRun('123');
  assert.equal(unresolved?.status, 'cleanup_required');
});

test('zero-spend evidence is issued only after the 48h post-cleanup observation window', async () => {
  const fx = makeService();
  const run = await fx.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin });

  await assert.rejects(
    fx.service.verifySpend(run.canaryRunId, { principal: admin }),
    error => error?.code === 'SEARCHAD_CANARY_OBSERVATION_PENDING'
  );
  assert.equal(fx.repository.generatedEvidence.length, 0);

  fx.advance(48 * HOUR + 1);
  const verified = await fx.service.verifySpend(run.canaryRunId, { principal: admin });
  assert.equal(verified.status, 'passed');
  assert.equal(fx.repository.generatedEvidence.length, 1);
  const evidence = fx.repository.generatedEvidence[0];
  assert.equal(evidence.evidenceType, 'active_canary');
  assert.equal(evidence.customerId, '123');
  assert.equal(evidence.result, 'verified');
  assert.deepEqual(evidence.operationKeys, ['campaign.create', 'campaign.read', 'campaign.update', 'campaign.delete']);
  assert.deepEqual(evidence.fieldScope, ['campaign.userLock', 'campaign.budget']);
  assert.deepEqual(evidence.lifecycleKinds, ['create', 'delete']);
});

test('non-zero post-cleanup spend prevents PASS and evidence issuance', async () => {
  const fx = makeService({ remoteOptions: { afterSpend: 1 } });
  const run = await fx.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin });
  fx.advance(48 * HOUR + 1);
  const checked = await fx.service.verifySpend(run.canaryRunId, { principal: admin });
  assert.equal(checked.status, 'spend_detected');
  assert.equal(fx.repository.generatedEvidence.length, 0);
});

test('negative or otherwise invalid spend delta is unverified, never PASS', async () => {
  const fx = makeService({ remoteOptions: { baselineSpend: 5, afterSpend: 4 } });
  const run = await fx.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin });
  fx.advance(48 * HOUR + 1);
  await assert.rejects(
    fx.service.verifySpend(run.canaryRunId, { principal: admin }),
    error => error?.code === 'SEARCHAD_CANARY_SPEND_UNVERIFIED'
  );
  assert.equal(fx.repository.generatedEvidence.length, 0);
});

test('ambiguous create outcome is recorded once and no later mutation is attempted', async () => {
  const fx = makeService({ remoteOptions: { failCreate: true } });
  await assert.rejects(
    fx.service.start({ customerId: '123', passiveEvidenceId: 'passive-1' }, { principal: admin }),
    error => error?.code === 'SEARCHAD_CANARY_UNKNOWN_OUTCOME'
  );

  const mutateCalls = fx.remote.calls.filter(call => call.type === 'mutate');
  assert.deepEqual(mutateCalls.map(call => call.operationKey), ['campaign.create']);
  const unknown = [...fx.repository.events].find(event => event.status === 'unknown_outcome');
  assert.ok(unknown);
});
