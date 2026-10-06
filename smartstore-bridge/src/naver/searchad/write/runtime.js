import { loadSearchAdWriteConfig } from './config.js';
import { SearchAdWriteRepository } from './repository.js';
import { SearchAdGatewayRemoteAdapter } from './remote-adapter.js';
import { SearchAdChangePlanService } from './plan-service.js';
import { SearchAdApprovalService } from './approval-service.js';
import { SearchAdExecutionService } from './execution-service.js';

export function createSearchAdWriteRuntime({ gateway, env = process.env, baseDir, database, clock } = {}) {
  const config = loadSearchAdWriteConfig(env, { baseDir });
  const repository = new SearchAdWriteRepository({ databasePath: config.databasePath, database });
  const remote = new SearchAdGatewayRemoteAdapter({ gateway });
  const approvalService = new SearchAdApprovalService({ repository, config, clock });
  const planService = new SearchAdChangePlanService({ repository, remote, config, clock });
  const executionService = new SearchAdExecutionService({ repository, remote, approvalService, config, clock });
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
        policy: {
          implementationTarget: 'all_official_searchad_read_write_create_batch_delete_automation',
          prevalidationGateTemporary: true,
          enableAfter: ['capability_probe_passed', 'active_canary_passed']
        }
      };
    },
    close() { repository.close(); }
  };
}
