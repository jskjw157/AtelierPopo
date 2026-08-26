import { MultiSourceCatalogError, asMultiSourceCatalogError } from './errors.js';
import { normalizeDomain } from './config.js';

function assertProvider(provider, source) {
  const required = ['status', 'listChanges', 'getSourceProduct', 'hydrateAssets', 'normalize'];
  for (const method of required) {
    if (typeof provider?.[method] !== 'function') {
      throw new MultiSourceCatalogError(
        'MULTI_SOURCE_INVALID_PROVIDER',
        `${source.sourceId} Provider에 ${method}()가 없습니다.`,
        { details: { sourceId: source.sourceId, providerType: source.providerType, method } }
      );
    }
  }
}

function publicSource(source, providerStatus = null) {
  return {
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    sourceType: source.sourceType,
    providerType: source.providerType,
    status: source.status,
    canonical: source.canonical,
    metadata: source.metadata,
    provider: providerStatus
  };
}

export class CatalogSourceRegistry {
  constructor({ sources = [], logger = console } = {}) {
    this.logger = logger;
    this.sources = new Map(sources.map(source => [source.sourceId, structuredClone(source)]));
    this.providers = new Map();
  }

  registerProvider(sourceId, provider) {
    const source = this.requireSource(sourceId);
    assertProvider(provider, source);
    this.providers.set(source.sourceId, provider);
    return provider;
  }

  hasSource(sourceId) {
    return this.sources.has(String(sourceId || '').trim().toLowerCase());
  }

  requireSource(sourceId) {
    const id = String(sourceId || '').trim().toLowerCase();
    const source = this.sources.get(id);
    if (!source) {
      throw new MultiSourceCatalogError('MULTI_SOURCE_SOURCE_NOT_FOUND', `상품 Source를 찾을 수 없습니다: ${sourceId}`, {
        status: 404,
        details: { sourceId: id }
      });
    }
    return source;
  }

  requireProvider(sourceId) {
    const source = this.requireSource(sourceId);
    const provider = this.providers.get(source.sourceId);
    if (!provider) {
      throw new MultiSourceCatalogError(
        'MULTI_SOURCE_PROVIDER_NOT_READY',
        `${source.sourceName} Provider가 준비되지 않았습니다.`,
        { status: 503, details: { sourceId: source.sourceId, providerType: source.providerType } }
      );
    }
    return { source, provider };
  }

  async listSources() {
    const items = [];
    for (const source of this.sources.values()) {
      const provider = this.providers.get(source.sourceId);
      let providerStatus = { ready: false, code: 'PROVIDER_NOT_REGISTERED' };
      if (provider) {
        try {
          providerStatus = await provider.status();
        } catch (error) {
          const normalized = asMultiSourceCatalogError(error, 'MULTI_SOURCE_PROVIDER_STATUS_FAILED');
          providerStatus = { ready: false, code: normalized.code, message: normalized.message };
        }
      }
      items.push(publicSource(source, providerStatus));
    }
    return items;
  }

  async getSourceStatus(sourceId) {
    const source = this.requireSource(sourceId);
    const provider = this.providers.get(source.sourceId);
    if (!provider) return publicSource(source, { ready: false, code: 'PROVIDER_NOT_REGISTERED' });
    try {
      return publicSource(source, await provider.status());
    } catch (error) {
      const normalized = asMultiSourceCatalogError(error, 'MULTI_SOURCE_PROVIDER_STATUS_FAILED');
      return publicSource(source, { ready: false, code: normalized.code, message: normalized.message });
    }
  }

  async listChanges(sourceId, options = {}) {
    const { source, provider } = this.requireProvider(sourceId);
    try {
      const result = await provider.listChanges(options);
      return { source: publicSource(source), ...result };
    } catch (error) {
      throw asMultiSourceCatalogError(error, 'MULTI_SOURCE_LIST_CHANGES_FAILED');
    }
  }

  async getSourceProduct(sourceId, sourceProductId, options = {}) {
    const { source, provider } = this.requireProvider(sourceId);
    try {
      const rawProduct = await provider.getSourceProduct(String(sourceProductId), options);
      const normalized = await provider.normalize(rawProduct);
      return {
        source: publicSource(source),
        sourceProduct: normalized,
        ...(options.includeRaw ? { rawProduct } : {})
      };
    } catch (error) {
      throw asMultiSourceCatalogError(error, 'MULTI_SOURCE_GET_PRODUCT_FAILED');
    }
  }

  async hydrateAssets(sourceId, sourceProductId, options = {}) {
    const { source, provider } = this.requireProvider(sourceId);
    try {
      const result = await provider.hydrateAssets(String(sourceProductId), options);
      return { source: publicSource(source), result };
    } catch (error) {
      throw asMultiSourceCatalogError(error, 'MULTI_SOURCE_HYDRATE_FAILED');
    }
  }

  status() {
    return {
      sourceCount: this.sources.size,
      providerCount: this.providers.size,
      readySourceCount: [...this.sources.keys()].filter(id => this.providers.has(id)).length,
      sourceIds: [...this.sources.keys()]
    };
  }
}

export class SalesChannelRegistry {
  constructor(channels = []) {
    this.channels = new Map(channels.map(channel => [channel.channelId, structuredClone(channel)]));
  }

  list() {
    return [...this.channels.values()].map(item => structuredClone(item));
  }

  get(channelId) {
    const id = String(channelId || '').trim().toLowerCase();
    const channel = this.channels.get(id);
    if (!channel) {
      throw new MultiSourceCatalogError('MULTI_SOURCE_CHANNEL_NOT_FOUND', `판매 채널을 찾을 수 없습니다: ${channelId}`, {
        status: 404,
        details: { channelId: id }
      });
    }
    return structuredClone(channel);
  }

  findByPlatform(platformType, externalStoreId = null) {
    const platform = String(platformType || '').trim().toLowerCase().replaceAll('-', '_');
    const store = String(externalStoreId || '').trim();
    return this.list().find(channel => channel.platformType === platform && (!store || channel.externalStoreId === store)) || null;
  }

  findByDomain(domain) {
    const normalized = normalizeDomain(domain);
    return this.list().find(channel => channel.primaryDomain === normalized) || null;
  }

  ownMall() {
    return this.list().find(channel => channel.channelRole === 'owned_store' && channel.platformType === 'cafe24') || null;
  }

  status() {
    const items = this.list();
    return {
      channelCount: items.length,
      marketplaceCount: items.filter(item => item.channelRole === 'marketplace').length,
      ownedStoreCount: items.filter(item => item.channelRole === 'owned_store').length,
      ownMall: this.ownMall()
    };
  }
}

export const _internal = { assertProvider, publicSource };
