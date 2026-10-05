import { createWorkerRuntime } from './worker/runtime.js';
import { loadWorkerConfig } from './worker/config.js';
import { AutomationService } from './automation/service.js';
import { PostgresAutomationRepository } from './automation/postgres-repository.js';
import { createCircuitGuard } from './circuit/service.js';
import { configuredReportStorage } from './reporting/s3-storage.js';
import { createPostgresPool, closePostgresPool } from '../../infrastructure/postgres/pool.js';
import { loadSearchAdReportingConfig } from './reporting/config.js';
import { createReportingRuntime } from './reporting/runtime.js';
import { reportingError } from './reporting/contracts.js';
const TABLES = ['searchad_stats_observations', 'searchad_report_blobs', 'searchad_report_ingestions', 'searchad_report_rows_staging', 'searchad_daily_metrics', 'searchad_conversion_metrics', 'searchad_search_terms', 'searchad_master_snapshots', 'searchad_spend_evidence', 'searchad_circuit_policies', 'searchad_circuit_state', 'searchad_circuit_events', 'searchad_circuit_projection_cursors', 'searchad_automation_reservations', 'searchad_automation_policy_revisions', 'searchad_write_execution_claims', 'searchad_write_execution_outcomes'];
async function assertSchema(pool) {
  try {
    const result = await pool.query('SELECT name,to_regclass(name)::text AS relation FROM unnest($1::text[]) AS name', [TABLES]);
    if (result.rows?.length !== TABLES.length || result.rows.some(row => !row.relation)) throw new Error();
    const migration = await pool.query("SELECT version FROM schema_migrations WHERE version='0013'");
    if (migration.rows.length !== 1) throw new Error();
  } catch { throw reportingError('SEARCHAD_REPORTING_SCHEMA_NOT_READY', 503); }
}
/** Completion borrows the activation pool when available. Any injected storage
 * is borrowed; future ingestion services reuse this same resource owner. */
export async function bootstrapSearchAdCompletionRuntime({ app = {}, env = process.env, clock = Date.now, blobStorage = null, getWriteRuntime, logger = console } = {}) {
  let ownedPool = null, partialRuntime = null;
  try {
    const workerConfig = loadWorkerConfig(env);
    const reportingConfig = loadSearchAdReportingConfig(env);
    if (!app.searchAdConfig?.configured) {
      if(workerConfig.enabled)throw Object.assign(new Error(),{code:'SEARCHAD_WORKER_DEPENDENCIES'});
      const runtime=await createReportingRuntime({ reportingConfig: { ...reportingConfig, enabled: false } });
      const status=runtime.status.bind(runtime);runtime.status=()=>({...status(),worker:{required:false,initialized:false,ready:false}});
      return {runtime,startupError:null};
    }
    if (!app.searchAdGateway || !app.searchAdCredentials || !app.searchAdRegistry) throw reportingError('SEARCHAD_REPORTING_DEPENDENCIES_REQUIRED', 503);
    let pool = app.searchAdActivationRuntime?.repository?.pool;
    if (!pool) {
      if (!reportingConfig.databaseUrl) throw reportingError('SEARCHAD_REPORTING_DATABASE_REQUIRED', 503);
      ownedPool = createPostgresPool({ connectionString: reportingConfig.databaseUrl, sslMode: reportingConfig.postgresSslMode, logger }); pool = ownedPool;
    }
    await assertSchema(pool);
    for (const customer of app.searchAdCredentials.listCustomers()) {
      if (customer.status === 'active') {
        await pool.query('INSERT INTO searchad_customer_accounts(customer_id) VALUES($1) ON CONFLICT(customer_id) DO NOTHING', [customer.customerId]);
        await pool.query('INSERT INTO searchad_canary_accounts(customer_id) VALUES($1) ON CONFLICT(customer_id) DO NOTHING', [customer.customerId]);
      }
    }
    const storage = blobStorage || configuredReportStorage(env);
    const runtime = await createReportingRuntime({ pool, blobStorage: storage, gateway: app.searchAdGateway, registry: app.searchAdRegistry, credentialsRegistry: app.searchAdCredentials, config: app.searchAdConfig, reportingConfig, clock, closeOwnedResources: async () => { if (!blobStorage) storage?.client?.destroy?.(); await closePostgresPool(ownedPool); } });

    partialRuntime=runtime;
    const spendEvidence = reportingConfig.enabled && runtime.repository ? { async select(dispatch, { client, now }) {
      // Producer order is Customer advisory -> report date advisory -> job row.
      // The final account fence holds this shared producer lock through initiation.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`report-circuit:${dispatch.customerId}`]);
      const identity = runtime.identityResolver(dispatch.customerId);
      const row = await runtime.repository.selectSpendEvidence({ customerId: dispatch.customerId, entityType: dispatch.entityType, entityId: dispatch.entityId, identity, now, maxAgeMs: 86400000, client });
      // A report total alone establishes no comparable deviation baseline.
      return row ? { spendGrossKrw: Number(row.spend_gross_krw), baselineGrossKrw: null, validUntil: Date.parse(row.generation_lower) + 86400000 } : null;
    } } : null;
    runtime.circuitService = createCircuitGuard({ pool, clock, spendEvidence });
    runtime.circuitRepository = runtime.circuitService.repository;
    runtime.automationRepository = new PostgresAutomationRepository({pool,clock,identityResolver:runtime.identityResolver});
    runtime.circuitService.automationRepository = runtime.automationRepository;
    const automationService = new AutomationService({repository:runtime.automationRepository,evidenceSelector:{select:input=>runtime.repository?.selectAutomationEvidence(input) || {stats:null,spend:null}},circuit:runtime.circuitService,getWriteRuntime,identityResolver:runtime.identityResolver,clock});
    runtime.automationService = Object.fromEntries(['createPolicy','listPolicies','listRuns','getRun','evaluate','prepare','executeApproved','reconcile'].map(method=>[method,(input,context)=>runtime.trackOperation(()=>automationService[method](input,context))]));
    const reportingStatus = runtime.status.bind(runtime);
    runtime.workerRuntime=await createWorkerRuntime({completion:runtime,pool,env,clock,logger});
    const closeReporting=runtime.close.bind(runtime);
    runtime.close=async()=>{await runtime.workerRuntime?.close();await closeReporting();};
    runtime.status = () => ({ ...reportingStatus(), worker:runtime.workerRuntime?.status() || {required:false,initialized:false,ready:false}, circuit: { ready: !runtime.isClosing(), mode: 'observe', automationEnabled: false }, automation: { ready: !runtime.isClosing(), defaultMode: 'observe', autoAvailable: false } });
    return { runtime, startupError: null };
  } catch (error) {
    if(partialRuntime)await partialRuntime.close();else await closePostgresPool(ownedPool);
    const code = /^SEARCHAD_(?:REPORTING|WORKER)_[A-Z_]+$/.test(error?.code || '') ? error.code : 'SEARCHAD_REPORTING_STARTUP_FAILED';
    const startupError = { code, message: 'SearchAd completion startup failed; reporting remains unavailable.' };
    logger.error?.('SearchAd completion startup failed', { code });
    return { runtime: null, startupError };
  }
}
