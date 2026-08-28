import crypto from 'node:crypto';
import { ChannelImportError } from './errors.js';

function stableJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

export function normalizeExactCode(value) {
  const text = String(value ?? '').normalize('NFKC').trim();
  return text ? text.replace(/\s+/g, ' ').replace(/[-_\s]+/g, '-').toUpperCase() : null;
}

export function normalizeVariantSkuSet(values) {
  return [...new Set((values || []).map(normalizeExactCode).filter(Boolean))].sort();
}

export function makeChannelProductRef(channelId, remoteProductId) {
  const channel = String(channelId || '').trim().toLowerCase();
  const remote = String(remoteProductId || '').trim();
  if (!channel || !remote) {
    throw new ChannelImportError(
      'CHANNEL_PRODUCT_REF_REQUIRED',
      'channelId와 remoteProductId가 필요합니다.'
    );
  }
  return `${channel}:${remote}`;
}

export function hashChannelProduct(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

export function validateNormalizedChannelProduct(value) {
  for (const key of ['channelId', 'remoteProductId', 'channelProductRef', 'productName', 'raw']) {
    if (value?.[key] === undefined || value?.[key] === null || value?.[key] === '') {
      throw new ChannelImportError(
        'CHANNEL_PRODUCT_INVALID',
        `${key} 값이 필요합니다.`,
        { details: { key } }
      );
    }
  }
  return structuredClone(value);
}

export const _internal = { stableJson };
