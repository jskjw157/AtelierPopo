import path from 'node:path';
import { MultiSourceCatalogError } from './errors.js';

const SOURCE_TYPES = new Set(['supplier', 'own_brand', 'manual', 'channel_import', 'marketplace', 'other']);
const PROVIDER_TYPES = new Set([
  'google_drive_manifest',
  'google_drive_folder',
  'manual_upload',
  'csv_excel',
  'supplier_api',
  'url_import',
  'commerce_channel',
  'other'
]);
const CHANNEL_ROLES = new Set(['marketplace', 'owned_store', 'social_commerce', 'wholesale', 'other']);

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function asString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function parseJsonArray(value, fallback, label) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch (error) {
    throw new MultiSourceCatalogError(
      'MULTI_SOURCE_INVALID_JSON_CONFIG',
      `${label} 값은 JSON 배열이어야 합니다: ${error.message}`,
      { details: { label } }
    );
  }
  if (!Array.isArray(parsed)) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_JSON_CONFIG', `${label} 값은 JSON 배열이어야 합니다.`, {
      details: { label }
    });
  }
  return parsed;
}

function normalizeIdentifier(value, label) {
  const id = asString(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(id)) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_IDENTIFIER', `${label} 형식이 올바르지 않습니다.`, {
      details: { label, value: String(value ?? '') }
    });
  }
  return id;
}

function normalizeProviderType(value) {
  const raw = asString(value, 'other').toLowerCase().replaceAll('-', '_');
  const aliases = {
    drive_manifest: 'google_drive_manifest',
    google_drive: 'google_drive_manifest',
    drive_folder: 'google_drive_folder',
    manual: 'manual_upload',
    csv: 'csv_excel',
    excel: 'csv_excel',
    api: 'supplier_api',
    channel: 'commerce_channel'
  };
  const normalized = aliases[raw] || raw;
  if (!PROVIDER_TYPES.has(normalized)) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_PROVIDER_TYPE', `지원하지 않는 providerType입니다: ${value}`);
  }
  return normalized;
}

function normalizeSourceType(value) {
  const raw = asString(value, 'other').toLowerCase().replaceAll('-', '_');
  const aliases = { supplier_catalog: 'supplier', own: 'own_brand', self: 'own_brand', channel: 'channel_import' };
  const normalized = aliases[raw] || raw;
  if (!SOURCE_TYPES.has(normalized)) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_SOURCE_TYPE', `지원하지 않는 sourceType입니다: ${value}`);
  }
  return normalized;
}

function normalizeChannelRole(value) {
  const raw = asString(value, 'other').toLowerCase().replaceAll('-', '_');
  const aliases = {
    own_site: 'owned_store',
    own_mall: 'owned_store',
    cafe24: 'owned_store',
    smartstore: 'marketplace',
    naver_smartstore: 'marketplace'
  };
  const normalized = aliases[raw] || raw;
  if (!CHANNEL_ROLES.has(normalized)) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_CHANNEL_ROLE', `지원하지 않는 channelRole입니다: ${value}`);
  }
  return normalized;
}

function normalizePlatformType(value) {
  const raw = asString(value, 'other').toLowerCase().replaceAll('-', '_');
  const aliases = {
    own_site: 'cafe24',
    own_mall: 'cafe24',
    smartstore: 'naver_smartstore',
    naver: 'naver_smartstore'
  };
  return aliases[raw] || raw;
}

export function normalizeDomain(value) {
  const raw = asString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_DOMAIN', `도메인 형식이 올바르지 않습니다: ${value}`);
  }
}

function normalizeSource(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_SOURCE', `sources[${index}]는 객체여야 합니다.`);
  }
  const sourceId = normalizeIdentifier(entry.sourceId || entry.source_id || entry.id, `sources[${index}].sourceId`);
  const sourceType = normalizeSourceType(entry.sourceType || entry.source_type || entry.type);
  const providerType = normalizeProviderType(entry.providerType || entry.provider_type || entry.provider);
  const sourceName = asString(entry.sourceName || entry.source_name || entry.name, sourceId);
  const rootReference = asString(entry.rootReference || entry.root_reference || entry.root || entry.folderId) || null;
  if (providerType.startsWith('google_drive_') && !rootReference) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_ROOT_REFERENCE_REQUIRED', `${sourceId}에는 Google Drive 폴더 ID가 필요합니다.`, {
      details: { sourceId, providerType }
    });
  }
  return {
    sourceId,
    sourceName,
    sourceType,
    providerType,
    rootReference,
    credentialRef: asString(entry.credentialRef || entry.credential_ref) || null,
    defaultCurrency: asString(entry.defaultCurrency || entry.default_currency, 'KRW').toUpperCase(),
    status: asString(entry.status, 'active').toLowerCase(),
    canonical: asBoolean(entry.canonical, false),
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? structuredClone(entry.metadata)
      : {}
  };
}

function normalizeChannel(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new MultiSourceCatalogError('MULTI_SOURCE_INVALID_CHANNEL', `channels[${index}]는 객체여야 합니다.`);
  }
  const channelId = normalizeIdentifier(entry.channelId || entry.channel_id || entry.id, `channels[${index}].channelId`);
  const channelRole = normalizeChannelRole(
    entry.channelRole || entry.channel_role || entry.channelType || entry.channel_type || entry.role
  );
  const platformType = normalizePlatformType(entry.platformType || entry.platform_type || entry.platform);
  const primaryDomain = normalizeDomain(entry.primaryDomain || entry.primary_domain || entry.domain);
  if (platformType === 'cafe24' && channelRole !== 'owned_store') {
    throw new MultiSourceCatalogError(
      'MULTI_SOURCE_CAFE24_ROLE_MISMATCH',
      'Cafe24 채널은 HAAR 자사몰(owned_store) 역할로 등록해야 합니다.',
      { details: { channelId, channelRole, platformType } }
    );
  }
  return {
    channelId,
    channelName: asString(entry.channelName || entry.channel_name || entry.name, channelId),
    channelRole,
    platformType,
    externalStoreId: asString(entry.externalStoreId || entry.external_store_id || entry.mallId || entry.mall_id) || null,
    primaryDomain,
    accountReference: asString(entry.accountReference || entry.account_reference) || null,
    status: asString(entry.status, 'active').toLowerCase(),
    metadata: entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? structuredClone(entry.metadata)
      : {}
  };
}

function assertUniqueSources(sources) {
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.sourceId)) {
      throw new MultiSourceCatalogError('MULTI_SOURCE_DUPLICATE_SOURCE_ID', `중복 sourceId입니다: ${source.sourceId}`);
    }
    ids.add(source.sourceId);
  }
}

function assertUniqueChannels(channels) {
  const ids = new Set();
  const platformStores = new Set();
  const domains = new Set();
  let cafe24OwnedStoreCount = 0;
  for (const channel of channels) {
    if (ids.has(channel.channelId)) {
      throw new MultiSourceCatalogError('MULTI_SOURCE_DUPLICATE_CHANNEL_ID', `중복 channelId입니다: ${channel.channelId}`);
    }
    ids.add(channel.channelId);
    if (channel.externalStoreId) {
      const identity = `${channel.platformType}:${channel.externalStoreId}`;
      if (platformStores.has(identity)) {
        throw new MultiSourceCatalogError('MULTI_SOURCE_DUPLICATE_PLATFORM_STORE', `동일 플랫폼 스토어가 중복 등록됐습니다: ${identity}`);
      }
      platformStores.add(identity);
    }
    if (channel.primaryDomain) {
      if (domains.has(channel.primaryDomain)) {
        throw new MultiSourceCatalogError('MULTI_SOURCE_DUPLICATE_CHANNEL_DOMAIN', `동일 도메인이 중복 등록됐습니다: ${channel.primaryDomain}`);
      }
      domains.add(channel.primaryDomain);
    }
    if (channel.channelRole === 'owned_store' && channel.platformType === 'cafe24') cafe24OwnedStoreCount += 1;
  }
  if (cafe24OwnedStoreCount > 1) {
    throw new MultiSourceCatalogError(
      'MULTI_SOURCE_DUPLICATE_CAFE24_OWN_MALL',
      'HAAR 자사몰과 Cafe24를 별도 채널로 중복 등록할 수 없습니다.'
    );
  }
}

function defaultSources(env, driveConfig) {
  const catalogFolderId = asString(driveConfig?.catalogFolderId || env.GOOGLE_DRIVE_CATALOG_FOLDER_ID);
  if (!catalogFolderId) return [];
  return [{
    sourceId: asString(env.ATELIER_QUEENSILVER_SOURCE_ID, 'queensilver_20260811'),
    sourceName: asString(env.ATELIER_QUEENSILVER_SOURCE_NAME, '퀸실버_전체상품_20260811'),
    sourceType: 'supplier',
    providerType: 'google_drive_manifest',
    rootReference: catalogFolderId,
    canonical: false,
    metadata: { expectedProductCount: 1515, initialAdapter: true }
  }];
}

function defaultChannels(env) {
  return [
    {
      channelId: asString(env.ATELIER_NAVER_CHANNEL_ID, 'haar_naver_smartstore'),
      channelName: asString(env.ATELIER_NAVER_CHANNEL_NAME, 'HAAR 네이버 스마트스토어'),
      channelRole: 'marketplace',
      platformType: 'naver_smartstore',
      externalStoreId: asString(env.NAVER_ACCOUNT_ID) || null,
      primaryDomain: null,
      accountReference: asString(env.NAVER_ACCOUNT_ID) || null
    },
    {
      channelId: asString(env.ATELIER_OWN_MALL_CHANNEL_ID, 'haar_own_mall'),
      channelName: asString(env.ATELIER_OWN_MALL_CHANNEL_NAME, 'HAAR 자사몰'),
      channelRole: 'owned_store',
      platformType: 'cafe24',
      externalStoreId: asString(env.CAFE24_MALL_ID) || null,
      primaryDomain: asString(env.HAAR_OWN_MALL_DOMAIN, 'haar.co.kr'),
      accountReference: asString(env.CAFE24_MALL_ID) || null
    }
  ];
}

export function loadMultiSourceCatalogConfig(env = process.env, { cwd = process.cwd(), driveConfig = null } = {}) {
  const rawSources = parseJsonArray(
    env.ATELIER_CATALOG_SOURCES_JSON,
    defaultSources(env, driveConfig),
    'ATELIER_CATALOG_SOURCES_JSON'
  );
  const rawChannels = parseJsonArray(
    env.ATELIER_SALES_CHANNELS_JSON,
    defaultChannels(env),
    'ATELIER_SALES_CHANNELS_JSON'
  );
  const sources = rawSources.map(normalizeSource);
  const channels = rawChannels.map(normalizeChannel);
  assertUniqueSources(sources);
  assertUniqueChannels(channels);
  return {
    enabled: asBoolean(env.ATELIER_MULTI_SOURCE_CATALOG_ENABLED, true),
    sources,
    channels,
    cacheRoot: path.resolve(cwd, asString(
      env.ATELIER_MULTI_SOURCE_CACHE_DIR,
      driveConfig?.cacheDir ? path.join(driveConfig.cacheDir, 'catalog-sources') : './work/catalog-sources'
    )),
    defaultSourceId: asString(env.ATELIER_DEFAULT_CATALOG_SOURCE_ID, sources[0]?.sourceId || '') || null,
    naverChannelId: asString(env.ATELIER_NAVER_CHANNEL_ID, 'haar_naver_smartstore'),
    ownMallChannelId: asString(env.ATELIER_OWN_MALL_CHANNEL_ID, 'haar_own_mall')
  };
}

export function publicMultiSourceCatalogConfig(config) {
  return {
    enabled: config.enabled,
    defaultSourceId: config.defaultSourceId,
    sourceCount: config.sources.length,
    channelCount: config.channels.length,
    sources: config.sources.map(source => ({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      providerType: source.providerType,
      status: source.status,
      canonical: source.canonical,
      metadata: source.metadata
    })),
    channels: config.channels.map(channel => ({
      channelId: channel.channelId,
      channelName: channel.channelName,
      channelRole: channel.channelRole,
      platformType: channel.platformType,
      externalStoreId: channel.externalStoreId,
      primaryDomain: channel.primaryDomain,
      status: channel.status
    }))
  };
}

export const _internal = {
  normalizeIdentifier,
  normalizeProviderType,
  normalizeSourceType,
  normalizeChannelRole,
  normalizePlatformType,
  normalizeSource,
  normalizeChannel,
  assertUniqueChannels,
  defaultSources,
  defaultChannels
};
