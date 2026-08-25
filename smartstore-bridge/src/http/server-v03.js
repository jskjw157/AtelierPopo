import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationQueue } from '../application/operation-queue.js';
import { logger as defaultLogger } from '../infrastructure/logger.js';
import { HttpError, errorPayload } from './errors-v03.js';
import {
  FixedWindowRateLimiter,
  clientIp,
  loadHttpConfig,
  readJsonBody,
  verifyApiKey
} from './security.js';
import {
  applyCors,
  closeLedgerWhenQueueIdle,
  configuredApiKeys,
  ensureSameIdempotentOperation,
  normalizePathname,
  sendJson
} from './runtime.js';
import { createSystemRoutesV03, readinessV03 } from './routes-system-v03.js';
import { createProductRoutesV03 } from './routes-products-v03.js';
import { createLedgerRoutesV03 } from './routes-ledger-v03.js';
import { createDriveRoutes } from './routes-drive.js';

const SERVICE_VERSION = '0.3.0';
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createHttpApiV03({ app, env = process.env, logger = defaultLogger, version = SERVICE_VERSION } = {}) {
  if (!app) throw new Error('createHttpApiV03에는 bootstrap 결과 app이 필요합니다.');
  const httpConfig = loadHttpConfig(env);
  const rateLimiter = new FixedWindowRateLimiter();
  const operationQueue = new OperationQueue({
    ledger: app.ledger,
    concurrency: httpConfig.operationConcurrency,
    logger
  });
  const startedAt = Date.now();
  const redactionRoots = [
    app.config.catalogRoot,
    app.config.workDir,
    app.config.databasePath && path.dirname(app.config.databasePath),
    app.driveConfig?.cacheDir
  ];

  async function createAsyncOperation({ idempotencyKey, operationType, sourceProductId, request, task }) {
    const existing = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
    if (existing) {
      ensureSameIdempotentOperation(existing, { operationType, sourceProductId, request });
      return { row: existing, reused: true };
    }

    const operationId = randomUUID();
    let row;
    try {
      row = app.ledger.createOperation({
        operationId,
        idempotencyKey,
        operationType,
        sourceProductId,
        request
      });
    } catch (error) {
      const raced = app.ledger.findOperationByIdempotencyKey(idempotencyKey);
      if (!raced) throw error;
      ensureSameIdempotentOperation(raced, { operationType, sourceProductId, request });
      return { row: raced, reused: true };
    }

    operationQueue.enqueue(operationId, task);
    return { row, reused: false };
  }

  const routeContext = { app, httpConfig, operationQueue, version, startedAt, createAsyncOperation, redactionRoots };
  const routes = [
    ...createSystemRoutesV03(routeContext),
    ...createProductRoutesV03(routeContext),
    ...createLedgerRoutesV03(routeContext),
    ...createDriveRoutes(routeContext)
  ];

  const server = http.createServer(async (req, res) => {
    const requestId = String(req.headers['x-request-id'] || randomUUID()).slice(0, 128);
    res.setHeader('X-Request-Id', requestId);
    applyCors(req, res, httpConfig);
    if (res.hasHeader('Access-Control-Allow-Methods')) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }

    try {
      if (req.method === 'OPTIONS') {
        if (req.headers.origin && !applyCors(req, res, httpConfig)) {
          throw new HttpError(403, 'CORS_ORIGIN_NOT_ALLOWED', '허용되지 않은 Origin입니다.');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = normalizePathname(url.pathname);
      const candidates = routes.filter(item => item.pattern.test(pathname));
      const selected = candidates.find(item => item.method === req.method);
      if (!selected) {
        if (candidates.length) {
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 HTTP 메서드입니다.', {
            allowed: [...new Set(candidates.map(item => item.method))]
          });
        }
        throw new HttpError(404, 'ROUTE_NOT_FOUND', '요청한 API 경로를 찾을 수 없습니다.');
      }

      selected.pattern.lastIndex = 0;
      const match = selected.pattern.exec(pathname);
      let authenticatedToken = '';
      if (selected.auth) {
        authenticatedToken = verifyApiKey(req, {
          ...httpConfig,
          apiKeys: configuredApiKeys(httpConfig)
        });
      }

      if (selected.auth) {
        const ip = clientIp(req, httpConfig);
        const tokenFingerprint = authenticatedToken.slice(0, 8);
        const limit = selected.write
          ? httpConfig.writeRateLimitPerMinute
          : httpConfig.readRateLimitPerMinute;
        const rate = rateLimiter.consume(
          `${ip}:${tokenFingerprint}:${selected.write ? 'write' : 'read'}`,
          limit
        );
        res.setHeader('X-RateLimit-Limit', String(rate.limit));
        res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));
        if (!rate.allowed) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
          throw new HttpError(429, 'RATE_LIMITED', '분당 API 호출 한도를 초과했습니다.');
        }
      }

      const bodyLimit = Math.max(
        httpConfig.maxBodyBytes,
        Number(selected.maxBodyBytes || 0)
      );
      const body = BODY_METHODS.has(req.method || '')
        ? await readJsonBody(req, bodyLimit)
        : {};

      logger.info('HTTP request', {
        requestId,
        method: req.method,
        pathname,
        authenticated: selected.auth,
        write: selected.write,
        bodyLimit
      });

      await selected.handler({ req, res, url, pathname, match, body, requestId });
    } catch (error) {
      const { status, body } = errorPayload(error, requestId, {
        exposeInternal: httpConfig.exposeInternalErrors
      });
      logger.error('HTTP request failed', {
        requestId,
        method: req.method,
        url: req.url,
        status,
        name: error.name,
        code: error.code,
        message: error.message
      });
      if (!res.headersSent) {
        if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="atelier-popo"');
        sendJson(req, res, status, body);
      } else {
        res.destroy();
      }
    }
  });

  server.requestTimeout = Math.max(httpConfig.requestTimeoutMs, app.driveConfig?.requestTimeoutMs || 0);
  server.headersTimeout = Math.min(30_000, server.requestTimeout);
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  async function listen({ host = httpConfig.host, port = httpConfig.port } = {}) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    return server.address();
  }

  async function close() {
    operationQueue.accepting = false;
    if (server.listening) {
      await new Promise(resolve => server.close(() => resolve()));
    }
    const idle = await operationQueue.close({ timeoutMs: httpConfig.shutdownTimeoutMs });
    closeLedgerWhenQueueIdle(app.ledger, idle);
  }

  return {
    server,
    httpConfig,
    operationQueue,
    listen,
    close,
    readiness: () => readinessV03(app, httpConfig, operationQueue)
  };
}
