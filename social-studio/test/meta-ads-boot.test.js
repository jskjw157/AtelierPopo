import {describe,expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {testDatabase,testDbUrl} from './helpers/ads-db.js';

describe.skipIf(!testDbUrl)('Real server integration with isolated PostgreSQL',()=>{
 it('migrates advertising tables and mounts protected HTTP and disabled MCP routes',async()=>{
  const db=await testDatabase(),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const schema=(await db.pool.query('SELECT current_schema() AS name')).rows[0].name;
  const url=new URL(testDbUrl);url.searchParams.set('options',`-c search_path=${schema}`);
  const child=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',PORT:String(port),APP_BASE_URL:`http://127.0.0.1:${port}`,DATABASE_URL:url.toString(),DATABASE_SSL:'false',ADMIN_EMAIL:'boot@test',ADMIN_PASSWORD_HASH:await bcrypt.hash('not-a-real-password',4),SESSION_SECRET:'s'.repeat(40),TOKEN_ENCRYPTION_KEY:'a'.repeat(64),MEDIA_SIGNING_SECRET:'m'.repeat(40),META_ADS_WRITES_ENABLED:'false',HAAR_TOOL_BEARER_TOKEN:'',HAAR_TOOL_ACTOR_ID:'',THREADS_CONNECT_ENABLED:'false',THREADS_WRITES_ENABLED:'false',TIKTOK_CONNECT_ENABLED:'false',TIKTOK_WRITES_ENABLED:'false',X_CONNECT_ENABLED:'false',X_WRITES_ENABLED:'false',X_BILLING_APPROVED:'false'},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  try{
    for(let i=0;i<100&&!log.includes('listening');i++){if(child.exitCode!==null)throw new Error(log);await new Promise(r=>setTimeout(r,40));}
    const base=`http://127.0.0.1:${port}`;
    const health=await fetch(base+'/api/health');expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({version:'0.2.0',features:{metaAds:true,adsExecutionEnabled:false}});
    expect((await fetch(base+'/api/meta/ads/status')).status).toBe(401);
    expect((await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(503);
    expect((await fetch(base+'/api/channels/status')).status).toBe(401);
    const owner=(await db.pool.query("SELECT id FROM users WHERE email='boot@test'")).rows[0];
    const session=jwt.sign({sub:owner.id,role:'owner'},'s'.repeat(40),{issuer:'haar-social-studio',audience:'haar-admin',expiresIn:'1h'});
    const headers={cookie:`haar_session=${session}; haar_csrf=mock-csrf`,'x-csrf-token':'mock-csrf','content-type':'application/json'};
    const channels=await (await fetch(base+'/api/channels/status',{headers})).json();
    expect(channels.channels).toHaveLength(3);expect(channels.channels.every(c=>!c.connectEnabled&&!c.writesEnabled)).toBe(true);
    const content={clientRequestId:randomUUID(),platform:'threads',format:'text',caption:'local-only draft',mediaAssetIds:[],mode:'draft',consent:true};
    expect((await fetch(base+'/api/channels/posts',{method:'POST',headers,body:JSON.stringify(content)})).status).toBe(201);
    const locked=await fetch(base+'/api/channels/posts',{method:'POST',headers,body:JSON.stringify({...content,clientRequestId:randomUUID(),mode:'publish'})});
    expect(locked.status).toBe(409);expect((await locked.json()).error.code).toBe('CHANNEL_NOT_CONFIGURED');
    expect((await db.pool.query('SELECT state FROM channel_posts')).rows).toEqual([{state:'draft'}]);
    expect((await db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='oauth_states' AND column_name='purpose'",[schema])).rowCount).toBe(1);
  }finally{const exit=once(child,'exit');child.kill('SIGTERM');if(child.exitCode===null)await exit;await db.close();}
 },15000);
});
