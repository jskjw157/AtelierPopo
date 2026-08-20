import { buildOpenApiSpec } from './openapi.js';
import { baseUrlFromRequest, readiness, route, sendJson } from './runtime.js';

export function createSystemRoutes({ app, httpConfig, operationQueue, version, startedAt }) {
  return [
    route('GET', /^\/$/, async ({ req, res }) => {
      sendJson(req, res, 200, {
        ok: true,
        service: 'atelier-popo-smartstore-bridge',
        version,
        health: '/health',
        readiness: '/health/ready',
        openapi: '/openapi.json'
      });
    }, { auth: false }),

    route('GET', /^\/health$/, async ({ req, res }) => {
      const state = readiness(app, httpConfig, operationQueue);
      sendJson(req, res, 200, {
        ok: true,
        status: state.readyForRead ? 'ok' : 'degraded',
        service: 'atelier-popo-smartstore-bridge',
        version,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        readiness: state
      });
    }, { auth: false }),

    route('HEAD', /^\/health$/, async ({ req, res }) => {
      sendJson(req, res, 200, { ok: true });
    }, { auth: false }),

    route('GET', /^\/health\/ready$/, async ({ req, res }) => {
      const state = readiness(app, httpConfig, operationQueue);
      sendJson(req, res, state.readyForRead ? 200 : 503, {
        ok: state.readyForRead,
        status: state.readyForRead ? 'ready' : 'not_ready',
        service: 'atelier-popo-smartstore-bridge',
        version,
        readiness: state
      });
    }, { auth: false }),

    route('GET', /^\/openapi\.json$/, async ({ req, res }) => {
      sendJson(req, res, 200, buildOpenApiSpec({ serverUrl: baseUrlFromRequest(req), version }));
    }, { auth: false }),

    route('GET', /^\/api\/v1\/status$/, async ({ req, res }) => {
      sendJson(req, res, 200, {
        ok: true,
        service: 'atelier-popo-smartstore-bridge',
        version,
        readiness: readiness(app, httpConfig, operationQueue),
        jobs: app.ledger.counts(),
        operations: app.ledger.operationCounts()
      });
    }),

    route('POST', /^\/api\/v1\/auth\/test$/, async ({ req, res }) => {
      const { issueAccessToken } = await import('../naver/auth.js');
      const token = await issueAccessToken({
        clientId: app.config.naver.clientId,
        clientSecret: app.config.naver.clientSecret,
        tokenType: app.config.naver.tokenType,
        accountId: app.config.naver.accountId,
        baseUrl: app.config.naver.baseUrl
      });
      sendJson(req, res, 200, {
        ok: true,
        tokenType: token.tokenType,
        expiresIn: token.expiresIn
      });
    }),

    route('GET', /^\/api\/v1\/catalog\/stats$/, async ({ req, res }) => {
      sendJson(req, res, 200, { ok: true, catalog: app.catalogRepository.stats() });
    }),

    route('POST', /^\/api\/v1\/catalog\/enqueue$/, async ({ req, res }) => {
      sendJson(req, res, 200, { ok: true, result: app.productService.enqueueCatalog(app.config.catalogRoot) });
    })
  ];
}
