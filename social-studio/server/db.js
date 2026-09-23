import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensureBootstrapAdmin } from './bootstrap-admin.js';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const adsSql = await fs.readFile(new URL('./meta/ads/schema.sql', import.meta.url), 'utf8');
  await transaction(async client => { await client.query(sql); await client.query(adsSql); });
}

export async function bootstrapAdmin() {
  return ensureBootstrapAdmin({
    queryFn: query,
    email: config.adminEmail,
    passwordHash: config.adminPasswordHash,
    idFactory: randomUUID
  });
}

export async function bootstrapBrandProfile() {
  const existing = await query('SELECT id FROM brand_profiles LIMIT 1');
  if (existing.rowCount) return existing.rows[0].id;
  const id = randomUUID();
  await query('INSERT INTO brand_profiles (id) VALUES ($1)', [id]);
  return id;
}

export async function audit(actorUserId, action, entityType, entityId = null, metadata = {}) {
  await query(
    `INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), actorUserId, action, entityType, entityId, JSON.stringify(metadata)]
  );
}
