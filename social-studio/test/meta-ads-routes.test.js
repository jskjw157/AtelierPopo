import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAdsRouter } from '../server/meta/ads/routes.js';
import { requireAuth,requireCsrf } from '../server/auth.js';
import { errorHandler } from '../server/http.js';
import { adsFixture } from './helpers/ads-fixture.js';
import { testDbUrl } from './helpers/ads-db.js';
describe.skipIf(!testDbUrl)('Ads HTTP security boundary',()=>{
 let f,app;
 beforeAll(async()=>{
  f=await adsFixture();app=express();app.use(express.json());
  app.use((req,_res,next)=>{if(req.get('x-test-user'))req.user={sub:req.get('x-test-user')};req.cookies={haar_csrf:'test-csrf'};next()});
  app.use('/api/meta/ads',requireAuth,requireCsrf,createAdsRouter({...f,status:()=>f.auth.status('owner'),insights:{},drafts:{},actions:{},startOAuth:async()=> 'https://www.facebook.com/oauth-test'}));
  app.use(errorHandler);
 });
 afterAll(async()=>{if(f)await f.close()});
 it('requires a session even for status reads',async()=>{expect((await request(app).get('/api/meta/ads/status')).status).toBe(401)});
 it('requires an active owner in the database',async()=>{expect((await request(app).get('/api/meta/ads/status').set('x-test-user','unknown')).status).toBe(403)});
 it('does not expose Meta credentials in status',async()=>{
  const r=await request(app).get('/api/meta/ads/status').set('x-test-user','owner');expect(r.status).toBe(200);expect(JSON.stringify(r.body)).not.toContain('test-only-token');
 });
 it('requires CSRF for permission changes and account selection',async()=>{
  expect((await request(app).post('/api/meta/ads/connect').set('x-test-user','owner')).status).toBe(403);
  const r=await request(app).post('/api/meta/ads/connect').set('x-test-user','owner').set('x-csrf-token','test-csrf');expect(r.status).toBe(200);expect(r.body.url).toContain('facebook.com');
 });
 it('does not accept a bare approved=true as an approval',async()=>{
  const r=await request(app).post('/api/meta/ads/actions/00000000-0000-4000-8000-000000000001/approve').set('x-test-user','owner').set('x-csrf-token','test-csrf').send({approved:true});expect(r.status).toBe(400);
 });
});
