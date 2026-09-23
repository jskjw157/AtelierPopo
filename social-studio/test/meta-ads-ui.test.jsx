// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {AdsApprovals} from '../src/components/ads/AdsApprovals.jsx';
import {AdsDraftForm} from '../src/components/ads/AdsDraftForm.jsx';
import {AdsInsights} from '../src/components/ads/AdsInsights.jsx';
afterEach(cleanup);
const account={external_account_id:'act_123',name:'HAAR',currency:'KRW',timezone_name:'Asia/Seoul'};
const action={id:'action-1',status:'pending',payload_hash:'a'.repeat(64),expires_at:new Date(Date.now()+600000).toISOString(),action_type:'launch',summary:{account:{id:'act_123',currency:'KRW',timezone:'Asia/Seoul'},campaignName:'Orbit',budgetType:'daily',budgetAmountMinor:20000,landingUrl:'https://haar.co.kr/product/orbit/43',notice:'일예산은 평균입니다.'}};
it('requires explicit confirmation and submits the exact hash, without executing',async()=>{
 const onAction=vi.fn().mockResolvedValue();render(<AdsApprovals actions={[action]} executionEnabled onAction={onAction} busy={false}/>);
 const approve=screen.getByRole('button',{name:'승인'});expect(approve.disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(approve);
 await waitFor(()=>expect(onAction).toHaveBeenCalledWith('action-1','approve',{expectedHash:'a'.repeat(64),confirmed:true}));
 expect(onAction.mock.calls.some(c=>c[1]==='execute')).toBe(false);
 expect(screen.getByRole('link',{name:'상품 구매 링크'}).getAttribute('href')).toBe(action.summary.landingUrl);
});
it('cannot execute an approved action when the server execution lock is on',()=>{
 render(<AdsApprovals actions={[{...action,status:'approved'}]} executionEnabled={false} onAction={vi.fn()} busy={false}/>);
 fireEvent.click(screen.getByRole('checkbox'));
 expect(screen.getByRole('button',{name:'승인된 작업 실행'}).disabled).toBe(true);
});
it('fills the product purchase URL in a new draft and never presents a direct launch button',()=>{
 render(<AdsDraftForm account={account} products={[{id:'product',name:'Orbit',product_url:'https://haar.co.kr/product/orbit/43'}]} media={[]} posts={[]} pixels={[]} onSave={vi.fn()} busy={false}/>);
 fireEvent.change(screen.getByLabelText('상품'),{target:{value:'product'}});
 expect(screen.getByLabelText('상품 구매 링크').value).toBe('https://haar.co.kr/product/orbit/43');
 expect(screen.getByRole('button',{name:'초안 저장'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'광고 실행'})).toBeNull();
});
it('shows unavailable purchase/ROAS instead of invented zeros',()=>{
 render(<AdsInsights data={{rows:[{campaignId:'c1',campaignName:'Orbit',currency:'KRW',spend:20000,clicks:10,impressions:100,ctr:10,cpc:2000,cpm:200000,purchases:null,roas:null}],capturedAt:null}} range={{since:'2026-09-01',until:'2026-09-07',level:'campaign'}} onRange={vi.fn()} onSync={vi.fn()} busy={false}/>);
 expect(screen.getAllByText('데이터 없음').length).toBeGreaterThanOrEqual(2);
 expect(screen.queryByText('0.00×')).toBeNull();
});
