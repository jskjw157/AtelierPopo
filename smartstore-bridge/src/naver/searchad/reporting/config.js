import { reportingError } from './contracts.js';
function flag(env, key, fallback) {
  const value = env[key]; if (value === undefined || value === '') return fallback;
  if (value !== 'true' && value !== 'false') throw reportingError('SEARCHAD_REPORTING_CONFIG_INVALID', 503);
  return value === 'true';
}
function positive(env,key,max){if(env[key]===undefined||env[key]==='')return null;const value=Number(env[key]);if(!/^\d+$/.test(env[key])||!Number.isSafeInteger(value)||value<1||value>max)throw reportingError('SEARCHAD_REPORTING_CONFIG_INVALID',503);return value;}
export function loadSearchAdReportingConfig(env = process.env) {
  const clockUncertaintyMs=positive(env,'ATELIER_SEARCHAD_REPORT_CLOCK_UNCERTAINTY_MS',3600000);
  const rolloutUncertaintyMs=positive(env,'ATELIER_SEARCHAD_REPORT_ROLLOUT_UNCERTAINTY_MS',86400000);
  return { ingestionRequired:flag(env,'ATELIER_SEARCHAD_REPORT_INGESTION_REQUIRED',false),production:env.NODE_ENV==='production',generationPolicy:clockUncertaintyMs && rolloutUncertaintyMs ? {version:'generation-window-v1',clockUncertaintyMs,rolloutUncertaintyMs} : null,maxDownloadBytes:positive(env,'ATELIER_SEARCHAD_REPORT_MAX_BYTES',268435456)||67108864, enabled: flag(env, 'ATELIER_SEARCHAD_REPORTING_ENABLED', true), allowReportingJobs: flag(env, 'ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS', false), databaseUrl: String(env.DATABASE_URL || '').trim() || null, postgresSslMode: String(env.ATELIER_POSTGRES_SSL_MODE || 'require') };
}
