import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIGRATION_LOCK_KEY = 7_288_441_201;

export function stripOuterTransaction(sql) {
  return String(sql)
    .replace(/^\s*BEGIN;\s*/i, '')
    .replace(/\s*COMMIT;\s*$/i, '');
}

export function listMigrationFiles(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map(fileName => {
      const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
      return {
        version: fileName.slice(0, 4),
        fileName,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex')
      };
    });
}

export async function runPostgresMigrations({ pool, migrationsDir, logger = console }) {
  if (!pool) throw new Error('PostgreSQL pool is required');
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(
      version text PRIMARY KEY,
      file_name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const migration of listMigrationFiles(migrationsDir)) {
      const existing = await client.query(
        'SELECT checksum FROM schema_migrations WHERE version=$1',
        [migration.version]
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch: ${migration.fileName}`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(stripOuterTransaction(migration.sql));
        await client.query(
          'INSERT INTO schema_migrations(version,file_name,checksum) VALUES($1,$2,$3)',
          [migration.version, migration.fileName, migration.checksum]
        );
        await client.query('COMMIT');
        applied.push(migration.fileName);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    const result = await client.query('SELECT max(version) AS version FROM schema_migrations');
    logger.info?.('PostgreSQL migrations complete', { applied });
    return { applied, currentVersion: result.rows[0].version || null };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export const _internal = { MIGRATION_LOCK_KEY };
