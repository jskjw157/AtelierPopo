import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselines = {
  'test/postgres-searchad-active-canary.integration.test.js': { hash: '0b1bec1ff4cad177b387f157695e1b40395be149', results: ['first'] },
  'test/postgres-searchad-activation.integration.test.js': { hash: '6b74b24b51f0527c9bf8acf9438ae1d8a5de81c1', results: ['first'] },
  'test/postgres-searchad-write.integration.test.js': { hash: '4f9ab71436678bde4f3aea7694655bb822ddaf32', results: ['first', 'second'] }
};
function blobHash(text) {
  const data = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}
let allowedVersionChanges = 0;
for (const [file, { hash, results }] of Object.entries(baselines)) {
  let reversed = fs.readFileSync(path.join(root, file), 'utf8');
  for (const result of results) {
    const oldLine = `assert.equal(${result}.currentVersion, '0008');`;
    const newLine = `assert.equal(${result}.currentVersion, '0009');`;
    assert.equal(reversed.split(newLine).length - 1, 1, `Exactly one ${result} 0009 head expectation is required: ${file}`);
    reversed = reversed.replace(newLine, oldLine);
    allowedVersionChanges += 1;
  }
  assert.equal(blobHash(reversed), hash, `Only the recorded head expectations may change: ${file}`);
  console.log(`Verified unchanged existing assertions except 0008->0009 head: ${file}`);
}
console.log(JSON.stringify({ ok: true, existingTestsChecked: Object.keys(baselines).length, allowedVersionChanges, sourceWrites: 0 }));
