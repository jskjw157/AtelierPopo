import { recommend } from './recommendation-rules.js';
import { fail } from './contracts.js';
export class RecommendationService {
  constructor({repository,profitabilityService,toolAdapter,clock=Date.now}){Object.assign(this,{repository,profitabilityService,toolAdapter,clock});}
  async generate(input,context){
    const snapshot=await this.profitabilityService.calculate(input,context);
    const hints=await this.repository.productHints(input.haarProductId);
    let keywordIdeas;try{keywordIdeas=await this.toolAdapter.keywordIdeas({customerId:input.customerId,hintKeywords:hints});}catch(error){if(error.code==='SEARCHAD_COMMERCE_IDENTITY_CHANGED')throw error;keywordIdeas={status:'unavailable',reason:'KEYWORD_READ_UNAVAILABLE',ideas:[]};}
    const bidEstimate=await this.toolAdapter.bidEstimate({customerId:input.customerId});
    const current=await this.profitabilityService.select(input);
    if(current.inputHash!==snapshot.inputHash)throw fail('SEARCHAD_COMMERCE_IDENTITY_CHANGED',409);
    const rows=recommend({...snapshot,tools:{keywordIdeas,bidEstimate},stale:snapshot.missingReasons.some(x=>x.includes('STALE'))},{now:this.clock()});
    return {snapshotId:snapshot.snapshotId,inputHash:snapshot.inputHash,recommendations:await this.repository.appendRecommendations(rows)};
  }
  async list(input,context){const snapshot=await this.profitabilityService.getLatest(input,context);const rows=await this.repository.listRecommendations(snapshot);return {snapshotId:snapshot.snapshotId,inputHash:snapshot.inputHash,recommendations:rows.filter(r=>r.customerId===snapshot.customerId&&r.haarProductId===snapshot.haarProductId&&r.inputHash===snapshot.inputHash).map(r=>({...r,expired:Date.parse(r.expiresAt)<this.clock(),executable:false}))};}
}
