import { currentReportingIdentity } from '../reporting/contracts.js';
import { NaverSearchAdClient } from '../client.js';
import { SearchAdOperationGateway } from '../gateway.js';
import { createCircuitGuard } from '../circuit/service.js';
import { loadSearchAdWriteConfig } from './config.js';
import { SearchAdWriteRepository } from './repository.js';
import { PostgresSearchAdWriteRepository } from './postgres-repository.js';
import { SafeSearchAdGatewayRemoteAdapter } from './safe-remote-adapter.js';
import { SearchAdChangePlanService } from './plan-service.js';
import { SearchAdApprovalService } from './approval-service.js';
import { ProductionSearchAdExecutionService } from './production-execution-service.js';
import { SearchAdWriteError } from './errors.js';
import { createPostgresMutationGateway } from '../lifecycle/postgres-mutation-gateway.js';
import { createPostgresPool, closePostgresPool } from '../../../infrastructure/postgres/pool.js';

export function createProductionSearchAdWriteRuntime({
  gateway,
  activationGuard = null,
  circuitGuard = null,
  env = process.env,
  baseDir,
  database,
  postgresPool,
  clock
} = {}) {
  const config = loadSearchAdWriteConfig(env, { baseDir });
  let ownedPostgresPool = null;
  let mutationPool = null;
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
    mutationPool = pool;
    repository = new PostgresSearchAdWriteRepository({ pool, clock, identityResolver:customerId=>currentReportingIdentity({customerId,registry:gateway.registry,credentialsRegistry:gateway.credentialsRegistry,config:gateway.config}) });
  } else {
    repository = new SearchAdWriteRepository({ databasePath: config.databasePath, database });
  }

  // Native activation owns the authoritative account row, even when write plans
  // use another database. Never substitute a mirror for an existing repository.
  // Repository-free injected guards retain the supplied pool as their account store.
  const accountPool = activationGuard?.repository ? activationGuard.repository.pool : mutationPool;
  // Plan storage is not the account-control authority. SQLite plans using native
  // activation must use its fence too; a missing native pool must not fall back.
  const guard = circuitGuard || createCircuitGuard({ pool: accountPool, clock });
  if(repository.pool && guard.repository?.pool===accountPool) guard.automationRepository=repository.automation;
  const readGateway = gateway instanceof SearchAdOperationGateway && gateway.client instanceof NaverSearchAdClient ? new SearchAdOperationGateway({
    registry:gateway.registry,credentialsRegistry:gateway.credentialsRegistry,config:gateway.config,logger:gateway.logger,
    client:new NaverSearchAdClient({baseUrl:gateway.client.baseUrl,credentialsRegistry:gateway.credentialsRegistry,fetchImpl:gateway.client.fetchImpl,clock:gateway.client.clock,requestTimeoutMs:gateway.client.requestTimeoutMs,maxRetries:0,redirectPolicy:'error',logger:gateway.client.logger})
  }) : gateway;
  const remote = new SafeSearchAdGatewayRemoteAdapter({
    readGateway,
    gateway: createPostgresMutationGateway({ gateway, pool: accountPool, circuitGuard: guard, requireWriteOwner: true, ordinaryStoreReady: Boolean(accountPool && repository.pool === accountPool) })
  });
  const approvalService = new SearchAdApprovalService({ repository, config, clock });
  const planService = new SearchAdChangePlanService({ repository, remote, config, clock });
  const executionService = new ProductionSearchAdExecutionService({
    repository,
    remote,
    approvalService,
    config,
    activationGuard,
    circuitGuard: guard,
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

/** One lazy application-owned writer, shared by HTTP and completion services. */
export function getApplicationSearchAdWriteRuntime({app,env=process.env}) {
  if (!app.searchAdGateway) throw new SearchAdWriteError('SEARCHAD_NOT_READY','SearchAd gateway is unavailable.',{},503);
  if (!app.searchAdWriteRuntime) app.searchAdWriteRuntime=createProductionSearchAdWriteRuntime({gateway:app.searchAdGateway,env,baseDir:app.config?.workDir || process.cwd(),activationGuard:app.searchAdActivationRuntime?.guard,circuitGuard:app.searchAdCompletionRuntime?.circuitService,postgresPool:!env.ATELIER_SEARCHAD_WRITE_DATABASE_URL || env.ATELIER_SEARCHAD_WRITE_DATABASE_URL===env.DATABASE_URL ? app.searchAdActivationRuntime?.repository?.pool : undefined,clock:app.clock});
  return app.searchAdWriteRuntime;
}
