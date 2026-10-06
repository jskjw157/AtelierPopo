import { hash, count, deduplicate } from './contracts.js';
export const CAFE24_EVIDENCE_READS=Object.freeze({product:Object.freeze({method:'GET',path:'/admin/products/{productNo}'}),variants:Object.freeze({method:'GET',path:'/admin/products/{productNo}/variants'})});
export class Cafe24CommerceEvidenceProvider {
  constructor({client,shopNo,sourceIdentity,clock=Date.now}){this.client=client;this.shopNo=shopNo;this.sourceIdentity=sourceIdentity;this.clock=clock;}
  result(rows,reasons){return {rows:deduplicate(rows).rows,complete:reasons.length===0&&rows.length>0,sourceIdentity:this.sourceIdentity,observedAt:new Date(this.clock()).toISOString(),missingReasons:reasons};}
  async collectProductState(scope){
    const id=encodeURIComponent(scope.remoteProductId);
    const result=await this.client.get(`/admin/products/${id}`,{query:{shop_no:this.shopNo}});
    const product=result.data?.product;
    if(!product||String(product.product_no)!==scope.remoteProductId)return this.result([],['CAFE24_PRODUCT_RESPONSE_MISSING']);
    const reasons=['CAFE24_PRODUCT_TOTAL_INVENTORY_UNAVAILABLE'];
    const rows=[{sourceReference:hash([scope.customerId,scope.channelId,this.sourceIdentity,'product',scope.remoteProductId]),saleState:product.selling==='T'&&product.display==='T'?'SALE':product.selling==='F'||product.display==='F'?'STOPPED':null,stockQuantity:null}];
    // 2026-06-01 documents shop_no and optional inventories, not limit/offset.
    const response=await this.client.get(`/admin/products/${id}/variants`,{query:{shop_no:this.shopNo}});
    const variants=response.data?.variants;
    if(!Array.isArray(variants))return this.result(rows,[...reasons,'CAFE24_VARIANTS_RESPONSE_MISSING']);
    if(!variants.length||variants.length>=100)reasons.push('CAFE24_VARIANT_COVERAGE_UNVERIFIED');
    for(const v of variants){
      if(!v.variant_code){reasons.push('CAFE24_VARIANT_ID_MISSING');continue;}
      const stockQuantity=count(v.quantity);
      if(stockQuantity===null)reasons.push('CAFE24_VARIANT_INVENTORY_MISSING');
      rows.push({sourceReference:hash([scope.customerId,scope.channelId,this.sourceIdentity,'variant',scope.remoteProductId,v.variant_code]),variantReference:hash([scope.channelId,v.variant_code]),saleState:v.selling==='T'&&v.display==='T'?'SALE':v.selling==='F'||v.display==='F'?'STOPPED':null,stockQuantity});
    }
    return this.result(rows,[...new Set(reasons)]);
  }
  async collectOrderLines(){return this.result([],['CAFE24_ORDER_CAPABILITY_UNVERIFIED']);}
  async collectAdjustments(){return this.result([],['CAFE24_ADJUSTMENT_CAPABILITY_UNVERIFIED']);}
  async collectSettlements(){return this.result([],['CAFE24_SETTLEMENT_CAPABILITY_UNVERIFIED']);}
}
