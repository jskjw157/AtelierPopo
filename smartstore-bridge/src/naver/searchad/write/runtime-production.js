import { loadSearchAdWriteConfig } from './config.js';
import { SearchAdWriteRepository } from './repository.js';
import { PostgresSearchAdWriteRepository } from './postgres-repository.js';
import { SafeSearchAdGatewayRemoteAdapter } from './safe-remote-adapter.js';
import { SearchAdChangePlanService } from './plan-service.js';
import { SearchAdApprovalService } from './approval-service.js';
import { ProductionSearchAdExecutionService } from './production-execution-service.js';
import { SearchAdWriteError } from './errors.js';
import { createPostgresPool, closePostgresPool } from '../../../infrastructure/postgres/pool.js';

export function createProductionSearchAdWriteRuntime({
  gateway,
  activationGuard = null,
  env = process.env,
  baseDir,
  database,
  postgresPool,
  clock
} = {}) {
  const config = loadSearchAdWriteConfig(env, { baseDir });
  let ownedPostgresPool = null;
  let repository;

  if (config.storageBackend === 'postgres') {
    if (!postgresPool && !config.postgresConnectionString) {
      throw new SearchAdWriteError(
        'SEARCHAD_WRITE_POSTGRES_URL_REQUIRED',
        'PostgreSQL SearchAd write runtime에는 ATELIER_SEARCHAD_WRITE_DATABASE_URL 또는 DATABASE_URL이 필요합니다.',
        {},
        500
      );
    }
    const pool = postgresPool || createPostgresPool({
      connectionString: config.postgresConnectionString,
      sslMode: config.postgresSslMode
    });
    if (!postgresPool) ownedPostgresPool = pool;
    repository = new PostgresSearchAdWriteRepository({ pool });
  } else {
    repository = new SearchAdWriteRepository({ databasePath: config.databasePath, database });
  }

  const remote = new SafeSearchAdGatewayRemoteAdapter({ gateway });
  const approvalService = new SearchAdApprovalService({ repository, config, clock });
  const planService = new SearchAdChangePlanService({ repository, remote, config, clock });
  const executionService = new ProductionSearchAdExecutionService({
    repository,
    remote,
    approvalService,
    config,
    activationGuard,
    clock
  });

  return {
    config,
    repository,
    remote,
    planService,
    approvalService,
    executionService,
    status() {
      return {
        featureVersion: '0.7.0',
        enabled: config.enabled,
        allowPlans: config.allowPlans,
        allowWrites: config.allowWrites,
        allowRollback: config.allowRollback,
        allowReconcile: config.allowReconcile,
        activationMode: config.initialActivationMode,
        storage: {
          runtime: config.storageBackend,
          postgresSchemaAvailable: true,
          postgresRuntimeAdapter: config.storageBackend === 'postgres'
        },
        policy: {
          implementationTarget: 'all_official_searchad_read_write_create_update_batch_delete_rollback_automation',
          prevalidationGateTemporary: true,
          enableAfter: ['capability_probe_passed', 'active_canary_passed'],
          permanentWriteProhibition: false
        }
      };
    },
    async close() {
      await repository.close?.();
      if (ownedPostgresPool) await closePostgresPool(ownedPostgresPool);
    }
  };
}
