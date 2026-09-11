import { SearchAdWriteError } from '../write/errors.js';

export const SEARCHAD_REPORTING_OPERATIONS = Object.freeze({
  stat: Object.freeze({
    single: 'report.get.get_single_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_id_time_increment_time_range',
    bulk: 'report.get.get_bulk_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_ids_time_increment_time_range'
  }),
  statReport: Object.freeze({
    create: 'report.post.register_report_job_using_post__p_stat_reports',
    list: 'report.get.get_report_job_list_using_get__p_stat_reports',
    get: 'report.get.get_report_job_by_report_job_id_using_get__p_stat_reports_report_job_id'
  }),
  masterReport: Object.freeze({
    create: 'master_report.post.create_master_report__p_master_reports',
    list: 'master_report.get.get_all_master_reports__p_master_reports',
    get: 'master_report.get.get_master_report__p_master_reports_id'
  })
});

const PINNED_KEYS = new Set([
  ...Object.values(SEARCHAD_REPORTING_OPERATIONS.stat),
  ...Object.values(SEARCHAD_REPORTING_OPERATIONS.statReport),
  ...Object.values(SEARCHAD_REPORTING_OPERATIONS.masterReport)
]);

function fail(code, message, details = {}) {
  throw new SearchAdWriteError(code, message, details, 409);
}

export function assertReportingOperation(gatewayOrRegistry, operationKey, { sideEffect } = {}) {
  const key = String(operationKey || '').trim();
  if (!PINNED_KEYS.has(key)) {
    fail('SEARCHAD_REPORTING_OPERATION_UNVERIFIED', 'SearchAd reporting operation is not part of the pinned reporting contract.', {
      operationKey: key || null
    });
  }

  let operation;
  try {
    operation = gatewayOrRegistry?.get?.(key);
  } catch {
    operation = null;
  }
  if (
    !operation ||
    operation.runtimeAllowlisted !== true ||
    String(operation.state || '') !== 'public_documented' ||
    String(operation.tier || '') !== 'B'
  ) {
    fail('SEARCHAD_REPORTING_OPERATION_UNVERIFIED', 'SearchAd reporting operation is no longer a verified public runtime operation.', {
      operationKey: key
    });
  }
  if (typeof sideEffect === 'boolean' && Boolean(operation.sideEffect) !== sideEffect) {
    fail('SEARCHAD_REPORTING_OPERATION_EFFECT_MISMATCH', 'SearchAd reporting operation side-effect classification does not match the required contract.', {
      operationKey: key,
      expectedSideEffect: sideEffect,
      actualSideEffect: Boolean(operation.sideEffect)
    });
  }
  return operation;
}

export const _internal = { PINNED_KEYS };
