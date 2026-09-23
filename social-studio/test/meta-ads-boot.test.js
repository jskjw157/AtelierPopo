import {describe,expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import {testDatabase,testDbUrl} from './helpers/ads-db.js';

describe.skipIf(!testDbUrl)('Real server integration with isolated PostgreSQL',()=>{
 it('migrates advertising tables and mounts protected HTTP and disabled MCP routes',async()=>{
  const db=await testDatabase(),probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const schema=(await db.pool.query('SELECT current_schema() AS name')).rows[0].name;
  const url=new URL(testDbUrl);url.searchParams.set('options',`-c search_path=${schema}`);
  const child=spawn(process.execPath,['server/index.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',PORT:String(port),APP_BASE_URL:`http://127.0.0.1:${port}`,DATABASE_URL:url.toString(),DATABASE_SSL:'false',ADMIN_EMAIL:'boot@test',ADMIN_PASSWORD_HASH:await bcrypt.hash('not-a-real-password',4),SESSION_SECRET:'s'.repeat(40),TOKEN_ENCRYPTION_KEY:'a'.repeat(64),MEDIA_SIGNING_SECRET:'m'.repeat(40),META_ADS_WRITES_ENABLED:'false',HAAR_TOOL_BEARER_TOKEN:'',HAAR_TOOL_ACTOR_ID:''},stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  try{
    for(let i=0;i<100&&!log.includes('listening');i++){if(child.exitCode!==null)throw new Error(log);await new Promise(r=>setTimeout(r,40));}
    const base=`http://127.0.0.1:${port}`;
    const health=await fetch(base+'/api/health');expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({version:'0.2.0',features:{metaAds:true,adsExecutionEnabled:false}});
    expect((await fetch(base+'/api/meta/ads/status')).status).toBe(401);
    expect((await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(503);
    expect((await db.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='oauth_states' AND column_name='purpose'",[schema])).rowCount).toBe(1);
  }finally{const exit=once(child,'exit');child.kill('SIGTERM');if(child.exitCode===null)await exit;await db.close();}
 },15000);
});
