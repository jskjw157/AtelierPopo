import { SearchAdWriteError } from '../write/errors.js';

export const CANARY_OPERATION_KEYS = Object.freeze({
  createCampaign: 'ncc.post.add_using_post_3__p_ncc_campaigns',
  readCampaign: 'ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id',
  updateCampaign: 'ncc.put.modify_using_put_5__p_ncc_campaigns_campaign_id__q_fields',
  deleteCampaign: 'ncc.delete.remove_using_delete_5__p_ncc_campaigns_campaign_id',
  readSingleStat: 'report.get.get_single_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_id_time_increment_time_range'
});

export const STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE = Object.freeze({
  operationKeys: Object.freeze(Object.values(CANARY_OPERATION_KEYS)),
  fieldScope: Object.freeze(['campaign.userLock', 'campaign.dailyBudget'])
});

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new SearchAdWriteError(
      'SEARCHAD_CANARY_BUDGET_CONFIG_REQUIRED',
      `${label} must be a finite positive number.`,
      { label },
      500
    );
  }
  return number;
}

function normalizedTimeRange(value) {
  const since = String(value?.since || '').trim();
  const until = String(value?.until || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new SearchAdWriteError(
      'SEARCHAD_CANARY_STATS_RANGE_REQUIRED',
      'Active Canary statsTimeRange requires YYYY-MM-DD since/until.',
      {},
      500
    );
  }
  return { since, until };
}

function remoteValue(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'value')) return value.value;
  if (value && typeof value === 'object' && Object.hasOwn(value, 'data')) return value.data;
  if (value && typeof value === 'object' && Object.hasOwn(value, 'body')) return value.body;
  return value;
}

function campaignIdFromResult(result) {
  const value = remoteValue(result);
  return value?.nccCampaignId || value?.campaignId || null;
}

function campaignFromSnapshot(snapshot) {
  return remoteValue(snapshot) || null;
}

function statSalesAmount(result) {
  const value = remoteValue(result);
  const rows = value?.summaryStatResponse?.data;
  if (!Array.isArray(rows) || rows.length !== 1) return Number.NaN;
  const amount = rows[0]?.salesAmt;
  return typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
    ? amount
    : Number.NaN;
}

export function createStoppedWebSiteCampaignRecipe({
  dailyBudget,
  budgetDelta,
  statsTimeRange
} = {}) {
  const baseBudget = positiveNumber(dailyBudget, 'dailyBudget');
  const delta = positiveNumber(budgetDelta, 'budgetDelta');
  const range = normalizedTimeRange(statsTimeRange);

  const statDescriptor = ({ customerId, remoteId }) => ({
    operationKey: CANARY_OPERATION_KEYS.readSingleStat,
    customerId: String(customerId),
    query: {
      id: String(remoteId),
      fields: JSON.stringify(['salesAmt']),
      timeRange: JSON.stringify(range),
      timeIncrement: 'allDays'
    }
  });

  return Object.freeze({
    id: 'stopped_web_site_campaign_v1',
    requiredOperationKeys: STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE.operationKeys,
    verifiedOperationScope: Object.freeze({
      operationKeys: Object.freeze([
        CANARY_OPERATION_KEYS.createCampaign,
        CANARY_OPERATION_KEYS.readCampaign,
        CANARY_OPERATION_KEYS.updateCampaign,
        CANARY_OPERATION_KEYS.deleteCampaign
      ]),
      fieldScope: STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE.fieldScope,
      campaignType: 'WEB_SITE'
    }),

    createCampaign({ customerId, canaryRunId }) {
      return {
        operationKey: CANARY_OPERATION_KEYS.createCampaign,
        customerId: String(customerId),
        body: {
          campaignTp: 'WEB_SITE',
          name: `HAAR_CANARY_${String(canaryRunId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48)}`,
          userLock: true,
          dailyBudget: baseBudget
        }
      };
    },

    extractCampaignId(result) {
      return campaignIdFromResult(result);
    },

    readCampaign({ customerId, remoteId }) {
      return {
        operationKey: CANARY_OPERATION_KEYS.readCampaign,
        customerId: String(customerId),
        pathParams: { campaignId: String(remoteId) }
      };
    },

    assertCreatedStopped(snapshot) {
      const campaign = campaignFromSnapshot(snapshot);
      return Boolean(
        campaign?.nccCampaignId &&
        campaign.campaignTp === 'WEB_SITE' &&
        campaign.userLock === true &&
        Number(campaign.dailyBudget) === baseBudget
      );
    },

    budgetMutation({ customerId, remoteId, before }) {
      const campaign = campaignFromSnapshot(before) || {};
      const beforeBudget = Number(campaign.dailyBudget);
      if (!Number.isFinite(beforeBudget) || beforeBudget <= 0) {
        throw new SearchAdWriteError(
          'SEARCHAD_CANARY_REMOTE_BUDGET_INVALID',
          'Remote campaign dailyBudget must be a positive finite number before Canary mutation.',
          { remoteId: String(remoteId) },
          409
        );
      }
      return {
        operationKey: CANARY_OPERATION_KEYS.updateCampaign,
        customerId: String(customerId),
        pathParams: { campaignId: String(remoteId) },
        query: { fields: 'budget' },
        body: {
          nccCampaignId: String(remoteId),
          dailyBudget: beforeBudget + delta,
          userLock: true
        }
      };
    },

    assertBudgetMutation(before, after) {
      const original = campaignFromSnapshot(before);
      const current = campaignFromSnapshot(after);
      return Boolean(
        original && current &&
        current.nccCampaignId === original.nccCampaignId &&
        current.userLock === true &&
        Number(current.dailyBudget) === Number(original.dailyBudget) + delta
      );
    },

    budgetRestore({ customerId, remoteId, before }) {
      const campaign = campaignFromSnapshot(before) || {};
      const beforeBudget = Number(campaign.dailyBudget);
      if (!Number.isFinite(beforeBudget) || beforeBudget <= 0) {
        throw new SearchAdWriteError(
          'SEARCHAD_CANARY_REMOTE_BUDGET_INVALID',
          'Remote campaign dailyBudget must be a positive finite number before Canary restore.',
          { remoteId: String(remoteId) },
          409
        );
      }
      return {
        operationKey: CANARY_OPERATION_KEYS.updateCampaign,
        customerId: String(customerId),
        pathParams: { campaignId: String(remoteId) },
        query: { fields: 'budget' },
        body: {
          nccCampaignId: String(remoteId),
          dailyBudget: beforeBudget,
          userLock: true
        }
      };
    },

    assertBudgetRestored(before, after) {
      const original = campaignFromSnapshot(before);
      const current = campaignFromSnapshot(after);
      return Boolean(
        original && current &&
        current.nccCampaignId === original.nccCampaignId &&
        current.userLock === true &&
        Number(current.dailyBudget) === Number(original.dailyBudget)
      );
    },

    cleanupCampaign({ customerId, remoteId }) {
      return {
        operationKey: CANARY_OPERATION_KEYS.deleteCampaign,
        customerId: String(customerId),
        pathParams: { campaignId: String(remoteId) }
      };
    },

    assertCleanup(readResult) {
      const value = campaignFromSnapshot(readResult);
      return value == null;
    },

    beforeSpendRead: statDescriptor,
    afterSpendRead: statDescriptor,
    parseSpend: statSalesAmount
  });
}
