import crypto from 'node:crypto';
import { HttpError } from './errors.js';

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function asInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function loadHttpConfig(env = process.env) {
  const rawKeys = env.ATELIER_API_KEYS || env.ATELIER_API_KEY || '';
  const apiKeys = rawKeys.split(',').map(value => value.trim()).filter(Boolean);
  const corsOrigins = String(env.ATELIER_CORS_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return {
    host: env.ATELIER_HTTP_HOST || '0.0.0.0',
    port: asInteger(env.PORT || env.ATELIER_HTTP_PORT, 3000, { min: 1, max: 65535 }),
    apiKeys,
    apiKeyMinLength: asInteger(env.ATELIER_API_KEY_MIN_LENGTH, 32, { min: 16, max: 128 }),
    allowWrites: asBoolean(env.ATELIER_HTTP_ALLOW_WRITES, false),
    allowBatchWrites: asBoolean(env.ATELIER_HTTP_ALLOW_BATCH_WRITES, false),
    trustProxy: asBoolean(env.ATELIER_TRUST_PROXY, true),
    corsOrigins,
    maxBodyBytes: asInteger(env.ATELIER_MAX_BODY_BYTES, 64 * 1024, { min: 1024, max: 1024 * 1024 }),
    readRateLimitPerMinute: asInteger(env.ATELIER_RATE_LIMIT_PER_MINUTE, 120, { min: 1, max: 10_000 }),
    writeRateLimitPerMinute: asInteger(env.ATELIER_WRITE_RATE_LIMIT_PER_MINUTE, 20, { min: 1, max: 1_000 }),
    requestTimeoutMs: asInteger(env.ATELIER_REQUEST_TIMEOUT_MS, 30_000, { min: 5_000, max: 10 * 60_000 }),
    shutdownTimeoutMs: asInteger(env.ATELIER_SHUTDOWN_TIMEOUT_MS, 30_000, { min: 1_000, max: 10 * 60_000 }),
    operationConcurrency: asInteger(env.ATELIER_OPERATION_CONCURRENCY, 1, { min: 1, max: 4 }),
    exposeInternalErrors: asBoolean(env.ATELIER_EXPOSE_INTERNAL_ERRORS, false)
  };
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    const dummy = Buffer.alloc(leftBuffer.length);
    crypto.timingSafeEqual(leftBuffer, dummy);
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function extractBearerToken(headerValue) {
  const match = /^Bearer\s+(.+)$/i.exec(String(headerValue || '').trim());
  return match ? match[1].trim() : '';
}

export function verifyApiKey(req, config) {
  if (!config.apiKeys.length) {
    throw new HttpError(503, 'API_AUTH_NOT_CONFIGURED', 'ATELIER_API_KEY가 설정되지 않았습니다.');
  }
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authorization: Bearer API_KEY 헤더가 필요합니다.');
  }
  if (!config.apiKeys.some(apiKey => constantTimeEquals(token, apiKey))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'API 키가 올바르지 않습니다.');
  }
  return token;
}

export async function readJsonBody(req, maxBytes) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > maxBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `요청 본문은 최대 ${maxBytes}바이트까지 허용됩니다.`);
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBytes) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `요청 본문은 최대 ${maxBytes}바이트까지 허용됩니다.`);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type은 application/json이어야 합니다.');
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('object required');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '요청 본문이 올바른 JSON 객체가 아닙니다.');
  }
}

export function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

export class FixedWindowRateLimiter {
  constructor() {
    this.windows = new Map();
    this.lastSweep = Date.now();
  }

  consume(key, limit, now = Date.now()) {
    const windowMs = 60_000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const existing = this.windows.get(key);
    const current = !existing || existing.windowStart !== windowStart
      ? { windowStart, count: 0 }
      : existing;
    current.count += 1;
    this.windows.set(key, current);

    if (now - this.lastSweep > 5 * windowMs) {
      for (const [itemKey, value] of this.windows) {
        if (value.windowStart < windowStart - windowMs) this.windows.delete(itemKey);
      }
      this.lastSweep = now;
    }

    const resetAt = windowStart + windowMs;
    return {
      allowed: current.count <= limit,
      limit,
      remaining: Math.max(0, limit - current.count),
      resetAt
    };
  }
}

export function validateIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new HttpError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey는 영문, 숫자, 점, 밑줄, 콜론, 하이픈으로 구성된 8~128자여야 합니다.'
    );
  }
  return key;
}

export function validateConfirmation(value, expected) {
  const confirmation = String(value || '');
  if (confirmation !== expected) {
    throw new HttpError(400, 'INVALID_CONFIRMATION', `confirmation 값은 정확히 ${expected}여야 합니다.`);
  }
  return confirmation;
}

export function parseBooleanQuery(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  return asBoolean(value, fallback);
}

export function parseIntegerQuery(value, fallback, { min = 0, max = 500 } = {}) {
  return asInteger(value, fallback, { min, max });
}
