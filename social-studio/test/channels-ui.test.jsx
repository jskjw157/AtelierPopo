// @vitest-environment jsdom
import React from 'react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { render,screen,fireEvent,cleanup,waitFor } from '@testing-library/react';
import ChannelConnections from '../src/components/ChannelConnections.jsx';
import ChannelsPage from '../src/pages/ChannelsPage.jsx';
import { api } from '../src/lib/api.js';
vi.mock('../src/lib/api.js',()=>({api:vi.fn(),formatDate:v=>v||'—'}));
const generation='11111111-1111-4111-8111-111111111111';
const channels=['threads','tiktok','x'].map(platform=>({platform,name:platform==='x'?'X':platform==='threads'?'Threads':'TikTok',scopes:['mock.scope'],note:platform==='tiktok'?'TikTok에서 최종 게시해야 합니다.':'사용자 승인 필요',configured:true,connectEnabled:true,writesEnabled:false,billingApproved:true,callbackUrl:`https://app.invalid/api/channels/${platform}/callback`,connection:{status:'connected',account_name:'Test '+platform,generation}}));
beforeEach(()=>{api.mockImplementation(async path=>path==='/api/channels/status'?{channels}:path==='/api/media'?{media:[]}:{posts:[]});vi.spyOn(window,'confirm').mockReturnValue(true);});
afterEach(()=>{cleanup();vi.restoreAllMocks();api.mockReset();});
it('never starts OAuth on mount or refresh, and disables missing config',async()=>{
 api.mockResolvedValue({channels:channels.map(c=>({...c,configured:false,connectEnabled:false,connection:{status:'disconnected'}}))});
 render(<ChannelConnections/>);await screen.findByRole('button',{name:'Threads 연결'});
 expect(screen.getByRole('button',{name:'Threads 연결'}).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'상태 새로고침'}));
 expect(api.mock.calls.every(c=>c[0]==='/api/channels/status')).toBe(true);
});
it('requires explicit consent before leaving for an OAuth provider',async()=>{
 render(<ChannelConnections/>);await screen.findByRole('button',{name:'Threads 다시 연결'});
 window.confirm.mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:'Threads 다시 연결'}));
 expect(api.mock.calls.some(c=>c[0].endsWith('/connect'))).toBe(false);
});
it('leaves writes locked while allowing drafts and explains TikTok completion',async()=>{
 render(<ChannelsPage/>);await screen.findAllByText('Test threads');
 fireEvent.change(screen.getByLabelText('채널'),{target:{value:'tiktok'}});
 expect(screen.getByText(/공개 자동게시 기능이 아닙니다/)).toBeTruthy();
 fireEvent.click(screen.getByRole('checkbox'));
 expect(screen.getByRole('button',{name:'최종 확인'}).disabled).toBe(false);
 fireEvent.change(screen.getByLabelText('동작'),{target:{value:'publish'}});
 fireEvent.click(screen.getByRole('checkbox'));
 expect(screen.getByRole('button',{name:'최종 확인'}).disabled).toBe(true);
});
it('retains the request UUID when a response is lost, resets it after editing content',async()=>{
 api.mockImplementation(async(path,options)=>{
  if(path==='/api/channels/status')return {channels};if(path==='/api/media')return {media:[]};
  if(options?.method==='POST')throw new Error('response lost');return {posts:[]};
 });
 render(<ChannelsPage/>);await screen.findAllByText('Test threads');
 fireEvent.change(screen.getByLabelText('최종 본문'),{target:{value:'hello'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'최종 확인'}));
 await screen.findByText('response lost');
 const posted=()=>api.mock.calls.filter(c=>c[1]?.method==='POST').map(c=>JSON.parse(c[1].body));
 fireEvent.click(screen.getByRole('button',{name:'최종 확인'}));await waitFor(()=>expect(posted()).toHaveLength(2));expect(posted()[0].clientRequestId).toBe(posted()[1].clientRequestId);
 await waitFor(()=>expect(screen.getByRole('button',{name:'최종 확인'}).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('최종 본문'),{target:{value:'edited'}});expect(screen.getByRole('checkbox').checked).toBe(false);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'최종 확인'}));await waitFor(()=>expect(posted()).toHaveLength(3));expect(posted()[2].clientRequestId).not.toBe(posted()[0].clientRequestId);
});
