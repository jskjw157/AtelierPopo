import path from 'node:path';

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function storageBackend(value) {
  const normalized = String(value || 'sqlite').trim().toLowerCase();
  return normalized === 'postgres' ? 'postgres' : 'sqlite';
}

export function loadSearchAdWriteConfig(env = process.env, { baseDir = process.cwd() } = {}) {
  const configuredPath = String(env.ATELIER_SEARCHAD_WRITE_DB_PATH || '').trim();
  return {
    enabled: bool(env.ATELIER_SEARCHAD_WRITE_EXECUTION_ENABLED, true),
    allowPlans: bool(env.ATELIER_SEARCHAD_ALLOW_CHANGE_PLANS, true),
    allowWrites: bool(env.ATELIER_SEARCHAD_ALLOW_WRITES, false),
    allowRollback: bool(env.ATELIER_SEARCHAD_ALLOW_ROLLBACK, false),
    allowReconcile: bool(env.ATELIER_SEARCHAD_ALLOW_RECONCILE, true),
    planTtlSeconds: int(env.ATELIER_SEARCHAD_PLAN_TTL_SECONDS, 1800, { min: 60, max: 86400 }),
    approvalTtlSeconds: int(env.ATELIER_SEARCHAD_APPROVAL_TTL_SECONDS, 600, { min: 60, max: 3600 }),
    storageBackend: storageBackend(env.ATELIER_SEARCHAD_WRITE_STORAGE),
    databasePath: path.resolve(baseDir, configuredPath || './work/searchad-write.sqlite'),
    postgresConnectionString: String(env.ATELIER_SEARCHAD_WRITE_DATABASE_URL || env.DATABASE_URL || '').trim(),
    postgresSslMode: String(env.ATELIER_POSTGRES_SSL_MODE || 'require').trim().toLowerCase() || 'require',
    initialActivationMode: String(env.ATELIER_SEARCHAD_ACTIVATION_MODE || 'prevalidation').trim() || 'prevalidation'
  };
}
