import { HttpError } from './errors.js';
import { parseIntegerQuery } from './security.js';
import { baseUrlFromRequest, route, sendJson } from './runtime.js';
import { buildMultiSourceCatalogOpenApi } from './openapi-multi-source.js';
import { publicMultiSourceCatalogConfig } from '../catalog/multi-source/config.js';

function asBoolean(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function requireRegistry(app) {
  if (!app.catalogSourceRegistry || !app.multiSourceCatalogConfig) {
    throw new HttpError(
      503,
      app.multiSourceCatalogStartupError?.code || 'MULTI_SOURCE_CATALOG_NOT_READY',
      app.multiSourceCatalogStartupError?.message || '다중 상품소스 Registry가 준비되지 않았습니다.'
    );
  }
  return app.catalogSourceRegistry;
}

function requireChannels(app) {
  if (!app.salesChannelRegistry) {
    throw new HttpError(503, 'MULTI_SOURCE_CHANNEL_REGISTRY_NOT_READY', '판매 채널 Registry가 준비되지 않았습니다.');
  }
  return app.salesChannelRegistry;
}

export function createMultiSourceCatalogRoutes({ app, version }) {
  return [
    route('GET', /^\/openapi-catalog\.json$/, async ({ req, res }) => {
      sendJson(req, res, 200, buildMultiSourceCatalogOpenApi({
        serverUrl: baseUrlFromRequest(req),
        version
      }));
    }, { auth: false }),

    route('GET', /^\/api\/v1\/catalog\/multi-source\/status$/, async ({ req, res }) => {
      const registry = requireRegistry(app);
      const channels = requireChannels(app);
      sendJson(req, res, 200, {
        ok: true,
        config: publicMultiSourceCatalogConfig(app.multiSourceCatalogConfig),
        registry: registry.status(),
        channels: channels.status(),
        startupErrors: app.multiSourceCatalogStartupErrors || [],
        startupError: app.multiSourceCatalogStartupError || null
      });
    }),

    route('GET', /^\/api\/v1\/catalog\/sources$/, async ({ req, res }) => {
      const registry = requireRegistry(app);
      sendJson(req, res, 200, { ok: true, sources: await registry.listSources() });
    }),

    route('GET', /^\/api\/v1\/catalog\/sources\/([^/]+)$/, async ({ req, res, match }) => {
      const registry = requireRegistry(app);
      const sourceId = decodeURIComponent(match[1]);
      sendJson(req, res, 200, { ok: true, source: await registry.getSourceStatus(sourceId) });
    }),

    route('GET', /^\/api\/v1\/catalog\/sources\/([^/]+)\/products$/, async ({ req, res, match, url }) => {
      const registry = requireRegistry(app);
      const sourceId = decodeURIComponent(match[1]);
      const result = await registry.listChanges(sourceId, {
        cursor: url.searchParams.get('cursor') || null,
        limit: parseIntegerQuery(url.searchParams.get('limit'), 100, { min: 1, max: 500 }),
        force: asBoolean(url.searchParams.get('force'))
      });
      sendJson(req, res, 200, { ok: true, ...result });
    }),

    route('GET', /^\/api\/v1\/catalog\/sources\/([^/]+)\/products\/([^/]+)$/, async ({ req, res, match, url }) => {
      const registry = requireRegistry(app);
      const sourceId = decodeURIComponent(match[1]);
      const sourceProductId = decodeURIComponent(match[2]);
      const result = await registry.getSourceProduct(sourceId, sourceProductId, {
        includeRaw: asBoolean(url.searchParams.get('includeRaw')),
        force: asBoolean(url.searchParams.get('force'))
      });
      sendJson(req, res, 200, { ok: true, ...result });
    }),

    route('POST', /^\/api\/v1\/catalog\/sources\/([^/]+)\/products\/([^/]+)\/hydrate$/, async ({ req, res, match, body }) => {
      const registry = requireRegistry(app);
      const sourceId = decodeURIComponent(match[1]);
      const sourceProductId = decodeURIComponent(match[2]);
      const imageNames = Array.isArray(body.imageNames) ? body.imageNames.map(String) : undefined;
      if (imageNames && imageNames.length > 200) {
        throw new HttpError(400, 'MULTI_SOURCE_TOO_MANY_IMAGES', '한 번에 최대 200개 이미지까지 Hydrate할 수 있습니다.');
      }
      const result = await registry.hydrateAssets(sourceId, sourceProductId, {
        imageNames,
        force: Boolean(body.force)
      });
      sendJson(req, res, 200, { ok: true, ...result });
    }, { maxBodyBytes: 1024 * 1024 }),

    route('GET', /^\/api\/v1\/sales-channels$/, async ({ req, res }) => {
      const channels = requireChannels(app);
      sendJson(req, res, 200, { ok: true, channels: channels.list(), status: channels.status() });
    }),

    route('GET', /^\/api\/v1\/sales-channels\/([^/]+)$/, async ({ req, res, match }) => {
      const channels = requireChannels(app);
      sendJson(req, res, 200, { ok: true, channel: channels.get(decodeURIComponent(match[1])) });
    })
  ];
}
