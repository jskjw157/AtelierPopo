import { automationError,authorize,exact,validatePolicy,logicalSlot,decisionIdentity } from './policy.js';
import { buildRecipe,observeCurrent } from './recipes.js';
import { autoWindow,evaluateAutoEligibility } from './eligibility.js';
export class AutomationService {
  constructor({repository,evidenceSelector,circuit,getWriteRuntime,identityResolver,clock=Date.now}) { Object.assign(this,{repository,evidenceSelector,circuit,getWriteRuntime,identityResolver,clock}); }
  async createPolicy(input,context) { const actor=authorize(input?.customerId,context,'admin'); const policy=validatePolicy(input); return this.repository.createPolicyRevision({...policy,actor,now:this.clock()}); }
  async listPolicies(input,context) { exact(input,['customerId']); authorize(input.customerId,context); return {items:await this.repository.listPolicies(input)}; }
  async listRuns(input,context) { exact(input,['customerId']); authorize(input.customerId,context); return {items:await this.repository.listRuns(input)}; }
  async getRun(input,context) { exact(input,['customerId','runId']); authorize(input.customerId,context); const run=await this.repository.getRun(input); if (!run) throw automationError('RUN_NOT_FOUND',404); return run; }
  async prepare(input,context) {
    exact(input,['customerId','runId']);authorize(input.customerId,context,'operator');
    const run=await this.getRun(input,context);
    if(run.state==='prepared'){await this.repository.authority({...input,states:['prepared']});return run;}
    await this.repository.authority({...input,states:['ready']});
    const runtime=await this.getWriteRuntime();
    if(runtime.repository.pool!==this.repository.pool)throw automationError('STORE_MISMATCH',503);
    const permit=await this.repository.reserveRun({...input,now:this.clock()});
    try {
      const plan=await this.repository.withPreparation(permit,()=>runtime.planService.create({...run.decision.recipe,createdBy:context.principal.principalId},{actor:context.principal.principalId,requestId:context.requestId}));
      return this.repository.attachPlan({...input,planId:plan.plan_id});
    } catch(error) { try { await this.repository.settleRun({...input,state:'manual_review'}); } catch {} throw error; }
  }
  async executeApproved(input,context) {
    exact(input,['customerId','runId','executionToken']);authorize(input.customerId,context,'executor');
    const run=await this.getRun({customerId:input.customerId,runId:input.runId},context);
    if(!run.planId)throw automationError('PLAN_REQUIRED');
    const runtime=await this.getWriteRuntime();
    await runtime.executionService.execute(run.planId,{customerId:input.customerId,executionToken:input.executionToken,idempotencyKey:run.decisionKey},context);
    return this.getRun({customerId:input.customerId,runId:input.runId},context);
  }
  async reconcile(input,context) {
    exact(input,['customerId','runId']);authorize(input.customerId,context,'executor');
    const run=await this.getRun(input,context);
    if(!run.planId) {
      if(!['observed','recommended','blocked','ready'].includes(run.state))throw automationError('PRIMARY_OUTCOME_UNRESOLVED');
      return run;
    }
    const runtime=await this.getWriteRuntime();
    if(runtime.repository.pool!==this.repository.pool)throw automationError('STORE_MISMATCH',503);
    const plan=await runtime.repository.getPlan(run.planId);
    if(!plan || plan.customer_id!==input.customerId)throw automationError('PLAN_BINDING');
    if(['applied','applied_reconciled','not_applied'].includes(plan.status)) {
      const completed=await this.repository.completedPrimaryRun({...input,planId:run.planId});
      if(!completed)throw automationError('PRIMARY_OUTCOME_UNRESOLVED');
      return completed;
    }
    await runtime.executionService.reconcile(run.planId,{},context);
    return this.getRun(input,context);
  }
  async evaluate(input,context) {
    exact(input,['customerId','policyId','slotAt']); authorize(input.customerId,context,'operator');
    const policy=await this.repository.findPolicy(input); if (!policy) throw automationError('POLICY_NOT_FOUND',404);
    const slotAt=logicalSlot(input.slotAt,this.clock()),identity=await this.identityResolver(input.customerId);
    let current=null;
    try {
      const observed=await observeCurrent({policy,runtime:await this.getWriteRuntime(),identity,identityResolver:this.identityResolver,clock:this.clock});
      await this.repository.appendCurrent(observed);
      current=observed; // Select only an acknowledged immutable observation.
    }
    catch(error) { if (error?.code === 'SEARCHAD_AUTOMATION_IDENTITY_CHANGED') throw error; }
    // The logical slot identifies the scheduled work. Source selection starts
    // only after the immutable current observation has been acknowledged.
    const selectedAt=this.clock();
    if(!Number.isFinite(selectedAt))throw automationError('CLOCK_UNAVAILABLE');
    const selected={...(await this.evidenceSelector.select({...policy,identity,now:selectedAt})),identity,current};
    if(policy.mode==='limited_auto')selected.auto=await this.repository.selectAutoFacts({policy,selected,now:selectedAt});
    const recipe=buildRecipe(policy,current),reasons=[...recipe.reasons];
    if (!policy.enabled) reasons.push('POLICY_DISABLED');
    if (!selected.stats) reasons.push('STATS_UNAVAILABLE');
    const decision=await this.circuit.evaluate({customerId:policy.customerId,entityType:policy.entityType,entityId:policy.entityId,ruleId:policy.ruleId,actionClass:recipe.actionClass,incrementalSpendKrw:recipe.incrementalSpendKrw},context);
    reasons.push(...decision.reasons);
    // Assess the original timestamps/deadlines after all awaited source and
    // Circuit work. A crossed KST window needs a new selection, never old days.
    const now=this.clock();
    if(!Number.isFinite(now)||now<selectedAt)reasons.push('CLOCK_UNAVAILABLE');
    if(policy.mode==='limited_auto'){
      if(Number.isFinite(now)&&JSON.stringify(autoWindow(selectedAt))!==JSON.stringify(autoWindow(now)))reasons.push('EVIDENCE_WINDOW_CHANGED');
      reasons.push(...evaluateAutoEligibility({...selected.auto,policy,now}).reasons);
    }
    return this.repository.createDecisionOnce({customerId:policy.customerId,policyId:policy.policyId,policyRevision:policy.revision,...decisionIdentity(policy,selected,slotAt),state:policy.mode==='observe'?'observed':reasons.length?'blocked':policy.mode==='recommend'?'recommended':'ready',decision:{mode:policy.mode,slotAt,allowed:reasons.length===0,reasons:[...new Set(reasons)],selected,recipe:recipe.input,actionClass:recipe.actionClass,incrementalSpendKrw:recipe.incrementalSpendKrw},now});
  }
}
