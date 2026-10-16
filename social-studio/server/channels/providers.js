import { definitions, fail } from './policy.js';
import { createProviderHttp } from './http.js';

const threadsBase = 'https://graph.threads.com/v1.0';
const tiktokBase = 'https://open.tiktokapis.com/v2';
export function createProviders(request = createProviderHttp()) {
  const threadsGet = (path, token, params = {}) => request(`${threadsBase}${path}?${new URLSearchParams(params)}`, { token });
  const threadsPost = (path, token, form) => request(`${threadsBase}${path}`, { method: 'POST', token, form });
  async function threadsResume(ctx) {
    const { post, credentials, checkpoint } = ctx;
    if (post.checkpoint.publishRequested) throw fail('CHANNEL_OUTCOME_UNKNOWN', '게시 요청 결과가 불확실합니다. 자동 재게시하지 않습니다.');
    if (post.checkpoint.phase === 'children') {
      if (post.checkpoint.parentRequested) throw fail('CHANNEL_OUTCOME_UNKNOWN', '캐러셀 컨테이너 생성 결과가 불확실합니다.');
      for (const id of post.checkpoint.childIds) {
        const child = await threadsGet(`/${id}`, credentials.accessToken, { fields: 'status' });
        if (['ERROR','EXPIRED'].includes(child.status)) throw fail('CHANNEL_PROCESSING_FAILED', 'Threads 캐러셀 이미지 처리에 실패했습니다.');
        if (child.status !== 'FINISHED') return { state: 'processing', providerRef: post.provider_ref };
      }
      await checkpoint({ ...post.checkpoint, parentRequested: true });
      const parent = await threadsPost(`/${post.account_id}/threads`, credentials.accessToken, { media_type:'CAROUSEL', text:post.caption, children:post.checkpoint.childIds.join(',') });
      if (!parent.id) throw fail('CHANNEL_OUTCOME_UNKNOWN', 'Threads 캐러셀 컨테이너 ID가 확인되지 않았습니다.');
      await checkpoint({ phase:'container', publishRequested:false }, parent.id);
      return { state:'processing', providerRef:parent.id };
    }
    const result = await threadsGet(`/${post.provider_ref}`, credentials.accessToken, { fields: 'status' });
    if (['ERROR', 'EXPIRED'].includes(result.status)) throw fail('CHANNEL_PROCESSING_FAILED', 'Threads 미디어 처리에 실패했습니다.');
    if (result.status === 'PUBLISHED') throw fail('CHANNEL_OUTCOME_UNKNOWN', '이미 게시된 컨테이너입니다. 게시물 ID를 수동으로 확인해 주세요.');
    if (result.status !== 'FINISHED') return { state: 'processing', providerRef: post.provider_ref };
    await checkpoint({ ...post.checkpoint, publishRequested: true });
    const published = await threadsPost(`/${post.account_id}/threads_publish`, credentials.accessToken, { creation_id: post.provider_ref });
    if (!published.id) throw fail('CHANNEL_OUTCOME_UNKNOWN', 'Threads 게시 ID가 확인되지 않았습니다.');
    let permalink = null;
    try { permalink = (await threadsGet(`/${published.id}`, credentials.accessToken, { fields: 'permalink' })).permalink || null; } catch { /* Publish ID remains authoritative. */ }
    return { state: 'published', externalId: published.id, providerRef: post.provider_ref, permalink };
  }
  return {
    threads: {
      authorize(settings, state) {
        return `https://www.threads.com/oauth/authorize?${new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.redirectUri, scope: definitions.threads.scopes.join(','), response_type: 'code', state })}`;
      },
      async exchange(settings, code) {
        const short = await request(`${threadsBase}/oauth/access_token`, { method: 'POST', form: { client_id: settings.clientId, client_secret: settings.clientSecret, grant_type: 'authorization_code', redirect_uri: settings.redirectUri, code } });
        const long = await threadsGet('/access_token', short.access_token, { grant_type: 'th_exchange_token', client_secret: settings.clientSecret });
        const info = await threadsGet('/debug_token', long.access_token, { input_token: long.access_token });
        if (!info.data?.is_valid) throw fail('CHANNEL_AUTH_EXPIRED', 'Threads 토큰이 유효하지 않습니다.');
        const profile = await threadsGet('/me', long.access_token, { fields: 'id,username' });
        return { accessToken: long.access_token, expiresIn: long.expires_in, scopes: info.data.scopes || [], accountId: profile.id, accountName: profile.username };
      },
      async refresh(settings, credentials) {
        const result = await threadsGet('/refresh_access_token', credentials.accessToken, { grant_type: 'th_refresh_token' });
        return { ...credentials, accessToken: result.access_token, expiresIn: result.expires_in };
      },
      async start(ctx) {
        const { post, assets, credentials, mediaUrl, checkpoint } = ctx;
        const base = { text: post.caption, media_type: post.format.toUpperCase() };
        if (post.format === 'carousel') {
          const children = [];
          for (const asset of assets) {
            const child = await threadsPost(`/${post.account_id}/threads`, credentials.accessToken, { media_type: 'IMAGE', image_url: mediaUrl(asset), is_carousel_item: 'true' });
            if (!child.id) throw fail('CHANNEL_OUTCOME_UNKNOWN', 'Threads 미디어 ID가 확인되지 않았습니다.');
            children.push(child.id);
          }
          await checkpoint({ phase:'children', childIds:children, parentRequested:false, publishRequested:false }, children[0]);
          return { state:'processing', providerRef:children[0] };
        } else if (assets.length) base[post.format === 'video' ? 'video_url' : 'image_url'] = mediaUrl(assets[0]);
        const container = await threadsPost(`/${post.account_id}/threads`, credentials.accessToken, base);
        if (!container.id) throw fail('CHANNEL_OUTCOME_UNKNOWN', 'Threads 컨테이너 ID가 확인되지 않았습니다.');
        await checkpoint({ containerId: container.id, publishRequested: false }, container.id);
        return { state: 'processing', providerRef: container.id };
      },
      resume: threadsResume
    },
    x: {
      authorize(settings, state, challenge) {
        return `https://x.com/i/oauth2/authorize?${new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.redirectUri, scope: definitions.x.scopes.join(' '), response_type: 'code', state, code_challenge: challenge, code_challenge_method: 'S256' })}`;
      },
      async exchange(settings, code, verifier) {
        const result = await request('https://api.x.com/2/oauth2/token', { method: 'POST', basic: `${settings.clientId}:${settings.clientSecret}`, form: { grant_type: 'authorization_code', code, redirect_uri: settings.redirectUri, code_verifier: verifier } });
        const profile = await request('https://api.x.com/2/users/me', { token: result.access_token });
        return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in, scopes: (result.scope || '').split(' '), accountId: profile.data?.id, accountName: profile.data?.username };
      },
      async refresh(settings, credentials) {
        if (!credentials.refreshToken) throw fail('CHANNEL_AUTH_EXPIRED', 'X 계정을 다시 연결해 주세요.');
        const result = await request('https://api.x.com/2/oauth2/token', { method: 'POST', basic: `${settings.clientId}:${settings.clientSecret}`, form: { grant_type: 'refresh_token', refresh_token: credentials.refreshToken } });
        return { ...credentials, accessToken: result.access_token, refreshToken: result.refresh_token || credentials.refreshToken, expiresIn: result.expires_in, scopes: result.scope ? result.scope.split(' ') : credentials.scopes };
      },
      async start({ post, credentials, assets, readMedia }) {
        const ids = [];
        for (const asset of assets) {
          const uploaded = await request('https://api.x.com/2/media/upload', { method: 'POST', token: credentials.accessToken, body: { media: (await readMedia(asset)).toString('base64'), media_category: 'tweet_image' } });
          if (!uploaded.data?.id) throw fail('CHANNEL_OUTCOME_UNKNOWN', 'X 미디어 ID가 확인되지 않았습니다.');
          ids.push(uploaded.data.id);
        }
        const result = await request('https://api.x.com/2/tweets', { method: 'POST', token: credentials.accessToken, body: { text: post.caption, ...(ids.length ? { media: { media_ids: ids } } : {}) } });
        if (!result.data?.id) throw fail('CHANNEL_OUTCOME_UNKNOWN', 'X 게시 ID가 확인되지 않았습니다.');
        return { state: 'published', externalId: result.data.id, permalink: `https://x.com/i/web/status/${result.data.id}` };
      }
    },
    tiktok: {
      authorize(settings, state) {
        return `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: settings.clientId, redirect_uri: settings.redirectUri, scope: definitions.tiktok.scopes.join(','), response_type: 'code', disable_auto_auth: '1', state })}`;
      },
      async exchange(settings, code) {
        const result = await request(`${tiktokBase}/oauth/token/`, { method: 'POST', form: { client_key: settings.clientId, client_secret: settings.clientSecret, grant_type: 'authorization_code', redirect_uri: settings.redirectUri, code } });
        const profile = await request(`${tiktokBase}/user/info/?fields=open_id,display_name`, { token: result.access_token });
        if (profile.data?.user?.open_id !== result.open_id) throw fail('CHANNEL_ACCOUNT_MISMATCH', 'TikTok 계정 정보가 일치하지 않습니다.');
        return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in, refreshExpiresIn: result.refresh_expires_in, scopes: (result.scope || '').split(','), accountId: result.open_id, accountName: profile.data?.user?.display_name };
      },
      async refresh(settings, credentials) {
        if (!credentials.refreshToken) throw fail('CHANNEL_AUTH_EXPIRED', 'TikTok 계정을 다시 연결해 주세요.');
        const result = await request(`${tiktokBase}/oauth/token/`, { method: 'POST', form: { client_key: settings.clientId, client_secret: settings.clientSecret, grant_type: 'refresh_token', refresh_token: credentials.refreshToken } });
        if (result.open_id !== credentials.accountId) throw fail('CHANNEL_ACCOUNT_MISMATCH', 'TikTok 갱신 계정이 변경되었습니다.');
        return { ...credentials, accessToken: result.access_token, refreshToken: result.refresh_token, expiresIn: result.expires_in, refreshExpiresIn: result.refresh_expires_in, scopes: (result.scope || '').split(',') };
      },
      async start({ assets, credentials, mediaUrl, settings }) {
        const url = mediaUrl(assets[0]);
        if (!settings.verifiedOrigin || new URL(url).origin !== settings.verifiedOrigin) throw fail('CHANNEL_MEDIA_ORIGIN_UNVERIFIED', 'TikTok 개발자 콘솔에서 미디어 origin 소유권을 검증해야 합니다.');
        const result = await request(`${tiktokBase}/post/publish/inbox/video/init/`, { method: 'POST', token: credentials.accessToken, body: { source_info: { source: 'PULL_FROM_URL', video_url: url } } });
        if (!result.data?.publish_id) throw fail('CHANNEL_OUTCOME_UNKNOWN', 'TikTok 업로드 ID가 확인되지 않았습니다.');
        return { state: 'processing', providerRef: result.data.publish_id };
      },
      async resume({ post, credentials }) {
        const result = await request(`${tiktokBase}/post/publish/status/fetch/`, { method: 'POST', token: credentials.accessToken, body: { publish_id: post.provider_ref } });
        if (result.data?.status === 'FAILED') throw fail('CHANNEL_PROCESSING_FAILED', 'TikTok 영상 처리에 실패했습니다.');
        return { state: ['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE'].includes(result.data?.status) ? 'awaiting_user' : 'processing', providerRef: post.provider_ref };
      }
    }
  };
}
