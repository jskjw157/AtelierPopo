import { AsyncLocalStorage } from 'node:async_hooks';
import { evaluateCircuitPolicy } from './policy.js';
import { PostgresCircuitRepository, circuitError } from './postgres-repository.js';
import { CircuitProjectionService } from './projection-service.js';
const bindings = new WeakMap();
const writeContexts = new AsyncLocalStorage();
const purposes = new Set(['ordinary','lifecycle','canary','rollback','report_registration']);
/** Internal adapters only. Neither HTTP bodies nor public execution contexts
 * are copied into this opaque dispatch ownership binding. */
export function createCircuitDispatch(input, owner = {}) {
  if (!purposes.has(input.purpose) || !/^\d{1,30}$/.test(input.customerId || '') || !input.operationKey) throw circuitError('INPUT', 400);
  const dispatch = Object.freeze({ customerId: input.customerId, purpose: input.purpose, operationKey: input.operationKey, entityType: input.entityType || 'campaign', entityId: input.entityId || 'unresolved', actionClass: input.actionClass || 'mutation', ...(input.ruleId ? { ruleId: input.ruleId } : {}), ...(input.incrementalSpendKrw !== undefined ? { incrementalSpendKrw: input.incrementalSpendKrw } : {}) });
  bindings.set(dispatch, structuredClone(owner)); return dispatch;
}
export function withCircuitWriteContext(binding, task) { return writeContexts.run(Object.freeze(structuredClone(binding)), task); }
export function currentCircuitWriteContext() { return writeContexts.getStore(); }
function authorize(customerId, context, admin = false) {
  const principal = context?.principal;
  if (!/^\d{1,30}$/.test(customerId || '') || !principal?.principalId || !Array.isArray(principal.customerIds) || !principal.customerIds.includes(customerId) || (admin ? principal.role !== 'admin' : !['reader','operator','executor','admin'].includes(principal.role))) throw circuitError('FORBIDDEN', 403);
  return principal.principalId;
}
export class CircuitService {
  constructor({ repository, projection, spendEvidence = null, lossEvidence = null, clock = Date.now }) { Object.assign(this, { repository, projection, spendEvidence, lossEvidence, clock }); }
  async status({ customerId }, context) {
    authorize(customerId, context);
    try {
      const projection = await this.projection.catchUp({ customerId });
      return { customerId, ready: projection.ready, state: await this.repository.getState({ customerId, now: this.clock() }), policy: await this.repository.getPolicy({ customerId }), spendEvidenceAvailable: Boolean(this.spendEvidence) };
    } catch { throw circuitError(); }
  }
  async evaluate(input, context) {
    input = structuredClone(input);
    authorize(input.customerId, context);
    if (Object.keys(input).some(k => !['customerId','entityType','entityId','ruleId','actionClass','incrementalSpendKrw'].includes(k))) throw circuitError('INPUT', 400);
    const result = await this.projection.catchUp({ customerId: input.customerId });
    if (!result.ready) return { allowed: false, reasons: ['PROJECTION_NOT_READY'] };
    const decision=await this.repository.transaction(input.customerId, client => this.decision({ ...input, purpose: 'ordinary' }, { client, now: this.clock() }));
    // Keep the existing snapshot check private, including time spent reading
    // evidence and committing the transaction. The send fence checks it again.
    if(decision.allowed){
      try{decision.validateSnapshot();}
      catch(error){if(error?.code!=='SEARCHAD_CIRCUIT_EVIDENCE_EXPIRED')throw error;return {allowed:false,reasons:[...decision.reasons,'EVIDENCE_EXPIRED']};}
    }
    return {allowed:decision.allowed,reasons:decision.reasons};
  }
  async decision(dispatch, { client, now }) {
    if (['rollback','report_registration'].includes(dispatch.purpose)) return { allowed: true, reasons: [] };
    let authority=null, activation=null, owner=bindings.get(dispatch);
    if(dispatch.purpose==='ordinary' && owner?.planId && this.automationRepository){
      authority=await this.automationRepository.planAuthority(owner.planId,{client,now,states:['executing']});
      if(authority){
        if(authority.reservation?.state!=='consumed' || dispatch.operationKey!==authority.run.decision.recipe.mutation.operationKey || dispatch.entityId!==authority.policy.entityId)throw circuitError('AUTOMATION_AUTHORITY',409);
        dispatch={...dispatch,ruleId:authority.policy.ruleId,entityType:authority.policy.entityType,entityId:authority.policy.entityId};
        owner={...owner,reservationId:authority.reservation.reservation_id};
        if(authority.policy.mode==='limited_auto'){
          if(this.activationGuard?.repository?.pool!==this.repository.pool)throw circuitError('AUTOMATION_AUTHORITY',503);
          activation=await this.activationGuard.assertMutationAllowed({customerId:dispatch.customerId,descriptor:authority.run.decision.recipe.mutation},{client});
          if(activation?.allowed!==true || typeof activation.validateSnapshot!=='function')throw circuitError('AUTOMATION_AUTHORITY',403);
        }
      }
    }
    if (await this.repository.hasBacklog({ customerId: dispatch.customerId, client })) return { allowed: false, reasons: ['PROJECTION_BACKLOG'] };
    if (await this.repository.unresolved({ customerId: dispatch.customerId, owner, dispatch, client })) return { allowed: false, reasons: ['UNRESOLVED_MUTATION'] };
    if (!Number.isFinite(now)) throw circuitError();
    let validUntil = authority?.validUntil ?? Infinity;
    const statDateKst = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
    const state = await this.repository.getState({ ...dispatch, client, now });
    // Loss is a complete Customer/KST-day net total, never a report spend alias.
    // Task 9 must supply the identity-bound actual selector; missing stays null.
    if (dispatch.actionClass === 'increase' && this.lossEvidence) {
      const loss = await this.lossEvidence.select({ customerId: dispatch.customerId }, { client, now });
      if (loss?.customerId === dispatch.customerId && loss.quality === 'actual' && loss.completeCustomerDay === true && loss.identityVerified === true && Number.isFinite(loss.observedAt) && loss.observedAt <= now && now - loss.observedAt <= 86400000 && loss.statDateKst === new Date(now + 9 * 3600000).toISOString().slice(0, 10) && Number.isFinite(loss.amountNetKrw) && loss.amountNetKrw >= 0) { state.dailyLossNetKrw = loss.amountNetKrw; validUntil = Math.min(validUntil, loss.observedAt + 86400000); }
    }
    const policy = await this.repository.getPolicy({ customerId: dispatch.customerId, client });
    const evidence = dispatch.ruleId && this.spendEvidence ? await this.spendEvidence.select(dispatch, { client, now }) : null;
    const decision = evaluateCircuitPolicy({ state, policy, dispatch, evidence, now });
    if (dispatch.ruleId) {
      if (!Number.isFinite(evidence?.validUntil) || evidence.validUntil < now) return { allowed: false, reasons: [...decision.reasons, 'SPEND_EVIDENCE_UNAVAILABLE'] };
      validUntil = Math.min(validUntil, evidence.validUntil);
    }
    return { ...decision, validateSnapshot: () => {
      activation?.validateSnapshot();
      const current = this.clock();
      if (!Number.isFinite(current) || current < now || current > validUntil || (authority && current >= authority.validUntil) ||
          ((dispatch.actionClass === 'increase' || dispatch.ruleId) && new Date(current + 9 * 3600000).toISOString().slice(0, 10) !== statDateKst)) throw circuitError('EVIDENCE_EXPIRED', 409);
    } };

  }
  async prepareDispatch(dispatch) {
    if (!bindings.has(dispatch)) throw circuitError('CONTEXT', 403);
    if (['rollback','report_registration'].includes(dispatch.purpose)) return;
    try {
      await this.repository.transaction(dispatch.customerId, async () => {});
      const result = await this.projection.catchUp({ customerId: dispatch.customerId });
      if (!result.ready) throw circuitError('PROJECTION_NOT_READY');
    } catch (error) { if (error?.code?.startsWith('SEARCHAD_CIRCUIT_')) throw error; throw circuitError(); }
  }
  async assertDispatchAllowed(dispatch, { client, now = this.clock() }) {
    if (!bindings.has(dispatch) || !client?.query) throw circuitError('CONTEXT', 403);
    try {
      const decision = await this.decision(dispatch, { client, now });
      if (!decision.allowed) throw circuitError('DENIED', 409, decision.reasons);
      return decision.validateSnapshot;
    } catch (error) { if (error?.code?.startsWith('SEARCHAD_CIRCUIT_')) throw error; throw circuitError(); }
  }
  async projectOutcome(customerId) {
    try { return await this.projection.catchUp({ customerId }); }
    catch { return { ready: false, cursors: {} }; }
  }
  async recoverRule(input,context) {
    const actor=authorize(input.customerId,context,true);
    if(Object.keys(input).some(key=>!['customerId','policyId','expectedRevision','reason','confirmation'].includes(key)) || !/^[a-f0-9-]{36}$/.test(input.policyId || '') || !Number.isInteger(input.expectedRevision) || input.expectedRevision<1 || typeof input.reason!=='string' || !input.reason.trim() || input.reason.length>500 || input.confirmation!=='RECOVER_SEARCHAD_KNOWN_FAILURES')throw circuitError('INPUT',400);
    const projection=await this.projection.catchUp({customerId:input.customerId});
    if(!projection.ready)throw circuitError('RECOVERY_UNRESOLVED',409);
    return this.repository.recoverKnownFailures({...input,actor,reason:input.reason.trim(),now:this.clock()});
  }
  async pause(input, context) { return this.control(input, context, true); }
  async resume(input, context) { return this.control(input, context, false); }
  async control(input, context, paused) {
    const actor = authorize(input.customerId, context, true);
    if (Object.keys(input).some(k => !['customerId','reason'].includes(k)) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) throw circuitError('INPUT', 400);
    try { return await this.repository.appendManualControl({ customerId: input.customerId, paused, reason: input.reason.trim(), actor, now: this.clock() }); }
    catch { throw circuitError(); }
  }
}
export function createCircuitGuard({ pool, clock = Date.now, spendEvidence = null, lossEvidence = null }) {
  const repository = new PostgresCircuitRepository({ pool });
  return new CircuitService({ repository, projection: new CircuitProjectionService({ repository, sources: repository.sources(), clock }), clock, spendEvidence, lossEvidence });
}
export async function preserveCircuitOutcome(guard, customerId, task) {
  try { return await task(); }
  finally { try { await guard?.projectOutcome(customerId); } catch { /* The primary result/error wins. */ } }
}
// ownedObjectIds is supplied only by a trusted repository's committed handoff.
// Never read a similarly named array from the public lifecycle request scope.
export async function prepareLifecycleDispatch(guard, scope, descriptor, ownedObjectIds = scope.hierarchyObjectId ? [scope.hierarchyObjectId] : []) {
  const dispatch = createCircuitDispatch({ customerId: scope.customerId, purpose: 'lifecycle', operationKey: descriptor.operationKey, entityType: 'hierarchy_object', entityId: scope.hierarchyObjectId || scope.planId, actionClass: 'mutation' }, { planId: scope.planId, objectIds: ownedObjectIds });
  await guard.prepareDispatch(dispatch); return dispatch;
}
