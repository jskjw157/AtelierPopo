import { loadSearchAdWriteConfig } from './config.js';
import { SearchAdWriteRepository } from './repository.js';
import { SafeSearchAdGatewayRemoteAdapter } from './safe-remote-adapter.js';
import { SearchAdChangePlanService } from './plan-service.js';
import { SearchAdApprovalService } from './approval-service.js';
import { SafeSearchAdExecutionService } from './safe-execution-service.js';

export function createSafeSearchAdWriteRuntime({ gateway, env = process.env, baseDir, database, clock } = {}) {
  const config = loadSearchAdWriteConfig(env, { baseDir });
  const repository = new SearchAdWriteRepository({ databasePath: config.databasePath, database });
  const remote = new SafeSearchAdGatewayRemoteAdapter({ gateway });
  const approvalService = new SearchAdApprovalService({ repository, config, clock });
  const planService = new SearchAdChangePlanService({ repository, remote, config, clock });
  const executionService = new SafeSearchAdExecutionService({
    repository,
    remote,
    approvalService,
    config,
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
        enabled: config.enabled,
        allowPlans: config.allowPlans,
        allowWrites: config.allowWrites,
        allowRollback: config.allowRollback,
        allowReconcile: config.allowReconcile,
        activationMode: config.initialActivationMode,
        storage: {
          runtime: 'sqlite',
          postgresSchemaAvailable: true
        },
        policy: {
          implementationTarget: 'all_official_searchad_read_write_create_update_batch_delete_rollback_automation',
          prevalidationGateTemporary: true,
          enableAfter: ['capability_probe_passed', 'active_canary_passed'],
          permanentWriteProhibition: false
        }
      };
    },
    close() { repository.close(); }
  };
}
