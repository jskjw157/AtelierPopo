import { ReportDownloadTransport } from '../transport/report-download.js';
import { ReportDownloadAdapter } from './download-adapter.js';
import { ReportIngestionService } from './ingestion-service.js';
import { SpendEvidenceService } from './spend-evidence-service.js';
import { createPostgresMutationGateway } from '../lifecycle/postgres-mutation-gateway.js';
import { ReportRemoteAdapter } from './remote-adapter.js';
import { ReportJobService } from './job-service.js';
import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { PostgresReportingRepository } from './postgres-repository.js';
import { StatsObservationService } from './stats-service.js';
import { currentReportingIdentity, reportingError } from './contracts.js';
export async function createReportingRuntime({ pool, repository = null, blobStorage = null, gateway, registry = gateway?.registry, credentialsRegistry = gateway?.credentialsRegistry, config = gateway?.config, reportingConfig = { enabled: true, allowReportingJobs: false }, identityResolver = customerId => currentReportingIdentity({ customerId, registry, credentialsRegistry, config }), clock = Date.now, closeOwnedResources = async () => {} } = {}) {
  let closing = false, closePromise;
  const active = new Set();
  const reportingRepository = repository || (pool && new PostgresReportingRepository({ pool, clock }));
  const enabled = reportingConfig.enabled === true;
  if (enabled && (!reportingRepository || !gateway?.client?.fetchImpl || !registry || !credentialsRegistry || typeof identityResolver !== 'function')) throw reportingError('SEARCHAD_REPORTING_DEPENDENCIES_REQUIRED', 503);
  const reportingGateway = enabled && new SearchAdOperationGateway({
    registry, credentialsRegistry, config,
    client: new NaverSearchAdClient({ baseUrl: 'https://api.searchad.naver.com', credentialsRegistry, fetchImpl: gateway.client.fetchImpl, clock, requestTimeoutMs: gateway.client.requestTimeoutMs, maxRetries: 0, redirectPolicy: 'error', logger: gateway.client.logger })
  });
  const collector = enabled && new StatsObservationService({ repository: reportingRepository, gateway: reportingGateway, identityResolver, clock });
  const reportJobsAvailable = enabled && typeof pool?.connect === 'function' && typeof reportingRepository?.createReportIntent === 'function';
  if (enabled && reportingConfig.allowReportingJobs && !reportJobsAvailable) throw reportingError('SEARCHAD_REPORTING_DEPENDENCIES_REQUIRED', 503);
  const jobService = reportJobsAvailable && new ReportJobService({ repository: reportingRepository, remote: new ReportRemoteAdapter({ gateway: createPostgresMutationGateway({ gateway: reportingGateway, pool }), registry }), identityResolver, clock, config: reportingConfig });
  const ingestionAvailable = Boolean(jobService && blobStorage?.put && blobStorage?.get && reportingConfig.generationPolicy && (!reportingConfig.production || blobStorage.durableProduction));
  const ingestion = ingestionAvailable && new ReportIngestionService({ repository: reportingRepository, jobService, storage: blobStorage, downloadAdapter: new ReportDownloadAdapter({ jobService, transport: new ReportDownloadTransport({ client: reportingGateway.client, maxBytes: reportingConfig.maxDownloadBytes }), identityResolver, clock }), clock, generationPolicy: reportingConfig.generationPolicy });
  const spendEvidence = ingestionAvailable && new SpendEvidenceService({ repository: reportingRepository, jobService, identityResolver, clock });
  function track(task) {
    if (closing) return Promise.reject(reportingError('SEARCHAD_REPORTING_NOT_READY', 503));
    const promise = task(); active.add(promise);
    promise.then(() => active.delete(promise), () => active.delete(promise)); return promise;
  }
  const runtime = {
    config: reportingConfig,
    repository: enabled ? reportingRepository : null,
    statsService: enabled ? { collect(input, context) {
      if (closing) return Promise.reject(reportingError('SEARCHAD_REPORTING_NOT_READY', 503));
      const promise = collector.collect(input, context); active.add(promise);
      promise.then(() => active.delete(promise), () => active.delete(promise));
      return promise;
    } } : null,
    jobService: jobService ? Object.fromEntries(['register','poll','reconcile'].map(method => [method, (input, context) => track(() => jobService[method](input, context))])) : null,
    ingestionService: ingestion ? Object.fromEntries(['ingest','archived'].map(method => [method,(input,context)=>track(()=>ingestion[method](input,context))])) : null,
    spendEvidenceService: spendEvidence ? { evaluateGeneration: (input,context)=>track(()=>spendEvidence.evaluateGeneration(input,context)) } : null,
    identityResolver,
    status() { return { enabled, ready: enabled && !closing && (!reportingConfig.ingestionRequired || ingestionAvailable), storage: { runtime: 'postgres', schemaReady: enabled }, reporting: { stats: enabled, metrics: ingestionAvailable ? 'available' : 'unavailable', ingestion: ingestionAvailable, reportJobs: Boolean(reportJobsAvailable) } }; },
    close() {
      if (!closePromise) { closing = true; closePromise = (async () => { await Promise.allSettled([...active]); await closeOwnedResources(); })(); }
      return closePromise;
    }
  };
  return runtime;
}
