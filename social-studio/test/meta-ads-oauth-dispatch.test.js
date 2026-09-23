import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),exchange:vi.fn(),long:vi.fn(),get:vi.fn(),debug:vi.fn(),save:vi.fn(),audit:vi.fn()}));
vi.mock('../server/db.js',()=>({query:mocks.query,transaction:vi.fn(),audit:mocks.audit}));
vi.mock('../server/meta/client.js',()=>({buildMetaOAuthUrl:vi.fn(),debugToken:mocks.debug,exchangeCodeForToken:mocks.exchange,exchangeForLongLivedToken:mocks.long,graphGet:mocks.get}));
vi.mock('../server/security.js',()=>({encryptSecret:v=>'enc:'+v,decryptSecret:vi.fn(),randomToken:vi.fn(),sha256:v=>'hash:'+v,safeErrorMessage:vi.fn()}));
vi.mock('../server/meta/ads/instance.js',()=>({adsServices:{auth:{saveCredential:mocks.save}}}));
import {finishMetaOAuth} from '../server/meta/oauth.js';
beforeEach(()=>{vi.clearAllMocks();mocks.exchange.mockResolvedValue({access_token:'short'});mocks.long.mockResolvedValue({access_token:'long'});mocks.debug.mockResolvedValue({data:{is_valid:true}});mocks.get.mockResolvedValue({data:[{id:'page',name:'HAAR'}]});});
it('routes ads OAuth to user-token storage without loading or replacing Pages',async()=>{
 mocks.query.mockResolvedValueOnce({rowCount:1,rows:[{user_id:'owner',purpose:'ads'}]});
 expect(await finishMetaOAuth({code:'test-code',state:'test-state'})).toEqual({adsConnected:true});
 expect(mocks.save).toHaveBeenCalledWith('owner',{accessToken:'long',tokenInfo:{is_valid:true}});expect(mocks.get).not.toHaveBeenCalled();
});
it('preserves the publishing OAuth Page-selection path',async()=>{
 mocks.query.mockResolvedValueOnce({rowCount:1,rows:[{user_id:'owner',purpose:'publishing'}]}).mockResolvedValue({rowCount:1,rows:[]});
 mocks.get.mockResolvedValue({data:[{id:'page',name:'HAAR'}]});
 const pending=await finishMetaOAuth({code:'test-code',state:'test-state'});expect(typeof pending).toBe('string');expect(mocks.save).not.toHaveBeenCalled();expect(mocks.get).toHaveBeenCalledWith('/me/accounts','long',expect.any(Object));
});
