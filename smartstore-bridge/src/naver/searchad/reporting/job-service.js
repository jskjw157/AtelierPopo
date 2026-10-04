import { randomUUID } from 'node:crypto';
import { contentHash } from '../write/canonical.js';
import { exactKeys, scopedCustomer, validDate, utcTimestamp, assertReportingScope, validateIdentity, reportingError } from './contracts.js';
import { REPORT_TYPES } from './operations.js';
export function validateReportJobInput(input) {
  exactKeys(input, ['customerId','kind','reportType','statDate','fromTime','intentKey'], 'SEARCHAD_REPORT_INPUT_INVALID');
  scopedCustomer(input.customerId);
  if (typeof input.kind !== 'string' || !Object.hasOwn(REPORT_TYPES, input.kind) || !REPORT_TYPES[input.kind].includes(input.reportType) || typeof input.intentKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.intentKey)) throw reportingError('SEARCHAD_REPORT_INPUT_INVALID');
  if (input.kind === 'stat' ? (!validDate(input.statDate) || Object.hasOwn(input, 'fromTime')) : Object.hasOwn(input, 'statDate')) throw reportingError('SEARCHAD_REPORT_INPUT_INVALID');
  return { customerId: input.customerId, kind: input.kind, reportType: input.reportType, statDate: input.kind === 'stat' ? input.statDate : null, fromTime: input.fromTime === undefined ? null : utcTimestamp(input.fromTime), intentKey: input.intentKey };
}
function jobScope(input, context) {
  exactKeys(input, ['customerId','reportJobId'], 'SEARCHAD_REPORT_INPUT_INVALID'); scopedCustomer(input.customerId); assertReportingScope(input.customerId, context);
  if (typeof input.reportJobId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.reportJobId)) throw reportingError('SEARCHAD_REPORT_INPUT_INVALID');
  return input;
}
function processingState(status) { return status === 'BUILT' ? 'built' : ['ERROR','NONE'].includes(status) ? 'failed' : status === 'REGIST' ? 'registered' : 'polling'; }
export class ReportJobService {
  constructor({ repository, remote, identityResolver, clock = Date.now, config = { allowReportingJobs: false } }) { Object.assign(this, { repository, remote, identityResolver, clock, config }); }
  async identity(customerId, previous = null) {
    const identity = validateIdentity(await this.identityResolver(customerId), customerId);
    if (previous && contentHash(identity) !== contentHash(validateIdentity(previous, customerId))) throw reportingError('SEARCHAD_REPORTING_IDENTITY_CHANGED', 409);
    return identity;
  }
  async register(input, context) {
    const scope = validateReportJobInput(input); assertReportingScope(scope.customerId, context);
    const identity = await this.identity(scope.customerId);
    const requestHash = contentHash({ ...scope, ...identity });
    if (!this.config.allowReportingJobs) throw reportingError('SEARCHAD_REPORT_GATE_DISABLED', 503);
    let intent;
    try { intent = await this.repository.createReportIntent({ reportJobId: randomUUID(), ...scope, ...identity, requestHash, registeredByPrincipalId: context.principal.principalId, createdAt: new Date(this.clock()).toISOString() }); }
    catch (error) { if (error?.code === 'SEARCHAD_REPORT_INTENT_CONFLICT') throw error; throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
    // ONLY this invocation's acknowledged fresh creator owns dispatch. Persisted
    // planned rows cannot reconstruct that authority after a crash/COMMIT loss.
    const { created, dispatchPermit, ...job } = intent;
    if (created !== true || !dispatchPermit) return job;
    let claim;
    try { claim = await this.repository.claimReportDispatch({ customerId: scope.customerId, reportJobId: intent.reportJobId, requestHash, identity, dispatchPermit, now: this.clock() }); }
    catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
    if (!claim) return this.repository.getReportJob({ customerId: scope.customerId, reportJobId: intent.reportJobId });
    try {
      await this.identity(scope.customerId, identity);
      const registrationAttemptedAt = new Date(this.clock()).toISOString();
      const response = await this.remote.register(job);
      const registrationAcknowledgedAt = new Date(this.clock()).toISOString();
      await this.identity(scope.customerId, identity);
      let captured;
      try { captured = await this.repository.captureReportRegistration({ customerId: scope.customerId, reportJobId: intent.reportJobId, claimId: claim.claimId, remoteJobId: response.remoteJobId, reportCreatedAt: response.reportCreatedAt, remoteUpdatedAt: response.remoteUpdatedAt ?? null, registrationAttemptedAt, registrationInitiatedAt: response.registrationInitiatedAt ?? null, registrationAcknowledgedAt, identity, now: this.clock() }); }
      catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
      if (!captured?.remoteJobId) throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503);
      return await this.settle(captured, processingState(response.status), null, response.status, response);
    } catch (error) {
      try { await this.settle(claim, 'unknown_outcome', error?.code === 'SEARCHAD_REPORTING_STORAGE_FAILED' ? 'SEARCHAD_REPORTING_STORAGE_FAILED' : 'SEARCHAD_REPORT_REGISTRATION_UNRESOLVED'); } catch { /* Existing intent never dispatches again, even if storage remains unavailable. */ }
      if (error?.code === 'SEARCHAD_REPORTING_STORAGE_FAILED') throw error;
      throw reportingError('SEARCHAD_REPORT_REGISTRATION_UNRESOLVED', 502);
    }
  }
  async settle(row, state, lastErrorCode = null, status = null, response = null) {
    try { return await this.repository.settleReportJob({ customerId: row.customerId, reportJobId: row.reportJobId, claimId: row.claimId, processingState: state, lastErrorCode, ...(response ? { remoteUpdatedAt: response.remoteUpdatedAt ?? null, reportCreatedAt: response.reportCreatedAt ?? null } : {}), ...(status === 'ERROR' || status === 'NONE' ? { quality: 'failed' } : {}), now: this.clock() }); }
    catch { throw reportingError('SEARCHAD_REPORTING_STORAGE_FAILED', 503); }
  }
  async load(input, context) {
    jobScope(input, context);
    const row = await this.repository.getReportJob(input);
    if (!row) throw reportingError('SEARCHAD_REPORT_JOB_NOT_FOUND', 404);
    await this.identity(row.customerId, row); return row;
  }
  async poll(input, context) {
    const row = await this.load(input, context);
    if (!row.remoteJobId) throw reportingError('SEARCHAD_REPORT_REMOTE_ID_REQUIRED', 409);
    let response;
    try { response = await this.remote.get(row); await this.identity(row.customerId, row); } catch { throw reportingError('SEARCHAD_REPORT_POLL_FAILED', 502); }
    return this.settle(row, processingState(response.status), null, response.status, response);
  }
  async reconcile(input, context) {
    const row = await this.load(input, context);
    if (row.remoteJobId) return this.poll(input, context);
    let candidates;
    try { candidates = await this.remote.list(row); await this.identity(row.customerId, row); } catch { throw reportingError('SEARCHAD_REPORT_RECONCILE_FAILED', 502); }
    const settled = await this.settle(row, 'manual_review', 'SEARCHAD_REPORT_REMOTE_OWNERSHIP_UNPROVEN');
    return { ...settled, diagnostics: { candidateCount: candidates.length, ownershipEstablished: false, completeAbsenceProof: false } };
  }
}
