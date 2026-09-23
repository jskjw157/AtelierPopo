import {expect,it} from 'vitest';
import {buildMetaOAuthUrl} from '../server/meta/client.js';
it('requests ads scopes only on the separate explicit connection path',()=>{
 const ads=new URL(buildMetaOAuthUrl('state',{scopes:['ads_read','ads_management']}));
 expect(ads.searchParams.get('scope')).toBe('ads_read,ads_management');
 expect(new URL(buildMetaOAuthUrl('state')).searchParams.get('scope')).toContain('instagram_basic');
 expect(new URL(buildMetaOAuthUrl('state')).searchParams.get('scope')).not.toContain('ads_management');
});
