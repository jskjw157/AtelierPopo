import { randomUUID } from 'node:crypto';
export async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); const value = await work(client); await client.query('COMMIT'); return value;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function adsAudit(db, actorId, action, entityId = null, metadata = {}) {
  await db.query(`INSERT INTO audit_logs(id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES($1,$2,$3,'meta_ads',$4,$5::jsonb)`, [randomUUID(),actorId,action,entityId,JSON.stringify(metadata)]);
}
export async function lockAdsContext(client, actorId, ctx) {
  const {rows}=await client.query(`SELECT c.generation FROM meta_ad_connections c JOIN meta_ad_accounts a ON a.connection_generation=c.generation
    WHERE c.owner_user_id=$1 AND c.generation=$2 AND c.status='connected' AND a.selected=TRUE AND a.accessible=TRUE AND a.external_account_id=$3
    AND (c.token_expires_at IS NULL OR c.token_expires_at>NOW()) FOR UPDATE OF c,a`,[actorId,ctx.generation,ctx.account.external_account_id]);
  if(!rows.length) {const error=new Error('광고 계정 또는 권한이 변경됐습니다.');error.status=409;error.code='ADS_CONTEXT_CHANGED';throw error;}
}
