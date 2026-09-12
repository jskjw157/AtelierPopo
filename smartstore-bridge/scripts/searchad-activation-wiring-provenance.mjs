import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

// Only the listed integration edits may differ from the previously verified
// repaired implementation. Undoing them must reproduce the exact original blob.
// This is an audit, not a source generator: it never writes or patches files.
const guardMethod = `  async assertActivation(plan, descriptor) {
    if (typeof this.activationGuard?.assertMutationAllowed !== 'function') {
      throw new SearchAdWriteError('SEARCHAD_ACTIVATION_GUARD_NOT_READY', 'SearchAd 활성화 검증기가 준비되지 않아 변경을 차단했습니다.', { planId: plan.plan_id }, 503);
    }
    const result = await this.activationGuard.assertMutationAllowed({
      customerId: plan.customer_id,
      descriptor: structuredClone(descriptor),
      planId: plan.plan_id
    });
    if (result?.allowed !== true) {
      throw new SearchAdWriteError('SEARCHAD_ACTIVATION_REJECTED', 'SearchAd 활성화 검증기가 변경을 허용하지 않았습니다.', { planId: plan.plan_id }, 403);
    }
  }

`;
const fixtureLines = indent => `${indent}// Authorization is a fixture here; real activation is covered by PostgreSQL composition.\n${indent}activationGuard: { async assertMutationAllowed() { return { allowed: true }; } },\n`;
const cases = [
  {
    path: 'src/naver/searchad/write/execution-service.js',
    original: 'ac0afabeacdd3e4c579c10076a1e26b9bd25fe9f',
    edits: [
      ['config, activationGuard = null, clock = () => Date.now()', 'config, clock = () => Date.now()'],
      ['    this.activationGuard = activationGuard;\n', ''],
      [guardMethod, ''],
      ['    await this.assertActivation(plan, plan.mutation_json);\n', ''],
      ['    await this.assertActivation(plan, plan.rollback_json.mutation);\n', '']
    ]
  },
  {
    path: 'src/naver/searchad/write/runtime-production.js',
    original: 'c1953e87bab893dbd9c0aa22efc666a1b0a6beab',
    edits: [ ['  activationGuard = null,\n', ''], ['    activationGuard,\n', ''] ]
  },
  {
    path: 'src/http/searchad-write-runtime.js',
    original: '43d6df4da02cdc11e7e0b0a254df997fe6c61857',
    edits: [[
      '      gateway: app.searchAdGateway, env, baseDir: app.config?.workDir || process.cwd(),\n      activationGuard: app.searchAdActivationRuntime?.guard\n',
      '      gateway: app.searchAdGateway, env, baseDir: app.config?.workDir || process.cwd()\n'
    ]]
  },
  {
    path: 'test/searchad-write-execution.test.js',
    original: 'a68ee20c870e19d7ef0b76e563210ec1eb0ef406',
    edits: [[fixtureLines('    '), '']]
  },
  {
    path: 'test/postgres-searchad-write-runtime.integration.test.js',
    original: 'db170ac8100019a072fda4c6d1e312c3d96da948',
    edits: [[fixtureLines('      '), '']]
  },
  {
    path: 'test/helpers/searchad-write-http-fixture.js',
    original: 'a9623acd6d21af0bbe7a14bd922ec26bfc8ecce2',
    edits: [
      ['// Network responses and activation authorization are explicit test doubles.\n// The pinned manifest, signer, client, gateway, SQLite services and HTTP server are real.\n',
       '// Only the network boundary is fake. The pinned manifest, signer, client,\n// gateway, adapter, SQLite services and HTTP server are production classes.\n'],
      ['export async function startWriteFixture(t, { masterWrites = true, searchAdWrites = true,\n  activationGuard = { async assertMutationAllowed() { return { allowed: true }; } }\n} = {}) {',
       'export async function startWriteFixture(t, { masterWrites = true, searchAdWrites = true } = {}) {'],
      ['    searchAdActivationRuntime: { guard: activationGuard },\n', '']
    ]
  }
];

function blobHash(text) {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
for (const entry of cases) {
  const actual = fs.readFileSync(new URL(`../${entry.path}`, import.meta.url), 'utf8');
  let restored = actual;
  for (const [addition, original] of entry.edits) {
    assert.equal(restored.split(addition).length, 2, `Expected exactly one documented edit in ${entry.path}`);
    restored = restored.replace(addition, original);
  }
  assert.equal(blobHash(restored), entry.original, `Unrecorded source or regression-test change: ${entry.path}`);
  console.log(`Verified additive wiring: ${entry.path} ${blobHash(actual)} -> ${entry.original}`);
}
console.log(JSON.stringify({ ok: true, auditedFiles: cases.length, productionFiles: 3, existingTestFixtures: 3, sourceWrites: 0 }));
