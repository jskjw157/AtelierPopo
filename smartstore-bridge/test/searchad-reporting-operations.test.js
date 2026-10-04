import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { loadSearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import {
  SEARCHAD_REPORTING_OPERATIONS,
  assertReportingOperation
} from '../src/naver/searchad/reporting/operations.js';

const manifestPath = fileURLToPath(new URL('../specs/naver-searchad/current.json', import.meta.url));
const registry = loadSearchAdSpecRegistry(manifestPath);

test('reporting operation keys are pinned to checked-in stat and report Swagger contracts', () => {
  assert.deepEqual(SEARCHAD_REPORTING_OPERATIONS, {
    stat: {
      single: 'report.get.get_single_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_id_time_increment_time_range',
      bulk: 'report.get.get_bulk_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_ids_time_increment_time_range'
    },
    statReport: {
      create: 'report.post.register_report_job_using_post__p_stat_reports',
      list: 'report.get.get_report_job_list_using_get__p_stat_reports',
      get: 'report.get.get_report_job_by_report_job_id_using_get__p_stat_reports_report_job_id'
    },
    masterReport: {
      create: 'master_report.post.create_master_report__p_master_reports',
      list: 'master_report.get.get_all_master_reports__p_master_reports',
      get: 'master_report.get.get_master_report__p_master_reports_id'
    }
  });
});

test('every pinned reporting operation remains public documented tier B and runtime allowlisted', () => {
  const reads = [
    SEARCHAD_REPORTING_OPERATIONS.stat.single,
    SEARCHAD_REPORTING_OPERATIONS.stat.bulk,
    SEARCHAD_REPORTING_OPERATIONS.statReport.list,
    SEARCHAD_REPORTING_OPERATIONS.statReport.get,
    SEARCHAD_REPORTING_OPERATIONS.masterReport.list,
    SEARCHAD_REPORTING_OPERATIONS.masterReport.get
  ];
  const creates = [
    SEARCHAD_REPORTING_OPERATIONS.statReport.create,
    SEARCHAD_REPORTING_OPERATIONS.masterReport.create
  ];

  for (const key of reads) {
    const operation = assertReportingOperation(registry, key, { sideEffect: false });
    assert.equal(operation.state, 'public_documented');
    assert.equal(operation.tier, 'B');
    assert.equal(operation.runtimeAllowlisted, true);
    assert.equal(operation.sideEffect, false);
  }
  for (const key of creates) {
    const operation = assertReportingOperation(registry, key, { sideEffect: true });
    assert.equal(operation.state, 'public_documented');
    assert.equal(operation.tier, 'B');
    assert.equal(operation.runtimeAllowlisted, true);
    assert.equal(operation.sideEffect, true);
  }
});

test('reporting operation guard fails closed for unknown or mismatched side-effect descriptors', () => {
  assert.throws(
    () => assertReportingOperation(registry, 'caller.fake.report', { sideEffect: false }),
    error => error?.code === 'SEARCHAD_REPORTING_OPERATION_UNVERIFIED' && error?.status === 409
  );
  assert.throws(
    () => assertReportingOperation(registry, SEARCHAD_REPORTING_OPERATIONS.statReport.create, { sideEffect: false }),
    error => error?.code === 'SEARCHAD_REPORTING_OPERATION_EFFECT_MISMATCH' && error?.status === 409
  );
});
