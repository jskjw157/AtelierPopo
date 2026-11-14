#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [path.join(root, 'src'), path.join(root, 'scripts')];

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = targets.flatMap(collectJavaScriptFiles).sort();
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`Syntax check failed: ${path.relative(root, file)}`);
  }
}

console.log(`Checked ${files.length} JavaScript files (${failed} failed).`);

if (failed > 0) {
  process.exitCode = 1;
}
