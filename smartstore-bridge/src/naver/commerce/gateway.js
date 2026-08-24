import crypto from 'node:crypto';
import { loadCommerceManifest } from './spec.js';

const MAX_FILTER_LIMIT = 500;
const SENSITIVE_KEY_PATTERN = /(secret|token|authorization|password|client[_-]?secret|access[_-]?license)/i;
const PERSONAL_KEY_PATTERN = /(receiver|recipient|purchaser|buyer|customer).*(name|tel|phone|mobile|email|address)|(^|_)(tel|phone|mobile|email|baseAddress|detailedAddress|zipCode|accountNo|bankAccount)(_|$)/i;

function stableJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function maskString(value) {
  const text = String(value ?? '');
  if (!text) return text;
  if (text.length <= 2) return '*'.repeat(text.length);
  return `${text.slice(0, 1)}${'*'.repeat(Math.min(12, text.length - 2))}${text.slice(-1)}`;
}

export function redactCommerceData(value, { exposePersonalData = false } = {}, key = '') {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (!exposePersonalData && PERSONAL_KEY_PATTERN.test(key)) {
    if (typeof value === 'string' || typeof value === 'number') return maskString(value);
  }
  if (Array.isArray(value)) return value.map(item => redactCommerceData(item, { exposePersonalData }, key));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      redactCommerceData(child, { exposePersonalData }, childKey)
    ]));
  }
  return value;
}

function normalizeFilterLimit(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_FILTER_LIMIT, parsed));
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function normalizeObject(value, label) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommerceGatewayError('COMMERCE_INVALID_INPUT', `${label}는 JSON 객체여야 합니다.`, { status: 400 });
  }
  return value;
}

function operationResourceKey(operation, pathParams = {}) {
  const values = operation.pathParams.map(name => `${name}=${String(pathParams[name] ?? '')}`);
  return [operation.operationId, ...values].join(':').slice(0, 512);
}

function renderOperationPath(operation, pathParams = {}) {
  const provided = normalizeObject(pathParams, 'pathParams');
  let rendered = operation.path;
  for (const name of operation.pathParams) {
    const value = provided[name];
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new CommerceGatewayError('COMMERCE_PATH_PARAM_REQUIRED', `pathParams.${name} 값이 필요합니다.`, {
        status: 400,
        details: { operationId: operation.operationId, pathParam: name }
      });
    }
    rendered = rendered.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  if (/\{[^}]+\}/.test(rendered)) {
    throw new CommerceGatewayError('COMMERCE_PATH_PARAM_UNRESOLVED', 'API 경로 매개변수가 모두 치환되지 않았습니다.', { status: 400 });
  }
  return rendered;
}

function decodeInlineFiles(files, config) {
  if (!Array.isArray(files) || !files.length) {
    throw new CommerceGatewayError('COMMERCE_FILES_REQUIRED', 'multipart 작업에는 files 배열이 필요합니다.', { status: 400 });
  }
  if (files.length > config.maxUploadFiles) {
    throw new CommerceGatewayError('COMMERCE_TOO_MANY_FILES', `파일은 최대 ${config.maxUploadFiles}개까지 허용됩니다.`, { status: 413 });
  }
  return files.map((file, index) => {
    if (!file || typeof file !== 'object') {
      throw new CommerceGatewayError('COMMERCE_INVALID_FILE', `files[${index}]가 올바른 객체가 아닙니다.`, { status: 400 });
    }
    const fileName = String(file.fileName || `image-${index + 1}.jpg`).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255);
    const mimeType = String(file.mimeType || 'application/octet-stream').slice(0, 128);
    const content = Buffer.from(String(file.contentBase64 || ''), 'base64');
    if (!content.length) {
      throw new CommerceGatewayError('COMMERCE_EMPTY_FILE', `files[${index}]의 contentBase64가 비어 있습니다.`, { status: 400 });
    }
    if (content.length > config.maxInlineUploadBytes) {
      throw new CommerceGatewayError('COMMERCE_FILE_TOO_LARGE', `files[${index}]가 인라인 업로드 제한을 초과했습니다.`, {
        status: 413,
        details: { maxBytes: config.maxInlineUploadBytes, actualBytes: content.length }
      });
    }
    return { fileName, mimeType, content };
  });
}

export class CommerceGatewayError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = 'CommerceGatewayError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class CommerceOperationGateway {
  constructor({ client, config, manifest, logger } = {}) {
    if (!client) throw new Error('CommerceOperationGateway에는 NaverCommerceClient가 필요합니다.');
    if (!config) throw new Error('CommerceOperationGateway에는 config가 필요합니다.');
    this.client = client;
    this.config = config;
    this.manifest = manifest || loadCommerceManifest(config.manifestPath);
    this.logger = logger;
    this.byId = new Map(this.manifest.operations.map(operation => [operation.operationId, operation]));
  }

  status() {
    return {
      enabled: Boolean(this.config.enabled),
      operationCount: this.manifest.operations.length,
      commerceApiVersion: this.manifest.commerceApiVersion,
      sourceUrl: this.manifest.sourceUrl,
      generatedAt: this.manifest.generatedAt,
      domains: this.manifest.domains,
      specPendingDomains: this.manifest.specPendingDomains || [],
      gates: {
        reads: Boolean(this.config.allowReads),
        writes: Boolean(this.config.allowWrites),
        deletes: Boolean(this.config.allowDeletes),
        orders: Boolean(this.config.allowOrders),
        claims: Boolean(this.config.allowClaims),
        inquiries: Boolean(this.config.allowInquiries),
        solutions: Boolean(this.config.allowSolutions),
        seller: Boolean(this.config.allowSellerWrites),
        multipart: Boolean(this.config.allowMultipartUploads)
      }
    };
  }

  list({ domain, method, risk, query, limit = 100, offset = 0 } = {}) {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase('ko-KR');
    const normalizedMethod = String(method || '').trim().toUpperCase();
    const normalizedDomain = String(domain || '').trim();
    const normalizedRisk = String(risk || '').trim().toLowerCase();
    const matched = this.manifest.operations.filter(operation => {
      if (normalizedDomain && operation.domain !== normalizedDomain) return false;
      if (normalizedMethod && operation.method !== normalizedMethod) return false;
      if (normalizedRisk && operation.risk !== normalizedRisk) return false;
      if (!normalizedQuery) return true;
      return [operation.operationId, operation.title, operation.path, operation.domain, operation.apiGroup]
        .join(' ')
        .toLocaleLowerCase('ko-KR')
        .includes(normalizedQuery);
    });
    const safeLimit = normalizeFilterLimit(limit);
    const safeOffset = normalizeOffset(offset);
    return {
      total: matched.length,
      limit: safeLimit,
      offset: safeOffset,
      items: matched.slice(safeOffset, safeOffset + safeLimit)
    };
  }

  get(operationId) {
    const operation = this.byId.get(String(operationId || '').trim());
    if (!operation) {
      throw new CommerceGatewayError('COMMERCE_OPERATION_NOT_FOUND', `커머스API operation을 찾을 수 없습니다: ${operationId}`, { status: 404 });
    }
    return operation;
  }

  preview(operationId, input = {}) {
    if (!this.config.enabled) {
      throw new CommerceGatewayError('COMMERCE_GATEWAY_DISABLED', 'ATELIER_COMMERCE_GATEWAY_ENABLED=false입니다.', { status: 503 });
    }
    const operation = this.get(operationId);
    const pathParams = normalizeObject(input.pathParams, 'pathParams');
    const query = normalizeObject(input.query, 'query');
    const apiPath = renderOperationPath(operation, pathParams);
    const resourceKey = operationResourceKey(operation, pathParams);
    const request = {
      operationId: operation.operationId,
      method: operation.method,
      apiPath,
      query,
      body: input.body,
      transport: operation.transport,
      fingerprint: fingerprint({ operationId: operation.operationId, apiPath, query, body: input.body })
    };
    return {
      operation,
      request: redactCommerceData(request, this.config),
      resourceKey,
      requiredConfirmation: operation.confirmation,
      requiredSecondConfirmation: ['destructive', 'order', 'claim', 'financial'].includes(operation.risk)
        ? resourceKey
        : null,
      gate: operation.gate,
      gateEnabled: this.isGateEnabled(operation),
      executable: this.isGateEnabled(operation) && !operation.internal
    };
  }

  isGateEnabled(operation) {
    if (!this.config.enabled) return false;
    if (operation.internal) return false;
    if (!this.config.allowUnverifiedOperations && operation.status !== 'implemented_and_verified') return false;
    switch (operation.gate) {
      case 'reads': return Boolean(this.config.allowReads);
      case 'writes': return Boolean(this.config.allowWrites);
      case 'deletes': return Boolean(this.config.allowWrites && this.config.allowDeletes);
      case 'orders': return Boolean(this.config.allowWrites && this.config.allowOrders);
      case 'claims': return Boolean(this.config.allowWrites && this.config.allowClaims);
      case 'inquiries': return Boolean(this.config.allowWrites && this.config.allowInquiries);
      case 'solutions': return Boolean(this.config.allowWrites && this.config.allowSolutions);
      case 'seller': return Boolean(this.config.allowWrites && this.config.allowSellerWrites);
      default: return false;
    }
  }

  assertExecutionAllowed(operation, input, { naverWritesEnabled = false, httpWritesEnabled = false } = {}) {
    if (operation.internal) {
      throw new CommerceGatewayError('COMMERCE_INTERNAL_OPERATION', '인증 토큰 발급 operation은 전용 인증 모듈에서만 호출할 수 있습니다.', { status: 403 });
    }
    if (!this.isGateEnabled(operation)) {
      throw new CommerceGatewayError('COMMERCE_OPERATION_GATE_DISABLED', `operation gate가 비활성입니다: ${operation.gate}`, {
        status: 403,
        details: { operationId: operation.operationId, gate: operation.gate }
      });
    }
    if (operation.sideEffect) {
      if (!naverWritesEnabled) {
        throw new CommerceGatewayError('NAVER_WRITES_DISABLED', 'NAVER_ALLOW_WRITES=false라 네이버 쓰기가 차단되어 있습니다.', { status: 403 });
      }
      if (!httpWritesEnabled) {
        throw new CommerceGatewayError('HTTP_WRITES_DISABLED', 'ATELIER_HTTP_ALLOW_WRITES=false라 원격 쓰기가 차단되어 있습니다.', { status: 403 });
      }
      if (String(input.confirmation || '') !== String(operation.confirmation || '')) {
        throw new CommerceGatewayError('COMMERCE_INVALID_CONFIRMATION', `confirmation 값은 정확히 ${operation.confirmation}여야 합니다.`, { status: 400 });
      }
      const preview = this.preview(operation.operationId, input);
      if (preview.requiredSecondConfirmation && String(input.secondConfirmation || '') !== preview.requiredSecondConfirmation) {
        throw new CommerceGatewayError('COMMERCE_INVALID_SECOND_CONFIRMATION', 'secondConfirmation 값이 대상 resourceKey와 일치하지 않습니다.', {
          status: 400,
          details: { requiredSecondConfirmation: preview.requiredSecondConfirmation }
        });
      }
    }
    if (operation.transport === 'multipart' && !this.config.allowMultipartUploads) {
      throw new CommerceGatewayError('COMMERCE_MULTIPART_DISABLED', 'ATELIER_COMMERCE_ALLOW_MULTIPART_UPLOADS=false입니다.', { status: 403 });
    }
  }

  async execute(operationId, input = {}, executionContext = {}) {
    const operation = this.get(operationId);
    this.assertExecutionAllowed(operation, input, executionContext);
    const preview = this.preview(operationId, input);
    let formData;
    if (operation.transport === 'multipart') {
      const files = decodeInlineFiles(input.files, this.config);
      formData = new FormData();
      for (const file of files) {
        formData.append('imageFiles', new Blob([file.content], { type: file.mimeType }), file.fileName);
      }
    }

    this.logger?.info?.('Naver Commerce operation start', {
      operationId: operation.operationId,
      method: operation.method,
      apiPath: preview.request.apiPath,
      fingerprint: preview.request.fingerprint,
      risk: operation.risk
    });

    const detailed = await this.client.requestDetailed(operation.method, preview.request.apiPath, {
      query: input.query,
      ...(operation.transport === 'multipart'
        ? { formData }
        : (input.body !== undefined ? { json: input.body } : {})),
      retrySafe: operation.readOnly,
      timeoutMs: input.timeoutMs
    });
    const result = {
      operation: {
        operationId: operation.operationId,
        domain: operation.domain,
        method: operation.method,
        path: operation.path,
        title: operation.title,
        risk: operation.risk
      },
      request: preview.request,
      resourceKey: preview.resourceKey,
      upstream: {
        status: detailed.status,
        traceId: detailed.traceId,
        attempts: detailed.attempts,
        redirects: detailed.redirects,
        responseTimeMs: detailed.responseTimeMs,
        url: detailed.url,
        rateLimit: Object.fromEntries(Object.entries(detailed.headers || {}).filter(([key]) => /rate|quota|retry/i.test(key)))
      },
      data: redactCommerceData(detailed.data, this.config)
    };
    this.logger?.info?.('Naver Commerce operation success', {
      operationId: operation.operationId,
      status: detailed.status,
      traceId: detailed.traceId,
      responseTimeMs: detailed.responseTimeMs
    });
    return result;
  }
}
