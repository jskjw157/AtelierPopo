import { randomUUID } from 'node:crypto';
import { query, audit } from './db.js';
import { AppError } from './http.js';
import { decryptSecret, safeErrorMessage } from './security.js';
import { graphGet } from './meta/client.js';

function asCount(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function insightMap(payload) {
  const values = {};
  for (const item of payload?.data || []) {
    const latest = Array.isArray(item.values) ? item.values.at(-1)?.value : item.value;
    values[item.name] = latest;
  }
  return values;
}

async function syncInstagram(variant, accessToken) {
  const base = await graphGet(`/${variant.external_post_id}`, accessToken, {
    fields: 'id,permalink,timestamp,media_type,like_count,comments_count'
  });

  const insights = {};
  const insightErrors = [];
  for (const metric of ['reach', 'views', 'saved', 'shares', 'total_interactions']) {
    try {
      Object.assign(
        insights,
        insightMap(await graphGet(`/${variant.external_post_id}/insights`, accessToken, { metric }))
      );
    } catch (error) {
      insightErrors.push(`${metric}: ${safeErrorMessage(error)}`);
    }
  }
  const insightsError = insightErrors.length ? insightErrors.join(' | ').slice(0, 1000) : null;

  return {
    permalink: base.permalink || variant.permalink || null,
    impressions: null,
    reach: asCount(insights.reach),
    likes: asCount(base.like_count),
    comments: asCount(base.comments_count),
    shares: asCount(insights.shares),
    saves: asCount(insights.saved),
    clicks: null,
    rawSupportedMetrics: {
      mediaType: base.media_type || null,
      views: asCount(insights.views),
      totalInteractions: asCount(insights.total_interactions)
    },
    syncError: insightsError
  };
}

async function syncFacebook(variant, accessToken) {
  const base = await graphGet(`/${variant.external_post_id}`, accessToken, {
    fields: 'id,permalink_url,created_time,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares'
  });
  return {
    permalink: base.permalink_url || variant.permalink || null,
    impressions: null,
    reach: null,
    likes: asCount(base.reactions?.summary?.total_count),
    comments: asCount(base.comments?.summary?.total_count),
    shares: asCount(base.shares?.count),
    saves: null,
    clicks: null,
    rawSupportedMetrics: {},
    syncError: null
  };
}

export async function syncVariantAnalytics(variantId, actorUserId) {
  const result = await query(
    `SELECT pv.*, sc.access_token_encrypted, sc.status AS connection_status
     FROM post_variants pv
     LEFT JOIN social_connections sc ON sc.platform = pv.platform
     WHERE pv.id = $1`,
    [variantId]
  );
  if (!result.rowCount) throw new AppError(404, 'POST_NOT_FOUND', '게시물을 찾지 못했습니다.');
  const variant = result.rows[0];
  if (variant.publish_state !== 'published' || !variant.external_post_id) {
    throw new AppError(409, 'POST_NOT_PUBLISHED', '발행 완료된 게시물만 성과를 동기화할 수 있습니다.');
  }
  if (variant.connection_status !== 'connected' || !variant.access_token_encrypted) {
    throw new AppError(409, 'SOCIAL_NOT_CONNECTED', '연결된 소셜 계정이 없습니다.');
  }

  const accessToken = decryptSecret(variant.access_token_encrypted);
  let metrics;
  try {
    if (variant.platform === 'instagram') metrics = await syncInstagram(variant, accessToken);
    else if (variant.platform === 'facebook') metrics = await syncFacebook(variant, accessToken);
    else throw new AppError(400, 'PLATFORM_NOT_IMPLEMENTED', '이 플랫폼의 성과 동기화는 아직 지원하지 않습니다.');
  } catch (error) {
    const syncError = safeErrorMessage(error);
    await query(
      `INSERT INTO analytics_snapshots
        (id, post_variant_id, sync_error)
       VALUES ($1, $2, $3)`,
      [randomUUID(), variantId, syncError]
    );
    throw error;
  }

  await query(
    `INSERT INTO analytics_snapshots
      (id, post_variant_id, impressions, reach, likes, comments, shares, saves, clicks,
       raw_supported_metrics, sync_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      randomUUID(),
      variantId,
      metrics.impressions,
      metrics.reach,
      metrics.likes,
      metrics.comments,
      metrics.shares,
      metrics.saves,
      metrics.clicks,
      JSON.stringify(metrics.rawSupportedMetrics || {}),
      metrics.syncError
    ]
  );
  if (metrics.permalink && metrics.permalink !== variant.permalink) {
    await query('UPDATE post_variants SET permalink = $2, updated_at = NOW() WHERE id = $1', [
      variantId,
      metrics.permalink
    ]);
  }
  await audit(actorUserId, 'analytics.synced', 'post_variant', variantId, {
    platform: variant.platform,
    partial: Boolean(metrics.syncError)
  });
  return metrics;
}

export async function listAnalytics() {
  const result = await query(
    `SELECT pv.id, pv.platform, pv.format, pv.caption, pv.permalink, pv.external_post_id,
            pv.updated_at AS published_at, c.title AS campaign_title,
            snap.captured_at, snap.impressions, snap.reach, snap.likes, snap.comments,
            snap.shares, snap.saves, snap.clicks, snap.raw_supported_metrics, snap.sync_error
     FROM post_variants pv
     JOIN campaigns c ON c.id = pv.campaign_id
     LEFT JOIN LATERAL (
       SELECT * FROM analytics_snapshots a
       WHERE a.post_variant_id = pv.id
       ORDER BY a.captured_at DESC LIMIT 1
     ) snap ON TRUE
     WHERE pv.publish_state = 'published'
     ORDER BY pv.updated_at DESC
     LIMIT 200`
  );
  return result.rows;
}
