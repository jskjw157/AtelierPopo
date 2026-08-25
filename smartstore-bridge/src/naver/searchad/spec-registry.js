import fs from 'node:fs';

export class SearchAdSpecError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'SearchAdSpecError';
    this.code = code;
    this.status = 500;
    this.details = details;
  }
}

function publicOperation(operation) {
  return {
    operationKey: operation.operationKey,
    sourceId: operation.sourceId,
    sourceOperationId: operation.sourceOperationId,
    method: operation.method,
    path: operation.path,
    rawPath: operation.rawPath,
    domain: operation.domain,
    tags: operation.tags,
    summary: operation.summary,
    action: operation.action,
    sideEffect: operation.sideEffect,
    destructive: operation.destructive,
    batch: operation.batch,
    risk: operation.risk,
    state: operation.state,
    tier: operation.tier,
    runtimeAllowlisted: operation.runtimeAllowlisted,
    requiredGate: operation.requiredGate,
    confirmation: operation.confirmation,
    capabilityKey: operation.capabilityKey,
    parameters: operation.parameters,
    specRef: operation.specRef
  };
}

export class SearchAdSpecRegistry {
  constructor(manifest) {
    if (!manifest || !Array.isArray(manifest.operations)) {
      throw new SearchAdSpecError('SEARCHAD_MANIFEST_INVALID', 'SearchAd manifest must contain operations array.');
    }
    this.manifest = manifest;
    this.byKey = new Map();
    for (const operation of manifest.operations) {
      if (!operation?.operationKey) throw new SearchAdSpecError('SEARCHAD_OPERATION_KEY_MISSING', 'SearchAd operationKey is missing.');
      if (this.byKey.has(operation.operationKey)) {
        throw new SearchAdSpecError('SEARCHAD_DUPLICATE_OPERATION_KEY', `Duplicate SearchAd operationKey: ${operation.operationKey}`);
      }
      this.byKey.set(operation.operationKey, operation);
    }
  }

  get(operationKey) {
    const key = String(operationKey || '').trim();
    const operation = this.byKey.get(key);
    if (!operation) {
      const error = new SearchAdSpecError('SEARCHAD_OPERATION_NOT_FOUND', `Unknown SearchAd operationKey: ${key}`);
      error.status = 404;
      throw error;
    }
    return operation;
  }

  list({ sourceId, domain, method, state, action, runtimeOnly = false, query, limit = 100, offset = 0 } = {}) {
    const text = String(query || '').trim().toLowerCase();
    let items = this.manifest.operations.filter(item => {
      if (sourceId && item.sourceId !== sourceId) return false;
      if (domain && item.domain !== domain) return false;
      if (method && item.method !== String(method).toUpperCase()) return false;
      if (state && item.state !== state) return false;
      if (action && item.action !== action) return false;
      if (runtimeOnly && !item.runtimeAllowlisted) return false;
      if (text) {
        const haystack = [item.operationKey, item.domain, item.summary, item.path, ...(item.tags || [])].join(' ').toLowerCase();
        if (!haystack.includes(text)) return false;
      }
      return true;
    });
    const total = items.length;
    items = items.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
    return { total, limit, offset, items: items.map(publicOperation) };
  }

  findByPath(method, path, predicate = () => true) {
    const normalizedMethod = String(method || '').toUpperCase();
    return this.manifest.operations.find(item => item.method === normalizedMethod && item.path === path && predicate(item)) || null;
  }

  status() {
    return {
      configured: true,
      specRef: this.manifest.specRef,
      generatedAt: this.manifest.generatedAt,
      baseUrl: this.manifest.baseUrl,
      counts: this.manifest.counts,
      sourceCount: this.manifest.sources?.length || 0,
      operationCount: this.manifest.operations.length
    };
  }

  publicOperation(operation) {
    return publicOperation(operation);
  }
}

export function loadSearchAdSpecRegistry(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new SearchAdSpecError('SEARCHAD_MANIFEST_NOT_FOUND', `SearchAd manifest not found: ${manifestPath}`);
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (error) {
    throw new SearchAdSpecError('SEARCHAD_MANIFEST_PARSE_FAILED', `Failed to parse SearchAd manifest: ${error.message}`);
  }
  return new SearchAdSpecRegistry(manifest);
}
