import { randomUUID } from 'node:crypto';
import { SearchAdWriteError, isAmbiguousSearchAdWriteError } from '../write/errors.js';
import { assertNoCallerRemoteIds } from './hierarchy-validator.js';
import { SEARCHAD_HIERARCHY_OPERATIONS } from './operations.js';

const START_KEYS = new Set(['customerId', 'planId', 'executionToken']);
const UNRESOLVED_RUN_STATUSES = Object.freeze([
  'created',
  'preflight_verified',
  'active',
  'cleanup_pending',
  'unknown_outcome',
  'manual_review'
]);

function fail(code, message, details = {}, status = 400) {
  throw new SearchAdWriteError(code, message, details, status);
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function safeError(error) {
  return {
    name: String(error?.name || 'Error'),
    code: String(error?.code || 'SEARCHAD_HIERARCHY_REMOTE_ERROR'),
    status: Number(error?.status || error?.statusCode || 0) || undefined
  };
}

function normalizePrincipal(context = {}) {
  const principal = context?.principal || {};
  return {
    principalId: String(principal.principalId || '').trim(),
    role: String(principal.role || '').trim().toLowerCase(),
    customerIds: Array.isArray(principal.customerIds) ? principal.customerIds.map(String) : []
  };
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export class HierarchyCanaryService {
  constructor({
    repository,
    activationGuard,
    riskService,
    approvalService,
    remote,
    campaignRecipe,
    childRecipe,
    gatewayContext,
    credentialFingerprintResolver,
    clock = Date.now
  } = {}) {
    if (!repository?.createRun || !repository?.createObject || !repository?.addEvent || !repository?.listRuns) {
      throw new TypeError('hierarchy Canary repository is required');
    }
    if (!activationGuard?.assertLifecycleMutationAllowed) throw new TypeError('lifecycle activation guard is required');
    if (!riskService?.reserve || !riskService?.consume || !riskService?.release) throw new TypeError('lifecycle risk service is required');
    if (!approvalService?.claim) throw new TypeError('approval service is required');
    if (!remote?.mutate || !remote?.read) throw new TypeError('hierarchy Canary remote adapter is required');
    if (!campaignRecipe?.createCampaign || !campaignRecipe?.extractCampaignId) throw new TypeError('campaign hierarchy recipe is required');
    if (!childRecipe) throw new TypeError('child hierarchy recipe is required');
    if (typeof credentialFingerprintResolver !== 'function') throw new TypeError('credentialFingerprintResolver is required');
    this.repository = repository;
    this.activationGuard = activationGuard;
    this.riskService = riskService;
    this.approvalService = approvalService;
    this.remote = remote;
    this.campaignRecipe = campaignRecipe;
    this.childRecipe = childRecipe;
    this.gatewayContext = {
      specSha: String(gatewayContext?.specSha || '').trim(),
      upstreamBaseUrl: normalizeBaseUrl(gatewayContext?.upstreamBaseUrl)
    };
    this.credentialFingerprintResolver = credentialFingerprintResolver;
    this.clock = clock;
  }

  assertAdminForCustomer(customerId, context = {}) {
    const principal = normalizePrincipal(context);
    if (principal.role !== 'admin' || !principal.principalId) {
      fail('SEARCHAD_HIERARCHY_ADMIN_REQUIRED', 'Hierarchy Canary requires an authenticated SearchAd Admin principal.', {}, 403);
    }
    if (!principal.customerIds.includes(String(customerId))) {
      fail('SEARCHAD_CUSTOMER_FORBIDDEN', 'This principal cannot access the requested SearchAd Customer.', { customerId: String(customerId) }, 403);
    }
    return principal;
  }

  assertStartInput(input = {}) {
    // Target-ID injection is checked before the generic shape error so callers
    // cannot smuggle an existing remote object by adding an otherwise unknown field.
    assertNoCallerRemoteIds(input);
    const extra = Object.keys(input || {}).filter(key => !START_KEYS.has(key));
    if (extra.length) {
      fail('SEARCHAD_HIERARCHY_INPUT_INVALID', 'Hierarchy Canary start accepts only customerId, planId and executionToken.', { rejectedFields: extra.sort() });
    }
    const customerId = String(input?.customerId || '').trim();
    const planId = String(input?.planId || '').trim();
    const executionToken = String(input?.executionToken || '').trim();
    if (!customerId || !planId || !executionToken) {
      fail('SEARCHAD_HIERARCHY_INPUT_INVALID', 'customerId, planId and executionToken are required.');
    }
    return { customerId, planId, executionToken };
  }

  async assertNoUnresolvedRun(customerId) {
    const runs = await this.repository.listRuns({
      customerIds: [String(customerId)],
      statuses: [...UNRESOLVED_RUN_STATUSES],
      limit: 1
    });
    if (runs[0]) {
      fail('SEARCHAD_HIERARCHY_ALREADY_ACTIVE', 'An unresolved hierarchy Canary already exists for this Customer.', {
        hierarchyRunId: runs[0].hierarchyRunId,
        status: runs[0].status
      }, 409);
    }
  }

  async addEvent(run, object, { phase, status, operationKey, lifecycleKind, requestId, details, error } = {}) {
    return this.repository.addEvent({
      eventId: randomUUID(),
      hierarchyRunId: run.hierarchyRunId,
      hierarchyObjectId: object?.hierarchyObjectId || null,
      customerId: run.customerId,
      phase,
      status,
      operationKey: operationKey || null,
      lifecycleKind: lifecycleKind || null,
      requestId: requestId || null,
      details: details || {},
      error: error ? safeError(error) : null,
      createdAt: nowIso(this.clock)
    });
  }

  async markCreateUnknown(run, object, descriptor, error) {
    const updatedAt = nowIso(this.clock);
    await this.repository.updateObject(object.hierarchyObjectId, {
      state: 'create_unknown',
      updatedAt
    }, run.customerId);
    await this.repository.updateRun(run.hierarchyRunId, {
      status: 'unknown_outcome',
      lastError: safeError(error)
    }, run.customerId);
    await this.addEvent(run, object, {
      phase: 'campaign_create',
      status: 'unknown_outcome',
      operationKey: descriptor?.operationKey,
      lifecycleKind: 'create',
      error
    });
    fail(
      'SEARCHAD_HIERARCHY_UNKNOWN_OUTCOME',
      'Hierarchy create outcome is ambiguous. Do not resend the mutation; use read-only reconcile.',
      { hierarchyRunId: run.hierarchyRunId, hierarchyObjectId: object.hierarchyObjectId },
      409
    );
  }

  async start(input = {}, context = {}) {
    const { customerId, planId, executionToken } = this.assertStartInput(input);
    const principal = this.assertAdminForCustomer(customerId, context);
    await this.assertNoUnresolvedRun(customerId);

    const activation = await this.activationGuard.assertLifecycleMutationAllowed({
      customerId,
      operationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create,
      lifecycleKind: 'create'
    });
    const credentialFingerprint = String(await this.credentialFingerprintResolver(customerId) || '').trim();
    if (!credentialFingerprint || !this.gatewayContext.specSha || !this.gatewayContext.upstreamBaseUrl) {
      fail('SEARCHAD_HIERARCHY_CONTEXT_REQUIRED', 'Current SearchAd spec, credential fingerprint and upstream context are required.', {}, 503);
    }

    const startedAt = nowIso(this.clock);
    const hierarchyRunId = randomUUID();
    const hierarchyObjectId = randomUUID();
    const run = {
      hierarchyRunId,
      customerId,
      recipeId: this.campaignRecipe.id || 'hierarchy_campaign_v1',
      status: 'preflight_verified',
      startedByPrincipalId: principal.principalId,
      specSha: this.gatewayContext.specSha,
      credentialFingerprint,
      upstreamBaseUrl: this.gatewayContext.upstreamBaseUrl,
      activationId: activation.activationId,
      startedAt,
      completedAt: null,
      lastError: null
    };
    await this.repository.createRun(run);

    const object = {
      hierarchyObjectId,
      hierarchyRunId,
      customerId,
      objectType: 'campaign',
      parentObjectId: null,
      createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.create,
      readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.read,
      deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.campaign.delete,
      remoteId: null,
      state: 'planned',
      createdAt: startedAt,
      updatedAt: startedAt,
      deletedAt: null
    };
    await this.repository.createObject(object);
    await this.addEvent(run, object, { phase: 'preflight', status: 'verified' });

    const intentId = `hierarchy:${hierarchyRunId}:${hierarchyObjectId}:create`;
    await this.riskService.reserve({
      customerId,
      intentId,
      operationKey: object.createOperationKey,
      lifecycleKind: 'create',
      ownerKind: 'hierarchy_canary',
      ownerRunId: hierarchyRunId
    });

    try {
      await this.approvalService.claim(planId, executionToken);
    } catch (error) {
      try { await this.riskService.release({ intentId }); } catch {}
      await this.repository.updateRun(hierarchyRunId, { status: 'failed', lastError: safeError(error) }, customerId);
      throw error;
    }

    // Consuming risk before writing dispatch intent is conservative: once the one-time
    // approval is claimed, failure after this point never gives capacity back for reuse.
    await this.riskService.consume({ intentId });
    const dispatchAt = nowIso(this.clock);
    await this.repository.updateObject(hierarchyObjectId, { state: 'dispatching', updatedAt: dispatchAt }, customerId);

    const descriptor = this.campaignRecipe.createCampaign({ customerId, hierarchyRunId });
    await this.addEvent(run, object, {
      phase: 'campaign_create',
      status: 'dispatch_intent',
      operationKey: descriptor.operationKey,
      lifecycleKind: 'create',
      details: { intentId }
    });

    let createResult;
    try {
      createResult = await this.remote.mutate(descriptor);
    } catch (error) {
      if (isAmbiguousSearchAdWriteError(error)) {
        return this.markCreateUnknown(run, object, descriptor, error);
      }
      await this.repository.updateObject(hierarchyObjectId, { state: 'manual_review', updatedAt: nowIso(this.clock) }, customerId);
      await this.repository.updateRun(hierarchyRunId, { status: 'failed', lastError: safeError(error), completedAt: nowIso(this.clock) }, customerId);
      await this.addEvent(run, object, {
        phase: 'campaign_create', status: 'failed', operationKey: descriptor.operationKey, lifecycleKind: 'create', error
      });
      throw error;
    }

    let remoteId;
    try {
      remoteId = this.campaignRecipe.extractCampaignId(createResult);
    } catch (error) {
      // A remote create response without one trustworthy returned ID must be treated
      // as ambiguous even if the HTTP request itself returned successfully.
      return this.markCreateUnknown(run, object, descriptor, error);
    }

    const ownedAt = nowIso(this.clock);
    const ownedObject = await this.repository.updateObject(hierarchyObjectId, {
      remoteId,
      state: 'owned',
      updatedAt: ownedAt
    }, customerId);
    await this.repository.holdOwnership({
      ownershipId: randomUUID(),
      customerId,
      objectType: 'campaign',
      remoteId,
      ownerKind: 'hierarchy_canary',
      ownerRunId: hierarchyRunId,
      hierarchyObjectId,
      parentHierarchyObjectId: null,
      createdOperationKey: descriptor.operationKey,
      state: 'owned',
      createdAt: ownedAt,
      updatedAt: ownedAt
    });
    await this.addEvent(run, ownedObject, {
      phase: 'campaign_create',
      status: 'remote_accepted',
      operationKey: descriptor.operationKey,
      lifecycleKind: 'create',
      requestId: createResult?.requestId || createResult?.upstream?.requestId || null
    });
    const activeRun = await this.repository.updateRun(hierarchyRunId, { status: 'active', lastError: null }, customerId);
    return { run: activeRun, object: ownedObject };
  }

  async reconcile(hierarchyRunId, context = {}) {
    const run = await this.repository.getRun(hierarchyRunId);
    if (!run) fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy Canary run was not found.', { hierarchyRunId }, 404);
    this.assertAdminForCustomer(run.customerId, context);

    const objects = await this.repository.listObjects(run.hierarchyRunId, run.customerId);
    const unresolved = objects.filter(object => ['dispatching', 'create_unknown', 'delete_unknown', 'manual_review'].includes(String(object.state)));
    if (!unresolved.length) return run;

    // Dispatching after a restart has no trustworthy completion proof. It is
    // deliberately converted to manual review instead of replaying the mutation.
    const noReturnedId = unresolved.filter(object => !String(object.remoteId || '').trim());
    if (noReturnedId.length) {
      const updatedAt = nowIso(this.clock);
      for (const object of noReturnedId) {
        await this.repository.updateObject(object.hierarchyObjectId, { state: 'manual_review', updatedAt }, run.customerId);
        await this.addEvent(run, object, {
          phase: 'reconcile',
          status: 'unresolved_no_returned_id',
          operationKey: object.createOperationKey,
          lifecycleKind: 'create'
        });
      }
      return this.repository.updateRun(run.hierarchyRunId, {
        status: 'manual_review',
        lastError: null
      }, run.customerId);
    }

    // Returned-ID reconciliation is read-only. No name lookup and no mutation is
    // available from this method.
    for (const object of unresolved) {
      if (object.objectType !== 'campaign') continue;
      let snapshot = null;
      try {
        snapshot = await this.remote.read(this.campaignRecipe.readCampaign({
          customerId: run.customerId,
          hierarchyRunId: run.hierarchyRunId,
          object
        }));
      } catch (error) {
        const status = Number(error?.status || error?.statusCode || 0);
        if (status !== 404) throw error;
      }
      await this.addEvent(run, object, {
        phase: 'reconcile',
        status: snapshot ? 'remote_object_present' : 'remote_object_missing',
        operationKey: object.readOperationKey,
        details: { returnedIdOnly: true }
      });
    }
    return run;
  }
}

export const _internal = {
  START_KEYS,
  UNRESOLVED_RUN_STATUSES,
  normalizePrincipal,
  normalizeBaseUrl,
  safeError
};
