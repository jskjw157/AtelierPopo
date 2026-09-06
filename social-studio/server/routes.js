import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { config, coreMissingConfig, coreConfigErrors, metaMissingConfig } from './config.js';
import { query, transaction, audit } from './db.js';
import { AppError, asyncRoute } from './http.js';
import {
  currentUser,
  login,
  loginLimiter,
  logout,
  requireAuth,
  requireCsrf
} from './auth.js';
import {
  createSignedMediaUrl,
  getMediaAsset,
  listMediaAssets,
  saveUploadedAsset,
  serveSignedMedia,
  upload
} from './media.js';
import {
  disconnectMeta,
  finishMetaOAuth,
  getPendingPages,
  listConnectionStatus,
  selectMetaPage,
  startMetaOAuth,
  testMetaConnection
} from './meta/oauth.js';
import {
  createManualDeletionRequest,
  getDeletionStatus,
  receiveMetaDeletionRequest
} from './meta/data-deletion.js';
import { getInstagramPublishingLimit } from './meta/instagram.js';
import { decryptSecret } from './security.js';
import { publishVariant, runDuePosts } from './publish/service.js';
import { listAnalytics, syncVariantAnalytics } from './analytics.js';

const router = express.Router();

const httpUrl = z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'HTTP 또는 HTTPS URL만 허용됩니다.');
const nullableUrl = z.union([httpUrl, z.literal(''), z.null()]).optional();
const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional().default(''),
  confirmedMaterial: z.string().trim().max(200).optional().default(''),
  variant: z.string().trim().max(200).optional().default(''),
  price: z.union([z.number().nonnegative(), z.string(), z.null()]).optional(),
  productUrl: nullableUrl,
  keyPoints: z.array(z.string().trim().min(1).max(300)).max(12).optional().default([]),
  active: z.boolean().optional().default(true)
});

const variantSchema = z.object({
  platform: z.enum(['instagram', 'facebook']),
  format: z.enum(['image', 'carousel', 'reel', 'text', 'link', 'video']),
  caption: z.string().max(10000).optional().default(''),
  altText: z.string().max(2000).optional().default(''),
  linkUrl: nullableUrl,
  mediaAssetIds: z.array(z.string().uuid()).max(10).optional().default([])
});

const campaignSchema = z.object({
  clientRequestId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  productId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional(),
  masterCaption: z.string().max(10000).optional().default(''),
  mode: z.enum(['draft', 'publish', 'schedule']),
  scheduledAt: z.union([z.string().datetime(), z.literal(''), z.null()]).optional(),
  variants: z.array(variantSchema).min(1).max(2)
});

const campaignUpdateSchema = campaignSchema.omit({ clientRequestId: true });

function parsed(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', '입력 내용을 다시 확인해 주세요.', result.error.flatten());
  }
  return result.data;
}

function normalizePrice(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError(400, 'PRICE_INVALID', '가격은 0 이상의 숫자로 입력해 주세요.');
  }
  return number;
}

function validateVariantMedia(variant) {
  const count = variant.mediaAssetIds.length;
  if (variant.platform === 'instagram') {
    if (variant.format === 'image' && count !== 1) throw new AppError(400, 'MEDIA_COUNT_INVALID', 'Instagram 단일 이미지는 이미지 1장이 필요합니다.');
    if (variant.format === 'carousel' && (count < 2 || count > 10)) throw new AppError(400, 'MEDIA_COUNT_INVALID', 'Instagram 캐러셀은 이미지 2~10장이 필요합니다.');
    if (variant.format === 'reel' && count !== 1) throw new AppError(400, 'MEDIA_COUNT_INVALID', 'Instagram 릴스는 영상 1개가 필요합니다.');
    if (!['image', 'carousel', 'reel'].includes(variant.format)) throw new AppError(400, 'FORMAT_INVALID', '지원하지 않는 Instagram 게시 형식입니다.');
  }
  if (variant.platform === 'facebook') {
    if (variant.format === 'image' && count !== 1) throw new AppError(400, 'MEDIA_COUNT_INVALID', 'Facebook 단일 이미지는 이미지 1장이 필요합니다.');
    if (variant.format === 'carousel' && (count < 2 || count > 10)) throw new AppError(400, 'MEDIA_COUNT_INVALID', 'Facebook 다중 사진은 이미지 2~10장이 필요합니다.');
    if (variant.format === 'video' && count !== 1) throw new AppError(400, 'MEDIA_COUNT_INVALID', 'Facebook 영상은 영상 1개가 필요합니다.');
    if (['text', 'link'].includes(variant.format) && count > 0) throw new AppError(400, 'MEDIA_COUNT_INVALID', '텍스트/링크 게시물에는 미디어를 넣을 수 없습니다.');
    if (!['image', 'carousel', 'video', 'text', 'link'].includes(variant.format)) throw new AppError(400, 'FORMAT_INVALID', '지원하지 않는 Facebook 게시 형식입니다.');
  }
}

function idempotencyKey(clientRequestId, platform, index) {
  return createHash('sha256').update(`${clientRequestId}:${platform}:${index}`).digest('hex');
}

router.get('/api/health', asyncRoute(async (_req, res) => {
  let database = 'unavailable';
  try {
    await query('SELECT 1');
    database = 'ok';
  } catch {
    database = 'unavailable';
  }
  res.json({
    status: database === 'ok' && coreMissingConfig().length === 0 && coreConfigErrors().length === 0 ? 'ok' : 'degraded',
    database,
    coreMissing: coreMissingConfig(),
    coreErrors: coreConfigErrors(),
    metaMissing: metaMissingConfig(),
    version: process.env.npm_package_version || '0.1.0'
  });
}));

router.post('/api/auth/login', loginLimiter, asyncRoute(login));
router.post('/api/auth/logout', requireAuth, requireCsrf, logout);
router.get('/api/auth/me', currentUser);

router.get('/api/dashboard', requireAuth, asyncRoute(async (_req, res) => {
  const [counts, connections, activity, scheduler, campaigns] = await Promise.all([
    query(`SELECT publish_state, COUNT(*)::int AS count FROM post_variants GROUP BY publish_state`),
    listConnectionStatus(),
    query(`SELECT action, entity_type, entity_id, metadata, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 12`),
    query(`SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT 1`),
    query(`SELECT c.id, c.title, c.status, c.updated_at, p.name AS product_name,
                  COUNT(pv.id)::int AS variant_count
           FROM campaigns c
           LEFT JOIN products p ON p.id = c.product_id
           LEFT JOIN post_variants pv ON pv.campaign_id = c.id
           GROUP BY c.id, p.name
           ORDER BY c.updated_at DESC LIMIT 8`)
  ]);
  const byState = Object.fromEntries(counts.rows.map((row) => [row.publish_state, row.count]));
  res.json({
    counts: {
      drafts: byState.draft || 0,
      scheduled: (byState.scheduled || 0) + (byState.queued || 0),
      published: byState.published || 0,
      failed: byState.failed || 0
    },
    connections,
    recentActivity: activity.rows,
    recentCampaigns: campaigns.rows,
    scheduler: {
      configured: Boolean(config.cronSecret),
      lastRun: scheduler.rows[0] || null,
      active: Boolean(config.cronSecret && scheduler.rows[0]?.status?.startsWith('completed'))
    }
  });
}));

router.get('/api/products', requireAuth, asyncRoute(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const result = await query(
    `SELECT * FROM products ${includeInactive ? '' : 'WHERE active = TRUE'} ORDER BY updated_at DESC LIMIT 500`
  );
  res.json({ products: result.rows });
}));

router.post('/api/products', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const value = parsed(productSchema, req.body);
  const id = randomUUID();
  const result = await query(
    `INSERT INTO products
      (id, name, category, confirmed_material, variant, price, product_url, key_points, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
    [id, value.name, value.category || null, value.confirmedMaterial || null, value.variant || null,
      normalizePrice(value.price), value.productUrl || null, JSON.stringify(value.keyPoints), value.active]
  );
  await audit(req.user.sub, 'product.created', 'product', id, { name: value.name });
  res.status(201).json({ product: result.rows[0] });
}));

router.put('/api/products/:id', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const value = parsed(productSchema, req.body);
  const result = await query(
    `UPDATE products SET name=$2, category=$3, confirmed_material=$4, variant=$5, price=$6,
       product_url=$7, key_points=$8::jsonb, active=$9, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [req.params.id, value.name, value.category || null, value.confirmedMaterial || null,
      value.variant || null, normalizePrice(value.price), value.productUrl || null,
      JSON.stringify(value.keyPoints), value.active]
  );
  if (!result.rowCount) throw new AppError(404, 'PRODUCT_NOT_FOUND', '상품을 찾지 못했습니다.');
  await audit(req.user.sub, 'product.updated', 'product', req.params.id, { name: value.name });
  res.json({ product: result.rows[0] });
}));

router.get('/api/media', requireAuth, asyncRoute(async (_req, res) => {
  res.json({ media: await listMediaAssets() });
}));

router.post('/api/media', requireAuth, requireCsrf, upload.single('file'), asyncRoute(async (req, res) => {
  const asset = await saveUploadedAsset(req.file, req.user.sub, req.body?.altText || '');
  res.status(201).json({ asset });
}));

router.get('/api/media/:id/preview', requireAuth, asyncRoute(async (req, res) => {
  const asset = await getMediaAsset(req.params.id);
  const filePath = path.join(config.uploadDir, asset.file_name);
  try { await fsp.access(filePath); } catch { throw new AppError(404, 'MEDIA_FILE_MISSING', '저장된 미디어 파일을 찾지 못했습니다.'); }
  res.set({
    'Content-Type': asset.mime_type,
    'Content-Length': String(asset.bytes),
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  });
  fs.createReadStream(filePath).pipe(res);
}));

router.get('/api/media/:id/signed-url', requireAuth, asyncRoute(async (req, res) => {
  const asset = await getMediaAsset(req.params.id);
  res.json({ url: createSignedMediaUrl(asset, 5 * 60) });
}));

router.get('/public-media/:id', asyncRoute(serveSignedMedia));

router.get('/api/campaigns', requireAuth, asyncRoute(async (_req, res) => {
  const result = await query(
    `SELECT c.*, p.name AS product_name,
       COALESCE(json_agg(json_build_object(
         'id', pv.id, 'platform', pv.platform, 'format', pv.format, 'caption', pv.caption,
         'scheduledAt', pv.scheduled_at, 'publishState', pv.publish_state,
         'externalPostId', pv.external_post_id, 'permalink', pv.permalink,
         'lastError', pv.last_error, 'mediaAssetIds', pv.media_asset_ids
       ) ORDER BY pv.created_at) FILTER (WHERE pv.id IS NOT NULL), '[]') AS variants
     FROM campaigns c
     LEFT JOIN products p ON p.id = c.product_id
     LEFT JOIN post_variants pv ON pv.campaign_id = c.id
     GROUP BY c.id, p.name
     ORDER BY c.created_at DESC LIMIT 300`
  );
  res.json({ campaigns: result.rows });
}));

router.get('/api/campaigns/:id', requireAuth, asyncRoute(async (req, res) => {
  const campaignResult = await query(
    `SELECT c.*, p.name AS product_name
     FROM campaigns c LEFT JOIN products p ON p.id = c.product_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!campaignResult.rowCount) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', '캠페인을 찾지 못했습니다.');
  const variants = await query(
    `SELECT * FROM post_variants WHERE campaign_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.json({ campaign: campaignResult.rows[0], variants: variants.rows });
}));

router.put('/api/campaigns/:id', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const value = parsed(campaignUpdateSchema, req.body);
  for (const variant of value.variants) validateVariantMedia(variant);
  const uniquePlatforms = new Set(value.variants.map((variant) => variant.platform));
  if (uniquePlatforms.size !== value.variants.length) {
    throw new AppError(400, 'DUPLICATE_PLATFORM', '한 캠페인에는 플랫폼별 게시물을 하나씩만 만들 수 있습니다.');
  }
  let scheduledAt = null;
  if (value.mode === 'schedule') {
    scheduledAt = new Date(value.scheduledAt || '');
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 60_000) {
      throw new AppError(400, 'SCHEDULE_TIME_INVALID', '예약 시간은 현재보다 최소 1분 이후로 설정해 주세요.');
    }
  }
  if (value.productId) {
    const product = await query('SELECT id FROM products WHERE id = $1', [value.productId]);
    if (!product.rowCount) throw new AppError(400, 'PRODUCT_NOT_FOUND', '연결할 상품을 찾지 못했습니다.');
  }

  const postState = value.mode === 'draft' ? 'draft' : value.mode === 'schedule' ? 'scheduled' : 'reviewed';
  const campaignStatus = value.mode === 'draft' ? 'draft' : value.mode === 'schedule' ? 'scheduled' : 'reviewed';
  const updatedVariants = await transaction(async (client) => {
    const locked = await client.query('SELECT * FROM campaigns WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!locked.rowCount) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', '캠페인을 찾지 못했습니다.');
    const current = await client.query('SELECT * FROM post_variants WHERE campaign_id = $1 FOR UPDATE', [req.params.id]);
    if (current.rows.some((variant) => variant.external_post_id || ['published', 'publishing'].includes(variant.publish_state))) {
      throw new AppError(409, 'CAMPAIGN_NOT_EDITABLE', '발행되었거나 발행 확인 중인 캠페인은 수정할 수 없습니다.');
    }

    await client.query(
      `UPDATE campaigns SET title=$2, product_id=$3, master_caption=$4, status=$5, updated_at=NOW()
       WHERE id=$1`,
      [req.params.id, value.title, value.productId || null, value.masterCaption, campaignStatus]
    );

    const requestedPlatforms = value.variants.map((variant) => variant.platform);
    await client.query(
      `DELETE FROM post_variants WHERE campaign_id=$1 AND NOT (platform = ANY($2::text[]))`,
      [req.params.id, requestedPlatforms]
    );

    const rows = [];
    for (const [index, variant] of value.variants.entries()) {
      const existing = current.rows.find((item) => item.platform === variant.platform);
      if (existing) {
        const result = await client.query(
          `UPDATE post_variants SET format=$2, caption=$3, alt_text=$4, link_url=$5,
             media_asset_ids=$6::jsonb, scheduled_at=$7, next_attempt_at=NULL, claimed_at=NULL,
             publish_state=$8, attempt_count=0, last_error=NULL, updated_at=NOW()
           WHERE id=$1 RETURNING *`,
          [existing.id, variant.format, variant.caption, variant.altText || null, variant.linkUrl || null,
            JSON.stringify(variant.mediaAssetIds), scheduledAt, postState]
        );
        rows.push(result.rows[0]);
      } else {
        const id = randomUUID();
        const result = await client.query(
          `INSERT INTO post_variants
            (id, campaign_id, platform, format, caption, alt_text, link_url, media_asset_ids,
             scheduled_at, publish_state, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING *`,
          [id, req.params.id, variant.platform, variant.format, variant.caption, variant.altText || null,
            variant.linkUrl || null, JSON.stringify(variant.mediaAssetIds), scheduledAt, postState,
            idempotencyKey(req.params.id, variant.platform, index)]
        );
        rows.push(result.rows[0]);
      }
    }
    return rows;
  });

  await audit(req.user.sub, 'campaign.updated', 'campaign', req.params.id, {
    mode: value.mode, platforms: value.variants.map((variant) => variant.platform)
  });
  const publishResults = [];
  if (value.mode === 'publish') {
    for (const variant of updatedVariants) {
      try {
        publishResults.push({ id: variant.id, ...(await publishVariant(variant.id, req.user.sub)) });
      } catch (error) {
        publishResults.push({ id: variant.id, ok: false, error: error.message });
      }
    }
  }
  res.json({ campaignId: req.params.id, variants: updatedVariants, publishResults });
}));

router.post('/api/campaigns', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const value = parsed(campaignSchema, req.body);
  for (const variant of value.variants) validateVariantMedia(variant);
  const uniquePlatforms = new Set(value.variants.map((variant) => variant.platform));
  if (uniquePlatforms.size !== value.variants.length) {
    throw new AppError(400, 'DUPLICATE_PLATFORM', '한 캠페인에는 플랫폼별 게시물을 하나씩만 만들 수 있습니다.');
  }

  let scheduledAt = null;
  if (value.mode === 'schedule') {
    scheduledAt = new Date(value.scheduledAt || '');
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 60_000) {
      throw new AppError(400, 'SCHEDULE_TIME_INVALID', '예약 시간은 현재보다 최소 1분 이후로 설정해 주세요.');
    }
  }

  if (value.productId) {
    const product = await query('SELECT id FROM products WHERE id = $1', [value.productId]);
    if (!product.rowCount) throw new AppError(400, 'PRODUCT_NOT_FOUND', '연결할 상품을 찾지 못했습니다.');
  }

  const existing = await query('SELECT id FROM campaigns WHERE client_request_id = $1', [value.clientRequestId]);
  if (existing.rowCount) {
    const variants = await query('SELECT * FROM post_variants WHERE campaign_id = $1 ORDER BY created_at', [existing.rows[0].id]);
    return res.status(200).json({ campaignId: existing.rows[0].id, variants: variants.rows, duplicateRequest: true });
  }

  const campaignId = randomUUID();
  const postState = value.mode === 'draft' ? 'draft' : value.mode === 'schedule' ? 'scheduled' : 'reviewed';
  const campaignStatus = value.mode === 'draft' ? 'draft' : value.mode === 'schedule' ? 'scheduled' : 'reviewed';
  const createdVariants = await transaction(async (client) => {
    await client.query(
      `INSERT INTO campaigns (id, client_request_id, title, product_id, master_caption, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [campaignId, value.clientRequestId, value.title, value.productId || null, value.masterCaption, campaignStatus, req.user.sub]
    );
    const rows = [];
    for (const [index, variant] of value.variants.entries()) {
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO post_variants
          (id, campaign_id, platform, format, caption, alt_text, link_url, media_asset_ids,
           scheduled_at, publish_state, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING *`,
        [id, campaignId, variant.platform, variant.format, variant.caption, variant.altText || null,
          variant.linkUrl || null, JSON.stringify(variant.mediaAssetIds), scheduledAt, postState,
          idempotencyKey(value.clientRequestId, variant.platform, index)]
      );
      rows.push(result.rows[0]);
    }
    return rows;
  });

  await audit(req.user.sub, 'campaign.created', 'campaign', campaignId, {
    mode: value.mode,
    platforms: value.variants.map((variant) => variant.platform)
  });

  const publishResults = [];
  if (value.mode === 'publish') {
    for (const variant of createdVariants) {
      try {
        publishResults.push({ id: variant.id, ...(await publishVariant(variant.id, req.user.sub)) });
      } catch (error) {
        publishResults.push({ id: variant.id, ok: false, error: error.message });
      }
    }
  }

  res.status(201).json({ campaignId, variants: createdVariants, publishResults });
}));

router.post('/api/posts/:id/publish', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  res.json(await publishVariant(req.params.id, req.user.sub));
}));

router.post('/api/posts/:id/cancel', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const result = await query(
    `UPDATE post_variants SET publish_state='cancelled', claimed_at=NULL, updated_at=NOW()
     WHERE id=$1 AND publish_state IN ('draft','reviewed','scheduled','queued','failed') RETURNING *`,
    [req.params.id]
  );
  if (!result.rowCount) throw new AppError(409, 'POST_NOT_CANCELLABLE', '현재 상태에서는 게시물을 취소할 수 없습니다.');
  await audit(req.user.sub, 'post.cancelled', 'post_variant', req.params.id, {});
  res.json({ post: result.rows[0] });
}));

router.get('/api/calendar', requireAuth, asyncRoute(async (req, res) => {
  const start = req.query.start ? new Date(String(req.query.start)) : new Date(Date.now() - 7 * 86400_000);
  const end = req.query.end ? new Date(String(req.query.end)) : new Date(Date.now() + 45 * 86400_000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new AppError(400, 'DATE_RANGE_INVALID', '조회 기간이 올바르지 않습니다.');
  const result = await query(
    `SELECT pv.id, pv.platform, pv.format, pv.caption, pv.scheduled_at, pv.created_at, pv.publish_state,
            pv.permalink, pv.last_error, c.title AS campaign_title, p.name AS product_name
     FROM post_variants pv
     JOIN campaigns c ON c.id=pv.campaign_id
     LEFT JOIN products p ON p.id=c.product_id
     WHERE COALESCE(pv.scheduled_at, pv.created_at) BETWEEN $1 AND $2
     ORDER BY COALESCE(pv.scheduled_at, pv.created_at) ASC`,
    [start, end]
  );
  res.json({ posts: result.rows });
}));

router.get('/api/meta/status', requireAuth, asyncRoute(async (_req, res) => {
  res.json(await listConnectionStatus());
}));

router.get('/api/meta/connect', requireAuth, asyncRoute(async (req, res) => {
  const url = await startMetaOAuth(req.user.sub);
  res.redirect(url);
}));

router.get('/api/meta/callback', asyncRoute(async (req, res) => {
  if (req.query.error) {
    const message = encodeURIComponent(String(req.query.error_description || req.query.error));
    return res.redirect(`/accounts?meta_error=${message}`);
  }
  const pendingId = await finishMetaOAuth({ code: req.query.code, state: req.query.state });
  return res.redirect(`/accounts?meta_pending=${encodeURIComponent(pendingId)}`);
}));

router.get('/api/meta/pending/:id/pages', requireAuth, asyncRoute(async (req, res) => {
  res.json({ pages: await getPendingPages(req.params.id, req.user.sub) });
}));

router.post('/api/meta/pending/:id/select', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const pageId = parsed(z.string().min(1), req.body?.pageId);
  res.json(await selectMetaPage({ pendingId: req.params.id, pageId, userId: req.user.sub }));
}));

router.post('/api/meta/test', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  res.json(await testMetaConnection(req.user.sub));
}));

router.post('/api/meta/disconnect', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  await disconnectMeta(req.user.sub);
  res.status(204).end();
}));

router.get('/api/meta/instagram/quota', requireAuth, asyncRoute(async (_req, res) => {
  const result = await query(`SELECT * FROM social_connections WHERE platform='instagram' AND status='connected' LIMIT 1`);
  if (!result.rowCount) throw new AppError(409, 'INSTAGRAM_NOT_CONNECTED', '연결된 Instagram 계정이 없습니다.');
  const connection = result.rows[0];
  const quota = await getInstagramPublishingLimit(connection, decryptSecret(connection.access_token_encrypted));
  res.json({ quota });
}));

router.get('/api/analytics', requireAuth, asyncRoute(async (_req, res) => {
  res.json({ analytics: await listAnalytics() });
}));

router.post('/api/analytics/:id/sync', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  res.json({ metrics: await syncVariantAnalytics(req.params.id, req.user.sub) });
}));

router.get('/api/activity', requireAuth, asyncRoute(async (_req, res) => {
  const [attempts, audits, scheduler] = await Promise.all([
    query(`SELECT pa.*, pv.caption, c.title AS campaign_title
           FROM publish_attempts pa
           JOIN post_variants pv ON pv.id=pa.post_variant_id
           JOIN campaigns c ON c.id=pv.campaign_id
           ORDER BY pa.started_at DESC LIMIT 300`),
    query(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 300`),
    query(`SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT 100`)
  ]);
  res.json({ attempts: attempts.rows, audits: audits.rows, schedulerRuns: scheduler.rows });
}));

router.get('/api/settings', requireAuth, asyncRoute(async (_req, res) => {
  const result = await query('SELECT * FROM brand_profiles ORDER BY created_at LIMIT 1');
  res.json({
    brand: result.rows[0] || null,
    setup: {
      appBaseUrl: config.appBaseUrl,
      callbackUrl: config.meta.redirectUri,
      graphVersion: config.meta.graphVersion,
      metaScopes: config.meta.scopes,
      coreMissing: coreMissingConfig(),
      coreErrors: coreConfigErrors(),
      metaMissing: metaMissingConfig(),
      cronConfigured: Boolean(config.cronSecret),
      cronEndpoint: `${config.appBaseUrl}/api/jobs/run-due`
    }
  });
}));

router.put('/api/settings/brand', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  const value = parsed(z.object({
    brandName: z.string().trim().min(1).max(100),
    displayName: z.string().trim().min(1).max(200),
    toneGuide: z.string().trim().max(2000),
    timezone: z.literal('Asia/Seoul'),
    defaultHashtags: z.array(z.string().trim().min(1).max(100)).max(50),
    defaultLink: nullableUrl
  }), req.body);
  const result = await query(
    `UPDATE brand_profiles SET brand_name=$1, display_name=$2, tone_guide=$3, timezone=$4,
       default_hashtags=$5::jsonb, default_link=$6, updated_at=NOW()
     WHERE id=(SELECT id FROM brand_profiles ORDER BY created_at LIMIT 1) RETURNING *`,
    [value.brandName, value.displayName, value.toneGuide, value.timezone,
      JSON.stringify(value.defaultHashtags), value.defaultLink || null]
  );
  await audit(req.user.sub, 'settings.brand.updated', 'brand_profile', result.rows[0]?.id || null, {});
  res.json({ brand: result.rows[0] });
}));

router.post('/api/jobs/run-due', asyncRoute(async (req, res) => {
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!config.cronSecret) throw new AppError(409, 'CRON_NOT_CONFIGURED', 'CRON_SECRET 설정이 필요합니다.');
  if (bearer !== config.cronSecret) throw new AppError(401, 'CRON_UNAUTHORIZED', '예약 발행 실행 권한이 없습니다.');
  res.json(await runDuePosts());
}));

router.post('/api/jobs/run-due/manual', requireAuth, requireCsrf, asyncRoute(async (req, res) => {
  if (!config.cronSecret) throw new AppError(409, 'CRON_NOT_CONFIGURED', 'CRON_SECRET 설정이 필요합니다.');
  res.json(await runDuePosts({ actorUserId: req.user.sub }));
}));

router.post('/api/data-deletion/meta', express.urlencoded({ extended: false }), asyncRoute(async (req, res) => {
  res.json(await receiveMetaDeletionRequest(req.body?.signed_request));
}));

router.post('/api/data-deletion/manual', asyncRoute(async (req, res) => {
  const email = parsed(z.string().email(), req.body?.email);
  const result = await createManualDeletionRequest(email);
  res.status(201).json(result);
}));

router.get('/api/data-deletion/status/:code', asyncRoute(async (req, res) => {
  res.json({ request: await getDeletionStatus(req.params.code) });
}));

export default router;
