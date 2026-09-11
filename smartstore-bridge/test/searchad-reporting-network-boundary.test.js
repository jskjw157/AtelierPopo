import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const reportingDir = path.resolve('src/naver/searchad/reporting');

async function jsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await jsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files.sort();
}

test('SearchAd reporting source has no direct network client outside the shared SearchAd client abstraction', async () => {
  const forbidden = [
    { label: 'global fetch', pattern: /\bglobalThis\.fetch\b/ },
    { label: 'direct fetch call', pattern: /(^|[^.\w])fetch\s*\(/m },
    { label: 'node:http', pattern: /from\s+['"]node:http(?:s)?['"]/ },
    { label: 'http package', pattern: /from\s+['"]http(?:s)?['"]/ },
    { label: 'axios', pattern: /\baxios\b/ }
  ];
  const violations = [];
  for (const file of await jsFiles(reportingDir)) {
    const source = await fs.readFile(file, 'utf8');
    for (const rule of forbidden) {
      if (rule.pattern.test(source)) violations.push(`${path.relative(process.cwd(), file)}: ${rule.label}`);
    }
  }
  assert.deepEqual(violations, []);
});
