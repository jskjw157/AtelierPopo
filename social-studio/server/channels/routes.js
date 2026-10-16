import express from 'express';
import { z } from 'zod';
import { asyncRoute } from '../http.js';
import { fail, platformDefinition } from './policy.js';

export function createChannelRouter(service) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control','no-store'); next(); });
  router.param('platform', (_req, _res, next, platform) => { try { platformDefinition(platform); next(); } catch(e) { next(e); } });
  router.param('id', (_req, _res, next, id) => { next(z.string().uuid().safeParse(id).success ? undefined : fail('CHANNEL_ID_INVALID','요청 ID가 올바르지 않습니다.',400)); });
  router.get('/status', asyncRoute(async(req,res) => res.json(await service.status(req.user.sub))));
  router.post('/:platform/connect', asyncRoute(async(req,res) => {
    if (req.body?.consent !== true) throw fail('CHANNEL_CONSENT_REQUIRED','필수 권한과 비용을 확인하고 연결에 동의해 주세요.',400);
    res.json(await service.startOAuth(req.user.sub,req.params.platform));
  }));
  router.get('/:platform/callback', asyncRoute(async(req,res) => {
    try {
      await service.finishOAuth(req.user.sub,req.params.platform,req.query);
      res.redirect('/channels?connected='+req.params.platform);
    } catch(e) {
      const code = /^CHANNEL_[A-Z_]+$/.test(e.code || '') ? e.code : 'CHANNEL_OAUTH_FAILED';
      res.redirect('/channels?connection_error='+code);
    }
  }));
  router.post('/:platform/disconnect', asyncRoute(async(req,res) => res.json(await service.disconnect(req.user.sub,req.params.platform))));
  router.get('/posts', asyncRoute(async(req,res) => res.json(await service.posts(req.user.sub))));
  router.post('/posts', asyncRoute(async(req,res) => {
    const result = await service.createPost(req.user.sub,req.body);
    if (req.body.mode === 'publish' && !result.duplicate) result.dispatch = await service.processPost(req.user.sub,result.post.id);
    res.status(result.duplicate ? 200 : 201).json(result);
  }));
  router.post('/posts/:id/status', asyncRoute(async(req,res) => res.json(await service.processPost(req.user.sub,req.params.id,true))));
  router.post('/posts/:id/cancel', asyncRoute(async(req,res) => res.json(await service.cancel(req.user.sub,req.params.id))));
  return router;
}
