import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd());
const required = [
  'src/naver/searchad/write/errors.js',
  'src/naver/searchad/write/canonical.js',
  'src/naver/searchad/write/config.js',
  'src/naver/searchad/write/redaction.js',
  'src/naver/searchad/write/remote-adapter.js',
  'src/naver/searchad/write/safe-remote-adapter.js',
  'src/naver/searchad/write/repository.js',
  'src/naver/searchad/write/plan-service.js',
  'src/naver/searchad/write/approval-service.js',
  'src/naver/searchad/write/execution-service.js',
  'src/naver/searchad/write/safe-execution-service.js',
  'src/naver/searchad/write/production-execution-service.js',
  'src/naver/searchad/write/runtime-production.js',
  'src/http/routes-searchad-write-v3.js',
  'src/http/searchad-write-runtime.js',
  'src/http/openapi-searchad-write.js',
  'migrations/postgres/0006_searchad_write_execution.sql',
  'docs/NAVER_SEARCHAD_WRITE_ACTIVATION_POLICY.md',
  'docs/NAVER_SEARCHAD_WRITE_EXECUTION_V0.7.0.md',
  'docs/HAAR_REAL_ACCOUNT_ACTIVATION_RUNBOOK.md'
];

const failures = [];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing:${relative}`);
}

const sourceDir = path.join(root, 'src/naver/searchad/write');
const sourceFiles = fs.existsSync(sourceDir)
  ? fs.readdirSync(sourceDir).filter(name => name.endsWith('.js')).map(name => path.join(sourceDir, name))
  : [];
const source = sourceFiles.map(file => {
  const text = fs.readFileSync(file, 'utf8');
  // This exact declaration denies raw requests; it is not a raw URL call site.
  return path.basename(file) === 'plan-service.js'
    ? text.replace("for (const forbidden of ['url', 'rawUrl', 'method', 'path', 'uri'])", '')
    : text;
}).join('\n');

for (const pattern of [
  /fetch\s*\(/,
  /axios\s*\(/,
  /https:\/\/api\.searchad\.naver\.com/,
  /rawUrl/,
  /arbitraryUrl/,
  /syncNaverToCafe24/,
  /syncCafe24ToNaver/
]) {
  if (pattern.test(source)) failures.push(`forbidden-source-pattern:${pattern}`);
}

const planSource = fs.readFileSync(path.join(root, 'src/naver/searchad/write/plan-service.js'), 'utf8');
const executeSource = fs.readFileSync(path.join(root, 'src/naver/searchad/write/execution-service.js'), 'utf8');
const productionSource = fs.readFileSync(path.join(root, 'src/naver/searchad/write/production-execution-service.js'), 'utf8');
const approvalSource = fs.readFileSync(path.join(root, 'src/naver/searchad/write/approval-service.js'), 'utf8');
const policy = fs.readFileSync(path.join(root, 'docs/NAVER_SEARCHAD_WRITE_ACTIVATION_POLICY.md'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/http/server-v05.js'), 'utf8');

const requiredEvidence = [
  [planSource, 'before_hash'],
  [planSource, 'SEARCHAD_RAW_REQUEST_FORBIDDEN'],
  [executeSource, 'SEARCHAD_STALE_PLAN'],
  [executeSource, 'SEARCHAD_UNKNOWN_OUTCOME'],
  [executeSource, 'SEARCHAD_ROLLBACK_DRIFT'],
  [executeSource, 'this.approvalService.claim'],
  [productionSource, 'rollback_unknown_outcome'],
  [approvalSource, 'APPROVE_SEARCHAD_CHANGE'],
  [approvalSource, 'token_hash'],
  [policy, '전체 구현 및 운영 활성화'],
  [policy, '검증 전 임시 게이트'],
  [policy, '영구적인 쓰기 금지 정책은 없다'],
  [server, 'createSearchAdWriteRoutesV3'],
  [server, 'app.searchAdWriteRuntime']
];
for (const [text, needle] of requiredEvidence) {
  if (!text.includes(needle)) failures.push(`missing-evidence:${needle}`);
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  scope: 'legacy_narrow_write_directory_only',
  expandedScanner: 'scripts/searchad-execution-safety.mjs',
  staticCheckOnly: true,
  requiredFiles: required.length,
  sourceFiles: sourceFiles.length,
  rawNetworkCallsInWriteSubsystem: 0,
  permanentWriteProhibition: false,
  temporaryPrevalidationGate: true
}, null, 2));
