import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanExecutionSources, REVIEWED_TRANSPORT_BOUNDARIES, REVIEWED_REQUEST_DATA_ESCAPES } from '../scripts/searchad-execution-safety.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'searchad-execution-safety-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function write(root,file,source){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source);}
const file='src/naver/searchad/automation/future/nested/service.js';
test('scanner_rejects_fetch_alias_http_undici_dynamic_network_import',async t=>{
  const root=fixture(t);
  const mutations=[
    'fetch("https://unapproved.invalid")',
    'const outbound=fetch; const alias=outbound; alias("https://unapproved.invalid")',
    'const {fetch:send}=globalThis; send("https://unapproved.invalid")',
    'globalThis["fetch"]("https://unapproved.invalid")',
    'const web=globalThis; web.fetch("https://unapproved.invalid")',
    'const send=globalThis.fetch.bind(globalThis); send("https://unapproved.invalid")',
    'import http from "node:http"; http.request("https://unapproved.invalid")',
    'import {get as send} from "https";send("https://unapproved.invalid")',
    'import {request as send} from "undici";send("https://unapproved.invalid")',
    'import axios from "axios";axios.get("https://unapproved.invalid")',
    'new WebSocket("wss://unapproved.invalid")',
    'const {fetch:send}=await import("undici");send("https://unapproved.invalid")',
    'const moduleName="node:"+"https";const client=await import(moduleName);client.get("https://unapproved.invalid")',
    'const load=import("node:http");',
    'const network=require("https");network.request("https://unapproved.invalid")',
    'export async function execute(client){return client.request({path:"/raw"});}',
    'export async function execute(gateway){return gateway.client.request({path:"/raw"});}',
    'export async function execute(fetchImpl){return fetchImpl("https://unapproved.invalid");}',
    'const target="fetch";globalThis[target]("https://unapproved.invalid")',
    'export function run(client){const {request:send}=client;return send({path:"/raw"});}',
    'class Service{constructor({fetchImpl:outbound}){this.outbound=outbound;}run(){this.outbound("https://unapproved.invalid");}}',
    'const io={send:fetch};io.send("https://unapproved.invalid");',
    'import {request as send} from "node:http";const wrapper={send};wrapper.send("https://unapproved.invalid");'

  ];
  for(const source of mutations)await t.test(source,()=>{write(root,file,source);const result=scanExecutionSources({root,transportAllowlist:[]});assert.ok(result.violations.length>0,source);assert.ok(result.violations.some(v=>v.file===file));});
});
test('scanner_visits_nested_and_new_source_files',t=>{
  const root=fixture(t);
  const files=['write','canary','lifecycle','reporting','circuit','automation','worker','validation','profitability'].map(dir=>`src/naver/searchad/${dir}/new/nested/run.js`);
  files.push('src/http/routes-new/nested/searchad.js','src/bootstrap-future.js','src/searchad-worker.js');
  for(const name of files)write(root,name,'globalThis.fetch("https://unapproved.invalid")');
  write(root,'src/bootstrap-future.js','import "./external/deep/transport.js";');
  write(root,'src/external/deep/transport.js','globalThis.fetch("https://unapproved.invalid")');files.push('src/external/deep/transport.js');
  const result=scanExecutionSources({root,transportAllowlist:[]});
  for(const name of files)assert.ok(result.scannedFiles.includes(name),name);
  for(const name of files.filter(name=>name!=='src/bootstrap-future.js'))assert.ok(result.violations.some(v=>v.file===name),name);
});
test('approved_transport_boundary_is_explicit_not_whole_directory_exemption',t=>{
  const root=fixture(t);write(root,'src/naver/searchad/transport/new/nested/raw.js','fetch("https://unapproved.invalid")');
  assert.ok(scanExecutionSources({root}).violations.length);
  assert.throws(()=>scanExecutionSources({root,transportAllowlist:[{file:'src/naver/searchad/transport/**',reason:'broad'}]}),/BOUNDARY_INVALID/);
  assert.ok(REVIEWED_TRANSPORT_BOUNDARIES.length>0);
  for(const entry of REVIEWED_TRANSPORT_BOUNDARIES){assert.ok(entry.file && entry.nodeSha256 && entry.reason && entry.testRefs.length);assert.doesNotMatch(entry.file,/\*/);}
});
test('scanner_accepts_approved_method_delegation_and_rejects_parse_errors',t=>{
  const root=fixture(t);write(root,file,'export const collect=(gateway,transport)=>gateway.execute("pinned-operation"); export const download=transport=>transport.download({jobId:"owned"});');
  assert.deepEqual(scanExecutionSources({root,transportAllowlist:[]}).violations,[]);
  write(root,file,'export const broken = ;');assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.some(v=>v.kind==='parse_error'));
});
test('real_source_mutation_cli_fails_and_restored_source_passes',t=>{
  const root=fixture(t);fs.cpSync(path.resolve('src'),path.join(root,'src'),{recursive:true});
  const scan=()=>spawnSync(process.execPath,[path.resolve('scripts/searchad-execution-safety.mjs'),'--root',root],{encoding:'utf8'});
  let result=scan();assert.equal(result.status,0,result.stderr+result.stdout);
  const clean=JSON.parse(result.stdout);assert.ok(clean.scannedFiles.length>100);assert.ok(clean.reviewedTransportBoundaries.length>0);
  for(const source of ['const send=globalThis.fetch;send("https://unapproved.invalid");','const network=await import("undici");network.request("https://unapproved.invalid");']){
    write(root,file,source);result=scan();assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).violations.some(v=>v.file===file));fs.rmSync(path.join(root,file));assert.equal(scan().status,0);
  }
  const approved=REVIEWED_TRANSPORT_BOUNDARIES[0].file,original=fs.readFileSync(path.join(root,approved),'utf8');
  fs.appendFileSync(path.join(root,approved),'\nfetch("https://unapproved.invalid");');assert.equal(scan().status,1);fs.writeFileSync(path.join(root,approved),original);assert.equal(scan().status,0);
});
test('scanner_rejects_exported_network_aliases_and_missing_source_tree',t=>{
  const root=fixture(t);
  assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.some(v=>v.kind==='source_missing'));
  for(const source of ['export const send=globalThis.fetch;', 'const send=fetch;export {send};', 'export default globalThis.fetch;']){
    write(root,file,source);assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.some(v=>v.kind==='network_export'),source);
  }
});

const fenceFile='src/naver/searchad/lifecycle/postgres-account-send-fence.js';
function copyFence(root){
  for(const name of [fenceFile,'src/naver/searchad/write/errors.js'])write(root,name,fs.readFileSync(name,'utf8'));
  fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  return fs.readFileSync(path.join(root,fenceFile),'utf8');
}
test('T7_I1_reviewed_context_rejects_fence_predicate_bypass_with_real_runtime_control',async t=>{
  const root=fixture(t),original=copyFence(root);
  assert.deepEqual(scanExecutionSources({root}).violations,[]);
  let calls=0;const pool={query(){throw new Error('unexpected DB access');},connect(){throw new Error('unexpected DB access');}};
  const {pathToFileURL}=await import('node:url');
  const load=async label=>(await import(pathToFileURL(path.join(root,fenceFile)).href+'?'+label)).PostgresAccountSendFence;
  const Before=await load('before');
  await assert.rejects(new Before({pool,fetchImpl:async()=>{calls++;return new Response();}}).fetch('https://api.searchad.naver.com/ncc/campaigns',{method:'POST'}),error=>error.code==='SEARCHAD_SEND_FENCE_SCOPE');assert.equal(calls,0);
  const changed=original.replace("if (method === 'GET' || method === 'HEAD')","if (true)");assert.notEqual(changed,original);write(root,fenceFile,changed);
  const After=await load('after');await new After({pool,fetchImpl:async()=>{calls++;return new Response();}}).fetch('https://api.searchad.naver.com/ncc/campaigns',{method:'POST'});assert.equal(calls,1);
  assert.ok(scanExecutionSources({root}).violations.some(v=>v.file===fenceFile),'unchanged invocation text must not approve weakened GET/HEAD guard');
});
test('T7_I1_moving_identical_invocation_outside_guarded_method_fails',t=>{
  const root=fixture(t),original=copyFence(root);
  const changed=original.replace("if (method === 'GET' || method === 'HEAD') return this.#fetch(address, request);","if (method === 'GET' || method === 'HEAD') return this.unguarded(address, request);").replace('  async fetch(url, init = {}) {','  unguarded(address, request) { return this.#fetch(address, request); }\n  async fetch(url, init = {}) {');
  assert.equal(changed.match(/this\.#fetch\(address, request\)/g).length,2);write(root,fenceFile,changed);
  assert.ok(scanExecutionSources({root}).violations.some(v=>v.file===fenceFile),'same call count in another method must not retain approval');
  write(root,fenceFile,original);assert.deepEqual(scanExecutionSources({root}).violations,[]);
});
test('T7_I2_callback_capability_transfer_and_container_module_exports_fail',async t=>{
  for(const source of [
    'function run(transport){return transport("https://unapproved.invalid");}run(globalThis.fetch);',
    'function run(transport){return transport("https://unapproved.invalid");}const send=fetch;run(send);',
    'function run(io){return io.send("https://unapproved.invalid");}run({nested:{send:globalThis.fetch}});'
  ])await t.test(source,()=>{const root=fixture(t);write(root,file,source);assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.length>0);});
  await t.test('two-file exported object capability',()=>{const root=fixture(t);write(root,'src/transport.js','export const io={send:globalThis.fetch};');write(root,'src/service.js','import {io} from "./transport.js";io.send("https://unapproved.invalid");');const result=scanExecutionSources({root,transportAllowlist:[]});assert.deepEqual(result.scannedFiles,['src/service.js','src/transport.js']);assert.ok(result.violations.some(v=>v.file==='src/transport.js'&&v.kind==='network_export'));});
});
test('T7_I2_harmless_callbacks_and_object_exports_pass',t=>{
  const root=fixture(t);write(root,'src/transport.js','export const io={send:value=>String(value),nested:{count:2}};export const marker="fetch";');write(root,'src/service.js','import {io} from "./transport.js";function run(callback){return callback("hello");}run(value=>value.toUpperCase());io.send("hello");');assert.deepEqual(scanExecutionSources({root,transportAllowlist:[]}).violations,[]);
});
test('T7_I3_local_and_unrelated_imported_constructor_namesakes_fail',async t=>{
  await t.test('local namesake',()=>{const root=fixture(t);write(root,file,'class PostgresAccountSendFence{constructor(){this.fetch=globalThis.fetch;}}const fence=new PostgresAccountSendFence();fence.fetch("https://unapproved.invalid");');assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.some(v=>v.file===file));});
  await t.test('unrelated imported namesake',()=>{const root=fixture(t);write(root,'src/unrelated.js','export class PostgresAccountSendFence{constructor(){this.fetch=globalThis.fetch;}}');write(root,'src/service.js','import {PostgresAccountSendFence} from "./unrelated.js";const fence=new PostgresAccountSendFence();fence.fetch("https://unapproved.invalid");');assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.some(v=>v.file==='src/service.js'));});
});
test('T7_I3_exact_fence_import_aliases_pass_but_shadowing_reassignment_and_tampering_fail',async t=>{
  const root=fixture(t);copyFence(root);
  const prefix='import {PostgresAccountSendFence as ActualFence} from "./naver/searchad/lifecycle/postgres-account-send-fence.js";';
  write(root,'src/service.js',prefix+'const Alias=ActualFence;const fence=new Alias();const alias=fence;alias.fetch("https://api.searchad.naver.com/stats");');
  assert.deepEqual(scanExecutionSources({root}).violations,[]);
  write(root,'src/service.js','import * as module from "./naver/searchad/lifecycle/postgres-account-send-fence.js";const fence=new module.PostgresAccountSendFence();fence.fetch("https://api.searchad.naver.com/stats");');assert.deepEqual(scanExecutionSources({root}).violations,[]);
  for(const source of [
    prefix+'function run(ActualFence){const fence=new ActualFence();fence.fetch("https://unapproved.invalid");}',
    prefix+'function run(){class ActualFence{constructor(){this.fetch=globalThis.fetch;}}const fence=new ActualFence();fence.fetch("https://unapproved.invalid");}',
    prefix+'let Alias=ActualFence;Alias=class{};const fence=new Alias();fence.fetch("https://unapproved.invalid");',
    prefix+'const fence=new ActualFence();fence.fetch=globalThis.fetch;fence.fetch("https://unapproved.invalid");'
  ])await t.test(source,()=>{write(root,'src/service.js',source);assert.ok(scanExecutionSources({root}).violations.some(v=>v.file==='src/service.js'));});
});
test('T7_I2_returned_capability_and_request_data_are_distinguished',t=>{
  const root=fixture(t);write(root,file,'function give(){return globalThis.fetch;}const send=give();send("https://unapproved.invalid");');
  assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.some(v=>v.kind==='network_capability_return'));
  write(root,file,'export function describe({request={}}={}){return JSON.stringify({request});}const metadata={request:{path:"/record"}};describe(metadata);');
  assert.deepEqual(scanExecutionSources({root,transportAllowlist:[]}).violations,[]);
});
test('T7_I2_arrow_capability_return_is_an_escape',t=>{
  const root=fixture(t);write(root,file,'export const getTransport=()=>({send:globalThis.fetch});');
  assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.some(v=>v.kind==='network_capability_return'));
});
test('T7_I3_destructuring_reassignments_invalidate_constructor_provenance',async t=>{
  for(const assignment of ['[Alias]=[class{}];','({replacement:Alias}=value);'])await t.test(assignment,()=>{
    const root=fixture(t);copyFence(root);
    write(root,'src/service.js','import {PostgresAccountSendFence as ActualFence} from "./naver/searchad/lifecycle/postgres-account-send-fence.js";let Alias=ActualFence;'+assignment+'const fence=new Alias();fence.fetch("https://unapproved.invalid");');
    assert.ok(scanExecutionSources({root}).violations.some(v=>v.file==='src/service.js'));
  });
});
test('T7_I3_destructured_values_are_not_constructor_identity_aliases',t=>{
  const root=fixture(t);copyFence(root);
  write(root,'src/service.js','import {PostgresAccountSendFence as ActualFence} from "./naver/searchad/lifecycle/postgres-account-send-fence.js";function run(Factory){ActualFence.Factory=Factory;const {Factory:Alias}=ActualFence;const fence=new Alias();fence.fetch("https://unapproved.invalid");}');
  assert.ok(scanExecutionSources({root}).violations.some(v=>v.file==='src/service.js'));
});
test('T7_I3_destructured_fetch_member_overwrite_invalidates_instance',t=>{
  const root=fixture(t);copyFence(root);
  write(root,'src/service.js','import {PostgresAccountSendFence as ActualFence} from "./naver/searchad/lifecycle/postgres-account-send-fence.js";const fence=new ActualFence();({replacement:fence.fetch}=source);fence.fetch("https://unapproved.invalid");');
  assert.ok(scanExecutionSources({root}).violations.some(v=>v.file==='src/service.js'));
});

test('T7_F1_I1_two_file_request_alias_export_executes_fake_POST_and_is_rejected',async t=>{
  const root=fixture(t);write(root,'package.json','{"type":"module"}');
  write(root,'src/producer.js','let send;export function configure(upstream){send=upstream.request;}export {send};');
  write(root,'src/service.js','import {send} from "./producer.js";export function execute(){return send("/ncc/campaigns",{method:"POST"});}');
  const {pathToFileURL}=await import('node:url');
  const {configure}=await import(pathToFileURL(path.join(root,'src/producer.js')).href);
  const {execute}=await import(pathToFileURL(path.join(root,'src/service.js')).href);
  const calls=[];configure({request:(route,options)=>{calls.push({route,method:options.method});return {fake:true};}});
  assert.deepEqual(execute(),{fake:true});assert.deepEqual(calls,[{route:'/ncc/campaigns',method:'POST'}]);
  const result=scanExecutionSources({root,transportAllowlist:[]});assert.deepEqual(result.scannedFiles,['src/producer.js','src/service.js']);
  assert.ok(result.violations.some(v=>v.file==='src/producer.js'&&v.kind==='network_export'));
});
test('T7_F1_I1_two_file_destructured_request_export_executes_fake_POST_and_is_rejected',async t=>{
  const root=fixture(t);write(root,'package.json','{"type":"module"}');
  write(root,'src/producer.js','export const calls=[];const upstream={request:(route,options)=>{calls.push({route,method:options.method});return {fake:true};}};const {request:send}=upstream;export {send};');
  write(root,'src/service.js','import {send} from "./producer.js";export function execute(){return send("/ncc/campaigns",{method:"POST"});}');
  const {pathToFileURL}=await import('node:url');
  const {calls}=await import(pathToFileURL(path.join(root,'src/producer.js')).href);
  const {execute}=await import(pathToFileURL(path.join(root,'src/service.js')).href);
  assert.deepEqual(execute(),{fake:true});assert.deepEqual(calls,[{route:'/ncc/campaigns',method:'POST'}]);
  const result=scanExecutionSources({root,transportAllowlist:[]});assert.deepEqual(result.scannedFiles,['src/producer.js','src/service.js']);
  assert.ok(result.violations.some(v=>v.file==='src/producer.js'&&v.kind==='network_export'));
});
test('T7_F1_I1_request_member_argument_return_and_direct_call_remain_forbidden',async t=>{
  for(const source of [
    'export function configure(upstream){run(upstream.request);}',
    'export function configure(upstream){const {request:send}=upstream;run(send);}',
    'export function configure(upstream){run({nested:{send:upstream.request}});}',
    'export function configure(upstream){return upstream.request;}',
    'export function execute(upstream){return upstream.request("/ncc/campaigns",{method:"POST"});}'
  ])await t.test(source,()=>{const root=fixture(t);write(root,file,source);assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.length>0);});
});
test('T7_F1_I1_plain_request_data_exports_and_aliases_pass',t=>{
  const root=fixture(t);
  write(root,'src/producer.js','export const metadata={request:{path:"/record"}};export const details=metadata.request;const {request:body}=metadata;export {body};');
  write(root,'src/service.js','import {metadata,details,body} from "./producer.js";export const paths=[metadata.request.path,details.path,body.path];');
  assert.deepEqual(scanExecutionSources({root,transportAllowlist:[]}).violations,[]);
});
test('T7_F1_I1_data_proof_does_not_survive_request_writes_or_serializer_shadowing',async t=>{
  for(const source of [
    'const metadata={request:{path:"/record"}};metadata.request=upstream.request;export const send=metadata.request;',
    'const metadata={request:{path:"/record"}};const alias=metadata;alias.request=upstream.request;export const send=metadata.request;',
    'export function run(upstream,JSON){return JSON.stringify(upstream.request);}',
    'JSON.stringify=callback=>callback("/ncc/campaigns",{method:"POST"});export function run(upstream){return JSON.stringify(upstream.request);}'
  ])await t.test(source,()=>{const root=fixture(t);write(root,file,source);assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.length>0);});
});
test('T7_F1_I1_candidate_data_distinction_retains_callable_choices_and_shadow_checks',async t=>{
  for(const source of [
    'const send=upstream.request||fallback;send("/ncc/campaigns",{method:"POST"});',
    'const send=ready?globalThis.fetch:fallback;send("https://unapproved.invalid");',
    'const metadata={request:{path:"/record"}};export function configure({metadata}){return metadata.request;}',
    '({replacement:JSON.stringify}=source);export function run(upstream){return JSON.stringify(upstream.request);}'
  ])await t.test(source,()=>{const root=fixture(t);write(root,file,source);assert.ok(scanExecutionSources({root,transportAllowlist:[]}).violations.length>0);});
});

test('T7_F1_I1_reviewed_request_data_contexts_do_not_approve_changed_context_or_new_calls',t=>{
  const root=fixture(t);fs.cpSync(path.resolve('src'),path.join(root,'src'),{recursive:true});
  const clean=scanExecutionSources({root});assert.deepEqual(clean.violations,[]);assert.equal(clean.reviewedRequestDataEscapes.length,28);assert.equal(clean.reviewedTransportBoundaries.length,56);
  assert.ok(REVIEWED_REQUEST_DATA_ESCAPES.every(record=>record.producer&&record.shape&&record.contextSha256&&record.testRefs.length));
  const name='src/catalog/channel-import/import-service.js',original=fs.readFileSync(path.join(root,name),'utf8');
  write(root,name,original.replace('request: request || {}','request: request ?? {}'));
  assert.ok(scanExecutionSources({root}).violations.some(v=>v.file===name&&v.kind==='reviewed_request_data_changed'));
  for(const addition of ['function raw(upstream){return upstream.request("/ncc/campaigns",{method:"POST"});}','function escape(upstream){return upstream.request;}']){
    write(root,name,original+'\n'+addition);assert.ok(scanExecutionSources({root}).violations.some(v=>v.file===name));
  }
  write(root,name,original);assert.deepEqual(scanExecutionSources({root}).violations,[]);
});
test('T7_F1_I1_data_records_cannot_approve_known_network_or_raw_invocation',t=>{
  const root=fixture(t);write(root,file,'function run(){consume(globalThis.fetch);}');
  const result=scanExecutionSources({root,transportAllowlist:[],requestDataAllowlist:[]}),finding=result.violations.find(v=>v.kind==='network_capability_transfer');assert.ok(finding);
  const record={...finding,occurrences:1,producer:'test control',shape:'test control',testRefs:['test/searchad-execution-safety.test.js']};
  assert.ok(scanExecutionSources({root,transportAllowlist:[],requestDataAllowlist:[record]}).violations.some(v=>v.kind==='network_capability_transfer'));
  assert.throws(()=>scanExecutionSources({root,transportAllowlist:[],requestDataAllowlist:[{...record,kind:'raw_client_delegation'}]}),/REQUEST_DATA_RECORD_INVALID/);
});

test('T7_F2_I1_stringify_toJSON_capability_invokes_fake_and_is_rejected',async t=>{
  for(const body of [
    'return JSON.stringify({toJSON:upstream.request});',
    'return JSON.stringify([{toJSON:upstream.request}]);',
    'const payload={toJSON:upstream.request};return JSON.stringify(payload);',
    'const alias=upstream.request;return JSON.stringify({toJSON:alias});',
    'return JSON.stringify({["to"+"JSON"]:upstream.request});',
    'return JSON.stringify({...{toJSON:upstream.request}});',
    'const value=upstream.request;value.toJSON=value;return JSON.stringify({request:value});',
    'return JSON.stringify({get toJSON(){return upstream.request;}});'
  ])await t.test(body,async()=>{
    const root=fixture(t);write(root,'package.json','{"type":"module"}');write(root,'src/service.js','export function execute(upstream){'+body+'}');
    const {pathToFileURL}=await import('node:url');const {execute}=await import(pathToFileURL(path.join(root,'src/service.js')).href);
    let calls=0;const value=execute({request:()=>{calls++;return {fakeRawRequest:true};}});
    assert.equal(calls,1);assert.ok(value.includes('"fakeRawRequest":true'));
    const result=scanExecutionSources({root,transportAllowlist:[],requestDataAllowlist:[]});assert.deepEqual(result.scannedFiles,['src/service.js']);
    assert.ok(result.violations.some(v=>['network_capability_transfer','network_capability_return'].includes(v.kind)));
  });
});
test('T7_F2_I1_stringify_bare_candidate_and_plain_request_field_do_not_invoke_fake',async t=>{
  for(const [expression,expected] of [['upstream.request',undefined],['{request:upstream.request}','{}']])await t.test(expression,async()=>{
    const root=fixture(t);write(root,'package.json','{"type":"module"}');write(root,'src/service.js','export function execute(upstream){return JSON.stringify('+expression+');}');
    const {pathToFileURL}=await import('node:url');const {execute}=await import(pathToFileURL(path.join(root,'src/service.js')).href);
    let calls=0;assert.equal(execute({request:()=>{calls++;return {fakeRawRequest:true};}}),expected);assert.equal(calls,0);
    assert.deepEqual(scanExecutionSources({root,transportAllowlist:[],requestDataAllowlist:[]}).violations,[]);
  });
});

test('exact money BigInt constants are analyzed and do not disable forbidden-call checks',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'searchad-bigint-'));
  try{fs.mkdirSync(path.join(dir,'src'),{recursive:true});fs.writeFileSync(path.join(dir,'src','money.js'),'const scale=10000n; export const amount=x=>BigInt(x)*scale;');assert.equal(scanExecutionSources({root:dir,transportAllowlist:[],requestDataAllowlist:[]}).violations.length,0);fs.appendFileSync(path.join(dir,'src','money.js'),' export const bad=()=>fetch("https://example.invalid");');assert.ok(scanExecutionSources({root:dir,transportAllowlist:[],requestDataAllowlist:[]}).violations.some(v=>v.kind!=="parse_error"));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
