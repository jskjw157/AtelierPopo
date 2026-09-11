import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fingerprintOrderedColumns,
  classifyReportSchema
} from '../src/naver/searchad/reporting/report-schema.js';

const COLUMNS = ['campaignId', 'adgroupId', 'salesAmt'];

test('ordered report columns produce a deterministic SHA-256 fingerprint and order changes the identity', () => {
  const first = fingerprintOrderedColumns(COLUMNS);
  const second = fingerprintOrderedColumns([...COLUMNS]);
  const reordered = fingerprintOrderedColumns(['adgroupId', 'campaignId', 'salesAmt']);
  const changed = fingerprintOrderedColumns(['campaignId', 'adgroupId', 'salesAmount']);

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(second, first);
  assert.notEqual(reordered, first);
  assert.notEqual(changed, first);
});

test('report column fingerprint fails closed for empty duplicate or malformed headers', () => {
  for (const columns of [
    [],
    ['campaignId', 'campaignId'],
    ['campaignId', ''],
    ['campaignId', ' salesAmt'],
    ['campaignId', 123],
    'campaignId,salesAmt'
  ]) {
    assert.throws(
      () => fingerprintOrderedColumns(columns),
      error => error?.code === 'SEARCHAD_REPORT_SCHEMA_INVALID'
    );
  }
});

test('exact fingerprint plus report kind/type maps only an explicitly known schema to trusted semantics', () => {
  const schemaSha256 = fingerprintOrderedColumns(COLUMNS);
  const known = {
    schemaSha256,
    reportKind: 'stat',
    reportType: 'AD_DETAIL',
    orderedColumns: COLUMNS,
    semanticMapping: {
      campaignId: 'campaign_id',
      adgroupId: 'adgroup_id',
      salesAmt: 'spend_krw_vat_included'
    },
    state: 'known'
  };

  const result = classifyReportSchema({
    reportKind: 'stat',
    reportType: 'AD_DETAIL',
    columns: COLUMNS,
    knownSchemas: [known]
  });

  assert.equal(result.schemaSha256, schemaSha256);
  assert.equal(result.state, 'known');
  assert.equal(result.trusted, true);
  assert.deepEqual(result.semanticMapping, known.semanticMapping);
  assert.equal(result.quarantineReason, null);
});

test('reordered unknown or changed columns are distinct schemas and are quarantined rather than guessed', () => {
  const known = {
    schemaSha256: fingerprintOrderedColumns(COLUMNS),
    reportKind: 'stat',
    reportType: 'AD_DETAIL',
    orderedColumns: COLUMNS,
    semanticMapping: { salesAmt: 'spend_krw_vat_included' },
    state: 'known'
  };

  for (const columns of [
    ['adgroupId', 'campaignId', 'salesAmt'],
    ['campaignId', 'adgroupId', 'salesAmt', 'unknownColumn'],
    ['campaignId', 'adgroupId', 'salesAmount']
  ]) {
    const result = classifyReportSchema({
      reportKind: 'stat',
      reportType: 'AD_DETAIL',
      columns,
      knownSchemas: [known]
    });
    assert.notEqual(result.schemaSha256, known.schemaSha256);
    assert.equal(result.state, 'quarantined');
    assert.equal(result.trusted, false);
    assert.deepEqual(result.semanticMapping, {});
    assert.equal(result.quarantineReason, 'unknown_schema');
  }
});

test('same header fingerprint cannot cross report kind/type boundary or escape a quarantined registry record', () => {
  const schemaSha256 = fingerprintOrderedColumns(COLUMNS);
  const known = {
    schemaSha256,
    reportKind: 'stat',
    reportType: 'AD_DETAIL',
    orderedColumns: COLUMNS,
    semanticMapping: { salesAmt: 'spend_krw_vat_included' },
    state: 'known'
  };
  const quarantined = { ...known, state: 'quarantined', quarantineReason: 'manual_review' };

  const wrongType = classifyReportSchema({
    reportKind: 'stat', reportType: 'AD', columns: COLUMNS, knownSchemas: [known]
  });
  assert.equal(wrongType.state, 'quarantined');
  assert.equal(wrongType.trusted, false);

  const wrongKind = classifyReportSchema({
    reportKind: 'master', reportType: 'Campaign', columns: COLUMNS, knownSchemas: [known]
  });
  assert.equal(wrongKind.state, 'quarantined');
  assert.equal(wrongKind.trusted, false);

  const registryQuarantine = classifyReportSchema({
    reportKind: 'stat', reportType: 'AD_DETAIL', columns: COLUMNS, knownSchemas: [quarantined]
  });
  assert.equal(registryQuarantine.state, 'quarantined');
  assert.equal(registryQuarantine.trusted, false);
  assert.deepEqual(registryQuarantine.semanticMapping, {});
  assert.equal(registryQuarantine.quarantineReason, 'manual_review');
});
