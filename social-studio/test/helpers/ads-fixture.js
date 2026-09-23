import { testDatabase } from './ads-db.js';
import { createAdsAuth } from '../../server/meta/ads/auth.js';
export async function adsFixture() {
  const db=await testDatabase();await db.migrateAds();
  await db.pool.query("INSERT INTO users(id,email,password_hash) VALUES('owner','owner@test','not-for-login')");
  const account={id:'act_123',name:'HAAR',currency:'KRW',timezone_name:'Asia/Seoul',account_status:1,user_tasks:['ADVERTISE']};
  const graph={listAccounts:async()=>[account],account:async()=>account,insights:async()=>[],hierarchy:async()=>({campaigns:[],adsets:[],ads:[]}),pixels:async()=>[]};
  const auth=createAdsAuth({pool:db.pool,graph,encrypt:t=>'enc:'+t,decrypt:t=>t.slice(4),appId:'111'});
  await auth.saveCredential('owner',{accessToken:'test-only-token',tokenInfo:{is_valid:true,type:'USER',app_id:'111',user_id:'888',scopes:['ads_read','ads_management'],expires_at:Math.floor(Date.now()/1000)+3600}});
  await auth.discover('owner');await auth.select('owner','act_123');
  return {...db,auth,graph,account};
}
