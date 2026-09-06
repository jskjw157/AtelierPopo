import { AppError } from '../http.js';
import { createSignedMediaUrl } from '../media.js';
import { graphGet, graphPost } from './client.js';

async function resolvePermalink(externalPostId, accessToken) {
  if (!externalPostId) return null;
  try {
    const result = await graphGet(`/${externalPostId}`, accessToken, {
      fields: 'id,permalink_url,created_time'
    });
    return result.permalink_url || null;
  } catch {
    return null;
  }
}

export async function publishFacebook({ connection, accessToken, variant, assets }) {
  const pageId = connection.page_id;
  if (!pageId) throw new AppError(409, 'FACEBOOK_NOT_CONNECTED', '연결된 Facebook 페이지가 없습니다.');

  let response;
  switch (variant.format) {
    case 'text':
    case 'link': {
      if (!variant.caption && !variant.link_url) {
        throw new AppError(400, 'FACEBOOK_TEXT_REQUIRED', 'Facebook 게시물 문구 또는 링크가 필요합니다.');
      }
      response = await graphPost(`/${pageId}/feed`, accessToken, {
        message: variant.caption || undefined,
        link: variant.link_url || undefined
      });
      break;
    }
    case 'image': {
      if (assets.length !== 1 || assets[0].media_type !== 'image') {
        throw new AppError(400, 'FACEBOOK_IMAGE_INVALID', 'Facebook 단일 이미지 게시물에는 이미지 1장이 필요합니다.');
      }
      response = await graphPost(`/${pageId}/photos`, accessToken, {
        url: createSignedMediaUrl(assets[0]),
        caption: variant.caption || undefined,
        published: true
      });
      break;
    }
    case 'carousel': {
      if (assets.length < 2 || assets.length > 10 || assets.some((asset) => asset.media_type !== 'image')) {
        throw new AppError(400, 'FACEBOOK_CAROUSEL_INVALID', '현재 Facebook 다중 사진 게시물은 이미지 2~10장만 지원합니다.');
      }
      const photoIds = [];
      for (const asset of assets) {
        const photo = await graphPost(`/${pageId}/photos`, accessToken, {
          url: createSignedMediaUrl(asset),
          published: false
        });
        photoIds.push(photo.id);
      }
      const attachedMedia = Object.fromEntries(
        photoIds.map((id, index) => [`attached_media[${index}]`, { media_fbid: id }])
      );
      response = await graphPost(`/${pageId}/feed`, accessToken, {
        message: variant.caption || undefined,
        ...attachedMedia
      });
      break;
    }
    case 'video': {
      if (assets.length !== 1 || assets[0].media_type !== 'video') {
        throw new AppError(400, 'FACEBOOK_VIDEO_INVALID', 'Facebook 영상 게시물에는 영상 1개가 필요합니다.');
      }
      response = await graphPost(`/${pageId}/videos`, accessToken, {
        file_url: createSignedMediaUrl(assets[0]),
        description: variant.caption || undefined,
        published: true
      });
      break;
    }
    default:
      throw new AppError(400, 'FACEBOOK_FORMAT_UNSUPPORTED', `지원하지 않는 Facebook 형식입니다: ${variant.format}`);
  }

  const externalPostId = response.post_id || response.id;
  return {
    externalPostId,
    permalink: await resolvePermalink(externalPostId, accessToken),
    raw: {}
  };
}
