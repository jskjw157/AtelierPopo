import { CAMPAIGN_WRITE } from '../../src/naver/searchad/automation/recipes.js';
import { AutoEvidenceSelector } from '../../src/naver/searchad/automation/auto-executor.js';
import { PostgresProductEvidenceRepository } from '../../src/naver/searchad/profitability/postgres-repository.js';
import { ProductMappingService } from '../../src/naver/searchad/profitability/mapping-service.js';
import { ProductEvidenceService } from '../../src/naver/searchad/profitability/product-evidence-service.js';
import { ProfitabilityService } from '../../src/naver/searchad/profitability/service.js';
import { PostgresReportingRepository } from '../../src/naver/searchad/reporting/postgres-repository.js';
export const autoNow=Date.parse('2026-10-05T03:00:00Z');
const iso=n=>new Date(n).toISOString();
// Synthetic source facts only. Production eligibility must establish every predicate.
export function autoFacts(now=autoNow) {
  const identity={customerId:'1001',specSha:'a'.repeat(64),credentialFingerprint:'b'.repeat(64),upstreamBaseUrl:'https://api.searchad.naver.com'};
  const days=['2026-09-26','2026-09-27','2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02'];
  const policy={customerId:'1001',entityType:'campaign',entityId:'cmp-1',mode:'limited_auto',enabled:true,revision:1,recipe:{kind:'campaign_budget',dailyBudgetKrw:800},reason:'synthetic bounded budget',maxCurrentAgeMs:1800000,
    delegation:{customerId:'1001',authorizedByPrincipalId:'fixture-admin',authorizedAt:iso(now-1000),expiresAt:iso(now+3600000),policyRevision:1,operationKeys:[CAMPAIGN_WRITE],fieldScope:['campaign.dailyBudget'],maxChangePercent:20,maxDailyBudgetKrw:100000,maxIncrementalSpendKrw:30000,maxDailyOperations:200}};
  return {policy,now,evidence:{identity,current:{normalized:{dailyBudgetKrw:1000,userLock:false},observedAt:now},stats:{observedAt:iso(now),cycleAt:iso(now),metrics:{conversions:'4'}},spend:{generation_lower:iso(now),quality:'stabilized_by_policy'},commerce:[{capability:'productState',observedAt:iso(now),complete:true,missingReasons:[],rows:[{stockQuantity:'1',saleStatus:'SALE'}]},{capability:'orderLines',observedAt:iso(now),complete:true,missingReasons:[],rows:[]}]},
    mapping:{customerId:'1001',entityType:'campaign',entityId:'cmp-1',current:true,confidence:'0.95',bindingIds:['synthetic-binding'],sourceHash:'c'.repeat(64)},
    profitability:{quality:'actual',asOf:iso(now),missingReasons:[],mappingVerified:true,allocationVerified:true,unallocatedSpendKrw:'0',metrics:{contributionKrw:'1000'},inputHash:'d'.repeat(64)},
    history:{generations:days.map((statDate,i)=>({ingestionId:`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,statDate,reportType:'AD',quality:'stabilized_by_policy',rowCount:1,entityRowCount:1,generationSha:String(i+1).repeat(64),schemaSha:'e'.repeat(64),generationWindow:{lower:iso(now-1000),upper:iso(now),downloadCompletedAt:iso(now),slot:Math.floor((now-Date.parse(`${statDate}T00:00:00+09:00`))/86400000),stableAge:true,policy:{version:'generation-window-v1'}}}))},
    capability:{automationEnabled:true,estimate:null,balance:null}};
}

// The actual production selection graph, with only its pool/clock supplied by
// tests. No profitability, eligibility, scope or repository query is replaced.
export function autoSourceGraph({pool,identityResolver,providers,clock}) {
  const productRepository=new PostgresProductEvidenceRepository({pool,clock});
  const mappingService=new ProductMappingService({repository:productRepository,providers,identityResolver,clock});
  const productEvidenceService=new ProductEvidenceService({repository:productRepository,mappingService,providers,identityResolver,clock});
  const reportingRepository=new PostgresReportingRepository({pool,clock});
  const profitabilityService=new ProfitabilityService({repository:productRepository,productEvidenceService,reportingRepository,identityResolver,clock});
  return new AutoEvidenceSelector({profitabilityService,productRepository,reportingRepository,identityResolver,clock});
}
