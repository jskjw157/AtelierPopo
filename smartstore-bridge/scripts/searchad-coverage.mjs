#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'specs/naver-searchad/current.json');
const coveragePath = path.join(root, 'specs/naver-searchad/coverage.json');
if (!fs.existsSync(manifestPath) || !fs.existsSync(coveragePath)) {
  console.error(JSON.stringify({ ok: false, code: 'SEARCHAD_SPEC_NOT_SYNCED', message: 'Run npm run searchad:spec:sync first.' }, null, 2));
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const keys = manifest.operations.map(item => item.operationKey);
const unique = new Set(keys);
const leaks = manifest.operations.filter(item => ['internal_quarantined', 'deprecated'].includes(item.state) && item.runtimeAllowlisted);
const result = {
  ok: Boolean(coverage.ok) && manifest.sources?.length === 9 && manifest.operations.length > 0 && unique.size === keys.length && leaks.length === 0,
  specRef: manifest.specRef,
  sourceCount: manifest.sources?.length || 0,
  rawOperations: manifest.operations.length,
  uniqueOperations: unique.size,
  runtimeAllowlisted: manifest.operations.filter(item => item.runtimeAllowlisted).length,
  internalOrDeprecatedRuntimeLeaks: leaks.map(item => item.operationKey),
  counts: manifest.counts
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
