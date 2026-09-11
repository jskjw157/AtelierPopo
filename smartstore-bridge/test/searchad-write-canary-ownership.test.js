import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { SearchAdCanaryOwnershipGuard, resolveSearchAdMutationTarget } from '../src/naver/searchad/lifecycle/ownership-guard.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from '../src/naver/searchad/lifecycle/operations.js';
import { SearchAdWriteRepository } from '../src/naver/searchad/write/repository.js';
import { SearchAdChangePlanService } from '../src/naver/searchad/write/plan-service.js';
import { SearchAdApprovalService, SEARCHAD_APPROVAL_CONFIRMATION } from '../src/naver/searchad/write/approval-service.js';
import { SearchAdExecutionService } from '../src/naver/searchad/write/execution-service.js';

const CAMPAIGN_UPDATE = 'ncc.put.modify_using_put_5__p_ncc_campaigns_campaign_id__q_fields';

test('ownership target resolver accepts only pinned mutation operations and their canonical path IDs', () => {
  assert.deepEqual(resolveSearchAdMutationTarget({
    operationKey: CAMPAIGN_UPDATE,
    pathParams: { campaignId: 'cmp-1' }
  }), { objectType: 'campaign', remoteId: 'cmp-1' });
  assert.deepEqual(resolveSearchAdMutationTarget({
    operationKey: SEARCHAD_HIERARCHY_OPERATIONS.adgroup.delete,
    pathParams: { adgroupId: 'grp-1' }
  }), { objectType: 'adgroup', remoteId: 'grp-1' });
  assert.deepEqual(resolveSearchAdMutationTarget({
    operationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.delete,
    pathParams: { nccKeywordId: 'kw-1' }
  }), { objectType: 'keyword', remoteId: 'kw-1' });
  assert.deepEqual(resolveSearchAdMutationTarget({
    operationKey: SEARCHAD_HIERARCHY_OPERATIONS.creative.delete,
    pathParams: { adId: 'ad-1' }
  }), { objectType: 'creative', remoteId: 'ad-1' });
  assert.throws(
    () => resolveSearchAdMutationTarget({ operationKey: 'caller.fake.update', pathParams: { campaignId: 'cmp-1' } }),
    error => error?.code === 'SEARCHAD_OWNERSHIP_TARGET_UNSUPPORTED' && error?.status === 409
  );
});

test('ownership guard blocks live Canary ownership but is Customer-scoped and allows deleted ownership', async () => {
  const rows = new Map([
    ['100:campaign:cmp-live', { customerId: '100', objectType: 'campaign', remoteId: 'cmp-live', state: 'owned', ownerKind: 'hierarchy_canary' }],
    ['100:campaign:cmp-unknown', { customerId: '100', objectType: 'campaign', remoteId: 'cmp-unknown', state: 'delete_unknown', ownerKind: 'hierarchy_canary' }],
    ['100:campaign:cmp-review', { customerId: '100', objectType: 'campaign', remoteId: 'cmp-review', state: 'manual_review', ownerKind: 'active_canary' }],
    ['100:campaign:cmp-deleted', { customerId: '100', objectType: 'campaign', remoteId: 'cmp-deleted', state: 'deleted', ownerKind: 'hierarchy_canary' }],
    ['200:campaign:cmp-live', { customerId: '200', objectType: 'campaign', remoteId: 'cmp-live', state: 'owned', ownerKind: 'hierarchy_canary' }]
  ]);
  const repository = {
    async getOwnership({ customerId, objectType, remoteId }) {
      return rows.get(`${customerId}:${objectType}:${remoteId}`) || null;
    }
  };
  const guard = new SearchAdCanaryOwnershipGuard({ repository });
  for (const remoteId of ['cmp-live', 'cmp-unknown', 'cmp-review']) {
    await assert.rejects(
      guard.assertMutationNotCanaryOwned({
        customerId: '100',
        descriptor: { operationKey: CAMPAIGN_UPDATE, pathParams: { campaignId: remoteId } }
      }),
      error => error?.code === 'SEARCHAD_CANARY_OWNERSHIP_HELD' && error?.status === 409
    );
  }
  await guard.assertMutationNotCanaryOwned({
    customerId: '100',
    descriptor: { operationKey: CAMPAIGN_UPDATE, pathParams: { campaignId: 'cmp-deleted' } }
  });
  await guard.assertMutationNotCanaryOwned({
    customerId: '200',
    descriptor: { operationKey: CAMPAIGN_UPDATE, pathParams: { campaignId: 'cmp-deleted' } }
  });
  await guard.assertMutationNotCanaryOwned({
    customerId: '100',
    descriptor: { operationKey: CAMPAIGN_UPDATE, pathParams: { campaignId: 'cmp-other' } }
  });
});

function executionHarness({ ownershipGuard }) {
  let state = { nccCampaignId: 'cmp-held', dailyBudget: 1000 };
  let approvalClaims = 0;
  let mutateCalls = 0;
  const clock = () => Date.parse('2026-09-11T07:00:00Z');
  const remote = {
    async read() { return { value: structuredClone(state) }; },
    async mutate(descriptor) {
      mutateCalls += 1;
      state = { ...state, ...(descriptor.body || {}) };
      return { requestId: 'remote-1' };
    }
  };
  const repository = new SearchAdWriteRepository({ database: new DatabaseSync(':memory:') });
  const config = {
    enabled: true,
    allowPlans: true,
    allowWrites: true,
    allowRollback: false,
    allowReconcile: true,
    initialActivationMode: 'active',
    planTtlSeconds: 1800,
    approvalTtlSeconds: 600
  };
  const approvalService = new SearchAdApprovalService({ repository, config, clock });
  const originalClaim = approvalService.claim.bind(approvalService);
  approvalService.claim = (...args) => { approvalClaims += 1; return originalClaim(...args); };
  const planService = new SearchAdChangePlanService({ repository, remote, config, clock });
  const executionService = new SearchAdExecutionService({
    repository,
    remote,
    approvalService,
    activationGuard: { async assertMutationAllowed() { return { allowed: true }; } },
    ownershipGuard,
    config,
    clock
  });
  return { repository, planService, approvalService, executionService, getApprovalClaims: () => approvalClaims, getMutateCalls: () => mutateCalls };
}

async function approvedCampaignPlan(h) {
  const plan = await h.planService.create({
    customerId: '100',
    createdBy: 'operator-100',
    reason: 'ownership guard contract',
    mutation: {
      operationKey: CAMPAIGN_UPDATE,
      pathParams: { campaignId: 'cmp-held' },
      query: { fields: 'budget' },
      body: { dailyBudget: 1200 },
      confirmation: 'UPDATE_AD_ENTITY'
    },
    verification: {
      read: { operationKey: 'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id', pathParams: { campaignId: 'cmp-held' } },
      expectedPatch: { dailyBudget: 1200 }
    }
  });
  const approval = h.approvalService.approve(plan.plan_id, {
    actor: 'executor-100',
    confirmation: SEARCHAD_APPROVAL_CONFIRMATION
  });
  return { plan, approval };
}

test('normal write ownership rejection happens before one-time approval claim and remote mutation', async () => {
  const calls = [];
  const h = executionHarness({
    ownershipGuard: {
      async assertMutationNotCanaryOwned(input) {
        calls.push(structuredClone(input));
        const error = new Error('held');
        error.code = 'SEARCHAD_CANARY_OWNERSHIP_HELD';
        error.status = 409;
        throw error;
      }
    }
  });
  const { plan, approval } = await approvedCampaignPlan(h);
  await assert.rejects(
    h.executionService.execute(plan.plan_id, { customerId: '100', executionToken: approval.executionToken }),
    error => error?.code === 'SEARCHAD_CANARY_OWNERSHIP_HELD'
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].customerId, '100');
  assert.equal(calls[0].descriptor.operationKey, CAMPAIGN_UPDATE);
  assert.equal(h.getApprovalClaims(), 0);
  assert.equal(h.getMutateCalls(), 0);
  h.repository.close();
});

test('normal non-owned write remains unchanged when ownership guard allows the target', async () => {
  const h = executionHarness({ ownershipGuard: { async assertMutationNotCanaryOwned() { return { allowed: true }; } } });
  const { plan, approval } = await approvedCampaignPlan(h);
  const applied = await h.executionService.execute(plan.plan_id, { customerId: '100', executionToken: approval.executionToken });
  assert.equal(applied.status, 'applied');
  assert.equal(h.getApprovalClaims(), 1);
  assert.equal(h.getMutateCalls(), 1);
  h.repository.close();
});