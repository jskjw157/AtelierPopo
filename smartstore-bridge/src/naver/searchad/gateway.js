import crypto from 'node:crypto';
import { redactSearchAdObject, SearchAdError } from './errors.js';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function interpolatePath(operation, pathParams = {}) {
  const required = (operation.parameters || []).filter(item => item.in === 'path');
  let result = operation.path;
  for (const item of required) {
    const value = pathParams[item.name];
    if (value === undefined || value === null || String(value) === '') {
      const error = new SearchAdGatewayError('SEARCHAD_PATH_PARAM_REQUIRED', `Missing SearchAd path parameter: ${item.name}`, { status: 400 });
      error.details = { parameter: item.name };
      throw error;
    }
    result = result.replace(new RegExp(`\\{${item.name}\\}`, 'g'), encodeURIComponent(String(value)));
  }
  if (/\{[^}]+\}/.test(result)) {
    throw new SearchAdGatewayError('SEARCHAD_UNRESOLVED_PATH_TEMPLATE', `Unresolved SearchAd path template: ${result}`, { status: 400 });
  }
  return result;
}

function gateEnabled(config, gate) {
  const map = {
    reads: config.allowReads,
    writes: config.allowWrites,
    creates: config.allowCreates,
    batchWrites: config.allowBatchWrites,
    deletes: config.allowDeletes,
    rollbacks: config.allowRollbacks
  };
  return Boolean(map[gate]);
}

function resourceKey(customerId, operation, input) {
  const pathValues = Object.values(input.pathParams || {}).map(String).filter(Boolean);
  const natural = pathValues[0] || input.body?.name || input.json?.name || operation.operationKey;
  return `searchad:${customerId}:${operation.domain}:${String(natural).slice(0, 128)}`;
}

export class SearchAdGatewayError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = 'SearchAdGatewayError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class SearchAdOperationGateway {
  constructor({ client, config, registry, credentialsRegistry, logger = console }) {
    this.client = client;
    this.config = config;
    this.registry = registry;
    this.credentialsRegistry = credentialsRegistry;
    this.logger = logger;
  }

  status() {
    return {
      ...this.registry.status(),
      enabled: this.config.enabled,
      configured: this.config.configured,
      gates: {
        reads: this.config.allowReads,
        writes: this.config.allowWrites,
        creates: this.config.allowCreates,
        batchWrites: this.config.allowBatchWrites,
        rollbacks: this.config.allowRollbacks,
        deletes: this.config.allowDeletes,
        activeCanary: this.config.allowActiveCanary,
        unverifiedOperations: this.config.allowUnverifiedOperations
      },
      automationMode: this.config.automationMode,
      credentials: this.credentialsRegistry.status()
    };
  }

  list(filters) { return this.registry.list(filters); }
  get(operationKey) { return this.registry.get(operationKey); }

  preview(operationKey, input = {}) {
    const operation = this.get(operationKey);
    const customerId = String(input.customerId || '').trim();
    if (!customerId) throw new SearchAdGatewayError('SEARCHAD_CUSTOMER_ID_REQUIRED', 'customerId is required.', { status: 400 });
    this.credentialsRegistry.resolve(customerId);
    const path = interpolatePath(operation, input.pathParams || {});
    const request = {
      customerId,
      method: operation.method,
      path,
      query: input.query || {},
      json: input.body ?? input.json,
      responseType: input.responseType || 'auto'
    };
    const requestFingerprint = fingerprint({ operationKey, request });
    return {
      operation: this.registry.publicOperation(operation),
      request: redactSearchAdObject(request),
      requestFingerprint,
      resourceKey: resourceKey(customerId, operation, input),
      requiredConfirmation: operation.confirmation,
      requiredSecondConfirmation: operation.destructive ? resourceKey(customerId, operation, input) : null,
      allowed: this.executionCheck(operation, input, { throwOnFailure: false })
    };
  }

  executionCheck(operation, input, { throwOnFailure = true } = {}) {
    const fail = (code, message, status = 403) => {
      if (throwOnFailure) throw new SearchAdGatewayError(code, message, { status });
      return { ok: false, code, message, status };
    };
    if (!this.config.enabled) return fail('SEARCHAD_GATEWAY_DISABLED', 'SearchAd gateway is disabled.');
    if (!this.config.configured) return fail('SEARCHAD_NOT_CONFIGURED', 'SearchAd credentials are not configured.', 503);
    if (!operation.runtimeAllowlisted) {
      return fail('SEARCHAD_OPERATION_NOT_ALLOWLISTED', `SearchAd operation is not runtime allowlisted: ${operation.operationKey}`);
    }
    if (operation.tier !== 'A' && operation.tier !== 'B' && !this.config.allowUnverifiedOperations) {
      return fail('SEARCHAD_OPERATION_UNVERIFIED', 'SearchAd operation requires capability verification.');
    }
    if (!gateEnabled(this.config, operation.requiredGate)) {
      return fail('SEARCHAD_GATE_DISABLED', `SearchAd gate ${operation.requiredGate} is disabled.`);
    }
    if (operation.sideEffect) {
      if (String(input.confirmation || '') !== String(operation.confirmation || '')) {
        return fail('SEARCHAD_INVALID_CONFIRMATION', `confirmation must be exactly ${operation.confirmation}.`, 400);
      }
      if (operation.destructive) {
        const expected = resourceKey(String(input.customerId || ''), operation, input);
        if (String(input.secondConfirmation || '') !== expected) {
          return fail('SEARCHAD_INVALID_SECOND_CONFIRMATION', 'secondConfirmation must match the preview resourceKey.', 400);
        }
      }
    }
    return { ok: true };
  }

  async execute(operationKey, input = {}) {
    const operation = this.get(operationKey);
    this.executionCheck(operation, input, { throwOnFailure: true });
    const customerId = String(input.customerId || '').trim();
    const path = interpolatePath(operation, input.pathParams || {});
    const result = await this.client.request({
      customerId,
      method: operation.method,
      path,
      query: input.query || {},
      json: input.body ?? input.json,
      responseType: input.responseType || 'auto',
      retrySafe: !operation.sideEffect
    });
    return {
      operation: this.registry.publicOperation(operation),
      requestFingerprint: fingerprint({ operationKey, customerId, path, query: input.query || {}, body: input.body ?? input.json }),
      upstream: {
        status: result.status,
        requestId: result.requestId,
        attempts: result.attempts,
        durationMs: result.durationMs,
        headers: result.headers
      },
      data: redactSearchAdObject(result.data)
    };
  }
}

export function toPublicSearchAdError(error) {
  if (error instanceof SearchAdGatewayError || error instanceof SearchAdError) {
    return {
      name: error.name,
      code: error.code,
      status: error.status,
      message: error.message,
      requestId: error.requestId || null,
      details: redactSearchAdObject(error.details)
    };
  }
  return { name: error?.name || 'Error', code: error?.code || null, status: error?.status || 500, message: error?.message || 'Unknown error' };
}

export const _internal = { canonicalize, fingerprint, interpolatePath, resourceKey, gateEnabled };
