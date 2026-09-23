import { afterEach,describe,expect,it } from 'vitest';
import { createAdsInsights } from '../server/meta/ads/insights.js';
import { adsFixture } from './helpers/ads-fixture.js';
import { testDbUrl } from './helpers/ads-db.js';
const range={since:'2026-09-01',until:'2026-09-07',level:'account'};
describe.skipIf(!testDbUrl)('Ads insight storage',()=>{
  let f;afterEach(async()=>{if(f)await f.close();f=null});
  it('stores normalized data and timestamp under exact account and date range',async()=>{
    f=await adsFixture();f.graph.insights=async()=>[{account_id:'123',spend:'500',impressions:'100',date_start:range.since,date_stop:range.until}];
    const s=createAdsInsights(f);const result=await s.sync('owner',range);
    expect(result.rows[0].spend).toBe(500);expect(result.accountId).toBe('act_123');
    expect((await s.latest('owner',range)).rows[0].spend).toBe(500);
    expect((await s.latest('owner',{...range,until:'2026-09-08'})).capturedAt).toBeNull();
  });
  it('distinguishes a successful empty result from no sync',async()=>{
    f=await adsFixture();const s=createAdsInsights(f);
    expect((await s.latest('owner',range)).capturedAt).toBeNull();
    expect((await s.sync('owner',range))).toMatchObject({rows:[]});
    expect((await s.latest('owner',range)).capturedAt).not.toBeNull();
  });
  it('rejects stale in-flight results after account selection changes',async()=>{
    f=await adsFixture();f.graph.insights=async()=>{await f.pool.query('UPDATE meta_ad_accounts SET selected=FALSE');return []};
    await expect(createAdsInsights(f).sync('owner',range)).rejects.toThrow();
    expect((await f.pool.query('SELECT * FROM meta_ad_insight_runs')).rowCount).toBe(0);
  });
});
