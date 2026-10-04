import fs from 'node:fs';
import { reportingError } from './contracts.js';
const manifest = JSON.parse(fs.readFileSync(new URL('../../../../specs/naver-searchad/current.json', import.meta.url)));
const stat = JSON.parse(fs.readFileSync(new URL('../../../../specs/naver-searchad/source/swagger/ncc-report.json', import.meta.url)));
const master = JSON.parse(fs.readFileSync(new URL('../../../../specs/naver-searchad/source/swagger/master-report.json', import.meta.url)));
export const REPORT_TYPES = Object.freeze({ stat: Object.freeze([...stat.definitions.StatReportJob.properties.reportTp.enum]), master: Object.freeze([...master.definitions.RequestJob.properties.item.enum]) });
export const REPORT_STATUSES = Object.freeze({ stat: Object.freeze([...stat.definitions.ReportJobResponse.properties.status.enum]), master: Object.freeze([...master.definitions.MasterReportJob.properties.status.enum]) });
export const REPORT_OPERATION_CONTRACTS = Object.freeze({
  registerStat: Object.freeze({ kind: 'stat', sourceId: 'report', sourceOperationId: 'registerReportJobUsingPOST', method: 'POST', path: '/stat-reports' }),
  getStat: Object.freeze({ kind: 'stat', sourceId: 'report', sourceOperationId: 'getReportJobByReportJobIdUsingGET', method: 'GET', path: '/stat-reports/{reportJobId}' }),
  listStat: Object.freeze({ kind: 'stat', sourceId: 'report', sourceOperationId: 'getReportJobListUsingGET', method: 'GET', path: '/stat-reports' }),
  registerMaster: Object.freeze({ kind: 'master', sourceId: 'master-report', sourceOperationId: 'createMasterReport', method: 'POST', path: '/master-reports' }),
  getMaster: Object.freeze({ kind: 'master', sourceId: 'master-report', sourceOperationId: 'getMasterReport', method: 'GET', path: '/master-reports/{id}' }),
  listMaster: Object.freeze({ kind: 'master', sourceId: 'master-report', sourceOperationId: 'getAllMasterReports', method: 'GET', path: '/master-reports' })
});
export function resolveReportOperationKeys(registry) {
  const operations = registry?.manifest?.operations;
  if (!Array.isArray(operations)) throw reportingError('SEARCHAD_REPORT_CONTRACT_INVALID', 503);
  return Object.freeze(Object.fromEntries(Object.entries(REPORT_OPERATION_CONTRACTS).map(([name, contract]) => {
    const matches = operations.filter(op => op.sourceOperationId === contract.sourceOperationId);
    const op = matches[0];
    if (matches.length !== 1 || op.sourceId !== contract.sourceId || op.method !== contract.method || op.path !== contract.path || op.sideEffect !== (contract.method === 'POST') || operations.filter(other => other.method === contract.method && other.path === contract.path).length !== 1) throw reportingError('SEARCHAD_REPORT_CONTRACT_INVALID', 503);
    return [name, op.operationKey];
  })));
}
export const REPORT_OPERATION_KEYS = resolveReportOperationKeys({ manifest });
export function assertReportOperation(operation, registry, { registration = false } = {}) {
  const keys = resolveReportOperationKeys(registry);
  const name = Object.keys(keys).find(name => keys[name] === operation?.operationKey && REPORT_OPERATION_KEYS[name] === keys[name]);
  const contract = REPORT_OPERATION_CONTRACTS[name];
  if (!contract || (registration && contract.method !== 'POST') || operation.specRef !== registry.status().specRef || operation.method !== contract.method || operation.path !== contract.path || operation.sourceOperationId !== contract.sourceOperationId || operation.sourceId !== contract.sourceId) throw reportingError('SEARCHAD_REPORT_OPERATION_FORBIDDEN', 403);
  return contract;
}
