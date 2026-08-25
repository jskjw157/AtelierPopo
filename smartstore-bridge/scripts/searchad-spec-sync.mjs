#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncPinnedSearchAdSpec } from '../src/naver/searchad/spec-sync.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const result = await syncPinnedSearchAdSpec({
  sourceManifestPath: path.join(root, 'specs/naver-searchad/source-manifest.json'),
  correctionsPath: path.join(root, 'specs/naver-searchad/corrections/compiled.json'),
  outputRoot: path.join(root, 'specs/naver-searchad')
});
console.log(JSON.stringify({ ok: result.coverage.ok, coverage: result.coverage }, null, 2));
if (!result.coverage.ok) process.exitCode = 1;
