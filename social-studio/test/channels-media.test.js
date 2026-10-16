import { expect,it } from 'vitest';
import { mkdtemp,writeFile,symlink,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readChannelMedia } from '../server/channels/media.js';
it('checks exact approved bytes and rejects traversal, symlinks and changed files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'haar-channels-media-'));
 try{
  const data=Buffer.from('test'),asset={file_name:'test.jpg',bytes:4,checksum:createHash('sha256').update(data).digest('hex')};
  await writeFile(join(dir,'test.jpg'),data);expect(await readChannelMedia(dir,asset)).toEqual(data);
  await expect(readChannelMedia(dir,{...asset,file_name:'../secret'})).rejects.toMatchObject({code:'CHANNEL_MEDIA_INVALID'});
  await symlink('/etc/passwd',join(dir,'outside.jpg'));await expect(readChannelMedia(dir,{...asset,file_name:'outside.jpg'})).rejects.toMatchObject({code:'CHANNEL_MEDIA_INVALID'});
  await writeFile(join(dir,'test.jpg'),'edit');await expect(readChannelMedia(dir,asset)).rejects.toMatchObject({code:'CHANNEL_MEDIA_CHANGED'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
