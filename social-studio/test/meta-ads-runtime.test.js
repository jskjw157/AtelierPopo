import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createAdsRuntime,loadAdImage} from '../server/meta/ads/runtime.js';
import {adsFixture} from './helpers/ads-fixture.js';
import {testDbUrl} from './helpers/ads-db.js';
let dir;
afterEach(async()=>{if(dir)await rm(dir,{recursive:true,force:true});dir=null;});
async function imageFixture(){dir=await mkdtemp(path.join(os.tmpdir(),'haar-ad-image-'));const data=Buffer.from('test-image');await writeFile(path.join(dir,'asset.jpg'),data);const checksum=createHash('sha256').update(data).digest('hex');const row={file_name:'asset.jpg',bytes:data.length,checksum,media_type:'image',mime_type:'image/jpeg',status:'ready'};return {data,row,creative:{assetId:'asset',checksum,mimeType:'image/jpeg'},pool:{query:async()=>({rows:[row]})},uploadDir:dir};}
it('loads only the exact image bytes approved in the draft',async()=>{const f=await imageFixture();expect(await loadAdImage(f,f.creative)).toBe(f.data.toString('base64'));});
it('blocks an altered file even when the database checksum is unchanged',async()=>{const f=await imageFixture();await writeFile(path.join(dir,'asset.jpg'),'wrong-byte');await expect(loadAdImage(f,f.creative)).rejects.toMatchObject({code:'ADS_IMAGE_CHANGED'});});
it('rejects path traversal in stored media filenames',async()=>{const f=await imageFixture();f.row.file_name='../secret';await expect(loadAdImage(f,f.creative)).rejects.toMatchObject({code:'ADS_IMAGE_UNAVAILABLE'});});
it('rejects a symlink out of the upload directory',async()=>{const f=await imageFixture();await symlink('/etc/passwd',path.join(dir,'outside.jpg'));f.row.file_name='outside.jpg';await expect(loadAdImage(f,f.creative)).rejects.toMatchObject({code:'ADS_IMAGE_UNAVAILABLE'});});
describe.skipIf(!testDbUrl)('Ads production service composition',()=>{
 it('creates a separate OAuth state without requesting advertising scopes from publishing',async()=>{
   const f=await adsFixture();try{
    const runtime=createAdsRuntime({pool:f.pool,config:{meta:{appId:'111',appSecret:'test-only',graphVersion:'v26.0',redirectUri:'https://social.haarapp.tech/api/meta/callback'},uploadDir:'/nonexistent'},get:async()=>({}),post:async()=>{throw new Error('writes not expected')},encrypt:t=>'enc:'+t,decrypt:t=>t.slice(4)});
    const u=new URL(await runtime.startOAuth('owner'));expect(u.searchParams.get('scope')).toBe('ads_read,ads_management');
    const states=(await f.pool.query('SELECT * FROM oauth_states')).rows;expect(states).toHaveLength(1);expect(states[0].purpose).toBe('ads');expect(states[0].state_hash).not.toBe(u.searchParams.get('state'));
    expect((await runtime.status('owner')).executionEnabled).toBe(false);
   }finally{await f.close();}
 });
});
