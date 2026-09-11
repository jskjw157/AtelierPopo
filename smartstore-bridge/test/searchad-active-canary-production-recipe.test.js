import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANARY_OPERATION_KEYS,
  createStoppedWebSiteCampaignRecipe
} from '../src/naver/searchad/canary/production-recipe.js';

const CUSTOMER = '1234567';
const RUN = '11111111-2222-4333-8444-555555555555';
const CAMPAIGN = 'cmp-returned-1';

function recipe() {
  return createStoppedWebSiteCampaignRecipe({
    dailyBudget: 10000,
    budgetDelta: 1000,
    statsTimeRange: { since: '2026-09-10', until: '2026-09-13' }
  });
}

test('production Canary recipe pins only official campaign/stat operation keys', () => {
  assert.deepEqual(CANARY_OPERATION_KEYS, {
    createCampaign: 'ncc.post.add_using_post_3__p_ncc_campaigns',
    readCampaign: 'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',
    updateCampaign: 'ncc.put.modify_using_put_5__p_ncc_campaigns_campaign_id__q_fields',
    deleteCampaign: 'ncc.delete.remove_using_delete_5__p_ncc_campaigns_campaign_id',
    readSingleStat: 'report.get.get_single_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_id_time_increment_time_range'
  });

  assert.deepEqual(recipe().requiredOperationKeys, Object.values(CANARY_OPERATION_KEYS));
});

test('production recipe creates a stopped WEB_SITE campaign and never accepts an existing campaign id', () => {
  const current = recipe();
  const descriptor = current.createCampaign({ customerId: CUSTOMER, canaryRunId: RUN });

  assert.equal(descriptor.operationKey, CANARY_OPERATION_KEYS.createCampaign);
  assert.equal(descriptor.customerId, CUSTOMER);
  assert.equal(descriptor.body.campaignTp, 'WEB_SITE');
  assert.equal(descriptor.body.userLock, true);
  assert.equal(descriptor.body.dailyBudget, 10000);
  assert.match(descriptor.body.name, /^HAAR_CANARY_/);
  assert.equal('campaignId' in descriptor, false);
  assert.equal('remoteId' in descriptor, false);
});

test('production recipe binds read/update/delete and stats to the returned campaign id', () => {
  const current = recipe();

  const read = current.readCampaign({ customerId: CUSTOMER, remoteId: CAMPAIGN });
  assert.equal(read.operationKey, CANARY_OPERATION_KEYS.readCampaign);
  assert.deepEqual(read.pathParams, { campaignId: CAMPAIGN });

  const update = current.budgetMutation({
    customerId: CUSTOMER,
    remoteId: CAMPAIGN,
    before: { dailyBudget: 10000, userLock: true }
  });
  assert.equal(update.operationKey, CANARY_OPERATION_KEYS.updateCampaign);
  assert.deepEqual(update.pathParams, { campaignId: CAMPAIGN });
  assert.deepEqual(update.query, { fields: 'budget' });
  assert.equal(update.body.dailyBudget, 11000);

  const restore = current.budgetRestore({
    customerId: CUSTOMER,
    remoteId: CAMPAIGN,
    before: { dailyBudget: 10000, userLock: true }
  });
  assert.deepEqual(restore.query, { fields: 'budget' });
  assert.equal(restore.body.dailyBudget, 10000);

  const remove = current.cleanupCampaign({ customerId: CUSTOMER, remoteId: CAMPAIGN });
  assert.equal(remove.operationKey, CANARY_OPERATION_KEYS.deleteCampaign);
  assert.deepEqual(remove.pathParams, { campaignId: CAMPAIGN });

  const stats = current.beforeSpendRead({ customerId: CUSTOMER, remoteId: CAMPAIGN });
  assert.equal(stats.operationKey, CANARY_OPERATION_KEYS.readSingleStat);
  assert.equal(stats.customerId, CUSTOMER);
  assert.equal(stats.query.id, CAMPAIGN);
  assert.equal(stats.query.fields, JSON.stringify(['salesAmt']));
  assert.equal(stats.query.timeIncrement, 'allDays');
  assert.equal(stats.query.timeRange, JSON.stringify({ since: '2026-09-10', until: '2026-09-13' }));
});

test('production recipe parses only explicit numeric salesAmt cost evidence', () => {
  const current = recipe();
  assert.equal(current.parseSpend({ value: { summaryStatResponse: { data: [{ salesAmt: 0 }] } } }), 0);
  assert.equal(current.parseSpend({ value: { summaryStatResponse: { data: [{ salesAmt: 1234 }] } } }), 1234);
  assert.ok(Number.isNaN(current.parseSpend({ value: { summaryStatResponse: { data: [] } } })));
  assert.ok(Number.isNaN(current.parseSpend({ value: { summaryStatResponse: { data: [{ salesAmt: 'unknown' }] } } })));
});

test('production recipe refuses unsafe budget configuration', () => {
  assert.throws(
    () => createStoppedWebSiteCampaignRecipe({ dailyBudget: 0, budgetDelta: 1000, statsTimeRange: { since: '2026-09-10', until: '2026-09-13' } }),
    error => error?.code === 'SEARCHAD_CANARY_BUDGET_CONFIG_REQUIRED'
  );
  assert.throws(
    () => createStoppedWebSiteCampaignRecipe({ dailyBudget: 10000, budgetDelta: 0, statsTimeRange: { since: '2026-09-10', until: '2026-09-13' } }),
    error => error?.code === 'SEARCHAD_CANARY_BUDGET_CONFIG_REQUIRED'
  );
});
