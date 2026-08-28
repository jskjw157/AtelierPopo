#!/usr/bin/env node
import path from 'node:path';
import { createPostgresPool, closePostgresPool } from '../src/infrastructure/postgres/pool.js';
import { runPostgresMigrations } from '../src/infrastructure/postgres/migrator.js';

const pool = createPostgresPool({
  connectionString: process.env.DATABASE_URL,
  sslMode: process.env.ATELIER_POSTGRES_SSL_MODE || 'require'
});
if (!pool) throw new Error('DATABASE_URL is required');
try {
  console.log(JSON.stringify(await runPostgresMigrations({
    pool,
    migrationsDir: path.resolve('migrations/postgres')
  }), null, 2));
} finally {
  await closePostgresPool(pool);
}
