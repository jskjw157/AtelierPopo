import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { createAdsAuth } from '../server/meta/ads/auth.js';
import { testDatabase,testDbUrl } from './helpers/ads-db.js';
const account={id:'act_123',name:'HAAR',currency:'KRW',timezone_name:'Asia/Seoul',account_status:1,user_tasks:['ADVERTISE']};
describe.skipIf(!testDbUrl)('Ads identity using real PostgreSQL',()=>{
  let db,auth,graph;
  beforeAll(async()=>{ db=await testDatabase(); await db.migrateAds(); await db.migrateAds(); });
  afterAll(async()=>{if(db)await db.close()});
  beforeEach(async()=>{
    await db.pool.query('TRUNCATE users,meta_ad_connections,meta_ad_accounts CASCADE');
    await db.pool.query("INSERT INTO users(id,email,password_hash,role) VALUES('owner','owner@test','not-a-login-hash','owner'),('viewer','viewer@test','not-a-login-hash','viewer')");
    graph={listAccounts:vi.fn(async()=>[account]),account:vi.fn(async()=>account)};
    auth=createAdsAuth({pool:db.pool,graph,encrypt:value=>'encrypted:'+Buffer.from(value).toString('base64'),decrypt:value=>Buffer.from(value.slice(10),'base64').toString(),appId:'111'});
  });
  const token=(scopes=['ads_read'])=>({accessToken:'private-token',tokenInfo:{is_valid:true,type:'USER',user_id:'888',app_id:'111',scopes,expires_at:Math.floor(Date.now()/1000)+3600}});
  it('stores a separate encrypted advertising token and keeps Page credentials intact',async()=>{
    await db.pool.query("INSERT INTO social_connections(id,platform,access_token_encrypted,status) VALUES('fb','facebook','original-page-token','connected')");
    await auth.saveCredential('owner',token());
    const status=await auth.status('owner');
    expect(status.readable).toBe(true);expect(status.managementGranted).toBe(false);
    expect(JSON.stringify(status)).not.toContain('private-token');
    expect((await db.pool.query('SELECT access_token_encrypted FROM meta_ad_connections')).rows[0].access_token_encrypted).not.toBe('private-token');
    expect((await db.pool.query('SELECT access_token_encrypted FROM social_connections')).rows[0].access_token_encrypted).toBe('original-page-token');
  });
  it('rejects invalid, foreign-app and missing-scope tokens without persisting them',async()=>{
    for(const change of [{is_valid:false},{app_id:'wrong'},{type:'PAGE'},{scopes:[]}])
      await expect(auth.saveCredential('owner',{...token(),tokenInfo:{...token().tokenInfo,...change}})).rejects.toThrow();
    expect((await db.pool.query('SELECT * FROM meta_ad_connections')).rowCount).toBe(0);
  });
  it('requires an active owner, not only a claimed browser role',async()=>{
    await expect(auth.status('viewer')).rejects.toMatchObject({status:403});
    await db.pool.query("UPDATE users SET status='disabled' WHERE id='owner'");
    await expect(auth.saveCredential('owner',token())).rejects.toMatchObject({status:403});
  });
  it('discovers, selects and returns live account currency and timezone',async()=>{
    await auth.saveCredential('owner',token(['ads_management']));
    const rows=await auth.discover('owner');expect(rows[0].currency).toBe('KRW');
    await auth.select('owner','act_123');
    expect((await auth.status('owner')).selectedAccount).toMatchObject({external_account_id:'act_123',timezone_name:'Asia/Seoul'});
  });
  it('rejects account selection outside the current identity inventory',async()=>{
    await auth.saveCredential('owner',token());await auth.discover('owner');
    await expect(auth.select('owner','act_999')).rejects.toMatchObject({code:'ADS_ACCOUNT_NOT_AVAILABLE'});
  });
  it('clears selection when the identity is reauthorized, or an account disappears',async()=>{
    await auth.saveCredential('owner',token());await auth.discover('owner');await auth.select('owner','act_123');
    graph.listAccounts.mockResolvedValue([]);await auth.discover('owner');
    expect((await auth.status('owner')).selectedAccount).toBeNull();
    await auth.saveCredential('owner',token());expect((await auth.accounts('owner'))).toEqual([]);
  });
  it('denies expired credentials even before the provider is called',async()=>{
    await auth.saveCredential('owner',token());
    await db.pool.query("UPDATE meta_ad_connections SET token_expires_at=NOW()-INTERVAL '1 second'");
    expect((await auth.status('owner')).readable).toBe(false);
    await expect(auth.discover('owner')).rejects.toMatchObject({code:'ADS_RECONNECT_REQUIRED'});
    expect(graph.listAccounts).not.toHaveBeenCalled();
  });
});
