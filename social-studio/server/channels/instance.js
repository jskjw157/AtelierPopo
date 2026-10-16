import { pool } from '../db.js';
import { config } from '../config.js';
import { encryptSecret, decryptSecret } from '../security.js';
import { createSignedMediaUrl } from '../media.js';
import { channelConfig } from './policy.js';
import { createProviders } from './providers.js';
import { readChannelMedia } from './media.js';
import { createChannelRuntime } from './runtime.js';

export const channelServices = createChannelRuntime({
  pool, settings: channelConfig(process.env, config.appBaseUrl), providers: createProviders(),
  encrypt: encryptSecret, decrypt: decryptSecret,
  // TikTok URL fetch and Threads processing can outlast short preview URLs.
  mediaUrl: asset => createSignedMediaUrl(asset, 24 * 60 * 60),
  readMedia: asset => readChannelMedia(config.uploadDir, asset)
});
