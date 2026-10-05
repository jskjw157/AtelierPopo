import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanExecutionSources, REVIEWED_TRANSPORT_BOUNDARIES } from '../scripts/searchad-execution-safety.mjs';
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
