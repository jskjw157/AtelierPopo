import { toPublicSearchAdError } from './gateway.js';

function hasRequiredPathParams(operation) {
  return (operation.parameters || []).some(item => item.in === 'path' && item.required);
}

function scoreProbe(operation) {
  const preferredDomains = ['campaign', 'business_channel', 'shared_budget', 'billing', 'account', 'label'];
  const index = preferredDomains.indexOf(operation.domain);
  return (index >= 0 ? index : 100) + ((operation.parameters || []).some(item => item.required) ? 20 : 0);
}

function stateFromResult(data) {
  if (Array.isArray(data) && data.length === 0) return 'supported_no_data';
  if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0) return 'supported_no_data';
  return 'supported';
}

function stateFromError(error) {
  const upstream = error.upstreamStatus || error.details?.upstreamStatus || error.status;
  if (upstream === 401) return 'authentication_failed';
  if (upstream === 403) return 'permission_required';
  if (upstream === 404) return 'not_found_or_ad_product_unavailable';
  if (upstream === 400) return 'invalid_probe_input';
  if (upstream === 429) return 'rate_limited';
  return 'unknown';
}

export class SearchAdCapabilityService {
  constructor({ gateway, config, clock = () => new Date() }) {
    this.gateway = gateway;
    this.config = config;
    this.clock = clock;
  }

  defaultPassiveOperations(limit = this.config.passiveProbeLimit) {
    return this.gateway.registry.manifest.operations
      .filter(item => item.runtimeAllowlisted && !item.sideEffect && ['GET', 'HEAD'].includes(item.method) && !hasRequiredPathParams(item))
      .sort((a, b) => scoreProbe(a) - scoreProbe(b) || a.operationKey.localeCompare(b.operationKey))
      .slice(0, limit)
      .map(item => item.operationKey);
  }

  async runPassive({ customerId, operations, inputs = {}, limit } = {}) {
    const requested = Array.isArray(operations) && operations.length
      ? operations.map(String)
      : this.defaultPassiveOperations(limit);
    if (!requested.length) {
      return { customerId, checkedAt: this.clock().toISOString(), results: [], summary: { supported: 0, failed: 0 } };
    }
    if (requested.length > 50) throw Object.assign(new Error('Passive capability probe supports at most 50 operations.'), { code: 'SEARCHAD_PROBE_LIMIT' });
    const results = [];
    for (const operationKey of requested) {
      try {
        const operation = this.gateway.get(operationKey);
        if (operation.sideEffect) {
          results.push({ operationKey, state: 'rejected_write_probe', supported: false });
          continue;
        }
        const result = await this.gateway.execute(operationKey, {
          customerId,
          ...(inputs[operationKey] || {})
        });
        results.push({
          operationKey,
          capabilityKey: operation.capabilityKey,
          state: stateFromResult(result.data),
          supported: true,
          evidence: 'live_passive',
          upstreamStatus: result.upstream.status,
          requestId: result.upstream.requestId,
          checkedAt: this.clock().toISOString()
        });
      } catch (error) {
        results.push({
          operationKey,
          state: stateFromError(error),
          supported: false,
          evidence: 'live_passive',
          error: toPublicSearchAdError(error),
          checkedAt: this.clock().toISOString()
        });
      }
    }
    const summary = results.reduce((acc, item) => {
      if (item.supported) acc.supported += 1; else acc.failed += 1;
      acc.states[item.state] = (acc.states[item.state] || 0) + 1;
      return acc;
    }, { supported: 0, failed: 0, states: {} });
    return { customerId, checkedAt: this.clock().toISOString(), operationCount: results.length, results, summary };
  }
}

export const _internal = { hasRequiredPathParams, scoreProbe, stateFromResult, stateFromError };
