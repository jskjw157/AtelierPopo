import { randomUUID } from 'node:crypto';
import { SearchAdWriteError, isAmbiguousSearchAdWriteError } from '../write/errors.js';
import { assertNoCallerRemoteIds, assertTopCampaignStopped } from './hierarchy-validator.js';
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
const CLEANUP_PRIORITY = Object.freeze({ creative: 4, keyword: 3, adgroup: 2, campaign: 1 });

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

function remoteValue(result) {
  if (result && typeof result === 'object' && Object.hasOwn(result, 'data')) return result.data;
  if (result && typeof result === 'object' && Object.hasOwn(result, 'value')) return result.value;
  if (result && typeof result === 'object' && Object.hasOwn(result, 'body')) return result.body;
  return result;
}

function requiredExecutionInput(input = {}) {
  assertNoCallerRemoteIds(input);
  const hierarchyRunId = String(input?.hierarchyRunId || '').trim();
  const parentObjectId = String(input?.parentObjectId || '').trim();
  const planId = String(input?.planId || '').trim();
  const executionToken = String(input?.executionToken || '').trim();
  if (!hierarchyRunId || !parentObjectId || !planId || !executionToken) {
    fail('SEARCHAD_HIERARCHY_INPUT_INVALID', 'hierarchyRunId, parentObjectId, planId and executionToken are required.');
  }
  return { hierarchyRunId, parentObjectId, planId, executionToken };
}

function requiredCleanupInput(input = {}) {
  assertNoCallerRemoteIds(input);
  const hierarchyRunId = String(input?.hierarchyRunId || '').trim();
  const planId = String(input?.planId || '').trim();
  const executionToken = String(input?.executionToken || '').trim();
  if (!hierarchyRunId || !planId || !executionToken) {
    fail('SEARCHAD_HIERARCHY_INPUT_INVALID', 'hierarchyRunId, planId and executionToken are required.');
  }
  return { hierarchyRunId, planId, executionToken };
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

  async markCreateUnknown(run, object, descriptor, error, { phase = 'campaign_create', lifecycleKind = 'create' } = {}) {
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
      phase,
      status: 'unknown_outcome',
      operationKey: descriptor?.operationKey,
      lifecycleKind,
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

  async loadChildContext(input = {}, context = {}) {
    const { hierarchyRunId, parentObjectId, planId, executionToken } = requiredExecutionInput(input);
    const run = await this.repository.getRun(hierarchyRunId);
    if (!run) fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy Canary run was not found.', { hierarchyRunId }, 404);
    this.assertAdminForCustomer(run.customerId, context);
    if (run.status !== 'active') {
      fail('SEARCHAD_HIERARCHY_MUTATION_NOT_ALLOWED', 'Hierarchy child mutation is allowed only for an active run.', { status: run.status }, 409);
    }
    const parent = await this.repository.getObject(parentObjectId, run.customerId);
    const objects = await this.repository.listObjects(run.hierarchyRunId, run.customerId);
    const campaign = objects.find(object => object.objectType === 'campaign' && object.parentObjectId == null && object.state === 'owned');
    if (!campaign) fail('SEARCHAD_HIERARCHY_CAMPAIGN_REQUIRED', 'An owned top campaign is required before child mutation.', {}, 409);

    const campaignSnapshot = await this.remote.read(this.campaignRecipe.readCampaign({
      customerId: run.customerId,
      hierarchyRunId: run.hierarchyRunId,
      object: campaign
    }));
    assertTopCampaignStopped(remoteValue(campaignSnapshot));
    return { run, parent, planId, executionToken };
  }

  async dispatchSingleChild({ run, parent, planId, executionToken, objectType, lifecycleKind, descriptor, extractId, phase }) {
    const operation = SEARCHAD_HIERARCHY_OPERATIONS[objectType];
    const activation = await this.activationGuard.assertLifecycleMutationAllowed({
      customerId: run.customerId,
      operationKey: operation.create,
      lifecycleKind
    });
    const createdAt = nowIso(this.clock);
    const object = {
      hierarchyObjectId: randomUUID(),
      hierarchyRunId: run.hierarchyRunId,
      customerId: run.customerId,
      objectType,
      parentObjectId: parent.hierarchyObjectId,
      createOperationKey: operation.create,
      readOperationKey: operation.read,
      deleteOperationKey: operation.delete,
      remoteId: null,
      state: 'planned',
      createdAt,
      updatedAt: createdAt,
      deletedAt: null
    };
    await this.repository.createObject(object);
    const intentId = `hierarchy:${run.hierarchyRunId}:${object.hierarchyObjectId}:${lifecycleKind}`;
    await this.riskService.reserve({
      customerId: run.customerId,
      intentId,
      operationKey: operation.create,
      lifecycleKind,
      ownerKind: 'hierarchy_canary',
      ownerRunId: run.hierarchyRunId
    });
    try {
      await this.approvalService.claim(planId, executionToken);
    } catch (error) {
      try { await this.riskService.release({ intentId }); } catch {}
      await this.repository.updateObject(object.hierarchyObjectId, { state: 'manual_review', updatedAt: nowIso(this.clock) }, run.customerId);
      throw error;
    }
    await this.riskService.consume({ intentId });
    await this.repository.updateObject(object.hierarchyObjectId, { state: 'dispatching', updatedAt: nowIso(this.clock) }, run.customerId);
    await this.addEvent(run, object, {
      phase,
      status: 'dispatch_intent',
      operationKey: descriptor.operationKey,
      lifecycleKind,
      details: { intentId, activationId: activation.activationId || null }
    });

    let result;
    try {
      result = await this.remote.mutate(descriptor);
    } catch (error) {
      if (isAmbiguousSearchAdWriteError(error)) {
        return this.markCreateUnknown(run, object, descriptor, error, { phase, lifecycleKind });
      }
      await this.repository.updateObject(object.hierarchyObjectId, { state: 'manual_review', updatedAt: nowIso(this.clock) }, run.customerId);
      throw error;
    }

    let remoteId;
    try {
      remoteId = extractId(result);
    } catch (error) {
      return this.markCreateUnknown(run, object, descriptor, error, { phase, lifecycleKind });
    }
    const ownedAt = nowIso(this.clock);
    const ownedObject = await this.repository.updateObject(object.hierarchyObjectId, { remoteId, state: 'owned', updatedAt: ownedAt }, run.customerId);
    await this.repository.holdOwnership({
      ownershipId: randomUUID(),
      customerId: run.customerId,
      objectType,
      remoteId,
      ownerKind: 'hierarchy_canary',
      ownerRunId: run.hierarchyRunId,
      hierarchyObjectId: object.hierarchyObjectId,
      parentHierarchyObjectId: parent.hierarchyObjectId,
      createdOperationKey: operation.create,
      state: 'owned',
      createdAt: ownedAt,
      updatedAt: ownedAt
    });
    await this.addEvent(run, ownedObject, {
      phase,
      status: 'remote_accepted',
      operationKey: descriptor.operationKey,
      lifecycleKind,
      requestId: result?.requestId || result?.upstream?.requestId || null
    });
    return { run, object: ownedObject };
  }

  async createAdgroup(input = {}, context = {}) {
    const { run, parent, planId, executionToken } = await this.loadChildContext(input, context);
    const descriptor = this.childRecipe.createAdgroup({
      customerId: run.customerId,
      hierarchyRunId: run.hierarchyRunId,
      parent
    });
    return this.dispatchSingleChild({
      run,
      parent,
      planId,
      executionToken,
      objectType: 'adgroup',
      lifecycleKind: 'create',
      descriptor,
      extractId: result => this.childRecipe.extractAdgroupId(result),
      phase: 'adgroup_create'
    });
  }

  async createCreative(input = {}, context = {}) {
    const { run, parent, planId, executionToken } = await this.loadChildContext(input, context);
    const descriptor = this.childRecipe.createCreative({
      customerId: run.customerId,
      hierarchyRunId: run.hierarchyRunId,
      parent
    });
    return this.dispatchSingleChild({
      run,
      parent,
      planId,
      executionToken,
      objectType: 'creative',
      lifecycleKind: 'create',
      descriptor,
      extractId: result => this.childRecipe.extractCreativeId(result),
      phase: 'creative_create'
    });
  }

  async createKeywords(input = {}, context = {}) {
    const { run, parent, planId, executionToken } = await this.loadChildContext(input, context);
    const descriptor = this.childRecipe.createKeywords({
      customerId: run.customerId,
      hierarchyRunId: run.hierarchyRunId,
      parent
    });
    await this.activationGuard.assertLifecycleMutationAllowed({
      customerId: run.customerId,
      operationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create,
      lifecycleKind: 'batch_create'
    });

    const count = Array.isArray(descriptor.body) ? descriptor.body.length : 0;
    if (!count) fail('SEARCHAD_HIERARCHY_KEYWORD_BATCH_REQUIRED', 'Keyword batch recipe produced no items.', {}, 500);
    const createdAt = nowIso(this.clock);
    const objects = [];
    for (let index = 0; index < count; index += 1) {
      const object = {
        hierarchyObjectId: randomUUID(),
        hierarchyRunId: run.hierarchyRunId,
        customerId: run.customerId,
        objectType: 'keyword',
        parentObjectId: parent.hierarchyObjectId,
        createOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create,
        readOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.read,
        deleteOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.delete,
        remoteId: null,
        state: 'planned',
        createdAt,
        updatedAt: createdAt,
        deletedAt: null
      };
      objects.push(await this.repository.createObject(object));
    }

    const intentId = `hierarchy:${run.hierarchyRunId}:${objects[0].hierarchyObjectId}:batch_create`;
    await this.riskService.reserve({
      customerId: run.customerId,
      intentId,
      operationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create,
      lifecycleKind: 'batch_create',
      ownerKind: 'hierarchy_canary',
      ownerRunId: run.hierarchyRunId
    });
    try {
      await this.approvalService.claim(planId, executionToken);
    } catch (error) {
      try { await this.riskService.release({ intentId }); } catch {}
      throw error;
    }
    await this.riskService.consume({ intentId });
    for (const object of objects) {
      await this.repository.updateObject(object.hierarchyObjectId, { state: 'dispatching', updatedAt: nowIso(this.clock) }, run.customerId);
      await this.addEvent(run, object, {
        phase: 'keyword_batch_create', status: 'dispatch_intent', operationKey: descriptor.operationKey, lifecycleKind: 'batch_create', details: { intentId }
      });
    }

    let result;
    try {
      result = await this.remote.mutate(descriptor);
    } catch (error) {
      if (isAmbiguousSearchAdWriteError(error)) {
        const updatedAt = nowIso(this.clock);
        for (const object of objects) {
          await this.repository.updateObject(object.hierarchyObjectId, { state: 'create_unknown', updatedAt }, run.customerId);
        }
        await this.repository.updateRun(run.hierarchyRunId, { status: 'unknown_outcome', lastError: safeError(error) }, run.customerId);
        fail('SEARCHAD_HIERARCHY_UNKNOWN_OUTCOME', 'Hierarchy keyword batch create outcome is ambiguous. Do not resend.', { hierarchyRunId: run.hierarchyRunId }, 409);
      }
      throw error;
    }

    let remoteIds;
    try {
      remoteIds = this.childRecipe.extractKeywordIds(result);
      if (remoteIds.length !== objects.length || new Set(remoteIds).size !== remoteIds.length) {
        fail('SEARCHAD_LIFECYCLE_RETURNED_ID_AMBIGUOUS', 'Keyword create returned ID count does not match the dispatched batch.', { expected: objects.length, actual: remoteIds.length }, 409);
      }
    } catch (error) {
      const updatedAt = nowIso(this.clock);
      for (const object of objects) {
        await this.repository.updateObject(object.hierarchyObjectId, { state: 'create_unknown', updatedAt }, run.customerId);
      }
      await this.repository.updateRun(run.hierarchyRunId, { status: 'unknown_outcome', lastError: safeError(error) }, run.customerId);
      fail('SEARCHAD_HIERARCHY_UNKNOWN_OUTCOME', 'Hierarchy keyword batch returned IDs are ambiguous. Do not resend.', { hierarchyRunId: run.hierarchyRunId }, 409);
    }

    const owned = [];
    for (let index = 0; index < objects.length; index += 1) {
      const ownedAt = nowIso(this.clock);
      const object = await this.repository.updateObject(objects[index].hierarchyObjectId, { remoteId: remoteIds[index], state: 'owned', updatedAt: ownedAt }, run.customerId);
      await this.repository.holdOwnership({
        ownershipId: randomUUID(),
        customerId: run.customerId,
        objectType: 'keyword',
        remoteId: remoteIds[index],
        ownerKind: 'hierarchy_canary',
        ownerRunId: run.hierarchyRunId,
        hierarchyObjectId: object.hierarchyObjectId,
        parentHierarchyObjectId: parent.hierarchyObjectId,
        createdOperationKey: SEARCHAD_HIERARCHY_OPERATIONS.keyword.create,
        state: 'owned',
        createdAt: ownedAt,
        updatedAt: ownedAt
      });
      owned.push(object);
    }
    return { run, objects: owned };
  }

  deleteDescriptor(run, object) {
    const args = { customerId: run.customerId, hierarchyRunId: run.hierarchyRunId, object };
    if (object.objectType === 'campaign') return this.campaignRecipe.deleteCampaign(args);
    if (object.objectType === 'adgroup') return this.childRecipe.deleteAdgroup(args);
    if (object.objectType === 'keyword') return this.childRecipe.deleteKeyword(args);
    if (object.objectType === 'creative') return this.childRecipe.deleteCreative(args);
    fail('SEARCHAD_HIERARCHY_OBJECT_TYPE_INVALID', 'Unsupported hierarchy object type for cleanup.', { objectType: object.objectType }, 409);
  }

  readDescriptor(run, object) {
    const args = { customerId: run.customerId, hierarchyRunId: run.hierarchyRunId, object };
    if (object.objectType === 'campaign') return this.campaignRecipe.readCampaign(args);
    if (object.objectType === 'adgroup') return this.childRecipe.readAdgroup(args);
    if (object.objectType === 'keyword') return this.childRecipe.readKeyword(args);
    if (object.objectType === 'creative') return this.childRecipe.readCreative(args);
    fail('SEARCHAD_HIERARCHY_OBJECT_TYPE_INVALID', 'Unsupported hierarchy object type for cleanup.', { objectType: object.objectType }, 409);
  }

  async updateOwnershipForObject(run, object, patch) {
    const ownership = await this.repository.listOwnershipByRun({
      ownerKind: 'hierarchy_canary',
      ownerRunId: run.hierarchyRunId,
      customerId: run.customerId
    });
    const match = ownership.find(record => record.hierarchyObjectId === object.hierarchyObjectId);
    if (!match) fail('SEARCHAD_HIERARCHY_OWNERSHIP_REQUIRED', 'Cleanup requires a persisted Canary ownership hold.', { hierarchyObjectId: object.hierarchyObjectId }, 409);
    return this.repository.updateOwnership(match.ownershipId, patch, run.customerId);
  }

  async cleanupNext(input = {}, context = {}) {
    const { hierarchyRunId, planId, executionToken } = requiredCleanupInput(input);
    const run = await this.repository.getRun(hierarchyRunId);
    if (!run) fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy Canary run was not found.', { hierarchyRunId }, 404);
    this.assertAdminForCustomer(run.customerId, context);
    const objects = await this.repository.listObjects(run.hierarchyRunId, run.customerId);

    if (objects.some(object => object.state === 'delete_unknown')) {
      fail('SEARCHAD_HIERARCHY_DELETE_UNKNOWN', 'A prior hierarchy delete has an ambiguous outcome. Reconcile read-only before any further cleanup.', { hierarchyRunId }, 409);
    }
    const owned = objects
      .filter(object => object.state === 'owned')
      .sort((left, right) => (CLEANUP_PRIORITY[right.objectType] || 0) - (CLEANUP_PRIORITY[left.objectType] || 0));
    if (!owned.length) {
      if (objects.length && objects.every(object => object.state === 'deleted')) {
        const completedAt = nowIso(this.clock);
        const passed = await this.repository.updateRun(run.hierarchyRunId, { status: 'passed', completedAt, lastError: null }, run.customerId);
        return { run: passed, object: null };
      }
      fail('SEARCHAD_HIERARCHY_CLEANUP_BLOCKED', 'Hierarchy cleanup is blocked by an unresolved non-owned object.', { hierarchyRunId }, 409);
    }

    const object = owned[0];
    const liveChildren = await this.repository.listLiveChildren(object.hierarchyObjectId, run.customerId);
    if (liveChildren.length) {
      fail('SEARCHAD_HIERARCHY_CLEANUP_BLOCKED', 'Hierarchy parent cannot be deleted while a live child remains.', {
        hierarchyObjectId: object.hierarchyObjectId,
        liveChildCount: liveChildren.length
      }, 409);
    }

    const descriptor = this.deleteDescriptor(run, object);
    const readDescriptor = this.readDescriptor(run, object);
    await this.activationGuard.assertLifecycleMutationAllowed({
      customerId: run.customerId,
      operationKey: object.deleteOperationKey,
      lifecycleKind: 'delete'
    });
    const intentId = `hierarchy:${run.hierarchyRunId}:${object.hierarchyObjectId}:delete`;
    await this.riskService.reserve({
      customerId: run.customerId,
      intentId,
      operationKey: object.deleteOperationKey,
      lifecycleKind: 'delete',
      ownerKind: 'hierarchy_canary',
      ownerRunId: run.hierarchyRunId
    });
    try {
      await this.approvalService.claim(planId, executionToken);
    } catch (error) {
      try { await this.riskService.release({ intentId }); } catch {}
      throw error;
    }
    await this.riskService.consume({ intentId });
    await this.repository.updateObject(object.hierarchyObjectId, { state: 'delete_pending', updatedAt: nowIso(this.clock) }, run.customerId);
    await this.addEvent(run, object, {
      phase: `${object.objectType}_delete`,
      status: 'dispatch_intent',
      operationKey: descriptor.operationKey,
      lifecycleKind: 'delete',
      details: { intentId }
    });

    let result;
    try {
      result = await this.remote.mutate(descriptor);
    } catch (error) {
      if (isAmbiguousSearchAdWriteError(error)) {
        const updatedAt = nowIso(this.clock);
        await this.repository.updateObject(object.hierarchyObjectId, { state: 'delete_unknown', updatedAt }, run.customerId);
        await this.updateOwnershipForObject(run, object, { state: 'delete_unknown', updatedAt });
        await this.repository.updateRun(run.hierarchyRunId, { status: 'unknown_outcome', lastError: safeError(error) }, run.customerId);
        await this.addEvent(run, object, {
          phase: `${object.objectType}_delete`, status: 'unknown_outcome', operationKey: descriptor.operationKey, lifecycleKind: 'delete', error
        });
        fail('SEARCHAD_HIERARCHY_UNKNOWN_OUTCOME', 'Hierarchy delete outcome is ambiguous. Do not resend the mutation.', { hierarchyObjectId: object.hierarchyObjectId }, 409);
      }
      await this.repository.updateObject(object.hierarchyObjectId, { state: 'manual_review', updatedAt: nowIso(this.clock) }, run.customerId);
      throw error;
    }

    let deleted = false;
    try {
      await this.remote.read(readDescriptor);
    } catch (error) {
      const status = Number(error?.status || error?.statusCode || 0);
      if (status === 404) deleted = true;
      else throw error;
    }
    if (!deleted) {
      await this.repository.updateObject(object.hierarchyObjectId, { state: 'manual_review', updatedAt: nowIso(this.clock) }, run.customerId);
      await this.repository.updateRun(run.hierarchyRunId, { status: 'manual_review' }, run.customerId);
      fail('SEARCHAD_HIERARCHY_DELETE_VERIFY_FAILED', 'Hierarchy delete could not be verified by returned ID.', { hierarchyObjectId: object.hierarchyObjectId }, 409);
    }

    const deletedAt = nowIso(this.clock);
    const deletedObject = await this.repository.updateObject(object.hierarchyObjectId, { state: 'deleted', updatedAt: deletedAt, deletedAt }, run.customerId);
    await this.updateOwnershipForObject(run, object, { state: 'deleted', updatedAt: deletedAt });
    await this.addEvent(run, deletedObject, {
      phase: `${object.objectType}_delete_verify`,
      status: 'deleted_verified',
      operationKey: readDescriptor.operationKey,
      lifecycleKind: 'delete',
      requestId: result?.requestId || result?.upstream?.requestId || null,
      details: { returnedIdOnly: true }
    });

    const remaining = (await this.repository.listObjects(run.hierarchyRunId, run.customerId)).filter(entry => entry.state !== 'deleted');
    if (!remaining.length) {
      const completedAt = nowIso(this.clock);
      const passed = await this.repository.updateRun(run.hierarchyRunId, { status: 'passed', completedAt, lastError: null }, run.customerId);
      return { run: passed, object: deletedObject };
    }
    const cleanupRun = await this.repository.updateRun(run.hierarchyRunId, { status: 'cleanup_pending', lastError: null }, run.customerId);
    return { run: cleanupRun, object: deletedObject };
  }

  async reconcile(hierarchyRunId, context = {}) {
    const run = await this.repository.getRun(hierarchyRunId);
    if (!run) fail('SEARCHAD_HIERARCHY_NOT_FOUND', 'Hierarchy Canary run was not found.', { hierarchyRunId }, 404);
    this.assertAdminForCustomer(run.customerId, context);

    const objects = await this.repository.listObjects(run.hierarchyRunId, run.customerId);
    const unresolved = objects.filter(object => ['dispatching', 'create_unknown', 'delete_unknown', 'manual_review'].includes(String(object.state)));
    if (!unresolved.length) return run;

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

    for (const object of unresolved) {
      let snapshot = null;
      try {
        snapshot = await this.remote.read(this.readDescriptor(run, { ...object, state: 'owned' }));
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
  CLEANUP_PRIORITY,
  normalizePrincipal,
  normalizeBaseUrl,
  remoteValue,
  safeError
};