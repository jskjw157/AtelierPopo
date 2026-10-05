import fs from 'node:fs';
import path from 'node:path';
import { loadValidationRegistry, validateOperationCoverage, VALIDATION_STATES } from '../src/naver/searchad/validation/registry.js';
const args=process.argv.slice(2);
if(args.length && (args.length!==2||args[0]!=='--root'))throw new Error('Usage: searchad-validation-coverage.mjs [--root directory]');
const root=path.resolve(args[1]||process.cwd());
try {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'specs/naver-searchad/current.json')));
  const entries=JSON.parse(fs.readFileSync(path.join(root,'specs/naver-searchad/validation-registry.json')));
  const registry=loadValidationRegistry({manifest,entries});
  const coverage=validateOperationCoverage({manifest,registry});
  const references=[...registry.operations,...registry.transportCapabilities].flatMap(row=>[...row.implementationRefs,...row.testRefs]);
  const missingReferences=[...new Set(references)].filter(ref=>!fs.existsSync(path.join(root,ref)));
  const result={ok:!coverage.unclassified.length&&!coverage.leaks.length&&!missingReferences.length,...coverage,specRef:registry.specRef,descriptiveOnly:true,runtimeAllowlisted:manifest.operations.filter(row=>row.runtimeAllowlisted).length,states:Object.fromEntries(VALIDATION_STATES.map(state=>[state,registry.operations.filter(row=>row.state===state).length])),liveVerified:registry.operations.filter(row=>row.liveVerified).length,transportCapabilities:registry.transportCapabilities.map(row=>row.capabilityKey),missingReferences};
  console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
} catch(error) {
  console.log(JSON.stringify({ok:false,code:/^SEARCHAD_VALIDATION_[A-Z_]+$/.test(error.code||'')?error.code:'SEARCHAD_VALIDATION_INPUT_INVALID'}));process.exitCode=1;
}
