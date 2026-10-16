import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { definitions, platforms, platformDefinition, fail, requireConfigured, requireWrites, validatePost, validateAssets } from './policy.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const publicPostFields = 'id,client_request_id,platform,format,caption,media_asset_ids,scheduled_at,state,last_error,external_post_id,permalink,created_at,updated_at';
const terminal = ['published','awaiting_user','failed','uncertain','cancelled'];
const safeCode = error => typeof error.code === 'string' && /^CHANNEL_[A-Z_]+$/.test(error.code) ? error.code : 'CHANNEL_OUTCOME_UNKNOWN';

export function createChannelRuntime({ pool, settings, providers, encrypt, decrypt, mediaUrl, readMedia }) {
  async function owner(id) {
    const r = await pool.query("SELECT id FROM users WHERE id=$1 AND role='owner' AND status='active'", [id]);
    if (!r.rowCount) throw fail('CHANNEL_OWNER_REQUIRED', '활성 owner 계정이 필요합니다.', 403);
  }
  async function lock(key, fn) {
    const client = await pool.connect();
    let acquired = false;
    try {
      acquired = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [`channels:${key}`])).rows[0].locked;
      if (!acquired) throw fail('CHANNEL_BUSY', '현재 이 채널을 처리 중입니다. 잠시 후 상태를 확인해 주세요.');
      return await fn(client);
    } finally {
      if (acquired) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`channels:${key}`]).catch(() => {});
      client.release();
    }
  }
  async function audit(client, userId, action, entityId, metadata = {}) {
    await client.query(`INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'channel',$4,$5::jsonb)`, [randomUUID(), userId, action, entityId, JSON.stringify(metadata)]);
  }
  function assertCredentials(credentials, platform) {
    if (!credentials.accessToken || !credentials.accountId || !Number.isFinite(Number(credentials.expiresIn)) || Number(credentials.expiresIn) <= 0) throw fail('CHANNEL_AUTH_INVALID', '인증 응답을 확인할 수 없습니다.');
    if (definitions[platform].scopes.some(s => !credentials.scopes?.includes(s))) throw fail('CHANNEL_PERMISSION_DENIED', '필수 권한이 승인되지 않았습니다. 다시 연결해 주세요.');
  }
  async function status(userId) {
    await owner(userId);
    const rows = (await pool.query('SELECT platform,generation,account_name,status,scopes,expires_at,last_error,credentials_encrypted FROM channel_connections WHERE owner_user_id=$1', [userId])).rows;
    return { channels: platforms.map(platform => {
      const cfg = settings[platform], row = rows.find(r => r.platform === platform);
      let connection = { status: 'disconnected' };
      if (row) {
        const { credentials_encrypted, ...publicFields } = row;
        connection = publicFields;
        if (row.status === 'connected' && Date.parse(row.expires_at) <= Date.now()) {
          connection.status = 'expired';
          try {
            const credential = JSON.parse(decrypt(credentials_encrypted));
            if (platform !== 'threads' && credential.refreshToken && (!credential.refreshExpiresAt || Date.parse(credential.refreshExpiresAt) > Date.now())) connection.status = 'refresh_available';
          } catch { connection.status = 'reauthorization_required'; }
        }
      }
      return { platform, ...definitions[platform], configured: Boolean(cfg.clientId && cfg.clientSecret), connectEnabled: cfg.connectEnabled, writesEnabled: cfg.writesEnabled, billingApproved: cfg.billingApproved,
        callbackUrl: cfg.redirectUri, verifiedMediaOrigin: platform === 'tiktok' ? cfg.verifiedOrigin : undefined,
        connection };
    }) };
  }
  async function startOAuth(userId, platform) {
    await owner(userId); platformDefinition(platform); requireConfigured(settings[platform]);
    return lock(`${userId}:${platform}`, async client => {
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      await client.query('DELETE FROM channel_oauth_states WHERE owner_user_id=$1 AND platform=$2', [userId, platform]);
      await client.query(`INSERT INTO channel_oauth_states(state_hash,owner_user_id,platform,verifier_encrypted,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes')`, [hash(state), userId, platform, encrypt(verifier)]);
      return { url: providers[platform].authorize(settings[platform], state, challenge) };
    });
  }
  async function finishOAuth(userId, platform, input) {
    await owner(userId); platformDefinition(platform); requireConfigured(settings[platform]);
    if (typeof input.state !== 'string' || input.state.length > 200) throw fail('CHANNEL_OAUTH_STATE_INVALID', '연결 요청이 유효하지 않습니다.', 400);
    return lock(`${userId}:${platform}`, async client => {
      const consumed = await client.query(`UPDATE channel_oauth_states SET consumed_at=NOW() WHERE state_hash=$1 AND owner_user_id=$2 AND platform=$3 AND expires_at>NOW() AND consumed_at IS NULL RETURNING verifier_encrypted`, [hash(input.state), userId, platform]);
      if (!consumed.rowCount) throw fail('CHANNEL_OAUTH_STATE_INVALID', '연결 요청이 만료되었거나 이미 사용되었습니다.', 400);
      if (input.error || typeof input.code !== 'string' || input.code.length > 4000) throw fail('CHANNEL_OAUTH_DENIED', '플랫폼 연결을 승인하지 않았습니다.', 400);
      const credential = await providers[platform].exchange(settings[platform], input.code, decrypt(consumed.rows[0].verifier_encrypted));
      assertCredentials(credential, platform);
      if (credential.refreshExpiresIn) credential.refreshExpiresAt = new Date(Date.now() + Number(credential.refreshExpiresIn) * 1000).toISOString();
      const generation = randomUUID(), expiresAt = new Date(Date.now() + Number(credential.expiresIn) * 1000);
      await client.query(`INSERT INTO channel_connections(owner_user_id,platform,generation,account_id,account_name,credentials_encrypted,scopes,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(owner_user_id,platform) DO UPDATE SET generation=$3,account_id=$4,account_name=$5,credentials_encrypted=$6,scopes=$7::jsonb,expires_at=$8,status='connected',last_error=NULL,updated_at=NOW()`,
        [userId, platform, generation, credential.accountId, credential.accountName || null, encrypt(JSON.stringify(credential)), JSON.stringify(credential.scopes), expiresAt]);
      await audit(client, userId, 'channel.connected', platform);
      return { connected: true };
    });
  }
  async function disconnect(userId, platform) {
    await owner(userId); platformDefinition(platform);
    return lock(`${userId}:${platform}`, async client => {
      await client.query('BEGIN');
      try {
        await client.query('DELETE FROM channel_connections WHERE owner_user_id=$1 AND platform=$2', [userId, platform]);
        await client.query('DELETE FROM channel_oauth_states WHERE owner_user_id=$1 AND platform=$2', [userId, platform]);
        await client.query(`UPDATE channel_posts SET state='cancelled',last_error='CHANNEL_DISCONNECTED',updated_at=NOW() WHERE owner_user_id=$1 AND platform=$2 AND state IN ('draft','queued','scheduled')`, [userId, platform]);
        await audit(client, userId, 'channel.disconnected', platform);
        await client.query('COMMIT');
      } catch(e) { await client.query('ROLLBACK'); throw e; }
      return { disconnected: true, note: '로컬 연결을 삭제했습니다. 플랫폼 앱 권한은 해당 플랫폼에서 철회할 수 있습니다.' };
    });
  }
  async function createPost(userId, input) {
    await owner(userId);
    // An existing immutable request remains readable even after its schedule passes.
    const v = validatePost(input, Date.now(), false), payloadHash = hash(JSON.stringify(v));
    return lock(`${userId}:${v.platform}`, async client => {
      const existing = (await client.query(`SELECT ${publicPostFields},payload_hash FROM channel_posts WHERE owner_user_id=$1 AND client_request_id=$2`, [userId, v.clientRequestId])).rows[0];
      if (existing) {
        if (existing.payload_hash !== payloadHash) throw fail('CHANNEL_REQUEST_CONFLICT', '이미 사용된 요청 ID에 다른 내용이 있습니다.', 409);
        delete existing.payload_hash; return { post: existing, duplicate: true };
      }
      validatePost(input);
      const connection = (await client.query('SELECT * FROM channel_connections WHERE owner_user_id=$1 AND platform=$2', [userId, v.platform])).rows[0];
      if (v.mode !== 'draft') {
        requireWrites(settings[v.platform]);
        if (!connection || connection.status !== 'connected' || connection.generation !== v.accountGeneration) throw fail('CHANNEL_ACCOUNT_CHANGED', '연결 계정이 바뀌었습니다. 대상 계정을 다시 확인해 주세요.');
      }
      const assets = (await client.query('SELECT * FROM media_assets WHERE id=ANY($1::text[])', [v.mediaAssetIds])).rows;
      validateAssets({ ...v, media_asset_ids: v.mediaAssetIds }, assets);
      const result = await client.query(`INSERT INTO channel_posts(id,owner_user_id,client_request_id,payload_hash,platform,account_generation,account_id,format,caption,media_asset_ids,scheduled_at,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) ON CONFLICT(owner_user_id,client_request_id) DO NOTHING RETURNING ${publicPostFields}`,
        [randomUUID(), userId, v.clientRequestId, payloadHash, v.platform, connection?.generation || null, connection?.account_id || null, v.format, v.caption, JSON.stringify(v.mediaAssetIds), v.scheduledAt, v.mode === 'draft' ? 'draft' : v.mode === 'schedule' ? 'scheduled' : 'queued']);
      if (!result.rowCount) throw fail('CHANNEL_REQUEST_CONFLICT', '이미 사용된 요청 ID입니다.', 409);
      await audit(client, userId, 'channel.post.created', result.rows[0].id, { platform: v.platform, mode: v.mode });
      return { post: result.rows[0], duplicate: false };
    });
  }
  async function posts(userId) { await owner(userId); return { posts: (await pool.query(`SELECT ${publicPostFields} FROM channel_posts WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT 200`, [userId])).rows }; }
  async function cancel(userId, postId) {
    await owner(userId);
    const post = (await pool.query('SELECT platform FROM channel_posts WHERE owner_user_id=$1 AND id=$2', [userId, postId])).rows[0];
    if (!post) throw fail('CHANNEL_POST_NOT_FOUND', '게시물을 찾지 못했습니다.', 404);
    return lock(`${userId}:${post.platform}`, async client => {
      const r = await client.query(`UPDATE channel_posts SET state='cancelled',updated_at=NOW() WHERE id=$1 AND owner_user_id=$2 AND state IN ('draft','queued','scheduled') AND dispatch_started_at IS NULL RETURNING id`, [postId, userId]);
      if (!r.rowCount) throw fail('CHANNEL_NOT_CANCELLABLE', '이미 전송이 시작되어 취소할 수 없습니다.');
      return { cancelled: true };
    });
  }
  async function processPost(userId, postId, poll = false) {
    await owner(userId);
    const pre = (await pool.query('SELECT platform FROM channel_posts WHERE id=$1 AND owner_user_id=$2', [postId, userId])).rows[0];
    if (!pre) throw fail('CHANNEL_POST_NOT_FOUND', '게시물을 찾지 못했습니다.', 404);
    return lock(`${userId}:${pre.platform}`, async client => {
      const post = (await client.query('SELECT * FROM channel_posts WHERE id=$1 AND owner_user_id=$2', [postId, userId])).rows[0];
      if (terminal.includes(post.state)) return { state: post.state, alreadyHandled: true };
      requireWrites(settings[post.platform]);
      if (poll && post.state !== 'processing') throw fail('CHANNEL_NOT_PROCESSING', '처리 중인 게시물만 상태를 확인할 수 있습니다.');
      if (!poll && !['queued','scheduled'].includes(post.state)) {
        if (post.state === 'publishing') await client.query("UPDATE channel_posts SET state='uncertain',last_error='CHANNEL_OUTCOME_UNKNOWN',updated_at=NOW() WHERE id=$1", [post.id]);
        throw fail('CHANNEL_NOT_DISPATCHABLE', '전송 대상이 아니거나 이전 전송 결과가 불확실합니다.');
      }
      if (post.scheduled_at && Date.parse(post.scheduled_at) > Date.now()) throw fail('CHANNEL_NOT_DUE', '아직 예약 시간이 되지 않았습니다.');
      let attemptId, persistedResult;
      try {
        let connection = (await client.query('SELECT * FROM channel_connections WHERE owner_user_id=$1 AND platform=$2', [userId, post.platform])).rows[0];
        if (!connection || connection.status !== 'connected' || connection.generation !== post.account_generation || connection.account_id !== post.account_id) throw fail('CHANNEL_ACCOUNT_CHANGED', '원래 승인한 계정 연결이 변경되었습니다. 새 계정에 자동 전송하지 않습니다.');
        let credentials = JSON.parse(decrypt(connection.credentials_encrypted));
        if (Date.parse(connection.expires_at) < Date.now() + 120_000) {
          if (credentials.refreshExpiresAt && Date.parse(credentials.refreshExpiresAt) <= Date.now()) throw fail('CHANNEL_AUTH_EXPIRED', '갱신 권한이 만료되어 계정을 다시 연결해야 합니다.');
          credentials = await providers[post.platform].refresh(settings[post.platform], credentials);
          assertCredentials(credentials, post.platform);
          if (credentials.refreshExpiresIn) credentials.refreshExpiresAt = new Date(Date.now() + Number(credentials.refreshExpiresIn) * 1000).toISOString();
          await client.query('UPDATE channel_connections SET credentials_encrypted=$3,scopes=$4::jsonb,expires_at=$5,updated_at=NOW() WHERE owner_user_id=$1 AND platform=$2', [userId, post.platform, encrypt(JSON.stringify(credentials)), JSON.stringify(credentials.scopes), new Date(Date.now()+Number(credentials.expiresIn)*1000)]);
        }
        assertCredentials(credentials, post.platform);
        const rows = (await client.query('SELECT * FROM media_assets WHERE id=ANY($1::text[])', [post.media_asset_ids])).rows;
        const assets = post.media_asset_ids.map(id => rows.find(r => r.id === id)).filter(Boolean);
        validateAssets(post, assets);
        // Validate exact file bytes before the first outbound call; includes path/symlink checks.
        if (!poll) for (const asset of assets) await readMedia(asset);
        attemptId = randomUUID();
        await client.query('INSERT INTO channel_attempts(id,post_id,operation,state) VALUES($1,$2,$3,$4)', [attemptId, post.id, poll ? 'poll' : 'dispatch', 'running']);
        if (!poll) {
          if (post.dispatch_started_at) throw fail('CHANNEL_OUTCOME_UNKNOWN', '이미 전송이 시작된 요청입니다.');
          await client.query("UPDATE channel_posts SET state='publishing',dispatch_started_at=NOW(),updated_at=NOW() WHERE id=$1", [post.id]);
          post.dispatch_started_at = new Date();
        }
        const checkpoint = async (value, providerRef = post.provider_ref) => {
          await client.query('UPDATE channel_posts SET checkpoint=$2::jsonb,provider_ref=$3,updated_at=NOW() WHERE id=$1', [post.id, JSON.stringify(value), providerRef]);
          post.checkpoint = value; post.provider_ref = providerRef;
        };
        const ctx = { post, assets, connection, credentials, settings: settings[post.platform], mediaUrl, readMedia, checkpoint };
        const result = await providers[post.platform][poll ? 'resume' : 'start'](ctx);
        if (!['processing','published','awaiting_user'].includes(result.state)) throw fail('CHANNEL_OUTCOME_UNKNOWN', '외부 처리 상태를 확인하지 못했습니다.');
        await client.query(`UPDATE channel_posts SET state=$2,provider_ref=COALESCE($3,provider_ref),external_post_id=$4,permalink=$5,last_error=NULL,updated_at=NOW() WHERE id=$1`, [post.id, result.state, result.providerRef || null, result.externalId || null, result.permalink || null]);
        persistedResult = result;
        await client.query('UPDATE channel_attempts SET state=$2,finished_at=NOW() WHERE id=$1', [attemptId, result.state]);
        await audit(client, userId, 'channel.post.'+result.state, post.id, { platform: post.platform });
        return result;
      } catch (error) {
        // A history/audit failure cannot erase an already persisted provider result.
        if (persistedResult) return { ...persistedResult, historyWarning: true };
        const code = safeCode(error);
        // Any started remote dispatch may have succeeded. Never reset it to a retryable state.
        const safeStatusRead = poll && (post.platform === 'tiktok' || post.platform === 'threads' && !post.checkpoint.publishRequested && !post.checkpoint.parentRequested);
        const transientRead = safeStatusRead && ['CHANNEL_OUTCOME_UNKNOWN','CHANNEL_RATE_LIMITED','CHANNEL_PROVIDER_UNAVAILABLE'].includes(code);
        const state = transientRead ? 'processing' : safeStatusRead && code === 'CHANNEL_PROCESSING_FAILED' ? 'failed' : post.dispatch_started_at ? 'uncertain' : 'failed';
        await client.query('UPDATE channel_posts SET state=$2,last_error=$3,updated_at=NOW() WHERE id=$1', [post.id, state, code]);
        if (attemptId) await client.query('UPDATE channel_attempts SET state=$2,error_code=$3,finished_at=NOW() WHERE id=$1', [attemptId, state, code]);
        if (['CHANNEL_AUTH_EXPIRED','CHANNEL_PERMISSION_DENIED'].includes(code)) await client.query('UPDATE channel_connections SET status=$3,last_error=$4,updated_at=NOW() WHERE owner_user_id=$1 AND platform=$2', [userId, post.platform, 'reauthorization_required', code]);
        return { state, errorCode: code };
      }
    });
  }
  async function runDue() {
    const enabled = platforms.filter(p => settings[p].connectEnabled && settings[p].writesEnabled && settings[p].billingApproved);
    const due = (await pool.query(`SELECT p.id,p.owner_user_id,p.state FROM channel_posts p JOIN users u ON u.id=p.owner_user_id AND u.role='owner' AND u.status='active'
      WHERE p.platform=ANY($1::text[]) AND ((p.state IN ('scheduled','queued') AND COALESCE(p.scheduled_at,p.created_at)<=NOW()) OR p.state='processing' OR (p.state='publishing' AND p.updated_at<NOW()-INTERVAL '10 minutes')) ORDER BY p.updated_at LIMIT 20`, [enabled])).rows;
    const results = [];
    for (const p of due) {
      try { results.push(await processPost(p.owner_user_id, p.id, p.state === 'processing')); }
      catch(e) { results.push({ errorCode: safeCode(e) }); }
    }
    return { checked: due.length, results };
  }
  return { owner, status, startOAuth, finishOAuth, disconnect, createPost, posts, cancel, processPost, runDue };
}
