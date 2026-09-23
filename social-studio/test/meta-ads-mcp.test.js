import {expect,it} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createAdsMcpRouter} from '../server/meta/ads/mcp.js';
const secret='test-only-scoped-credential-01234567890123456789';
function app(){const app=express();app.use(express.json());app.use('/mcp',createAdsMcpRouter({bearerToken:secret,actorId:'owner',appBaseUrl:'https://social.haarapp.tech',services:{auth:{owner:async()=>{},accounts:async()=>[]},status:async()=>({readable:true,executionEnabled:false})}}));return app;}
const rpc={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
const call=(body,token=secret)=>request(app()).post('/mcp').set('host','social.haarapp.tech').set('accept','application/json, text/event-stream').set('authorization','Bearer '+token).send(body);
it('rejects missing or wrong MCP bearer credentials',async()=>{expect((await call(rpc,'wrong')).status).toBe(401)});
it('exposes read tools only by default',async()=>{
 const r=await call(rpc);expect(r.status).toBe(200);expect(r.body.result.tools.some(t=>t.name==='haar_ads_status')).toBe(true);
 expect(r.body.result.tools.every(t=>t.annotations.readOnlyHint===true)).toBe(true);
 expect(r.body.result.tools.some(t=>/execute|approve|create/.test(t.name))).toBe(false);
});
it('returns status through the shared domain without exposing the secret',async()=>{
 const r=await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'haar_ads_status',arguments:{}}});
 expect(r.status).toBe(200);expect(r.body.result.content[0].text).toContain('readable');expect(JSON.stringify(r.body)).not.toContain(secret);
});
it('rejects a foreign browser origin before tool dispatch',async()=>{
 const r=await call(rpc).set('origin','https://evil.test');expect(r.status).toBe(403);
});
