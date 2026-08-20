import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.js';
import { validateConfirmation } from './security.js';
import { publicOperation } from './presenters.js';

const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function jsonStringify(value) {
  return JSON.stringify(value, (_key, child) => typeof child === 'bigint' ? child.toString() : child);
}

export function sendJson(req, res, status, body, headers = {}) {
  const serialized = jsonStringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(serialized));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  if (req.method === 'HEAD') res.end();
  else res.end(serialized);
}

export function normalizePathname(pathname) {
  if (pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

export function validateProductId(value) {
  const productId = String(value || '').trim();
  if (!PRODUCT_ID_PATTERN.test(productId)) {
    throw new HttpError(400, 'INVALID_PRODUCT_ID', 'productId 형식이 올바르지 않습니다.');
  }
  return productId;
}

export function validateOperationId(value) {
  const operationId = String(value || '').trim();
  if (!OPERATION_ID_PATTERN.test(operationId)) {
    throw new HttpError(400, 'INVALID_OPERATION_ID', 'operationId 형식이 올바르지 않습니다.');
  }
  return operationId;
}

export function baseUrlFromRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${protocol}://${host}`;
}

export function configuredApiKeys(httpConfig) {
  return httpConfig.apiKeys.filter(key => key.length >= httpConfig.apiKeyMinLength);
}

export function readiness(app, httpConfig, operationQueue) {
  const catalogRoot = app.config.catalogRoot || '';
  const catalogManifestExists = Boolean(catalogRoot) && fs.existsSync(path.join(catalogRoot, 'catalog_manifest.json'));
  const templateExists = Boolean(app.config.templateFile) && fs.existsSync(app.config.templateFile);
  const categories = Object.entries(app.config.categories || {});
  const unmappedCategories = categories
    .filter(([, value]) => !value || String(value).includes('REPLACE_WITH'))
    .map(([key]) => key);
  const apiAuthConfigured = configuredApiKeys(httpConfig).length > 0;
  const naverCredentialsConfigured = Boolean(app.config.naver.clientId && app.config.naver.clientSecret);
  const readyForRead = apiAuthConfigured && catalogManifestExists;
  const readyForPreview = readyForRead && templateExists && unmappedCategories.length === 0;
  const readyForWrite = readyForPreview
    && naverCredentialsConfigured
    && httpConfig.allowWrites
    && app.config.naver.allowWrites;
  return {
    readyForRead,
    readyForPreview,
    readyForWrite,
    apiAuth: {
      configured: apiAuthConfigured,
      configuredKeyCount: configuredApiKeys(httpConfig).length,
      minimumKeyLength: httpConfig.apiKeyMinLength
    },
    catalog: {
      configured: Boolean(catalogRoot),
      manifestExists: catalogManifestExists
    },
    template: {
      configured: Boolean(app.config.templateFile),
      exists: templateExists
    },
    categories: {
      mappedCount: categories.length - unmappedCategories.length,
      unmapped: unmappedCategories
    },
    naver: {
      credentialsConfigured: naverCredentialsConfigured,
      tokenType: app.config.naver.tokenType,
      coreWritesEnabled: Boolean(app.config.naver.allowWrites)
    },
    http: {
      writesEnabled: Boolean(httpConfig.allowWrites),
      batchWritesEnabled: Boolean(httpConfig.allowBatchWrites)
    },
    queue: operationQueue.stats()
  };
}

export function applyCors(req, res, httpConfig) {
  const origin = String(req.headers.origin || '');
  if (!origin || !httpConfig.corsOrigins.length) return false;
  const allowed = httpConfig.corsOrigins.includes('*') || httpConfig.corsOrigins.includes(origin);
  if (!allowed) return false;
  res.setHeader('Access-Control-Allow-Origin', httpConfig.corsOrigins.includes('*') ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

export function assertHttpWriteAllowed(app, httpConfig, confirmation, { batch = false } = {}) {
  if (!httpConfig.allowWrites) {
    throw new HttpError(403, 'HTTP_WRITES_DISABLED', 'ATELIER_HTTP_ALLOW_WRITES=false라 원격 쓰기가 차단되어 있습니다.');
  }
  if (batch && !httpConfig.allowBatchWrites) {
    throw new HttpError(403, 'HTTP_BATCH_WRITES_DISABLED', 'ATELIER_HTTP_ALLOW_BATCH_WRITES=false라 원격 배치 쓰기가 차단되어 있습니다.');
  }
  if (!app.config.naver.allowWrites) {
    throw new HttpError(403, 'NAVER_WRITES_DISABLED', 'NAVER_ALLOW_WRITES=false라 네이버 쓰기가 차단되어 있습니다.');
  }
  validateConfirmation(confirmation, app.config.writeConfirmation);
}

export function operationResponse(row, { reused = false, redactionRoots = [] } = {}) {
  return {
    ok: true,
    reused,
    operation: publicOperation(row, { redactionRoots }),
    poll: `/api/v1/operations/${row.operation_id}`
  };
}

export function ensureSameIdempotentOperation(existing, { operationType, sourceProductId }) {
  if (!existing) return;
  if (existing.operation_type !== operationType || String(existing.source_product_id || '') !== String(sourceProductId || '')) {
    throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', '동일한 idempotencyKey가 다른 작업에 이미 사용되었습니다.');
  }
}

export function operationStatusCode(row) {
  return ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(row.status) ? 200 : 202;
}

export function route(method, pattern, handler, options = {}) {
  return { method, pattern, handler, auth: options.auth !== false, write: Boolean(options.write) };
}
