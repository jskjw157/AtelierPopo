import { contentHash } from '../write/canonical.js';
import { hash as profitabilityIdentityHash } from '../profitability/contracts.js';
import { automationError, authorize, exact } from './policy.js';
import { autoWindow } from './eligibility.js';
/** Select immutable producer facts for the server-owned D-9..D-3 range. Cached
 * snapshots and public recommendation/validation flags are never authority. */
export class AutoEvidenceSelector {
  constructor({profitabilityService,productRepository,reportingRepository,identityResolver,clock=Date.now}){Object.assign(this,{profitabilityService,productRepository,reportingRepository,identityResolver,clock});}
  async select(policy,{client,now=this.clock()}={}) {
    const identity=await this.identityResolver(policy.customerId),range=autoWindow(now),reasons=[];
    if(client){
      // Hold producer membership stable through the final synchronous send.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`report-circuit:${policy.customerId}`]);
      await client.query('LOCK TABLE product_ad_mappings, searchad_customer_channel_bindings, searchad_commerce_observations, searchad_product_cost_inputs, channel_products, channel_product_snapshots, haar_product_source_links, supplier_cost_history, source_variant_links, haar_product_variants IN SHARE MODE');
    }
    const products=await this.productRepository.mappedProducts({customerId:policy.customerId,entityType:policy.entityType,entityId:policy.entityId,identityHash:profitabilityIdentityHash(identity)});
    const snapshots=[];
    for(const haarProductId of products.sort()){
      try{snapshots.push(await this.profitabilityService.select({customerId:policy.customerId,haarProductId,...range}));}
      catch(error){reasons.push(/^SEARCHAD_[A-Z_]+$/.test(error.code||'')?error.code:'PRODUCT_EVIDENCE_UNAVAILABLE');}
    }
    const ingestions=await this.reportingRepository.selectedIngestions(client||this.reportingRepository.pool,{customerId:policy.customerId,reportType:'AD',identity});
    const generations=[];
    for(const row of ingestions.filter(r=>r.stat_date>=range.since&&r.stat_date<=range.until)){
      const count=(await (client||this.reportingRepository.pool).query("SELECT count(*)::int n FROM searchad_daily_metrics WHERE customer_id=$1 AND ingestion_id=$2 AND (entity_type=$3 AND entity_id=$4 OR dimensions_json->>'Campaign ID'=$4)",[policy.customerId,row.ingestion_id,policy.entityType,policy.entityId])).rows[0].n;
      generations.push({ingestionId:row.ingestion_id,statDate:row.stat_date,reportType:row.report_type,quality:row.quality,rowCount:Number(row.row_count),entityRowCount:count,generationSha:row.generation_sha,schemaSha:row.ordered_schema_sha,generationWindow:row.provenance_json.generationWindow});
    }
    const mappings=snapshots.flatMap(s=>s.sources.mappings).filter(m=>m.entityType===policy.entityType&&m.entityId===policy.entityId),bindings=snapshots.flatMap(s=>s.sources.bindings);
    const mapping={customerId:policy.customerId,entityType:policy.entityType,entityId:policy.entityId,current:products.length>0&&snapshots.length===products.length&&mappings.length>0&&bindings.length>0&&!reasons.length,confidence:String(Math.min(1,...mappings.map(m=>Number(m.confidence)))),bindingIds:[...new Set(bindings.map(b=>b.bindingId))].sort(),sourceHash:contentHash({mappings,bindings})};
    // Shared/multiple-product allocation cannot be inferred by adding snapshots.
    const profitability=snapshots.length===1?snapshots[0]:null;
    const evidence=await this.reportingRepository.selectAutomationEvidence({...policy,identity,now});
    return {mapping,profitability,evidence:{...evidence,identity,commerce:snapshots.flatMap(s=>s.observations)},history:{generations,sourceReasons:reasons},capability:{estimate:null,balance:null,estimateReason:'ESTIMATE_READ_CAPABILITY_UNAVAILABLE',balanceReason:'BALANCE_VERIFICATION_UNAVAILABLE'}};
  }
}

/** Uses exactly the existing plan / token / claim / verify engine. */
export class LimitedAutoExecutor {
  constructor({repository,automationService,getWriteRuntime,circuit,identityResolver,clock=Date.now}){Object.assign(this,{repository,automationService,getWriteRuntime,circuit,identityResolver,clock});}
  async execute(input,context) {
    exact(input,['customerId','runId']);authorize(input.customerId,context,'executor');
    const bound=await this.repository.authority({...input,states:['ready']});
    if(bound.policy.mode!=='limited_auto')throw automationError('AUTO_MODE_REQUIRED');
    const runtime=await this.getWriteRuntime();
    if(runtime.repository.pool!==this.repository.pool||runtime.repository.automation!==this.repository)throw automationError('STORE_MISMATCH',503);
    // Reservation is the single owner. A duplicate loser must not retire it.
    const permit=await this.repository.reserveRun({...input,now:this.clock()});
    try{
      const actor=`policy:${bound.policy.policyId}:${bound.policy.revision}`;
      const plan=await this.repository.withPreparation(permit,()=>runtime.planService.create({...bound.run.decision.recipe,createdBy:actor},{actor,requestId:context.requestId}));
      const approval=await runtime.approvalService.approve(plan.plan_id,{actor,confirmation:'APPROVE_SEARCHAD_CHANGE'});
      await runtime.executionService.execute(plan.plan_id,{customerId:input.customerId,executionToken:approval.executionToken,idempotencyKey:bound.run.decisionKey},{...context,actor});
      return this.automationService.getRun(input,context);
    }catch(error){
      // No raw token survives, no retry can mint another, and primary terminal
      // outcomes already written by the engine remain authoritative.
      try{await this.repository.settleRun({...input,state:'manual_review'});}catch{}
      throw error;
    }
  }
}
