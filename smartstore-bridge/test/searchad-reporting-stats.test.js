import test from 'node:test';
import assert from 'node:assert/strict';

import { SEARCHAD_REPORTING_OPERATIONS } from '../src/naver/searchad/reporting/operations.js';
import { parseStatsResponse } from '../src/naver/searchad/reporting/stats-parser.js';
import { SearchAdStatsEvidenceService } from '../src/naver/searchad/reporting/stats-evidence-service.js';

function principal(role = 'operator', customerIds = ['100']) {
  return { principalId: `${role}-stats`, role, customerIds };
}

function fixture({ data, now = Date.UTC(2026, 8, 11, 3, 0, 0), maxCycleAgeMs = 72 * 60 * 60 * 1000 } = {}) {
  const calls = [];
  const observations = [];
  const descriptor = {
    operationKey: SEARCHAD_REPORTING_OPERATIONS.stat.single,
    state: 'public_documented',
    tier: 'B',
    runtimeAllowlisted: true,
    sideEffect: false,
    action: 'read'
  };
  const gateway = {
    get(operationKey) {
      calls.push({ type: 'get', operationKey });
      if (operationKey !== descriptor.operationKey) throw new Error('unknown operation');
      return descriptor;
    },
    async execute(operationKey, input) {
      calls.push({ type: 'execute', operationKey, input });
      return {
        operation: descriptor,
        upstream: { requestId: 'stats-request-1', status: 200 },
        data: data ?? {
          summaryStatResponse: {
            data: [{ id: 'cmp-100', salesAmt: 0 }],
            cycleBaseTm: '202609111100'
          }
        }
      };
    }
  };
  const repository = {
    async createObservation(row) {
      observations.push(structuredClone(row));
      return structuredClone(row);
    }
  };
  const service = new SearchAdStatsEvidenceService({
    repository,
    gateway,
    credentialFingerprintResolver: async customerId => `fp-${customerId}`,
    gatewayContext: {
      specSha: 'spec-stats-1',
      upstreamBaseUrl: 'https://api.searchad.naver.com/'
    },
    clock: () => now,
    maxCycleAgeMs
  });
  return { service, calls, observations };
}

const validInput = Object.freeze({
  customerId: '100',
  entityId: 'cmp-100',
  fields: ['salesAmt'],
  sinceDate: '2026-09-08',
  untilDate: '2026-09-08',
  timeIncrement: 'allDays',
  breakdown: null
});

test('stats observation rejects caller-fabricated evidence/context fields before remote I/O or persistence', async () => {
  for (const [field, value] of [
    ['salesAmt', 0],
    ['cycleBaseTm', '202609111100'],
    ['stabilized', true],
    ['rawResponse', { fake: true }],
    ['specSha', 'caller-spec'],
    ['credentialFingerprint', 'caller-fp'],
    ['upstreamBaseUrl', 'https://evil.example'],
    ['datePreset', 'today']
  ]) {
    const { service, calls, observations } = fixture();
    await assert.rejects(
      () => service.observe({ ...validInput, [field]: value }, { principal: principal() }),
      error => error?.code === 'SEARCHAD_REPORTING_INPUT_INVALID' && error?.status === 400
    );
    assert.equal(calls.length, 0, field);
    assert.equal(observations.length, 0, field);
  }
});

test('stats observation requires Operator-or-higher plus explicit Customer access before gateway execution', async () => {
  const reader = fixture();
  await assert.rejects(
    () => reader.service.observe(validInput, { principal: principal('reader') }),
    error => error?.code === 'SEARCHAD_OPERATOR_REQUIRED' && error?.status === 403
  );
  assert.equal(reader.calls.length, 0);

  const wrongCustomer = fixture();
  await assert.rejects(
    () => wrongCustomer.service.observe(validInput, { principal: principal('operator', ['200']) }),
    error => error?.code === 'SEARCHAD_CUSTOMER_FORBIDDEN' && error?.status === 403
  );
  assert.equal(wrongCustomer.calls.length, 0);
});

test('explicit-range stats read persists only upstream-derived numeric zero with VAT_INCLUDED and current context', async () => {
  const { service, calls, observations } = fixture();
  const result = await service.observe(validInput, {
    principal: principal('operator'),
    requestId: 'http-stats-1'
  });

  const execute = calls.find(call => call.type === 'execute');
  assert.equal(execute.operationKey, SEARCHAD_REPORTING_OPERATIONS.stat.single);
  assert.deepEqual(execute.input, {
    customerId: '100',
    query: {
      id: 'cmp-100',
      fields: JSON.stringify(['salesAmt']),
      timeRange: JSON.stringify({ since: '2026-09-08', until: '2026-09-08' }),
      timeIncrement: 'allDays'
    }
  });
  assert.equal(observations.length, 1);
  assert.equal(result.customerId, '100');
  assert.equal(result.entityId, 'cmp-100');
  assert.equal(result.salesAmtKrw, 0);
  assert.equal(result.vatBasis, 'VAT_INCLUDED');
  assert.equal(result.validity, 'valid');
  assert.equal(result.cycleBaseTm, '202609111100');
  assert.equal(result.specSha, 'spec-stats-1');
  assert.equal(result.credentialFingerprint, 'fp-100');
  assert.equal(result.upstreamBaseUrl, 'https://api.searchad.naver.com');
  assert.equal(result.sourceRequestId, 'stats-request-1');
  assert.match(result.rawResponseSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.rawResponse, {
    summaryStatResponse: {
      data: [{ id: 'cmp-100', salesAmt: 0 }],
      cycleBaseTm: '202609111100'
    }
  });
});

test('stats parser preserves explicit numeric spend and never converts missing malformed or negative spend to zero', () => {
  const common = {
    entityId: 'cmp-100',
    timeIncrement: 'allDays',
    observedAtMs: Date.UTC(2026, 8, 11, 3, 0, 0),
    maxCycleAgeMs: 72 * 60 * 60 * 1000
  };
  const response = salesAmt => ({
    summaryStatResponse: {
      data: [{ id: 'cmp-100', ...(salesAmt === undefined ? {} : { salesAmt }) }],
      cycleBaseTm: '202609111100'
    }
  });

  assert.deepEqual(parseStatsResponse({ ...common, data: response(1234) }), {
    salesAmtKrw: 1234,
    vatBasis: 'VAT_INCLUDED',
    cycleBaseTm: '202609111100',
    validity: 'valid'
  });
  assert.deepEqual(parseStatsResponse({ ...common, data: response(undefined) }), {
    salesAmtKrw: null,
    vatBasis: 'VAT_INCLUDED',
    cycleBaseTm: '202609111100',
    validity: 'missing'
  });
  for (const value of ['0', -1, Number.NaN]) {
    const parsed = parseStatsResponse({ ...common, data: response(value) });
    assert.equal(parsed.salesAmtKrw, null);
    assert.equal(parsed.validity, 'malformed');
  }
});

test('stale or malformed cycleBaseTm cannot be valid trusted observation evidence', () => {
  const base = {
    entityId: 'cmp-100',
    timeIncrement: 'allDays',
    observedAtMs: Date.UTC(2026, 8, 11, 3, 0, 0),
    maxCycleAgeMs: 60 * 60 * 1000
  };
  const make = cycleBaseTm => ({
    summaryStatResponse: {
      data: [{ id: 'cmp-100', salesAmt: 77 }],
      cycleBaseTm
    }
  });

  assert.deepEqual(parseStatsResponse({ ...base, data: make('202609110000') }), {
    salesAmtKrw: 77,
    vatBasis: 'VAT_INCLUDED',
    cycleBaseTm: '202609110000',
    validity: 'stale'
  });
  assert.deepEqual(parseStatsResponse({ ...base, data: make('bad-cycle') }), {
    salesAmtKrw: null,
    vatBasis: 'VAT_INCLUDED',
    cycleBaseTm: 'bad-cycle',
    validity: 'malformed'
  });
});
