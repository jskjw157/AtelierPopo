import { randomUUID } from 'node:crypto';
export async function seedSource(f) {
  const mediaId=randomUUID(),productId=randomUUID();
  await f.pool.query("INSERT INTO media_assets(id,file_name,original_name,mime_type,media_type,bytes,checksum) VALUES($1,'test.jpg','test.jpg','image/jpeg','image',10,$2)",[mediaId,randomUUID()]);
  await f.pool.query("INSERT INTO products(id,name,price,product_url) VALUES($1,'HAAR Earring',120000,'https://haar.co.kr/product/earring/43/')",[productId]);
  await f.pool.query("INSERT INTO social_connections(id,platform,account_id,page_id,status) VALUES('fb','facebook','321','321','connected'),('ig','instagram','654','321','connected')");
  return {clientRequestId:randomUUID(),sourceType:'media',productId,mediaAssetIds:[mediaId],campaignName:'HAAR test',objective:'TRAFFIC',budgetType:'lifetime',budgetAmount:'20000',startAt:new Date(Date.now()+3600000).toISOString(),endAt:new Date(Date.now()+86400000).toISOString(),countries:['KR'],placements:['instagram'],primaryText:'승인할 광고 문구'};
}
