import { contentHash } from '../write/canonical.js';
import { fail } from './contracts.js';
export const KEYWORD_READ='keyword_tool.get.get_keywordstool__p_keywordstool';
export const BID_ESTIMATE='estimate.post.get_average_position_bid__p_estimate_average_position_bid_type';
/** Only server-built product scopes reach this adapter; there is no public tool proxy. */
export class SearchAdRecommendationToolAdapter {
  constructor({gateway,identityResolver}){Object.assign(this,{gateway,identityResolver});}
  async keywordIdeas(scope){
    const op=this.gateway.get(KEYWORD_READ);
    if(op.operationKey!==KEYWORD_READ||op.specRef!==this.identityResolver(scope.customerId).specSha||op.method!=='GET'||op.path!=='/keywordstool'||op.sideEffect!==false||op.destructive!==false||op.requiredGate!=='reads'||op.capabilityKey!=='rel_kwd_stat.read'||op.runtimeAllowlisted!==true)return {status:'unavailable',reason:'KEYWORD_READ_DESCRIPTOR_UNSUPPORTED',ideas:[]};
    const hints=(scope.hintKeywords||[]).filter(x=>typeof x==='string'&&/^[\p{L}\p{N} _-]{1,80}$/u.test(x)).slice(0,5);
    if(!hints.length)return {status:'unavailable',reason:'KEYWORD_HINTS_MISSING',ideas:[]};
    const input={customerId:scope.customerId,query:{hintKeywords:hints.join(','),showDetail:0}};
    if(!this.gateway.executionCheck(op,input,{throwOnFailure:false}).ok)return {status:'unavailable',reason:'KEYWORD_READ_CAPABILITY_UNAVAILABLE',ideas:[]};
    const identity=contentHash(this.identityResolver(scope.customerId));
    const result=await this.gateway.execute(KEYWORD_READ,input);
    if(identity!==contentHash(this.identityResolver(scope.customerId)))throw fail('SEARCHAD_COMMERCE_IDENTITY_CHANGED',409);
    if(!Array.isArray(result.data?.keywordList))return {status:'unavailable',reason:'KEYWORD_RESPONSE_INVALID',ideas:[]};
    const ideas=[...new Set(result.data.keywordList.map(x=>x.relKeyword).filter(x=>typeof x==='string'&&/^[\p{L}\p{N} _-]{1,80}$/u.test(x)))].sort().slice(0,20);
    return {status:'available',ideas,operationKey:KEYWORD_READ,sourceHash:contentHash({identity,ideas}),liveVerified:false};
  }
  async bidEstimate(){
    // The pinned estimate family is sideEffect:true/create gated. No descriptor
    // is relabeled as read-only and no POST is dispatched from recommendations.
    return {status:'unavailable',reason:'ESTIMATE_READ_CAPABILITY_UNAVAILABLE',operationKey:BID_ESTIMATE,liveVerified:false};
  }
}
