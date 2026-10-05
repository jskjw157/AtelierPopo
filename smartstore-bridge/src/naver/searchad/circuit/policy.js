/** Spend ceilings are VAT-inclusive KRW; realized loss is net KRW. */
export const DEFAULT_CIRCUIT_POLICY = Object.freeze({
  entityCooldownMs: 86400000, manualChangeHoldMs: 86400000,
  maxIncrementalSpendGrossKrw: 30000, dailyLossLimitNetKrw: 50000,
  maxConsecutiveFailures: 3, maxUnknownOutcomes: 3,
  postChangeObservationMs: 86400000, spendSpikeMultiplier: 2,
  customerDailySpendCeilingGrossKrw: null
});
const active = (at, duration, now) => at != null && now < Number(at) + duration;
export function evaluateCircuitPolicy({ state = {}, dispatch, policy = {}, evidence = null, now }) {
  const p = { ...DEFAULT_CIRCUIT_POLICY, ...policy }; const reasons = [];
  if (['rollback', 'read', 'report_registration'].includes(dispatch.purpose)) return { allowed: true, reasons };
  const automatic = Boolean(dispatch.ruleId), increase = dispatch.actionClass === 'increase';
  if (state.manualPaused) reasons.push('MANUAL_PAUSE');
  if ((state.unknownCount || 0) >= p.maxUnknownOutcomes) reasons.push('UNKNOWN_LIMIT');
  if (automatic && (state.consecutiveFailures?.[dispatch.ruleId] || 0) >= p.maxConsecutiveFailures) reasons.push('FAILURE_LIMIT');
  if (automatic && active(state.manualChangedAt, p.manualChangeHoldMs, now)) reasons.push('MANUAL_HOLD');
  if (automatic && active(state.changedAt, p.entityCooldownMs, now)) reasons.push('ENTITY_COOLDOWN');
  if (increase && active(state.changedAt, p.postChangeObservationMs, now)) reasons.push('POST_CHANGE_OBSERVATION');
  if (increase && !Number.isFinite(state.dailyLossNetKrw)) reasons.push('LOSS_EVIDENCE_UNAVAILABLE');
  if (increase && Number.isFinite(state.dailyLossNetKrw) && state.dailyLossNetKrw >= p.dailyLossLimitNetKrw) reasons.push('DAILY_LOSS_LIMIT');
  if (increase && (!Number.isFinite(dispatch.incrementalSpendKrw) || dispatch.incrementalSpendKrw < 0 || dispatch.incrementalSpendKrw > p.maxIncrementalSpendGrossKrw)) reasons.push('INCREMENTAL_SPEND_LIMIT');
  if (automatic) {
    if (!(p.customerDailySpendCeilingGrossKrw > 0)) reasons.push('DAILY_SPEND_CEILING_REQUIRED');
    if (!evidence || !Number.isFinite(evidence.spendGrossKrw) || evidence.spendGrossKrw < 0) reasons.push('SPEND_EVIDENCE_UNAVAILABLE');
    else {
      if (!(evidence.baselineGrossKrw > 0)) reasons.push('SPEND_BASELINE_UNAVAILABLE');
      else if (evidence.spendGrossKrw >= evidence.baselineGrossKrw * p.spendSpikeMultiplier) reasons.push('SPEND_SPIKE');
      if (p.customerDailySpendCeilingGrossKrw > 0 && evidence.spendGrossKrw + (dispatch.incrementalSpendKrw || 0) > p.customerDailySpendCeilingGrossKrw) reasons.push('DAILY_SPEND_LIMIT');
    }
  }
  return { allowed: reasons.length === 0, reasons };
}
