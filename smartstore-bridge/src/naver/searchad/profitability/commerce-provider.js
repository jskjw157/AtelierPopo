import { NaverCommerceEvidenceProvider, NAVER_EVIDENCE_READS } from './naver-commerce-provider.js';
import { Cafe24CommerceEvidenceProvider, CAFE24_EVIDENCE_READS } from './cafe24-commerce-provider.js';
import { loadCafe24Config } from '../../../cafe24/config.js';
import { Cafe24AdminClient } from '../../../cafe24/client.js';
import { Cafe24TokenProvider } from '../../../cafe24/auth.js';
import { FileCafe24TokenStore } from '../../../cafe24/token-store.js';
import { hash } from './contracts.js';
/** App composition only. HTTP payloads never choose clients, accounts or credentials. */
export function createCommerceEvidenceProviders({app,env,clock=Date.now,logger=console}){
  const providers=new Map();
  const config=app.config?.naver;
  if(app.commerceGateway&&config?.clientId&&config?.clientSecret&&config.baseUrl==='https://api.commerce.naver.com/external'){
    const sourceIdentity=hash({provider:'naver',origin:config.baseUrl,credentialFingerprint:hash([config.clientId,config.clientSecret,config.tokenType,config.accountId]),descriptorSha:hash([NAVER_EVIDENCE_READS,'naver-2.90.0-2026-10-06'])});
    providers.set('haar_naver_smartstore',new NaverCommerceEvidenceProvider({gateway:app.commerceGateway,sourceIdentity,clock}));
  }
  const cafe24=loadCafe24Config(env);
  if(cafe24.enabled&&cafe24.apiVersion==='2026-06-01'){
    const tokenStore=new FileCafe24TokenStore({filePath:cafe24.tokenStorePath,initialTokens:cafe24.initialTokens,clock:()=>new Date(clock()).toISOString()});
    // Existing client logs response metadata URLs; evidence composition exposes only sanitized status.
    const providerLogger={info(){},warn(){},error(){}};
    const tokenProvider=new Cafe24TokenProvider({config:cafe24,tokenStore,clock,logger:providerLogger});
    const client=new Cafe24AdminClient({config:cafe24,tokenProvider,logger:providerLogger});
    const sourceIdentity=hash({provider:'cafe24',origin:cafe24.baseUrl,shopNo:cafe24.shopNo,apiVersion:cafe24.apiVersion,credentialFingerprint:hash([cafe24.clientId,cafe24.clientSecret,cafe24.scopes]),descriptorSha:hash(CAFE24_EVIDENCE_READS)});
    providers.set('haar_own_mall',new Cafe24CommerceEvidenceProvider({client,shopNo:cafe24.shopNo,sourceIdentity,clock}));
  }
  return providers;
}
