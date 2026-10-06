import fs from 'node:fs';
export const VALIDATION_STATES = Object.freeze(['implemented_canary_proven_family','implemented_manual_only','public_unverified','internal_or_quarantined']);
const PINNED_SHA = '8e250490ab748367a627213f7d7a2917e005cb10';
const pinnedOperations = JSON.parse(fs.readFileSync(new URL(`../../../../specs/naver-searchad/versions/${PINNED_SHA}/operation-manifest.json`,import.meta.url))).operations;
const fields = ['operationKey','state','scope','implementationRefs','testRefs','liveVerified','reason'];
export function freezeValidation(value) {
  if(value && typeof value==='object'){for(const child of Object.values(value))freezeValidation(child);Object.freeze(value);}
  return value;
}
function fail(code){throw Object.assign(new Error(`SEARCHAD_VALIDATION_${code}`),{code:`SEARCHAD_VALIDATION_${code}`,status:503});}
export function validateOperationCoverage({manifest,registry}) {
  const raw=manifest?.operations||[],rows=registry?.operations||[],keys=new Set(raw.map(op=>op.operationKey)),classified=new Set(rows.map(op=>op.operationKey));
  const leaks=rows.filter(row=>!keys.has(row.operationKey)).map(row=>row.operationKey);
  for(const op of raw)if((!op.runtimeAllowlisted||op.state==='internal_quarantined') && rows.some(row=>row.operationKey===op.operationKey&&row.state!=='internal_or_quarantined'))leaks.push(op.operationKey);
  return {rawCount:raw.length,classifiedCount:rows.filter(row=>keys.has(row.operationKey)&&VALIDATION_STATES.includes(row.state)).length,unclassified:[...keys].filter(key=>!classified.has(key)),leaks:[...new Set(leaks)]};
}
/** Descriptive immutable data. Never consumed by an execution/activation guard. */
export function loadValidationRegistry({manifest,entries}={}) {
  manifest ??= JSON.parse(fs.readFileSync(new URL('../../../../specs/naver-searchad/current.json',import.meta.url)));
  entries ??= JSON.parse(fs.readFileSync(new URL('../../../../specs/naver-searchad/validation-registry.json',import.meta.url)));
  if(manifest.specRef!==PINNED_SHA||entries.specRef!==PINNED_SHA||entries.schemaVersion!==1||!Array.isArray(manifest.operations)||!Array.isArray(entries.operations))fail('PIN_INVALID');
  const raw=manifest.operations,rows=entries.operations;
  for(const op of raw){const pinned=pinnedOperations.find(row=>row.operationKey===op.operationKey);if(!pinned||['method','path','state','runtimeAllowlisted','specRef'].some(key=>op[key]!==pinned[key]))fail('PIN_INVALID');}
  if(raw.length!==126||new Set(raw.map(op=>op.operationKey)).size!==126||raw.filter(op=>op.runtimeAllowlisted).length!==117||rows.length!==126||new Set(rows.map(op=>op.operationKey)).size!==126)fail('COVERAGE_INVALID');
  for(const row of rows){
    if(Object.keys(row).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(row,key))||!VALIDATION_STATES.includes(row.state)||typeof row.reason!=='string'||!row.reason.trim())fail('RECORD_INVALID');
    for(const key of ['scope','implementationRefs','testRefs'])if(!Array.isArray(row[key])||!row[key].length||row[key].some(value=>typeof value!=='string'||!value.trim()))fail('SCOPE_INVALID');
    if(row.implementationRefs.some(ref=>!/^src\/[A-Za-z0-9_./-]+\.js$/.test(ref)||ref.split('/').includes('..'))||row.testRefs.some(ref=>!/^test\/[A-Za-z0-9_./-]+\.test\.js$/.test(ref)||ref.split('/').includes('..')))fail('REFERENCE_INVALID');
    if(row.liveVerified!==false)fail('LIVE_EVIDENCE_UNAVAILABLE');
    const op=raw.find(op=>op.operationKey===row.operationKey);
    if(op && !op.runtimeAllowlisted && row.state!=='internal_or_quarantined')fail('INTERNAL_CLASSIFICATION');
  }
  const coverage=validateOperationCoverage({manifest,registry:entries});if(coverage.unclassified.length||coverage.leaks.length)fail('COVERAGE_INVALID');
  const operations=rows.map(row=>{const op=raw.find(op=>op.operationKey===row.operationKey);return {...structuredClone(row),method:op.method,path:op.path,runtimeAllowlisted:op.runtimeAllowlisted};});
  return freezeValidation({specRef:PINNED_SHA,descriptiveOnly:true,operations,transportCapabilities:[{
    capabilityKey:'signed_report_download',rawOperation:false,liveVerified:false,
    scope:['Owned report job only; fixed official /report-download path, exact signed query, current identity, no redirects; never an extra raw operation.'],
    implementationRefs:['src/naver/searchad/transport/report-download.js','src/naver/searchad/reporting/download-adapter.js'],
    testRefs:['test/searchad-reporting-ingestion.test.js','test/postgres-searchad-report-ingestion.integration.test.js'],
    reason:'Separate internal transport capability; offline fixtures do not establish live Customer authority.'
  }]});
}
