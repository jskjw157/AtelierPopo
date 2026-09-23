// @vitest-environment jsdom
import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
const api=vi.hoisted(()=>vi.fn());
vi.mock('../src/lib/api.js',async()=>({...await vi.importActual('../src/lib/api.js'),api}));
import App from '../src/App.jsx';
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('opens Ads from the protected app route without launching or spending',async()=>{
 const account={external_account_id:'act_123',name:'HAAR',currency:'KRW',timezone_name:'Asia/Seoul'};
 api.mockImplementation(async p=>{
  if(p==='/api/auth/me')return {user:{id:'owner',email:'owner@test',role:'owner'}};
  if(p==='/api/meta/ads/status')return {readable:true,connected:true,managementGranted:true,executionEnabled:false,selectedAccount:account,scopes:['ads_read','ads_management']};
  if(p==='/api/meta/ads/accounts')return {accounts:[account]};
  if(p==='/api/meta/ads/drafts')return {drafts:[]};
  if(p==='/api/meta/ads/actions')return {actions:[]};
  if(p==='/api/products')return {products:[]};if(p==='/api/media')return {media:[]};if(p==='/api/campaigns')return {campaigns:[]};
  if(p.includes('/insights'))return {rows:[],capturedAt:null};
  if(p.endsWith('/tracking'))return {pixels:[]};
  throw new Error('Unexpected request '+p);
 });
 render(<MemoryRouter initialEntries={['/ads']}><App/></MemoryRouter>);
 expect(await screen.findByRole('heading',{name:'광고 관리',level:1})).toBeTruthy();
 expect(screen.getByRole('link',{name:'광고 관리'}).getAttribute('href')).toBe('/ads');
 fireEvent.click(screen.getByRole('tab',{name:'광고 초안'}));
 expect(await screen.findByRole('heading',{name:'새 광고 초안'})).toBeTruthy();
 await waitFor(()=>expect(api.mock.calls.every(c=>!c[1]?.method||c[1].method==='GET')).toBe(true));
});
