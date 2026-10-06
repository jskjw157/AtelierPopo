import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadValidationRegistry, validateOperationCoverage } from '../src/naver/searchad/validation/registry.js';
import { ValidationService } from '../src/naver/searchad/validation/service.js';
import { SearchAdSpecRegistry } from '../src/naver/searchad/spec-registry.js';
import { searchAdCompletionOpenApi } from '../src/http/openapi-searchad-completion.js';
import { postgresCompletionFixture, completionReaderKey } from './helpers/postgres-searchad-completion-fixture.js';
const manifest = JSON.parse(fs.readFileSync('specs/naver-searchad/current.json'));
const entries = () => JSON.parse(fs.readFileSync('specs/naver-searchad/validation-registry.json'));
const states = ['implemented_canary_proven_family','implemented_manual_only','public_unverified','internal_or_quarantined'];
const load = () => loadValidationRegistry({manifest,entries:entries()});
test('registry_classifies_exactly_126_unique_keys', () => {
  const registry=load();
  assert.deepEqual(validateOperationCoverage({manifest,registry}),{rawCount:126,classifiedCount:126,unclassified:[],leaks:[]});
  assert.equal(new Set(registry.operations.map(op=>op.operationKey)).size,126);
  assert.deepEqual([...new Set(registry.operations.map(op=>op.state))].sort(),states.toSorted());
  for(const op of registry.operations){assert.ok(op.scope.length && op.implementationRefs.length && op.testRefs.length && op.reason);assert.equal(op.liveVerified,false);}
  assert.equal(registry.transportCapabilities.length,1);
  assert.equal(registry.transportCapabilities[0].capabilityKey,'signed_report_download');
});
test('registry_never_mutates_runtime_allowlist', () => {
  const before=JSON.stringify(manifest), registry=load(), service=new ValidationService({registry});
  const listed=service.list();
  assert.throws(()=>listed.items.push({operationKey:'forged'}),TypeError);
  assert.throws(()=>{listed.items[0].scope[0]='forged';},TypeError);
  const input=entries();const cloned=loadValidationRegistry({manifest,entries:input});input.operations[0].scope[0]='changed';
  assert.notEqual(cloned.operations[0].scope[0],'changed');
  assert.equal(JSON.stringify(manifest),before);
  assert.equal(manifest.operations.filter(op=>op.runtimeAllowlisted).length,117);
  assert.equal(listed.descriptiveOnly,true);
  assert.equal(service.activate,undefined);assert.equal(service.promote,undefined);assert.equal(service.issueEvidence,undefined);
});
test('internal_nine_never_become_public', () => {
  const registry=load(), internal=manifest.operations.filter(op=>!op.runtimeAllowlisted);
  assert.equal(internal.length,9);
  for(const op of internal){assert.equal(registry.operations.find(row=>row.operationKey===op.operationKey).state,'internal_or_quarantined');}
  const data=entries();data.operations.find(row=>row.operationKey===internal[0].operationKey).state='implemented_manual_only';
  assert.throws(()=>loadValidationRegistry({manifest,entries:data}),/INTERNAL_CLASSIFICATION/);
  assert.equal(new SearchAdSpecRegistry(manifest).list({runtimeOnly:true,limit:200}).total,117);
});
test('canary_family_does_not_imply_live_customer_authority', () => {
  const service=new ValidationService({registry:load()});const families=service.list({state:'implemented_canary_proven_family'});
  assert.ok(families.items.length>0);
  for(const op of families.items){assert.equal(op.liveVerified,false);assert.match(op.reason,/fixture|offline/i);assert.match(op.scope.join(' '),/bounded|WEB_SITE|campaign|hierarchy/i);}
  const data=entries();data.operations[0].liveVerified=true;
  assert.throws(()=>loadValidationRegistry({manifest,entries:data}),/LIVE_EVIDENCE_UNAVAILABLE/);
  const parents=service.list().items.filter(op=>op.method==='DELETE' && ['/ncc/campaigns/{campaignId}','/ncc/adgroups/{adgroupId}'].includes(op.path));
  assert.equal(parents.length,2);for(const op of parents)assert.match(op.scope.join(' '),/public.*disabled|public.*absent/i);
  assert.throws(()=>service.list({state:'active'}),error=>error.status===400);
});
test('registry_rejects_missing_duplicate_unknown_and_unbounded_records', () => {
  for(const mutate of [data=>data.operations.pop(),data=>data.operations.push(data.operations[0]),data=>{data.operations[0].operationKey='invented';},data=>{data.operations[0].scope=[];},data=>{data.operations[0].state='implemented';},data=>{data.operations[0].activate=true;}]){const data=entries();mutate(data);assert.throws(()=>loadValidationRegistry({manifest,entries:data}));}
  const data=entries();data.operations.pop();data.operations.push({...data.operations[0],operationKey:'invented'});
  const coverage=validateOperationCoverage({manifest,registry:data});assert.equal(coverage.unclassified.length,1);assert.ok(coverage.leaks.includes('invented'));
});
test('validation_openapi_is_reader_get_only_and_explicitly_descriptive', () => {
  for(const role of ['reader','operator','executor','admin']){
    const paths=searchAdCompletionOpenApi({role}).paths;const op=paths['/api/v1/searchad/validation/operations'];
    assert.deepEqual(Object.keys(op),['get']);assert.equal(op.get['x-minimum-role'],'reader');assert.match(op.get.summary,/descriptive/i);
    assert.ok(op.get.parameters.some(p=>p.name==='customerId' && p.required));
    assert.deepEqual(op.get.parameters.find(p=>p.name==='state').schema.enum,states);
    assert.equal(Object.keys(paths).some(p=>/validation.*(?:activate|promote)/.test(p)),false);
  }
});
test('validation_actual_application_http_requires_reader_customer_and_stays_immutable_after_restart',{skip:!process.env.TEST_DATABASE_URL},async t=>{
  const f=await postgresCompletionFixture(t);let runtime=await f.start({allowedPaths:[]});
  const route='/api/v1/searchad/validation/operations';
  const first=await runtime.call(completionReaderKey,'GET',route+'?customerId=1001');
  assert.equal(first.status,200);assert.equal(first.body.items.length,126);assert.equal(first.body.descriptiveOnly,true);
  assert.equal(runtime.app.searchAdCompletionRuntime.validationService.list().items.length,126);
  assert.equal((await runtime.call('', 'GET',route+'?customerId=1001')).status,401);
  assert.equal((await runtime.call(f.env.ATELIER_API_KEY,'GET',route+'?customerId=1001')).status,401);
  assert.equal((await runtime.call(completionReaderKey,'POST',route,{customerId:'1001'})).status,405);
  for(const q of ['', '?customerId=2002'])assert.equal((await runtime.call(completionReaderKey,'GET',route+q)).status,403);
  for(const q of ['?customerId=1001&state=active','?customerId=1001&state=public_unverified&state=public_unverified','?customerId=1001&activate=true'])assert.equal((await runtime.call(completionReaderKey,'GET',route+q)).status,400);
  const filtered=await runtime.call(completionReaderKey,'GET',route+'?customerId=1001&state=internal_or_quarantined');assert.equal(filtered.body.items.length,9);
  for(const action of ['activate','promote'])assert.equal((await runtime.call(completionReaderKey,'POST',route+'/'+action,{customerId:'1001'})).status,404);
  first.body.items[0].liveVerified=true;
  await runtime.api.close();runtime=await f.start({allowedPaths:[]});
  const again=await runtime.call(completionReaderKey,'GET',route+'?customerId=1001');assert.equal(again.status,200);assert.equal(again.body.items[0].liveVerified,false);
  assert.equal(f.calls.length,0);
  for(const table of ['searchad_write_change_plans','searchad_canary_runs','searchad_verification_evidence','searchad_activation_grants'])assert.equal((await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
});

test('validation_coverage_cli_fails_on_missing_or_invented_classifications',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'searchad-validation-coverage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const directory of ['src','test','specs'])fs.cpSync(path.resolve(directory),path.join(root,directory),{recursive:true});
  const scan=()=>spawnSync(process.execPath,[path.resolve('scripts/searchad-validation-coverage.mjs'),'--root',root],{encoding:'utf8'});
  const valid=scan();assert.equal(valid.status,0,valid.stderr);const report=JSON.parse(valid.stdout);assert.equal(report.rawCount,126);assert.equal(report.classifiedCount,126);assert.equal(report.runtimeAllowlisted,117);assert.equal(report.liveVerified,0);
  const file=path.join(root,'specs/naver-searchad/validation-registry.json');
  for(const mutate of [data=>data.operations.pop(),data=>{data.operations[0].operationKey='invented';},data=>{data.operations[0].implementationRefs=['src/missing.js'];}]){const data=entries();mutate(data);fs.writeFileSync(file,JSON.stringify(data));assert.equal(scan().status,1);}
});
test('pinned_internal_runtime_membership_cannot_be_reclassified_by_input_manifest',()=>{
  const changed=structuredClone(manifest),internal=changed.operations.find(op=>!op.runtimeAllowlisted),external=changed.operations.find(op=>op.runtimeAllowlisted);
  internal.runtimeAllowlisted=true;external.runtimeAllowlisted=false;
  const data=entries();data.operations.find(row=>row.operationKey===external.operationKey).state='internal_or_quarantined';
  assert.throws(()=>loadValidationRegistry({manifest:changed,entries:data}));
});
test('validation_service_snapshots_caller_registry_without_mutating_it',()=>{
  const input=structuredClone(load()),service=new ValidationService({registry:input});const original=service.list().items[0].scope[0];
  input.operations[0].scope[0]='changed';assert.equal(service.list().items[0].scope[0],original);assert.equal(Object.isFrozen(input),false);
});
