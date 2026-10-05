import { circuitError } from '../circuit/postgres-repository.js';
import { createCircuitDispatch, currentCircuitWriteContext } from '../circuit/service.js';
import { isDeepStrictEqual } from 'node:util';
import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { credentialFingerprintForCustomer } from '../canary/credential-fingerprint.js';
import { SearchAdWriteError } from '../write/errors.js';
import { PostgresAccountSendFence } from './postgres-account-send-fence.js';

const ORIGIN = 'https://api.searchad.naver.com';
function unavailable() {
  throw new SearchAdWriteError('SEARCHAD_SEND_GATEWAY_UNAVAILABLE', 'A supported account-fenced SearchAd transport is required.', {}, 503);
}

/**
 * Private PostgreSQL mutation adapter. Does not alter the shared gateway/client,
 * authorize an operation, or replace approval, activation, risk or intent checks.
 * Reads retain their original path. Validation is lazy so read-only construction
 * works without a writable transport; mutation NEVER falls back to that path.
 */
export function createPostgresMutationGateway({ gateway: source, pool, circuitGuard = null, requireWriteOwner = false, ordinaryStoreReady = true } = {}) {
  async function mutate(operationKey, rawInput, canary) {
    const client = source?.client;
    const registry = source?.registry;
    const credentials = source?.credentialsRegistry;
    const config = source?.config;
    const fetchImpl = client?.fetchImpl;
    const execute = canary === 'report' ? 'executeReportJob' : canary ? 'executeCanary' : 'execute';
    const check = canary === 'report' ? 'reportExecutionCheck' : canary ? 'canaryExecutionCheck' : 'executionCheck';
    if (!(source instanceof SearchAdOperationGateway) || !(client instanceof NaverSearchAdClient) ||
        source[execute] !== SearchAdOperationGateway.prototype[execute] ||
        source[check] !== SearchAdOperationGateway.prototype[check] ||
        client.request !== NaverSearchAdClient.prototype.request ||
        typeof fetchImpl !== 'function' || typeof pool?.connect !== 'function' || typeof pool?.query !== 'function' ||
        typeof registry?.status !== 'function' || typeof credentials?.resolve !== 'function' ||
        client.credentialsRegistry !== credentials || client.baseUrl !== ORIGIN || config?.baseUrl !== ORIGIN) unavailable();
    let input, operation, specSha, credential;
    try {
      input = structuredClone(rawInput);
      operation = structuredClone(source.get(operationKey));
      specSha = registry.status().specRef;
      credential = credentialFingerprintForCustomer(credentials, input.customerId);
    } catch { unavailable(); }
    if (typeof input?.customerId !== 'string' || !/^\d{1,30}$/.test(input.customerId) ||
        typeof specSha !== 'string' || !specSha || operation?.operationKey !== operationKey ||
        operation.sideEffect !== true || !['POST', 'PUT', 'DELETE'].includes(operation.method)) unavailable();

    const binding = currentCircuitWriteContext();
    const owned = binding?.customerId === input.customerId ? binding : {};
    const entity = Object.entries(input.pathParams || {})[0];
    const budget = input.body?.dailyBudget, prior = owned.before?.dailyBudget;
    const stoppedCanary = canary === true && owned.canaryRunId && input.body?.userLock === true;
    // Only a known reduction/lock or unchanged field is proven non-increasing.
    // Unknown fields, batches, absent trusted prior and ordinary creates retain
    // the increase evidence requirement; callers cannot supply a classification.
    const reduction = operation.method === 'PUT' && input.body && !Array.isArray(input.body) &&
      Object.entries(input.body).every(([key, value]) =>
        (!['dailyBudget', 'bidAmt'].includes(key) && isDeepStrictEqual(value, owned.before?.[key])) ||
        (key === 'userLock' && value === true) ||
        (['dailyBudget', 'bidAmt'].includes(key) && Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(owned.before?.[key]) && owned.before[key] >= 0 && value <= owned.before[key]));
    const increase = !stoppedCanary && operation.method !== 'DELETE' && !reduction;
    const dispatch = createCircuitDispatch({ customerId: input.customerId,
      purpose: canary === 'report' ? 'report_registration' : owned.purpose === 'rollback' ? 'rollback' : canary ? 'canary' : 'ordinary',
      operationKey, entityType: entity?.[0]?.replace(/Id$/, '') || 'campaign', entityId: entity?.[1] || input.body?.nccCampaignId || owned.planId || owned.canaryRunId || 'unresolved',
      actionClass: increase ? 'increase' : 'mutation', ...(increase ? { incrementalSpendKrw: Number.isSafeInteger(budget) && budget >= 0 && Number.isSafeInteger(prior) && prior >= 0 ? Math.max(0, budget - prior) : null } : {})
    }, owned);
    if (circuitGuard) await circuitGuard.prepareDispatch(dispatch);

    const validate = () => {
      try {
        if (source.client !== client || source.registry !== registry || source.config !== config ||
            source.credentialsRegistry !== credentials || client.credentialsRegistry !== credentials ||
            client.fetchImpl !== fetchImpl || client.baseUrl !== ORIGIN || config.baseUrl !== ORIGIN ||
            source[execute] !== SearchAdOperationGateway.prototype[execute] ||
            source[check] !== SearchAdOperationGateway.prototype[check] ||
            registry.status().specRef !== specSha || !isDeepStrictEqual(source.get(operationKey), operation) ||
            credentialFingerprintForCustomer(credentials, input.customerId) !== credential) unavailable();
        source[check](operation, input);
      } catch { unavailable(); }
    };
    let initiatedAt = null, boundaryFailure = null;
    const fence = new PostgresAccountSendFence({ pool, fetchImpl: (url, init) => {
      if (canary === 'report') initiatedAt = new Date(client.clock()).toISOString();
      return Reflect.apply(fetchImpl, client, [url, init]);
    } });
    const privateClient = new NaverSearchAdClient({
      baseUrl: ORIGIN, credentialsRegistry: credentials, clock: client.clock,
      requestTimeoutMs: client.requestTimeoutMs, maxRetries: 0, logger: client.logger, redirectPolicy: 'error',
      fetchImpl: async (url, init) => {
        let response;
        try { response = await fence.fetch(url, init); }
        catch (error) { if (error instanceof SearchAdWriteError) boundaryFailure = error; throw error; }
        if (response.redirected || (response.status >= 300 && response.status < 400)) unavailable();
        return response;
      }
    });
    const gateway = new SearchAdOperationGateway({ client: privateClient, registry, credentialsRegistry: credentials, config, logger: source.logger });
    let result;
    try { result = await fence.run(input.customerId, validate, () => gateway[execute](operationKey, input), operation.method, circuitGuard ? { dispatch, beforeSend: (store, d) => {
      if (!canary && (!ordinaryStoreReady || (requireWriteOwner && !owned.planId))) throw circuitError('SOURCE_STORE_REQUIRED');
      return circuitGuard.assertDispatchAllowed(d, { client: store, now: client.clock() });
    } } : {}); } catch (error) { throw boundaryFailure || error; }
    return canary === 'report' ? { ...result, upstream: { ...result.upstream, initiatedAt } } : result;
  }

  return Object.freeze({
    get: key => source.get(key),
    preview: (key, input) => source.preview(key, input),
    execute(key, input = {}) {
      return source.get(key)?.sideEffect === false ? source.execute(key, input) : mutate(key, input, false);
    },
    consumeReportDownloadResponse: (key, input, consume) => source.consumeReportDownloadResponse(key, input, consume),
    executeCanary: (key, input = {}) => mutate(key, input, true),
    executeReportJob: (key, input = {}) => mutate(key, input, 'report')
  });
}
