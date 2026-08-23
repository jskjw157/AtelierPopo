import { AppError } from '../http.js';
import { createSignedMediaUrl } from '../media.js';
import { graphGet, graphPost } from './client.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForContainer(containerId, accessToken, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await graphGet(`/${containerId}`, accessToken, { fields: 'status_code,status' });
    if (status.status_code === 'FINISHED' || status.status_code === 'PUBLISHED') return status;
    if (['ERROR', 'EXPIRED'].includes(status.status_code)) {
      throw new AppError(400, 'INSTAGRAM_PROCESSING_FAILED', 'Instagram에서 미디어 처리를 완료하지 못했습니다.', {
        status: status.status_code
      });
    }
    await sleep(5_000);
  }
  throw new AppError(504, 'INSTAGRAM_PROCESSING_TIMEOUT', 'Instagram 미디어 처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
}

async function createImageContainer({ igId, accessToken, asset, caption, altText, isCarouselItem = false }) {
  const payload = {
    image_url: createSignedMediaUrl(asset),
    is_carousel_item: isCarouselItem || undefined
  };
  if (!isCarouselItem) {
    payload.caption = caption || undefined;
    payload.alt_text = altText || undefined;
  }
  const container = await graphPost(`/${igId}/media`, accessToken, payload);
  await waitForContainer(container.id, accessToken, { timeoutMs: 2 * 60 * 1000 });
  return container.id;
}

async function createReelContainer({ igId, accessToken, asset, caption }) {
  const container = await graphPost(`/${igId}/media`, accessToken, {
    media_type: 'REELS',
    video_url: createSignedMediaUrl(asset),
    caption: caption || undefined,
    share_to_feed: true
  });
  await waitForContainer(container.id, accessToken);
  return container.id;
}

async function publishContainer(igId, accessToken, creationId) {
  const published = await graphPost(`/${igId}/media_publish`, accessToken, {
    creation_id: creationId
  });
  let details = {};
  try {
    details = await graphGet(`/${published.id}`, accessToken, {
      fields: 'id,permalink,timestamp,media_type'
    });
  } catch {
    // The publish response is authoritative. Permalink resolution can be retried during analytics sync.
  }
  return {
    externalPostId: published.id,
    permalink: details.permalink || null,
    raw: { mediaType: details.media_type || null, timestamp: details.timestamp || null }
  };
}

export async function getInstagramPublishingLimit(connection, accessToken) {
  try {
    return await graphGet(`/${connection.instagram_account_id}/content_publishing_limit`, accessToken, {
      fields: 'quota_usage,config'
    });
  } catch {
    return null;
  }
}

export async function publishInstagram({ connection, accessToken, variant, assets }) {
  const igId = connection.instagram_account_id;
  if (!igId) {
    throw new AppError(409, 'INSTAGRAM_NOT_CONNECTED', '연결된 Instagram 프로페셔널 계정이 없습니다.');
  }

  let creationId;
  switch (variant.format) {
    case 'image': {
      if (assets.length !== 1 || assets[0].media_type !== 'image') {
        throw new AppError(400, 'INSTAGRAM_IMAGE_INVALID', 'Instagram 단일 이미지 게시물에는 이미지 1장이 필요합니다.');
      }
      creationId = await createImageContainer({
        igId,
        accessToken,
        asset: assets[0],
        caption: variant.caption,
        altText: variant.alt_text
      });
      break;
    }
    case 'carousel': {
      if (assets.length < 2 || assets.length > 10 || assets.some((asset) => asset.media_type !== 'image')) {
        throw new AppError(400, 'INSTAGRAM_CAROUSEL_INVALID', '현재 Instagram 캐러셀은 이미지 2~10장만 지원합니다.');
      }
      const childIds = [];
      for (const asset of assets) {
        childIds.push(
          await createImageContainer({ igId, accessToken, asset, isCarouselItem: true })
        );
      }
      const parent = await graphPost(`/${igId}/media`, accessToken, {
        media_type: 'CAROUSEL',
        children: childIds,
        caption: variant.caption || undefined
      });
      await waitForContainer(parent.id, accessToken, { timeoutMs: 3 * 60 * 1000 });
      creationId = parent.id;
      break;
    }
    case 'reel': {
      if (assets.length !== 1 || assets[0].media_type !== 'video') {
        throw new AppError(400, 'INSTAGRAM_REEL_INVALID', 'Instagram 릴스 게시물에는 영상 1개가 필요합니다.');
      }
      creationId = await createReelContainer({
        igId,
        accessToken,
        asset: assets[0],
        caption: variant.caption
      });
      break;
    }
    default:
      throw new AppError(400, 'INSTAGRAM_FORMAT_UNSUPPORTED', `지원하지 않는 Instagram 형식입니다: ${variant.format}`);
  }

  return publishContainer(igId, accessToken, creationId);
}
