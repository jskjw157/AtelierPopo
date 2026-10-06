import test from 'node:test';
import assert from 'node:assert/strict';
import { StatsObservationService } from '../src/naver/searchad/reporting/stats-service.js';
import { validateStatsInput } from '../src/naver/searchad/reporting/contracts.js';
import { now, input, context, responseFixture, reportingFixture } from './helpers/searchad-completion-fixture.js';
const service = f => new StatsObservationService({ ...f, clock: () => now });
test('stats_rejects_injected_evidence_before_io', async () => {
  const f = reportingFixture();
  for (const key of ['identity', 'evidence', 'evidenceId', 'spend', 'cycleBaseTm', 'datePreset', 'fields', 'operationKey', 'upstreamBaseUrl']) {
    await assert.rejects(() => service(f).collect({ ...input, [key]: 'injected' }, context), { code: 'SEARCHAD_STATS_INPUT_INVALID' });
  }
  assert.equal(f.calls.length, 0); assert.equal(f.rows.length, 0);
});
test('stats_zero_is_valid_but_missing_is_not_zero', async () => {
  const zero = responseFixture(); Object.assign(zero.summaryStatResponse.data[0], { salesAmt: 0, impCnt: 0, clkCnt: 0, ccnt: 0, convAmt: 0 });
  assert.equal((await service(reportingFixture({ response: zero })).collect(input, context)).metrics.spendGrossKrw, '0');
  for (const value of [undefined, null, '', 'no', -1, Number.NaN, Number.POSITIVE_INFINITY, {}, '1e3', true, 1.5]) {
    const response = responseFixture(); response.summaryStatResponse.data[0].salesAmt = value;
    const f = reportingFixture({ response });
    await assert.rejects(() => service(f).collect(input, context), { code: 'SEARCHAD_STATS_RESPONSE_INVALID' });
    assert.equal(f.rows.length, 0);
  }
  for (const response of [{}, { summaryStatResponse: { cycleBaseTm: '202610051155', data: [] } }]) await assert.rejects(() => service(reportingFixture({ response })).collect(input, context));
});
test('stats_sales_amt_is_vat_included_cost', async () => {
  const f = reportingFixture(); const result = await service(f).collect(input, context);
  assert.equal(result.quality, 'provisional'); assert.equal(result.metrics.spendGrossKrw, '1100');
  assert.equal(result.metrics.conversionAmountKrw, '2000'); assert.equal(result.metrics.currency, 'KRW'); assert.equal(result.metrics.spendBasis, 'vat_included');
  assert.equal(result.sourceRequestId, 'fixture-upstream-request'); assert.equal(result.observedAt, '2026-10-05T03:00:00.000Z');
  assert.match(result.responseSha, /^[a-f0-9]{64}$/);
  const query = new URL(f.calls[0].url).searchParams;
  assert.equal(query.get('id'), 'cmp-1'); assert.equal(query.get('timeIncrement'), 'allDays');
  assert.equal(query.get('fields'), '["salesAmt","impCnt","clkCnt","ccnt","convAmt"]');
  assert.equal(query.get('timeRange'), '{"since":"2026-10-01","until":"2026-10-04"}');
  assert.equal(query.has('datePreset'), false);
});
test('stats_rechecks_rotated_identity_after_io', async () => {
  let f; f = reportingFixture({ afterRequest: () => f.rotate() });
  await assert.rejects(() => service(f).collect(input, context), { code: 'SEARCHAD_REPORTING_IDENTITY_CHANGED' }); assert.equal(f.rows.length, 0);
});
test('stats_scope_and_kst_cycle_are_exact', async () => {
  for (const patch of [{ since: '2026-02-29' }, { until: '2026-04-31' }, { since: '2026-10-05' }, { entityType: 'customer' }, { customerId: 1001 }]) assert.throws(() => validateStatsInput({ ...input, ...patch }), { code: 'SEARCHAD_STATS_INPUT_INVALID' });
  const f = reportingFixture(); await assert.rejects(() => service(f).collect(input, { ...context, principal: { ...context.principal, customerIds: ['2002'] } }), { code: 'SEARCHAD_CUSTOMER_FORBIDDEN' }); assert.equal(f.calls.length, 0);
  for (const patch of [{ id: 'cmp-other' }, { dateStart: '2026-09-30', dateEnd: '2026-10-04' }]) {
    const response = responseFixture(); Object.assign(response.summaryStatResponse.data[0], patch);
    await assert.rejects(() => service(reportingFixture({ response })).collect(input, context));
  }
  for (const cycle of ['202602291100', '202604311100', '202610052400', '202610051260', '202610051201', '2026-10-05T11:55', null]) {
    const response = responseFixture(); response.summaryStatResponse.cycleBaseTm = cycle;
    await assert.rejects(() => service(reportingFixture({ response })).collect(input, context));
  }
  const response = responseFixture(); response.summaryStatResponse.data.push({ ...response.summaryStatResponse.data[0] });
  await assert.rejects(() => service(reportingFixture({ response })).collect(input, context));
});
test('stats_errors_do_not_expose_transport_or_credentials', async () => {
  const f = reportingFixture({ response: new Error('secret fixture-license https://private.invalid?token=secret') });
  await assert.rejects(() => service(f).collect(input, context), error => error.code === 'SEARCHAD_STATS_UPSTREAM_FAILED' && !JSON.stringify({ message: error.message, details: error.details }).includes('secret'));
});
test('stats_missing_optional_conversion_amount_remains_null_and_echoed_range_is_exact', async () => {
  const response = responseFixture(); delete response.summaryStatResponse.data[0].convAmt;
  const result = await service(reportingFixture({ response })).collect(input, context);
  assert.equal(result.metrics.conversionAmountKrw, null); assert.deepEqual(result.missingMetrics, ['convAmt']); assert.equal(result.rangeBasis, 'server_request');
  Object.assign(response.summaryStatResponse.data[0], { dateStart: '2026-10-01', dateEnd: '2026-10-04', convAmt: '12345678901234567890.123456789' });
  const echoed = await service(reportingFixture({ response })).collect(input, context);
  assert.equal(echoed.rangeBasis, 'response_echo'); assert.equal(echoed.metrics.conversionAmountKrw, '12345678901234567890.123456789');
  for (const value of [null, '', 'NaN', '-1', true, {}, '1e2']) {
    response.summaryStatResponse.data[0].convAmt = value;
    await assert.rejects(() => service(reportingFixture({ response })).collect(input, context), { code: 'SEARCHAD_STATS_RESPONSE_INVALID' });
  }
});
test('stats_internal_collection_requires_operator_role_before_io', async () => {
  const f = reportingFixture(); await assert.rejects(() => service(f).collect(input, { ...context, principal: { ...context.principal, role: 'reader' } }), { code: 'SEARCHAD_REPORTING_ROLE_FORBIDDEN' }); assert.equal(f.calls.length, 0);
});
test('stats_requested_entity_type_is_not_remote_verified_type_or_trusted_evidence', async () => {
  const f = reportingFixture(); const row = await service(f).collect({ ...input, entityType: 'keyword' }, context);
  assert.equal(row.entityType, 'keyword'); assert.equal(row.entityTypeBasis, 'server_request'); assert.equal(row.quality, 'provisional');
  assert.equal(Object.hasOwn(row, 'verifiedEntityType'), false);
});
