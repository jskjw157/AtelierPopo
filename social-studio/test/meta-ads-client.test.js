import { expect, it, vi } from 'vitest';
import { createAdsClient, normalizeActId, validateDateRange } from '../server/meta/ads/client.js';
it('normalizes only numeric Meta ad account identifiers', () => {
  expect(normalizeActId('123')).toBe('act_123'); expect(normalizeActId('act_123')).toBe('act_123');
  for(const id of ['abc','act_act_1','1/permissions','https://evil.test','123?access_token=x']) expect(()=>normalizeActId(id)).toThrow();
});
it('follows cursors on the original endpoint, never the provider next URL', async () => {
  const calls=[];
  const client=createAdsClient({get:async (...args)=>{calls.push(args); return calls.length===1?{data:[{id:'act_1'}],paging:{next:'https://evil.test?access_token=secret',cursors:{after:'A'}}}:{data:[{id:'act_2'}]};}});
  expect(await client.listAccounts('private')).toHaveLength(2);
  expect(calls[1][0]).toBe('/me/adaccounts'); expect(calls[1][2].after).toBe('A');
});
it('refuses to report incomplete results when page limit is reached',async()=>{
  const client=createAdsClient({maxPages:1,get:async()=>({data:[],paging:{next:'x',cursors:{after:'A'}}})});
  await expect(client.listAccounts('private')).rejects.toMatchObject({code:'ADS_PAGE_LIMIT'});
});
it('rejects a repeating cursor instead of looping',async()=>{
  const client=createAdsClient({get:async()=>({data:[],paging:{next:'x',cursors:{after:'A'}}})});
  await expect(client.listAccounts('private')).rejects.toMatchObject({code:'ADS_PAGING_INVALID'});
});
it.each([['2026-02-30','2026-03-02'],['2026-02-02','2026-02-01'],['2026-01-01','2026-12-01']])('rejects invalid date range %s %s',(since,until)=>expect(()=>validateDateRange({since,until,level:'campaign'})).toThrow());
it('makes hierarchy reads only and limits insight field selection',async()=>{
  const get=vi.fn(async()=>({data:[]})); const client=createAdsClient({get});
  expect(await client.hierarchy('act_1','private')).toEqual({campaigns:[],adsets:[],ads:[]});
  await client.insights('act_1','private',{since:'2026-09-01',until:'2026-09-07',level:'account'});
  expect(get.mock.calls[3][2]).toMatchObject({level:'account',time_range:{since:'2026-09-01',until:'2026-09-07'}});
});
