#!/usr/bin/env node
import { loadCommerceManifest } from '../src/naver/commerce/spec.js';

const manifest = loadCommerceManifest(process.env.NAVER_COMMERCE_MANIFEST_PATH || './specs/naver-commerce/current.json');
const expected = Number(process.env.NAVER_COMMERCE_EXPECTED_OPERATIONS || 116);
const classified = manifest.operations.filter(item => item.status).length;
const unique = new Set(manifest.operations.map(item => item.operationId)).size;
const internal = manifest.operations.filter(item => item.internal).length;
const read = manifest.operations.filter(item => item.readOnly && !item.internal).length;
const write = manifest.operations.filter(item => item.sideEffect).length;
const report = {
  ok: manifest.operations.length === expected && classified === expected && unique === expected,
  expected,
  actual: manifest.operations.length,
  classified,
  unique,
  internal,
  read,
  write,
  domains: manifest.domains
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
