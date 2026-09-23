import express from 'express';
import { z } from 'zod';
import { AppError, asyncRoute } from '../../http.js';

const uuid=z.string().uuid();
const confirmation=z.object({confirmed:z.literal(true)}).strict();
const approval=confirmation.extend({expectedHash:z.string().regex(/^[a-f0-9]{64}$/)});
function parse(schema,value) {
  const result=schema.safeParse(value);
  if(!result.success)throw new AppError(400,'ADS_REQUEST_INVALID','승인 내용과 입력값을 확인해 주세요.');
  return result.data;
}

// Mount behind the normal session and CSRF middleware. The database role check
// also prevents a revoked owner from continuing with an old session token.
export function createAdsRouter(services) {
  const {auth,insights,drafts,actions}=services,router=express.Router();
  router.use(asyncRoute(async(req,_res,next)=>{await auth.owner(req.user?.sub);next();}));
  router.get('/status',asyncRoute(async(req,res)=>res.json(await services.status(req.user.sub))));
  router.post('/connect',asyncRoute(async(req,res)=>res.json({url:await services.startOAuth(req.user.sub)})));
  router.get('/accounts',asyncRoute(async(req,res)=>res.json({accounts:await auth.accounts(req.user.sub)})));
  router.post('/accounts/sync',asyncRoute(async(req,res)=>res.json({accounts:await auth.discover(req.user.sub)})));
  router.post('/accounts/:id/select',asyncRoute(async(req,res)=>res.json({account:await auth.select(req.user.sub,req.params.id)})));
  router.post('/test',asyncRoute(async(req,res)=>res.json(await services.testConnection(req.user.sub))));
  router.post('/disconnect',asyncRoute(async(req,res)=>{await auth.disconnect(req.user.sub);res.status(204).end();}));
  router.get('/campaigns',asyncRoute(async(req,res)=>res.json(await services.hierarchy(req.user.sub))));
  router.get('/tracking',asyncRoute(async(req,res)=>res.json({pixels:await services.tracking(req.user.sub)})));
  router.get('/insights',asyncRoute(async(req,res)=>res.json(await insights.latest(req.user.sub,req.query))));
  router.post('/insights/sync',asyncRoute(async(req,res)=>res.json(await insights.sync(req.user.sub,req.body))));
  router.get('/drafts',asyncRoute(async(req,res)=>res.json({drafts:await drafts.list(req.user.sub)})));
  router.post('/drafts',asyncRoute(async(req,res)=>res.status(201).json({draft:await drafts.create(req.user.sub,req.body)})));
  router.get('/drafts/:id',asyncRoute(async(req,res)=>res.json({draft:await drafts.get(req.user.sub,parse(uuid,req.params.id))})));
  router.put('/drafts/:id',asyncRoute(async(req,res)=>res.json({draft:await drafts.update(req.user.sub,parse(uuid,req.params.id),req.body)})));
  router.get('/actions',asyncRoute(async(req,res)=>res.json({actions:await actions.list(req.user.sub)})));
  router.post('/actions',asyncRoute(async(req,res)=>res.status(201).json({action:await actions.prepare(req.user.sub,req.body)})));
  router.post('/actions/:id/approve',asyncRoute(async(req,res)=>{
    const body=parse(approval,req.body);
    res.json({action:await actions.approve(req.user.sub,parse(uuid,req.params.id),body.expectedHash)});
  }));
  router.post('/actions/:id/execute',asyncRoute(async(req,res)=>{
    parse(confirmation,req.body);
    res.json({action:await actions.execute(req.user.sub,parse(uuid,req.params.id))});
  }));
  router.post('/actions/:id/reconcile',asyncRoute(async(req,res)=>res.json({action:await actions.reconcile(req.user.sub,parse(uuid,req.params.id))})));
  router.post('/actions/:id/cancel',asyncRoute(async(req,res)=>res.json({action:await actions.cancel(req.user.sub,parse(uuid,req.params.id))})));
  return router;
}
