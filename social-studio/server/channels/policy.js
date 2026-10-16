import { z } from 'zod';
import { AppError } from '../http.js';

export const platforms = ['threads', 'tiktok', 'x'];
export const definitions = {
  threads: { name: 'Threads', scopes: ['threads_basic', 'threads_content_publish'], formats: ['text', 'image', 'carousel', 'video'], note: '별도 Threads 앱과 사용자 승인이 필요합니다. 일반 사용자 연결에는 앱 심사가 적용됩니다.' },
  tiktok: { name: 'TikTok', scopes: ['user.info.basic', 'video.upload'], formats: ['video'], note: 'TikTok 받은 편지함에 영상 초안을 전달합니다. TikTok에서 사용자가 최종 게시해야 합니다. 내부 팀 전용 도구는 Direct Post 허용 용도가 아닙니다.' },
  x: { name: 'X', scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'], formats: ['text', 'image'], note: '사용량 과금: 일반 게시 $0.015, URL 포함 $0.200/요청(2026-10-16 공식 문서). 미디어·조회 비용 별도, 콘솔 최종 단가 확인 필요.' }
};
export const fail = (code, message, status = 409) => new AppError(status, code, message);

export function channelConfig(env = process.env, appBaseUrl = '') {
  return Object.fromEntries(platforms.map(platform => {
    const key = platform.toUpperCase();
    return [platform, {
      clientId: env[`${key}_CLIENT_ID`] || '',
      clientSecret: env[`${key}_CLIENT_SECRET`] || '',
      redirectUri: `${appBaseUrl}/api/channels/${platform}/callback`,
      connectEnabled: env[`${key}_CONNECT_ENABLED`] === 'true',
      writesEnabled: env[`${key}_WRITES_ENABLED`] === 'true',
      billingApproved: platform !== 'x' || env.X_BILLING_APPROVED === 'true',
      verifiedOrigin: platform === 'tiktok' ? env.TIKTOK_VERIFIED_MEDIA_ORIGIN || '' : ''
    }];
  }));
}

export function platformDefinition(platform) {
  if (!platforms.includes(platform)) throw fail('CHANNEL_UNSUPPORTED', '지원하지 않는 채널입니다.', 400);
  return definitions[platform];
}

export function requireConfigured(settings) {
  if (!settings?.connectEnabled || !settings.clientId || !settings.clientSecret || !/^https:\/\//.test(settings.redirectUri)) {
    throw fail('CHANNEL_NOT_CONFIGURED', '앱 등록과 HTTPS 콜백 설정 후 연결을 활성화해 주세요.');
  }
  if (!settings.billingApproved) throw fail('CHANNEL_BILLING_APPROVAL_REQUIRED', 'X 과금과 크레딧 사용 승인이 필요합니다.');
}

export function requireWrites(settings) {
  requireConfigured(settings);
  if (!settings.writesEnabled) throw fail('CHANNEL_WRITES_DISABLED', '이 채널의 실제 업로드·게시가 비활성화되어 있습니다.');
}

const inputSchema = z.object({
  clientRequestId: z.string().uuid(), platform: z.enum(platforms),
  format: z.enum(['text', 'image', 'carousel', 'video']),
  caption: z.string().trim().max(2200).default(''),
  mediaAssetIds: z.array(z.string().uuid()).max(10).default([]),
  mode: z.enum(['draft', 'publish', 'schedule']),
  scheduledAt: z.string().datetime().nullable().optional(),
  consent: z.literal(true),
  accountGeneration: z.string().uuid().nullable().optional()
}).strict();

export function validatePost(input, now = Date.now(), checkSchedule = true) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw fail('CHANNEL_INPUT_INVALID', '채널·본문·미디어·대상 확인 동의를 다시 확인해 주세요.', 400);
  const value = parsed.data, { platform, format, mediaAssetIds, caption } = value;
  if (!definitions[platform].formats.includes(format)) throw fail('CHANNEL_FORMAT_UNSUPPORTED', '이 채널에서 지원하지 않는 형식입니다.', 400);
  const count = mediaAssetIds.length;
  if (new Set(mediaAssetIds).size !== count) throw fail('CHANNEL_MEDIA_INVALID', '같은 미디어를 중복 선택할 수 없습니다.', 400);
  if ((format === 'text' && (count || !caption)) || (['image','video'].includes(format) && count !== 1 && !(platform === 'x' && format === 'image' && count >= 1 && count <= 4)) || (format === 'carousel' && (count < 2 || count > 10))) {
    throw fail('CHANNEL_MEDIA_INVALID', '선택한 형식에 맞는 미디어와 본문이 필요합니다.', 400);
  }
  if (platform === 'threads' && [...caption].length > 500) throw fail('CHANNEL_TEXT_TOO_LONG', 'Threads 본문은 500자 이하여야 합니다.', 400);
  // Conservative weighted limit: URLs count as 23, wide Unicode characters as 2.
  if (platform === 'x') {
    const withoutUrls = caption.replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23));
    const weight = [...withoutUrls].reduce((n,c) => n + (c.codePointAt(0) > 0x10ff ? 2 : 1), 0);
    if (weight > 280) throw fail('CHANNEL_TEXT_TOO_LONG', 'X 표준 게시물의 가중 280자 제한을 초과했습니다.', 400);
  }
  if (checkSchedule && value.mode === 'schedule' && (!value.scheduledAt || Date.parse(value.scheduledAt) <= now + 60_000)) {
    throw fail('CHANNEL_SCHEDULE_INVALID', '예약 시간은 현재보다 최소 1분 이후여야 합니다.', 400);
  }
  return { ...value, scheduledAt: value.mode === 'schedule' ? value.scheduledAt : null };
}

export function validateAssets(post, assets) {
  if (assets.length !== post.media_asset_ids.length || assets.some(a => a.status !== 'ready')) throw fail('CHANNEL_MEDIA_MISSING', '선택한 미디어를 사용할 수 없습니다.');
  const type = post.format === 'video' ? 'video' : 'image';
  if (assets.some(a => a.media_type !== type)) throw fail('CHANNEL_MEDIA_INVALID', '미디어 종류가 게시 형식과 다릅니다.', 400);
  if (post.platform === 'x' && assets.some(a => a.bytes > 5 * 1024 * 1024)) throw fail('CHANNEL_MEDIA_INVALID', 'X 이미지는 각 5MB 이하여야 합니다.', 400);
}
