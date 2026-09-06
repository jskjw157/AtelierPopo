import { randomUUID } from 'node:crypto';
import { query, transaction, audit } from '../db.js';
import { AppError } from '../http.js';
import { decryptSecret, safeErrorMessage } from '../security.js';
import { publishInstagram } from '../meta/instagram.js';
import { publishFacebook } from '../meta/facebook.js';

function normalizeMediaIds(value) {
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value || '[]');
  } catch {
    return [];
  }
}

async function loadAssets(mediaIds) {
  if (!mediaIds.length) return [];
  const result = await query('SELECT * FROM media_assets WHERE id = ANY($1::text[]) AND status = $2', [mediaIds, 'ready']);
  const map = new Map(result.rows.map((row) => [row.id, row]));
  const assets = mediaIds.map((id) => map.get(id)).filter(Boolean);
  if (assets.length !== mediaIds.length) {
    throw new AppError(400, 'MEDIA_ASSET_MISSING', '게시물에 연결된 미디어 일부를 찾지 못했습니다.');
  }
  return assets;
}

async function claimVariant(variantId) {
  const result = await query(
    `UPDATE post_variants
     SET publish_state = 'publishing', claimed_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = $1
       AND external_post_id IS NULL
       AND publish_state IN ('reviewed', 'scheduled', 'queued', 'failed')
       AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '20 minutes')
     RETURNING *`,
    [variantId]
  );
  if (!result.rowCount) {
    const existing = await query('SELECT publish_state, external_post_id FROM post_variants WHERE id = $1', [variantId]);
    if (existing.rows[0]?.external_post_id) {
      return { alreadyPublished: true, row: existing.rows[0] };
    }
    throw new AppError(409, 'POST_NOT_CLAIMABLE', '이미 발행 중이거나 현재 발행할 수 없는 게시물입니다.');
  }
  return { alreadyPublished: false, row: result.rows[0] };
}

async function refreshCampaignStatus(campaignId) {
  const states = await query('SELECT publish_state FROM post_variants WHERE campaign_id = $1', [campaignId]);
  const values = states.rows.map((row) => row.publish_state);
  let status = 'draft';
  if (values.length && values.every((value) => value === 'published')) status = 'published';
  else if (values.includes('published') && values.includes('failed')) status = 'partially_published';
  else if (values.includes('failed')) status = 'failed';
  else if (values.some((value) => ['scheduled', 'queued', 'publishing'].includes(value))) status = 'scheduled';
  else if (values.some((value) => value === 'reviewed')) status = 'reviewed';
  await query('UPDATE campaigns SET status = $2, updated_at = NOW() WHERE id = $1', [campaignId, status]);
  return status;
}

function backoffMinutes(attemptCount) {
  return [1, 5, 15][Math.min(Math.max(attemptCount - 1, 0), 2)];
}

export async function publishVariant(variantId, actorUserId = null) {
  const claim = await claimVariant(variantId);
  if (claim.alreadyPublished) {
    return { ok: true, alreadyPublished: true, externalPostId: claim.row.external_post_id };
  }
  const variant = claim.row;
  const attemptId = randomUUID();
  const startedAt = new Date();
  await query(
    `INSERT INTO publish_attempts
      (id, post_variant_id, platform, attempt_number, started_at, result)
     VALUES ($1, $2, $3, $4, $5, 'publishing')`,
    [attemptId, variant.id, variant.platform, variant.attempt_count, startedAt]
  );

  let externalResult = null;
  try {
    const connectionResult = await query(
      `SELECT * FROM social_connections WHERE platform = $1 AND status = 'connected' LIMIT 1`,
      [variant.platform]
    );
    if (!connectionResult.rowCount) {
      throw new AppError(409, 'SOCIAL_NOT_CONNECTED', `${variant.platform} 계정이 연결되어 있지 않습니다.`);
    }
    const connection = connectionResult.rows[0];
    const accessToken = decryptSecret(connection.access_token_encrypted);
    const assets = await loadAssets(normalizeMediaIds(variant.media_asset_ids));

    if (variant.platform === 'instagram') {
      externalResult = await publishInstagram({ connection, accessToken, variant, assets });
    } else if (variant.platform === 'facebook') {
      externalResult = await publishFacebook({ connection, accessToken, variant, assets });
    } else {
      throw new AppError(400, 'PLATFORM_NOT_IMPLEMENTED', `${variant.platform} 연동은 아직 구현되지 않았습니다.`);
    }

    let recoveredPersistence = false;
    try {
      await transaction(async (client) => {
        await client.query(
          `UPDATE post_variants
           SET publish_state = 'published', external_post_id = $2, permalink = $3,
               last_error = NULL, claimed_at = NULL, next_attempt_at = NULL, updated_at = NOW()
           WHERE id = $1`,
          [variant.id, externalResult.externalPostId, externalResult.permalink]
        );
        await client.query(
          `UPDATE publish_attempts
           SET finished_at = NOW(), result = 'published', response_code = '200', external_request_id = $2
           WHERE id = $1`,
          [attemptId, externalResult.externalPostId]
        );
      });
    } catch (persistenceError) {
      const persistenceMessage = safeErrorMessage(persistenceError);
      try {
        await transaction(async (client) => {
          await client.query(
            `UPDATE post_variants
             SET publish_state = 'published', external_post_id = $2, permalink = $3,
                 last_error = $4, claimed_at = NULL, next_attempt_at = NULL, updated_at = NOW()
             WHERE id = $1`,
            [
              variant.id,
              externalResult.externalPostId,
              externalResult.permalink || null,
              `발행 성공 후 내부 저장을 복구했습니다: ${persistenceMessage}`.slice(0, 1000)
            ]
          );
          await client.query(
            `UPDATE publish_attempts
             SET finished_at = NOW(), result = 'published_recovered', response_code = '200',
                 sanitized_error = $2, external_request_id = $3
             WHERE id = $1`,
            [attemptId, persistenceMessage, externalResult.externalPostId]
          );
        });
        recoveredPersistence = true;
      } catch {
        throw persistenceError;
      }
    }

    await refreshCampaignStatus(variant.campaign_id).catch(() => {});
    if (actorUserId) {
      await audit(actorUserId, 'post.published', 'post_variant', variant.id, {
        platform: variant.platform,
        externalPostId: externalResult.externalPostId,
        recoveredPersistence
      }).catch(() => {});
    }
    return { ok: true, recoveredPersistence, ...externalResult };
  } catch (error) {
    const message = safeErrorMessage(error);

    if (externalResult?.externalPostId) {
      const ambiguousMessage =
        `외부 플랫폼은 발행 성공 ID(${externalResult.externalPostId})를 반환했지만 내부 최종 저장 중 오류가 발생했습니다. 자동 재시도하지 말고 게시물 존재를 확인해 주세요. ${message}`.slice(0, 1000);
      try {
        await transaction(async (client) => {
          await client.query(
            `UPDATE post_variants
             SET publish_state = 'publishing', external_post_id = $2, permalink = $3,
                 last_error = $4, next_attempt_at = NULL, updated_at = NOW()
             WHERE id = $1`,
            [variant.id, externalResult.externalPostId, externalResult.permalink || null, ambiguousMessage]
          );
          await client.query(
            `UPDATE publish_attempts
             SET finished_at = NOW(), result = 'verification_required', response_code = 'AMBIGUOUS',
                 sanitized_error = $2, external_request_id = $3
             WHERE id = $1`,
            [attemptId, ambiguousMessage, externalResult.externalPostId]
          );
        });
      } catch {
        // Keep the original error. A publishing state is intentionally not auto-reclaimed.
      }
      throw new AppError(500, 'PUBLICATION_VERIFICATION_REQUIRED', ambiguousMessage);
    }

    const canRetry = Boolean(error?.isTransient) && variant.attempt_count < 3;
    const nextAttempt = canRetry
      ? new Date(Date.now() + backoffMinutes(variant.attempt_count) * 60_000)
      : null;
    await transaction(async (client) => {
      await client.query(
        `UPDATE post_variants
         SET publish_state = $2, last_error = $3, next_attempt_at = $4, claimed_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [variant.id, canRetry ? 'queued' : 'failed', message, nextAttempt]
      );
      await client.query(
        `UPDATE publish_attempts
         SET finished_at = NOW(), result = $2, response_code = $3, sanitized_error = $4,
             external_request_id = $5
         WHERE id = $1`,
        [
          attemptId,
          canRetry ? 'retry_scheduled' : 'failed',
          String(error?.metaCode || error?.status || 500),
          message,
          error?.requestId || null
        ]
      );
    });
    await refreshCampaignStatus(variant.campaign_id);
    throw error;
  }
}

export async function runDuePosts({ actorUserId = null } = {}) {
  const runId = randomUUID();
  const startedAt = new Date();
  await query(
    `INSERT INTO scheduler_runs (id, started_at, status)
     VALUES ($1, $2, 'running')`,
    [runId, startedAt]
  );

  try {
    const due = await query(
      `SELECT id FROM post_variants
       WHERE publish_state IN ('scheduled', 'queued')
         AND COALESCE(scheduled_at, created_at) <= NOW()
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
         AND external_post_id IS NULL
       ORDER BY COALESCE(scheduled_at, created_at) ASC
       LIMIT 20`
    );

    let successCount = 0;
    let failureCount = 0;
    for (const row of due.rows) {
      try {
        await publishVariant(row.id, actorUserId);
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }
    await query(
      `UPDATE scheduler_runs
       SET finished_at = NOW(), due_count = $2, success_count = $3, failure_count = $4,
           status = $5
       WHERE id = $1`,
      [runId, due.rowCount, successCount, failureCount, failureCount ? 'completed_with_errors' : 'completed']
    );
    return { runId, dueCount: due.rowCount, successCount, failureCount };
  } catch (error) {
    await query(
      `UPDATE scheduler_runs
       SET finished_at = NOW(), status = 'failed', failure_count = 1
       WHERE id = $1`,
      [runId]
    ).catch(() => {});
    throw error;
  }
}
