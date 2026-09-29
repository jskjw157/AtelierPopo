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
export function createPostgresMutationGateway({ gateway: source, pool } = {}) {
  async function mutate(operationKey, rawInput, canary) {
    const client = source?.client;
    const registry = source?.registry;
    const credentials = source?.credentialsRegistry;
    const config = source?.config;
    const fetchImpl = client?.fetchImpl;
    const execute = canary ? 'executeCanary' : 'execute';
    const check = canary ? 'canaryExecutionCheck' : 'executionCheck';
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
    const fence = new PostgresAccountSendFence({ pool, fetchImpl: (url, init) => Reflect.apply(fetchImpl, client, [url, init]) });
    const privateClient = new NaverSearchAdClient({
      baseUrl: ORIGIN, credentialsRegistry: credentials, clock: client.clock,
      requestTimeoutMs: client.requestTimeoutMs, maxRetries: 0, logger: client.logger,
      fetchImpl: async (url, init) => {
        const response = await fence.fetch(url, init);
        if (response.redirected || (response.status >= 300 && response.status < 400)) unavailable();
        return response;
      }
    });
    const gateway = new SearchAdOperationGateway({ client: privateClient, registry, credentialsRegistry: credentials, config, logger: source.logger });
    return fence.run(input.customerId, validate, () => gateway[execute](operationKey, input), operation.method);
  }

  return Object.freeze({
    get: key => source.get(key),
    preview: (key, input) => source.preview(key, input),
    execute(key, input = {}) {
      return source.get(key)?.sideEffect === false ? source.execute(key, input) : mutate(key, input, false);
    },
    executeCanary: (key, input = {}) => mutate(key, input, true)
  });
}
