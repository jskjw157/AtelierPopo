import { configuredReportStorage } from './reporting/s3-storage.js';
import { createPostgresPool, closePostgresPool } from '../../infrastructure/postgres/pool.js';
import { loadSearchAdReportingConfig } from './reporting/config.js';
import { createReportingRuntime } from './reporting/runtime.js';
import { reportingError } from './reporting/contracts.js';
const TABLES = ['searchad_stats_observations', 'searchad_report_blobs', 'searchad_report_ingestions', 'searchad_report_rows_staging', 'searchad_daily_metrics', 'searchad_conversion_metrics', 'searchad_search_terms', 'searchad_master_snapshots', 'searchad_spend_evidence'];
async function assertSchema(pool) {
  try {
    const result = await pool.query('SELECT name,to_regclass(name)::text AS relation FROM unnest($1::text[]) AS name', [TABLES]);
    if (result.rows?.length !== TABLES.length || result.rows.some(row => !row.relation)) throw new Error();
    const migration = await pool.query("SELECT version FROM schema_migrations WHERE version='0011'");
    if (migration.rows.length !== 1) throw new Error();
  } catch { throw reportingError('SEARCHAD_REPORTING_SCHEMA_NOT_READY', 503); }
}
/** Completion borrows the activation pool when available. Any injected storage
 * is borrowed; future ingestion services reuse this same resource owner. */
export async function bootstrapSearchAdCompletionRuntime({ app = {}, env = process.env, clock = Date.now, blobStorage = null, logger = console } = {}) {
  let ownedPool = null;
  try {
    const reportingConfig = loadSearchAdReportingConfig(env);
    if (!app.searchAdConfig?.configured || !reportingConfig.enabled) return { runtime: await createReportingRuntime({ reportingConfig: { ...reportingConfig, enabled: false } }), startupError: null };
    if (!app.searchAdGateway || !app.searchAdCredentials || !app.searchAdRegistry) throw reportingError('SEARCHAD_REPORTING_DEPENDENCIES_REQUIRED', 503);
    let pool = app.searchAdActivationRuntime?.repository?.pool;
    if (!pool) {
      if (!reportingConfig.databaseUrl) throw reportingError('SEARCHAD_REPORTING_DATABASE_REQUIRED', 503);
      ownedPool = createPostgresPool({ connectionString: reportingConfig.databaseUrl, sslMode: reportingConfig.postgresSslMode, logger }); pool = ownedPool;
    }
    await assertSchema(pool);
    for (const customer of app.searchAdCredentials.listCustomers()) {
      if (customer.status === 'active') await pool.query('INSERT INTO searchad_customer_accounts(customer_id) VALUES($1) ON CONFLICT(customer_id) DO NOTHING', [customer.customerId]);
    }
    const storage = blobStorage || configuredReportStorage(env);
    const runtime = await createReportingRuntime({ pool, blobStorage: storage, gateway: app.searchAdGateway, registry: app.searchAdRegistry, credentialsRegistry: app.searchAdCredentials, config: app.searchAdConfig, reportingConfig, clock, closeOwnedResources: async () => { if (!blobStorage) storage?.client?.destroy?.(); await closePostgresPool(ownedPool); } });

    return { runtime, startupError: null };
  } catch (error) {
    await closePostgresPool(ownedPool);
    const code = /^SEARCHAD_REPORTING_[A-Z_]+$/.test(error?.code || '') ? error.code : 'SEARCHAD_REPORTING_STARTUP_FAILED';
    const startupError = { code, message: 'SearchAd completion startup failed; reporting remains unavailable.' };
    logger.error?.('SearchAd completion startup failed', { code });
    return { runtime: null, startupError };
  }
}
