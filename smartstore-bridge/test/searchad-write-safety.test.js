import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('write safety scan accepts raw URL rejection and still rejects raw network calls', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haar-write-safety-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ['src', 'docs', 'migrations', 'scripts']) {
    fs.cpSync(path.resolve(directory), path.join(root, directory), { recursive: true });
  }
  const scan = () => spawnSync(process.execPath, [path.join(root, 'scripts/searchad-write-safety.mjs')], { cwd: root, encoding: 'utf8' });
  const clean = scan();
  assert.equal(clean.status, 0, clean.stderr);
  const file = path.join(root, 'src/naver/searchad/write/remote-adapter.js');
  const original = fs.readFileSync(file, 'utf8');
  fs.appendFileSync(file, '\nfetch("https://unapproved.invalid");\n');
  const unsafe = scan();
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /forbidden-source-pattern/);
  fs.writeFileSync(file, original + '\nconst escaped = input.rawUrl;\n');
  const rawReference = scan();
  assert.equal(rawReference.status, 1);
  assert.match(rawReference.stderr, /rawUrl/);
});
