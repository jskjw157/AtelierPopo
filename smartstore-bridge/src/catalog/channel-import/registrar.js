import { asChannelImportError } from './errors.js';

function failureItem(item, error) {
  const normalized = asChannelImportError(error, 'CHANNEL_PRODUCT_REGISTRATION_FAILED');
  return {
    channelId: String(item?.channelId || ''),
    remoteProductId: String(item?.remoteProductId || ''),
    channelProductKey: item?.channelProductKey || null,
    code: normalized.code,
    message: normalized.message,
    details: normalized.details || null
  };
}

export class ChannelProductRegistrar {
  constructor({ repository } = {}) {
    if (!repository || typeof repository.upsertImportedChannelProduct !== 'function') {
      throw new Error('ChannelProductRegistrar에는 channel import repository가 필요합니다.');
    }
    this.repository = repository;
  }

  registerPage({ importRunId, items } = {}) {
    const input = Array.isArray(items) ? items : [];
    const result = {
      discovered: input.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      failures: [],
      registrations: []
    };
    for (const item of input) {
      try {
        const registration = this.repository.upsertImportedChannelProduct({
          importRunId,
          draft: item
        });
        result.registrations.push(registration);
        if (registration.created) result.created += 1;
        else if (registration.updated) result.updated += 1;
        else if (registration.unchanged) result.unchanged += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push(failureItem(item, error));
      }
    }
    return result;
  }
}

export const _internal = { failureItem };
