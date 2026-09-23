import { expect,it } from 'vitest';
import { normalizeInsightsRow } from '../server/meta/ads/insights.js';
it('keeps unreported metrics unavailable and never fabricates ROAS',()=>{
  const r=normalizeInsightsRow({spend:'0',clicks:'0',actions:[]},'KRW');
  expect(r.spend).toBe(0);expect(r.clicks).toBe(0);expect(r.purchases).toBeNull();expect(r.roas).toBeNull();expect(r.impressions).toBeNull();
});
it('preserves fractional average costs in account major currency units',()=>{
  const r=normalizeInsightsRow({spend:'1234.56',cpc:'3.4567',cpm:'89.12'},'USD');
  expect(r.spend).toBe(1234.56);expect(r.cpc).toBe(3.4567);expect(r.cpm).toBe(89.12);
});
it('uses one explicitly labelled purchase series instead of adding overlapping totals',()=>{
  const r=normalizeInsightsRow({actions:[{action_type:'purchase',value:'2'},{action_type:'omni_purchase',value:'2'}],action_values:[{action_type:'omni_purchase',value:'8000'}],purchase_roas:[{action_type:'omni_purchase',value:'4'}]},'KRW');
  expect(r.purchases).toBe(2);expect(r.purchaseValue).toBe(8000);expect(r.purchaseMetricSource).toBe('omni_purchase');expect(r.roas).toBe(4);
});
it('marks conflicting duplicate purchase rows unavailable',()=>{
  const r=normalizeInsightsRow({actions:[{action_type:'purchase',value:'2'},{action_type:'purchase',value:'3'}]},'KRW');
  expect(r.purchases).toBeNull();expect(r.warnings).toContain('AMBIGUOUS_PURCHASE_ACTIONS');
});
it.each(['',null,true,'nan','Infinity','-1'])('does not turn invalid values into zero: %s',value=>{
  const r=normalizeInsightsRow({spend:value,impressions:value},'KRW');expect(r.spend).toBeNull();expect(r.impressions).toBeNull();
});
it('does not expose arbitrary response keys or raw provider token fields',()=>{
  const r=normalizeInsightsRow({account_id:'123',access_token:'never-display',paging:{next:'secret'},actions:[{action_type:'link_click',value:'1',access_token:'secret'}]},'KRW');
  expect(JSON.stringify(r)).not.toContain('secret');expect(JSON.stringify(r)).not.toContain('never-display');
});
it('does not combine a purchase count with value from a different action type',()=>{
  const r=normalizeInsightsRow({actions:[{action_type:'offsite_conversion.fb_pixel_purchase',value:'2'}],action_values:[{action_type:'omni_purchase',value:'10'}]},'USD');
  expect(r.purchaseValue).toBeNull();
});
