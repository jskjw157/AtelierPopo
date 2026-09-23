import { randomUUID } from 'node:crypto';
import { adsServices } from './ads/instance.js';
import { config, metaMissingConfig } from '../config.js';
import { query, transaction, audit } from '../db.js';
import { AppError } from '../http.js';
import { encryptSecret, decryptSecret, randomToken, sha256, safeErrorMessage } from '../security.js';
import {
  buildMetaOAuthUrl,
  debugToken,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  graphGet
} from './client.js';

export async function startMetaOAuth(userId) {
  const missing = metaMissingConfig();
  if (missing.length) {
    throw new AppError(409, 'META_NOT_CONFIGURED', 'Meta 개발자 연동 설정이 필요합니다.', { missing });
  }
  const state = randomToken(32);
  await query(
    `INSERT INTO oauth_states (state_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
    [sha256(state), userId]
  );
  return buildMetaOAuthUrl(state);
}

async function consumeOAuthState(state) {
  const result = await query(
    `UPDATE oauth_states
     SET consumed_at = NOW()
     WHERE state_hash = $1
       AND consumed_at IS NULL
       AND expires_at > NOW()
     RETURNING user_id, purpose`,
    [sha256(state)]
  );
  if (!result.rowCount) {
    throw new AppError(400, 'OAUTH_STATE_INVALID', 'Meta 연결 요청이 만료되었거나 유효하지 않습니다.');
  }
  return result.rows[0];
}

export async function finishMetaOAuth({ code, state }) {
  if (!code || !state) {
    throw new AppError(400, 'OAUTH_CALLBACK_INVALID', 'Meta 인증 응답에 필요한 값이 없습니다.');
  }
  const authorization = await consumeOAuthState(state);
  const userId = authorization.user_id;
  const shortToken = await exchangeCodeForToken(code);
  const longToken = await exchangeForLongLivedToken(shortToken.access_token);
  const userAccessToken = longToken.access_token;
  if (authorization.purpose === 'ads') {
    const tokenInfo = (await debugToken(userAccessToken)).data;
    await adsServices.auth.saveCredential(userId, { accessToken: userAccessToken, tokenInfo });
    return { adsConnected: true };
  }

  const pagesResponse = await graphGet('/me/accounts', userAccessToken, {
    fields: 'id,name,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url}',
    limit: 100
  });
  const pages = Array.isArray(pagesResponse.data) ? pagesResponse.data : [];
  if (!pages.length) {
    throw new AppError(400, 'NO_MANAGED_PAGES', '이 계정에서 관리 가능한 Facebook 페이지를 찾지 못했습니다.');
  }

  const pendingId = randomUUID();
  const payload = { pages };
  await query(
    `INSERT INTO oauth_pending (id, user_id, payload_encrypted, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')`,
    [pendingId, userId, encryptSecret(JSON.stringify(payload))]
  );
  await audit(userId, 'meta.oauth.completed', 'oauth_pending', pendingId, { pageCount: pages.length });
  return pendingId;
}

async function loadPending(pendingId, userId) {
  const result = await query(
    `SELECT * FROM oauth_pending
     WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > NOW()`,
    [pendingId, userId]
  );
  if (!result.rowCount) {
    throw new AppError(404, 'META_PENDING_NOT_FOUND', '페이지 선택 요청이 만료되었거나 존재하지 않습니다.');
  }
  return {
    row: result.rows[0],
    payload: JSON.parse(decryptSecret(result.rows[0].payload_encrypted))
  };
}

export async function getPendingPages(pendingId, userId) {
  const { payload } = await loadPending(pendingId, userId);
  return payload.pages.map((page) => ({
    id: page.id,
    name: page.name,
    tasks: page.tasks || [],
    instagram: page.instagram_business_account
      ? {
          id: page.instagram_business_account.id,
          username: page.instagram_business_account.username,
          name: page.instagram_business_account.name,
          profilePictureUrl: page.instagram_business_account.profile_picture_url
        }
      : null
  }));
}

export async function selectMetaPage({ pendingId, pageId, userId }) {
  const { payload } = await loadPending(pendingId, userId);
  const page = payload.pages.find((item) => String(item.id) === String(pageId));
  if (!page) throw new AppError(400, 'PAGE_NOT_AVAILABLE', '선택한 Facebook 페이지가 인증 결과에 없습니다.');

  let tokenInfo = {};
  try {
    tokenInfo = (await debugToken(page.access_token)).data || {};
  } catch {
    tokenInfo = {};
  }
  const encryptedPageToken = encryptSecret(page.access_token);
  const scopes = tokenInfo.scopes || config.meta.scopes;
  const tokenExpiry = tokenInfo.data_access_expires_at || tokenInfo.expires_at;
  const expiresAt = tokenExpiry ? new Date(Number(tokenExpiry) * 1000) : null;
  const instagram = page.instagram_business_account || null;

  await transaction(async (client) => {
    await client.query(
      `INSERT INTO social_connections
        (id, platform, account_id, account_name, page_id, access_token_encrypted, status, scopes, token_expires_at, last_checked_at)
       VALUES ($1, 'facebook', $2, $3, $2, $4, 'connected', $5::jsonb, $6, NOW())
       ON CONFLICT (platform) DO UPDATE SET
         account_id = EXCLUDED.account_id,
         account_name = EXCLUDED.account_name,
         page_id = EXCLUDED.page_id,
         instagram_account_id = NULL,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         status = 'connected',
         scopes = EXCLUDED.scopes,
         token_expires_at = EXCLUDED.token_expires_at,
         last_checked_at = NOW(),
         updated_at = NOW()`,
      [randomUUID(), page.id, page.name, encryptedPageToken, JSON.stringify(scopes), expiresAt]
    );

    await client.query(
      `INSERT INTO social_connections
        (id, platform, account_id, account_name, page_id, instagram_account_id, access_token_encrypted, status, scopes, token_expires_at, last_checked_at)
       VALUES ($1, 'instagram', $2, $3, $4, $2, $5, $6, $7::jsonb, $8, NOW())
       ON CONFLICT (platform) DO UPDATE SET
         account_id = EXCLUDED.account_id,
         account_name = EXCLUDED.account_name,
         page_id = EXCLUDED.page_id,
         instagram_account_id = EXCLUDED.instagram_account_id,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         status = EXCLUDED.status,
         scopes = EXCLUDED.scopes,
         token_expires_at = EXCLUDED.token_expires_at,
         last_checked_at = NOW(),
         updated_at = NOW()`,
      [
        randomUUID(),
        instagram?.id || null,
        instagram?.username || instagram?.name || null,
        page.id,
        encryptedPageToken,
        instagram ? 'connected' : 'disconnected',
        JSON.stringify(scopes),
        expiresAt
      ]
    );

    await client.query('DELETE FROM oauth_pending WHERE id = $1', [pendingId]);
  });

  await audit(userId, 'meta.page.selected', 'facebook_page', page.id, {
    pageName: page.name,
    instagramAccountId: instagram?.id || null
  });

  return {
    page: { id: page.id, name: page.name },
    instagram: instagram ? { id: instagram.id, username: instagram.username } : null
  };
}

export async function listConnectionStatus() {
  const result = await query(
    `SELECT platform, account_id, account_name, page_id, instagram_account_id, status, scopes,
            token_expires_at, last_checked_at, created_at, updated_at
     FROM social_connections
     WHERE platform IN ('facebook', 'instagram')
     ORDER BY platform`
  );
  const byPlatform = Object.fromEntries(result.rows.map((row) => [row.platform, row]));
  const missing = metaMissingConfig();
  return {
    configured: missing.length === 0,
    missing,
    callbackUrl: config.meta.redirectUri,
    graphVersion: config.meta.graphVersion,
    scopes: config.meta.scopes,
    connections: {
      facebook: byPlatform.facebook || { platform: 'facebook', status: missing.length ? 'not_configured' : 'disconnected' },
      instagram: byPlatform.instagram || { platform: 'instagram', status: missing.length ? 'not_configured' : 'disconnected' }
    }
  };
}

export async function disconnectMeta(userId) {
  await query(`DELETE FROM social_connections WHERE platform IN ('facebook', 'instagram')`);
  await audit(userId, 'meta.disconnected', 'social_connection', null, {});
}

export async function testMetaConnection(userId) {
  const result = await query(
    `SELECT * FROM social_connections WHERE platform = 'facebook' AND status IN ('connected', 'expired', 'permission_error', 'api_error') LIMIT 1`
  );
  if (!result.rowCount) throw new AppError(409, 'META_NOT_CONNECTED', '연결된 Facebook 페이지가 없습니다.');
  const connection = result.rows[0];
  const accessToken = decryptSecret(connection.access_token_encrypted);
  try {
    const [page, tokenDebug] = await Promise.all([
      graphGet(`/${connection.page_id}`, accessToken, {
        fields: 'id,name,instagram_business_account{id,username,name}'
      }),
      debugToken(accessToken).catch(() => ({ data: {} }))
    ]);
    const instagram = page.instagram_business_account || null;
    const grantedScopes = tokenDebug.data?.scopes || connection.scopes || [];
    const missingScopes = config.meta.scopes.filter((scope) => !grantedScopes.includes(scope));
    const facebookStatus = missingScopes.length ? 'permission_error' : 'connected';
    const instagramStatus = !instagram ? 'disconnected' : missingScopes.length ? 'permission_error' : 'connected';

    await transaction(async (client) => {
      await client.query(
        `UPDATE social_connections
         SET status = $1, scopes = $2::jsonb, last_checked_at = NOW(), updated_at = NOW()
         WHERE platform = 'facebook'`,
        [facebookStatus, JSON.stringify(grantedScopes)]
      );
      await client.query(
        `UPDATE social_connections
         SET status = $1, account_id = $2, account_name = $3, instagram_account_id = $2,
             scopes = $4::jsonb, last_checked_at = NOW(), updated_at = NOW()
         WHERE platform = 'instagram'`,
        [instagramStatus, instagram?.id || null, instagram?.username || instagram?.name || null, JSON.stringify(grantedScopes)]
      );
    });
    await audit(userId, 'meta.connection.tested', 'facebook_page', connection.page_id, {
      ok: missingScopes.length === 0,
      missingScopes,
      instagramAccountId: instagram?.id || null
    });
    return { ok: missingScopes.length === 0, page, instagram, grantedScopes, missingScopes };
  } catch (error) {
    const failureStatus = Number(error?.metaCode) === 190 ? 'expired' : 'api_error';
    await query(
      `UPDATE social_connections SET status = $1, last_checked_at = NOW(), updated_at = NOW()
       WHERE platform IN ('facebook', 'instagram')`,
      [failureStatus]
    );
    await audit(userId, 'meta.connection.tested', 'facebook_page', connection.page_id, {
      ok: false,
      error: safeErrorMessage(error)
    });
    throw error;
  }
}
