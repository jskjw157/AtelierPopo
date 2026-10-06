import { randomUUID } from 'node:crypto';
import { CANARY_OPERATION_KEYS } from '../canary/production-recipe.js';
import { contentHash } from '../write/canonical.js';
import { validateStatsInput, assertReportingScope, validateIdentity, reportingError, strictDecimal, cycleTimestamp } from './contracts.js';
export class StatsObservationService {
  constructor({ repository, gateway, identityResolver, clock = Date.now }) { Object.assign(this, { repository, gateway, identityResolver, clock }); }
  async collect(input, context) {
    const scope = validateStatsInput(input);
    assertReportingScope(scope.customerId, context);
    const identity = validateIdentity(await this.identityResolver(scope.customerId), scope.customerId);
    let response;
    try {
      response = await this.gateway.execute(CANARY_OPERATION_KEYS.readSingleStat, { customerId: scope.customerId, query: { id: scope.entityId, fields: '["salesAmt","impCnt","clkCnt","ccnt","convAmt"]', timeRange: JSON.stringify({ since: scope.since, until: scope.until }), timeIncrement: 'allDays' } });
    } catch { throw reportingError('SEARCHAD_STATS_UPSTREAM_FAILED', 502); }
    let current;
    try { current = validateIdentity(await this.identityResolver(scope.customerId), scope.customerId); } catch { throw reportingError('SEARCHAD_REPORTING_IDENTITY_CHANGED', 409); }
    if (contentHash(current) !== contentHash(identity)) throw reportingError('SEARCHAD_REPORTING_IDENTITY_CHANGED', 409);
    const observedMs = this.clock();
    const summary = response?.data?.summaryStatResponse;
    if (!summary || response.data.dailyStatResponse || !Array.isArray(summary.data) || summary.data.length !== 1) throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
    const row = summary.data[0];
    if (!row || row.id !== scope.entityId || row.breakdowns?.length) throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
    const echoed = Object.hasOwn(row, 'dateStart') || Object.hasOwn(row, 'dateEnd');
    if (echoed && (row.dateStart !== scope.since || row.dateEnd !== scope.until)) throw reportingError('SEARCHAD_STATS_RESPONSE_INVALID', 502);
    const metrics = { spendGrossKrw: strictDecimal(row.salesAmt, { integer: true }), impressions: strictDecimal(row.impCnt, { integer: true }), clicks: strictDecimal(row.clkCnt, { integer: true }), conversions: strictDecimal(row.ccnt, { integer: true }), conversionAmountKrw: Object.hasOwn(row, 'convAmt') ? strictDecimal(row.convAmt) : null, currency: 'KRW', spendBasis: 'vat_included' };
    const observation = { observationId: randomUUID(), ...scope, ...identity, observedAt: new Date(observedMs).toISOString(), sourceRequestId: /^[A-Za-z0-9_.:-]{1,128}$/.test(response.upstream?.requestId || '') ? response.upstream.requestId : null, collectionRequestId: context.requestId, collectedByPrincipalId: context.principal.principalId, responseSha: contentHash(response.data), cycleBaseTm: summary.cycleBaseTm, cycleAt: cycleTimestamp(summary.cycleBaseTm, observedMs), quality: 'provisional', entityTypeBasis: 'server_request', rangeBasis: echoed ? 'response_echo' : 'server_request', missingMetrics: Object.hasOwn(row, 'convAmt') ? [] : ['convAmt'], metrics };
    try { return await this.repository.appendObservation(observation); } catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
}
