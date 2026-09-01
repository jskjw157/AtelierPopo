import pg from 'pg';

const { Pool } = pg;

export function createPostgresPool({
  connectionString,
  max = 10,
  sslMode = 'require',
  logger = console
} = {}) {
  if (!connectionString) return null;
  const ssl = sslMode === 'disable'
    ? false
    : { rejectUnauthorized: sslMode === 'verify-full' };
  const pool = new Pool({ connectionString, max, ssl });
  pool.on('error', error => logger.error?.('PostgreSQL idle client error', {
    message: error.message
  }));
  return pool;
}

export async function closePostgresPool(pool) {
  if (pool) await pool.end();
}
