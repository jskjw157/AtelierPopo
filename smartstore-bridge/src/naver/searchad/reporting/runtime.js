import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { PostgresReportingRepository } from './postgres-repository.js';
import { StatsObservationService } from './stats-service.js';
import { currentReportingIdentity, reportingError } from './contracts.js';
export async function createReportingRuntime({ pool, repository = null, gateway, registry = gateway?.registry, credentialsRegistry = gateway?.credentialsRegistry, config = gateway?.config, reportingConfig = { enabled: true, allowReportingJobs: false }, identityResolver = customerId => currentReportingIdentity({ customerId, registry, credentialsRegistry, config }), clock = Date.now, closeOwnedResources = async () => {} } = {}) {
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
  const runtime = {
    config: reportingConfig,
    repository: enabled ? reportingRepository : null,
    statsService: enabled ? { collect(input, context) {
      if (closing) return Promise.reject(reportingError('SEARCHAD_REPORTING_NOT_READY', 503));
      const promise = collector.collect(input, context); active.add(promise);
      promise.then(() => active.delete(promise), () => active.delete(promise));
      return promise;
    } } : null,
    status() { return { enabled, ready: enabled && !closing, storage: { runtime: 'postgres', schemaReady: enabled }, reporting: { stats: enabled, metrics: 'unavailable', reportJobs: false } }; },
    close() {
      if (!closePromise) { closing = true; closePromise = (async () => { await Promise.allSettled([...active]); await closeOwnedResources(); })(); }
      return closePromise;
    }
  };
  return runtime;
}
