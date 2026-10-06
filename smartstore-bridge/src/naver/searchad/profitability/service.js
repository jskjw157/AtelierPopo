import { calculateProfitability, summarizeOrders, allocateSpend, sum, multiply } from './calculator.js';
import { hash, fail, uuid } from './contracts.js';
import { contentHash } from '../write/canonical.js';
import { deterministicId } from './recommendation-rules.js';
const iso=v=>v instanceof Date?v.toISOString():v;
const intersects=(rows,start,end)=>Math.max(start,...rows.map(r=>Date.parse(r.validFrom)))<Math.min(end+1,...rows.map(r=>r.validTo?Date.parse(r.validTo):Infinity));
const overlaps=(rows,start,end)=>rows.some((a,i)=>rows.slice(i+1).some(b=>Math.max(start,Date.parse(a.validFrom),Date.parse(b.validFrom))<Math.min(end+1,a.validTo?Date.parse(a.validTo):Infinity,b.validTo?Date.parse(b.validTo):Infinity)));
const covers=(row,start,end)=>Date.parse(row.validFrom)<=start&&(!row.validTo||Date.parse(row.validTo)>end);
/** All financial inputs are selected from durable scoped producers, never HTTP. */
export class ProfitabilityService {
  constructor({repository,productEvidenceService,reportingRepository,identityResolver,clock=Date.now}){Object.assign(this,{repository,productEvidenceService,reportingRepository,identityResolver,clock});}
  async select(input){
    input={...input,haarProductId:uuid(input.haarProductId)};
    const scoped=await this.productEvidenceService.scopes(input),{scopes,mappings,identityHash,at}=scoped;
    const data=JSON.parse(JSON.stringify(await this.repository.selectProductInputs({...input,identityHash,at})));
    const observations=data.observations.filter(o=>scopes.some(s=>s.channelProductId===o.channelProductId&&s.bindingId===o.bindingId&&s.sourceIdentity===o.sourceIdentity&&s.identityHash===o.identityHash));
    const identity=this.identityResolver(input.customerId);
    if(hash(identity)!==identityHash)throw fail('SEARCHAD_COMMERCE_IDENTITY_CHANGED',409);
    const ads=this.reportingRepository?await this.reportingRepository.selectProductAdInputs({...input,identity,mappings,now:this.clock()}):{rows:[],conversions:[],searchTerms:[],generations:[]};
    const missing=new Set(['MANUAL_MAPPING_UNVERIFIED','ALLOCATION_UNVERIFIED']);
    const start=Date.parse(`${input.since}T00:00:00+09:00`),end=Date.parse(`${input.until}T23:59:59.999+09:00`);
    if(mappings.some(m=>!covers(m,start,end)))missing.add('MAPPING_RANGE_PARTIAL');
    for(const scope of scopes)for(const capability of ['productState','orderLines','adjustments','settlements']){
      const o=observations.find(o=>o.channelProductId===scope.channelProductId&&o.capability===capability);
      if(!o){missing.add(`${capability.toUpperCase()}_MISSING`);continue;}
      for(const reason of o.missingReasons)missing.add(reason);
      if(!o.complete)missing.add(`${capability.toUpperCase()}_PARTIAL`);
      if(this.clock()-Date.parse(o.observedAt)>900000||Date.parse(o.observedAt)>this.clock())missing.add('COMMERCE_EVIDENCE_STALE');
    }
    const orderObservations=observations.filter(o=>o.capability==='orderLines');
    const orders=summarizeOrders(orderObservations.flatMap(o=>o.rows));
    if(orders.conflict)missing.add('CONFLICTING_ORDER_IDENTITY');
    const provenance=observations.map(o=>({observationId:o.observationId,sourceHash:o.sourceHash,bindingId:o.bindingId,channelProductId:o.channelProductId,sourceIdentity:o.sourceIdentity,capability:o.capability,observedAt:iso(o.observedAt)})).sort((a,b)=>a.observationId.localeCompare(b.observationId));
    const component=(amountKrw,source,extra={})=>({amountKrw,quality:'actual',reconciled:false,alreadyIncludedInNetRevenue:false,sourceHash:contentHash(source),source,...extra});
    const components={paidRevenue:component(orders.paidRevenueKrw,provenance),netRevenue:component(orders.netRevenueKrw,provenance)};
    // Existing manual cost amounts are per remaining unit estimates, applied only
    // when one product-level revision covers the entire KST sales range. Variant
    // and multiple-supplier candidates need line-level identity and stay missing.
    for(const [db,key]of [['cogs','cogs'],['fees','fees'],['shipping','shipping'],['seller_discount','sellerDiscount'],['return_provision','returnProvision']]){
      const candidates=data.costs.filter(c=>c.component===db);
      if(candidates.some(c=>!covers(c,start,end)))missing.add(`${db.toUpperCase()}_COST_RANGE_PARTIAL`);
      if(overlaps(candidates,start,end))missing.add(`${db.toUpperCase()}_COST_INTERVAL_AMBIGUOUS`);
      let chosen=candidates.length===1&&covers(candidates[0],start,end)&&!candidates[0].haarVariantId?candidates[0]:null;
      if(key==='cogs'&&!candidates.length){
        // Descriptive history remains in sources; only relationships applicable
        // during sales may influence assignment ambiguity. Intersect cost, source
        // link and variant link together so disjoint effective periods stay inert.
        const sourceCosts=data.sourceCosts.map(c=>({...c,variantLinks:c.variantLinks.filter(v=>intersects([c,c.sourceLink,v],start,end))})).filter(c=>intersects([c,c.sourceLink],start,end)&&(!c.variantSpecific||c.variantLinks.length>0));
        if(data.sourceCosts.length&&!sourceCosts.length)missing.add('SOURCE_COST_LINK_RANGE_PARTIAL');
        const linkCovers=c=>covers(c.sourceLink,start,end)&&(!c.variantSpecific||c.variantLinks.length===1&&covers(c.variantLinks[0],start,end));
        if(sourceCosts.some(c=>!covers(c,start,end)))missing.add('SOURCE_COST_RANGE_PARTIAL');
        if(sourceCosts.some(c=>!linkCovers(c)))missing.add('SOURCE_COST_LINK_RANGE_PARTIAL');
        if(sourceCosts.some(c=>c.currency!=='KRW'))missing.add('SOURCE_COST_CURRENCY_UNSUPPORTED');
        if(sourceCosts.some(c=>overlaps(sourceCosts.filter(x=>x.sourceReference===c.sourceReference),start,end)))missing.add('SUPPLIER_COST_INTERVAL_AMBIGUOUS');
        if(sourceCosts.length>1)missing.add('SUPPLIER_COST_ASSIGNMENT_UNRESOLVED');
        if(sourceCosts.some(c=>c.variantSpecific))missing.add('VARIANT_COST_ASSIGNMENT_UNRESOLVED');
        if(sourceCosts.length===1&&!sourceCosts[0].variantSpecific&&sourceCosts[0].currency==='KRW'&&covers(sourceCosts[0],start,end)&&linkCovers(sourceCosts[0]))chosen=sourceCosts[0];
      }
      if(candidates.some(c=>c.haarVariantId))missing.add('VARIANT_COST_ASSIGNMENT_UNRESOLVED');
      components[key]=component(chosen?multiply(chosen.amountKrw,orders.quantity):null,chosen||[],{quality:'estimated',reconciled:false,basis:'per_remaining_unit_estimate'});
    }
    const naverOnly=scopes.every(s=>s.channelId==='haar_naver_smartstore');
    if(naverOnly&&orders.netRevenueKrw!==null)components.sellerDiscount={...components.sellerDiscount,alreadyIncludedInNetRevenue:true,basis:'remaining_discounted_commerce_payment'};
    const adjustments=observations.filter(o=>o.capability==='adjustments').flatMap(o=>o.rows);
    if(adjustments.length&&adjustments.every(a=>a.alreadyIncludedInNetRevenue===true)&&!data.costs.some(c=>c.component==='return_provision'))components.returnProvision=component(null,adjustments,{alreadyIncludedInNetRevenue:true,basis:'completed_refunds_in_remaining_payment'});
    // No currently configured mapping has generation-verified allocation proof.
    // Keep the full shared spend visible as unallocated, and never copy it into
    // each product's contribution or conversions.
    const allocated=allocateSpend(ads.rows.map(r=>({sourceKey:r.sourceKey,generation:r.generationSha,amountKrw:r.costGrossKrw,weights:[],verified:false,allocationGeneration:null})),input.haarProductId);
    components.adCost=component(allocated.allocatedKrw,ads.rows,{rawAmountKrw:sum(ads.rows.map(r=>r.costRaw)),basis:'vat_included',unallocatedKrw:allocated.unallocatedKrw});
    components.adAttributedRevenue=component(null,ads.conversions,{unallocatedKrw:sum(ads.conversions.map(r=>r.metrics['Sales by conversion']))});
    if(!ads.rows.length)missing.add('AD_COST_MISSING');else missing.add('SPEND_UNALLOCATED');
    if(ads.generations.some(g=>g.quality!=='stabilized_by_policy'))missing.add('AD_GENERATION_PROVISIONAL');
    if(ads.generations.some(g=>this.clock()-Date.parse(g.generationWindow.lower)>86400000))missing.add('AD_EVIDENCE_STALE');
    const timestamps=provenance.map(o=>Date.parse(o.observedAt)).concat(ads.generations.map(g=>Date.parse(g.generationWindow.lower))).filter(Number.isFinite);
    const asOf=timestamps.length?new Date(Math.min(...timestamps)).toISOString():null;
    const calculation=calculateProfitability({...input,asOf,components,counts:{conversions:null,clicks:null},missingReasons:[...missing],mappingVerified:false,allocationVerified:false});
    const catalog=data.catalog.filter(c=>scopes.some(s=>s.channelProductId===c.channelProductId)).sort((a,b)=>a.channelProductId.localeCompare(b.channelProductId));
    const sources={catalog,identityHash,bindings:scopes,mappings,commerce:provenance,costs:data.costs,sourceCosts:data.sourceCosts,ads:ads.generations,adRows:ads.rows.map(r=>({sourceKey:r.sourceKey,rowSha:r.rowSha,generationSha:r.generationSha})),conversionRows:ads.conversions.map(r=>({sourceKey:r.sourceKey,rowSha:r.rowSha,generationSha:r.generationSha}))};
    const inputHash=contentHash({input,sources,calculation});
    const current=await this.productEvidenceService.scopes(input);
    if(contentHash(current.scopes)!==contentHash(scopes)||contentHash(current.mappings)!==contentHash(mappings))throw fail('SEARCHAD_COMMERCE_IDENTITY_CHANGED',409);
    const snapshot={...input,...calculation,inputHash,snapshotId:deterministicId({input,inputHash}),sourceSetHash:contentHash(sources),sources,mappingVerified:false,allocationVerified:false,unallocatedSpendKrw:allocated.unallocatedKrw,searchTerms:ads.searchTerms,liveVerified:false,autoEligible:false,contributionKrw:calculation.metrics.contributionKrw,netRevenueKrw:calculation.metrics.netRevenueKrw,settlementAmountKrw:null,
      observations:observations.map(({bindingId,sourceIdentity,identityHash,...o})=>o),mappings:mappings.map(({bindingId,identityHash,...m})=>m),costs:data.costs,sourceCosts:data.sourceCosts,catalog};
    return snapshot;
  }
  async calculate(input,context){this.productEvidenceService.validate(input,context,'operator');return this.repository.appendSnapshot(await this.select(input));}
  async getLatest(input,context){this.productEvidenceService.validate(input,context,'reader');const current=await this.select(input);const stored=await this.repository.getSnapshot(current);if(stored&&contentHash(stored)!==contentHash(current))throw fail('SEARCHAD_PROFITABILITY_SNAPSHOT_CONFLICT',409);return {...(stored||current),persisted:Boolean(stored)};}
  async selectForAutomation({customerId,entityType,entityId,identity,now}){
    const products=await this.repository.mappedProducts({customerId,entityType,entityId,identityHash:hash(identity)});
    // Task9 does not infer a profitability window from the policy or accept a
    // cached snapshot as authority. Task10 must select and validate that window.
    return {productIds:products.sort(),snapshots:[],autoEligible:false,reason:'PROFITABILITY_EXECUTION_SELECTION_UNAVAILABLE'};
  }
}
