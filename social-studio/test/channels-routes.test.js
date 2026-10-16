import { expect,it,vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { requireAuth,requireCsrf } from '../server/auth.js';
import { errorHandler } from '../server/http.js';
import { createChannelRouter } from '../server/channels/routes.js';
function app(service,authenticated=true){const a=express();a.use(express.json(),cookieParser());a.use((req,_res,next)=>{if(authenticated)req.user={sub:'owner',role:'owner'};next();});a.use('/api/channels',requireAuth,requireCsrf,createChannelRouter(service));a.use(errorHandler);return a;}
it('protects channels with existing authentication and CSRF middleware',async()=>{
 const service={startOAuth:vi.fn()};
 expect((await request(app(service,false)).get('/api/channels/status')).status).toBe(401);
 expect((await request(app(service)).post('/api/channels/x/connect').send({consent:true})).status).toBe(403);expect(service.startOAuth).not.toHaveBeenCalled();
});
it('does not echo callback codes, tokens or provider descriptions',async()=>{
 const secret='only-test-secret';const service={finishOAuth:vi.fn(async()=>{throw new Error(secret);})};
 const r=await request(app(service)).get(`/api/channels/x/callback?code=${secret}&error_description=${secret}&state=state`);
 expect(r.status).toBe(302);expect(r.headers.location).toBe('/channels?connection_error=CHANNEL_OAUTH_FAILED');expect(r.text).not.toContain(secret);
});
it('rechecks the same client request without executing another provider dispatch',async()=>{
 const service={createPost:vi.fn(async()=>({post:{id:'post'},duplicate:true})),processPost:vi.fn()};
 const r=await request(app(service)).post('/api/channels/posts').set('Cookie','haar_csrf=test').set('x-csrf-token','test').send({mode:'publish'});
 expect(r.status).toBe(200);expect(service.processPost).not.toHaveBeenCalled();
});
