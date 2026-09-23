import { randomUUID } from 'node:crypto';
import { afterEach,describe,expect,it } from 'vitest';
import { createAdsDrafts } from '../server/meta/ads/drafts.js';
import { adsFixture } from './helpers/ads-fixture.js';
import { testDbUrl } from './helpers/ads-db.js';
describe.skipIf(!testDbUrl)('Local ad drafts',()=>{
  let f;afterEach(async()=>{if(f)await f.close();f=null});
  it('saves a product landing link, media checksum and exact account in a non-spending draft',async()=>{
    f=await adsFixture();const input=await seedSource(f),s=createAdsDrafts(f);const r=await s.create('owner',input);
    expect(r.status).toBe('draft');expect(r.definition.landingUrl).toBe('https://haar.co.kr/product/earring/43/');
    expect(r.definition.account.id).toBe('act_123');expect(r.definition.budgetAmountMinor).toBe(20000);
    expect(r.definition.creative.checksum).toBeTruthy();expect((await s.list('owner'))).toHaveLength(1);
  });
  it('makes repeated and concurrent identical requests idempotent',async()=>{
    f=await adsFixture();const input=await seedSource(f),s=createAdsDrafts(f);
    const [a,b]=await Promise.all([s.create('owner',input),s.create('owner',input)]);expect(a.id).toBe(b.id);
    await expect(s.create('owner',{...input,budgetAmount:'30000'})).rejects.toMatchObject({code:'ADS_IDEMPOTENCY_CONFLICT'});
  });
  it('rejects invalid URLs and fractional budgets rather than rounding',async()=>{
    f=await adsFixture();const input=await seedSource(f),s=createAdsDrafts(f);
    for(const patch of [{landingUrl:'javascript:alert(1)'},{landingUrl:'https://user:password@haar.co.kr/'},{budgetAmount:'0.1'}])await expect(s.create('owner',{...input,...patch})).rejects.toThrow();
  });
  it('uses optimistic revisions and invalidates old approvals when edited',async()=>{
    f=await adsFixture();const input=await seedSource(f),s=createAdsDrafts(f);const d=await s.create('owner',input);
    const updated=await s.update('owner',d.id,{...input,expectedRevision:1,budgetAmount:'30000'});
    expect(updated.revision).toBe(2);
    await expect(s.update('owner',d.id,{...input,expectedRevision:1})).rejects.toMatchObject({code:'ADS_DRAFT_STALE'});
  });
  it('revalidates the selected media before launch preparation',async()=>{
    f=await adsFixture();const input=await seedSource(f),s=createAdsDrafts(f);const d=await s.create('owner',input);
    await f.pool.query("UPDATE media_assets SET status='deleted' WHERE id=$1",[input.mediaAssetIds[0]]);
    await expect(s.revalidate('owner',d.id)).rejects.toMatchObject({code:'ADS_MEDIA_UNAVAILABLE'});
  });
  it('requires a connected Page and an accessible purchase pixel for sales launch',async()=>{
    f=await adsFixture();const input=await seedSource(f),s=createAdsDrafts(f);
    const d=await s.create('owner',{...input,objective:'SALES',pixelId:'777'});
    await expect(s.validateLaunch('owner',d.id)).rejects.toMatchObject({code:'ADS_SALES_TRACKING_REQUIRED'});
    f.graph.pixels=async()=>[{id:'777',name:'HAAR Pixel'}];
    expect((await s.validateLaunch('owner',d.id)).definition.objective).toBe('SALES');
  });
  it('keeps the persisted product, media and CTA consistent with the updated definition',async()=>{
    f=await adsFixture();const input=await seedSource(f),service=createAdsDrafts(f),d=await service.create('owner',input);
    const nextMedia=randomUUID(),nextProduct=randomUUID();
    await f.pool.query("INSERT INTO media_assets(id,file_name,original_name,mime_type,media_type,bytes,checksum) VALUES($1,'new.jpg','new.jpg','image/jpeg','image',10,$2)",[nextMedia,randomUUID()]);
    await f.pool.query("INSERT INTO products(id,name,product_url) VALUES($1,'New Product','https://haar.co.kr/product/new/44/')",[nextProduct]);
    const updated=await service.update('owner',d.id,{...input,expectedRevision:1,productId:nextProduct,mediaAssetIds:[nextMedia],callToAction:'LEARN_MORE'});
    expect(updated.product_id).toBe(nextProduct);expect(updated.media_asset_ids).toEqual([nextMedia]);expect(updated.call_to_action).toBe('LEARN_MORE');
  });

});

import { seedSource } from './helpers/ads-source.js';
