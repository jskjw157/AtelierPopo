import { reportingError } from './contracts.js';
function flag(env, key, fallback) {
  const value = env[key]; if (value === undefined || value === '') return fallback;
  if (value !== 'true' && value !== 'false') throw reportingError('SEARCHAD_REPORTING_CONFIG_INVALID', 503);
  return value === 'true';
}
export function loadSearchAdReportingConfig(env = process.env) {
  return { enabled: flag(env, 'ATELIER_SEARCHAD_REPORTING_ENABLED', true), allowReportingJobs: flag(env, 'ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS', false), databaseUrl: String(env.DATABASE_URL || '').trim() || null, postgresSslMode: String(env.ATELIER_POSTGRES_SSL_MODE || 'require') };
}
