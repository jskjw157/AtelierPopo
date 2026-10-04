import { REPORT_OPERATION_KEYS, REPORT_STATUSES, resolveReportOperationKeys, assertReportOperation } from './operations.js';
import { exactKeys, reportingError, utcTimestamp } from './contracts.js';
function invalid() { throw reportingError('SEARCHAD_REPORT_RESPONSE_INVALID', 502); }
export function parseReportResponse(data, intent, { knownId = null } = {}) {
  const stat = intent.kind === 'stat';
  try { exactKeys(data, stat ? ['reportJobId','reportTp','statDt','status','updateTm','downloadUrl'] : ['id','item','fromTime','status','updateTime','downloadUrl'], 'SEARCHAD_REPORT_RESPONSE_INVALID'); } catch { invalid(); }
  const rawId = stat ? data.reportJobId : data.id;
  if (stat ? (!Number.isSafeInteger(rawId) || rawId <= 0) : (typeof rawId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(rawId))) invalid();
  const remoteJobId = String(rawId);
  const reportType = stat ? data.reportTp : data.item;
  if (reportType !== intent.reportType || !REPORT_STATUSES[intent.kind]?.includes(data.status) || (knownId !== null && remoteJobId !== knownId) || (data.downloadUrl !== undefined && typeof data.downloadUrl !== 'string')) invalid();
  if (stat) {
    const statTime = utcTimestamp(data.statDt, 'SEARCHAD_REPORT_RESPONSE_INVALID', 502);
    if (new Date(Date.parse(statTime) + 9 * 3600_000).toISOString().slice(0,10) !== intent.statDate) invalid();
  } else if (data.fromTime !== undefined && utcTimestamp(data.fromTime, 'SEARCHAD_REPORT_RESPONSE_INVALID', 502) !== intent.fromTime) invalid();
  const timestamp = stat ? data.updateTm : data.updateTime;
  const reportCreatedAt = timestamp === undefined ? null : utcTimestamp(timestamp, 'SEARCHAD_REPORT_RESPONSE_INVALID', 502);
  return { remoteJobId, reportType, status: data.status, reportCreatedAt: stat ? null : reportCreatedAt, remoteUpdatedAt: stat ? reportCreatedAt : null };
}
export class ReportRemoteAdapter {
  constructor({ gateway, registry }) {
    Object.assign(this, { gateway, registry });
    const keys = resolveReportOperationKeys(registry);
    if (Object.keys(keys).some(key => keys[key] !== REPORT_OPERATION_KEYS[key])) throw reportingError('SEARCHAD_REPORT_CONTRACT_INVALID', 503);
  }
  async register(intent) {
    const key = intent.kind === 'stat' ? REPORT_OPERATION_KEYS.registerStat : REPORT_OPERATION_KEYS.registerMaster;
    assertReportOperation(this.registry.get(key), this.registry, { registration: true });
    const body = intent.kind === 'stat' ? { reportTp: intent.reportType, statDt: intent.statDate.replaceAll('-', '') } : { item: intent.reportType, ...(intent.fromTime ? { fromTime: intent.fromTime } : {}) };
    const result = await this.gateway.executeReportJob(key, { customerId: intent.customerId, body });
    return { ...parseReportResponse(result.data, intent), registrationInitiatedAt: result.upstream?.initiatedAt ? utcTimestamp(result.upstream.initiatedAt, 'SEARCHAD_REPORT_RESPONSE_INVALID', 502) : null };
  }
  async get(intent) {
    if (!intent.remoteJobId) throw reportingError('SEARCHAD_REPORT_REMOTE_ID_REQUIRED', 409);
    const key = intent.kind === 'stat' ? REPORT_OPERATION_KEYS.getStat : REPORT_OPERATION_KEYS.getMaster;
    assertReportOperation(this.registry.get(key), this.registry);
    const pathParams = intent.kind === 'stat' ? { reportJobId: intent.remoteJobId } : { id: intent.remoteJobId };
    return parseReportResponse((await this.gateway.execute(key, { customerId: intent.customerId, pathParams })).data, intent, { knownId: intent.remoteJobId });
  }
  async list(intent) {
    const key = intent.kind === 'stat' ? REPORT_OPERATION_KEYS.listStat : REPORT_OPERATION_KEYS.listMaster;
    assertReportOperation(this.registry.get(key), this.registry);
    const data = (await this.gateway.execute(key, { customerId: intent.customerId })).data;
    if (!Array.isArray(data) || data.length > 10000 || (intent.kind === 'master' && data.length > 100)) invalid();
    // Diagnostics only. Even a single exact type/date match has no ownership.
    return data.flatMap(row => { try { return [parseReportResponse(row, intent)]; } catch { return []; } });
  }
}
