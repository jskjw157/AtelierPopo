# SearchAd original-source recovery — Stage 0007 core

Date: 2026-09-12 (Asia/Seoul)
Status: source-only Active Canary core restored and CI verified; not deployed and not live-ready.

## Scope and fixed references

- Preserved baseline branch: `codex/searchad-recovery-2026-09-11`.
- Preserved baseline commit: `0adbd11359440efe43fd07c279bd01a4d8914568`.
- Isolated recovery branch: `codex/searchad-original-recovery-20260912`.
- Historical Stage 0007 source: `29fa2214ba8cd62edb0ba92d23c1b3d1a1303ef6`.
- Later historical source for subsequent recovery: `f20111858c3b52bae2c7249702a73b998a6eed37` on `codex/searchad-active-canary-20260910`.
- Verified code/CI checkpoint: `39f9c2bbfcc42fa429cb2c2728fbb9c6f4116310`.

This stage copies original Git blobs rather than rewriting the subsystem from summaries. It does not import the historical write subsystem wholesale. Existing production sources outside the new Canary directory, root and bridge package files, and PostgreSQL migrations 0001–0006 remain identical to the baseline. This preserves the baseline asynchronous PostgreSQL write runtime and existing dependency/security fixes.

## Exact original production blobs

Paths below are relative to `smartstore-bridge/`.

| Path | Original and restored Git blob SHA |
| --- | --- |
| `src/naver/searchad/canary/active-canary-service.js` | `3ff900a18b25e1bd411c87d36e6409ca50503a23` |
| `src/naver/searchad/canary/bootstrap.js` | `5bf189eceb22fb7bcc2f58ba78606788f3346bd0` |
| `src/naver/searchad/canary/config.js` | `ff20a7acf03be04b9187f180a04ae68d47ed46d1` |
| `src/naver/searchad/canary/credential-fingerprint.js` | `0d8e052bffc3c54fd1400b3ad5c720520cefd4f5` |
| `src/naver/searchad/canary/postgres-repository.js` | `db598e85224e3634cbcc992d730f9a5da66c1658` |
| `src/naver/searchad/canary/production-recipe.js` | `8660411a9a24f60bbd110704987242e65e7bec6d` |
| `src/naver/searchad/canary/remote-adapter.js` | `b1e4f6face0ecc8fece48779bb70fb354f64f710` |
| `src/naver/searchad/canary/runtime-production.js` | `6233bd56e73d84820bbebba8d561fab4013edfaa` |
| `migrations/postgres/0007_searchad_active_canary.sql` | `56a7856e067a5ec2e665da7ba06f0ac052f86177` |

CI compares these nine hashes directly with `git hash-object`. It also checks the protected baseline paths with `git diff --exit-code`. These checks passed at the verified checkpoint.

## Tests restored and compatibility changes

Five unit-test files were restored unchanged from the historical source:

- `test/searchad-active-canary-bootstrap.test.js`
- `test/searchad-active-canary-production-recipe.test.js`
- `test/searchad-active-canary-recovery.test.js`
- `test/searchad-active-canary-runtime.test.js`
- `test/searchad-active-canary-service.test.js`

The sixth original file, `test/postgres-searchad-active-canary.integration.test.js`, was first restored unchanged, then adapted for repeated execution against the same CI database. The original fixed `passive-pg` evidence ID collided when the direct PostgreSQL suite was followed by the full suite. Each invocation now uses a UUID-scoped Customer and evidence ID. The duplicate-active-run, immutable-evidence/event, restart-safety, and migration assertions are retained. No immutable records are deleted to make tests pass; no production constraint or source is weakened. Adapted test blob: `9769ffa3a63f118db3204a707efef0dc40918d57`.

Two baseline tests were updated for the new exact migration head:

- `test/postgres-migrator.test.js`: ordered list through 0007 and exact final filename.
- `test/postgres-searchad-write.integration.test.js`: currentVersion 0006 → 0007; existing plan/token constraints retained.

## Actual execution evidence

These results are from GitHub Actions using an ephemeral PostgreSQL 16 service and Node.js 22, not a production database or live Naver account.

| Checkpoint | Commit | Actions run | Result |
| --- | --- | --- | --- |
| Isolated baseline | `2e3a91797c651e86b6472174dd08413399db895c` | [34654383784](https://github.com/jskjw157/AtelierPopo/actions/runs/34654383784) | All configured checks passed |
| Original tests before source restoration | `acefa68f41e20efde470e019969d73ca816905ff` | [34654650784](https://github.com/jskjw157/AtelierPopo/actions/runs/34654650784) | Expected RED: missing Canary repository module |
| Original sources plus migration-head expectations | `8d4287083a4268c49a7c55094a6da976cdba0a2a` | [34654964803](https://github.com/jskjw157/AtelierPopo/actions/runs/34654964803) | PostgreSQL passed; full suite 189 passed / 1 failed due to fixed evidence ID reuse |
| Fixture isolation plus explicit recovery checks | `39f9c2bbfcc42fa429cb2c2728fbb9c6f4116310` | [34655158568](https://github.com/jskjw157/AtelierPopo/actions/runs/34655158568) | Completed SUCCESS |

Verified job `103445841533` for run `34655158568`:

| Verification | Observed result |
| --- | --- |
| Original blob and baseline preservation checks | Passed |
| Active Canary focused contracts | 30 passed, 0 failed, 0 skipped |
| Existing SearchAd write focused contracts | 41 passed, 0 failed, 0 skipped |
| Required PostgreSQL integration suite | 6 passed, 0 failed, 0 skipped |
| Additional repeat of Canary PostgreSQL contract | 1 passed, 0 failed, 0 skipped |
| Full regression suite | 190 passed, 0 failed, 0 skipped |
| Existing static checks and restored-source syntax | Passed |
| SearchAd write safety scan | Passed; 0 raw network calls in the write subsystem |
| Bundled Commerce operation coverage | 116 expected / 116 actual |
| Bundled SearchAd operation coverage | 126 unique; 117 runtime allowlisted; no internal/deprecated leaks |
| PostgreSQL migration reruns | Both report currentVersion 0007 and applied [] |
| Bridge production dependency audit | Found 0 vulnerabilities |

Focused and PostgreSQL tests also appear in the full suite; do not add these counts to 190. Canary's PostgreSQL contract ran directly, in the explicit repeat, and again in the full suite. Coverage numbers describe the bundled pinned manifests, not newly verified external API coverage. The dependency audit ran in `smartstore-bridge`; root dependency files were checked for preservation but the root audit was not rerun in this stage.

## Runtime boundary — important remaining work

This is a restored and tested core, not a complete runnable Active Canary release.

1. The preserved `src/naver/searchad/gateway.js` has ordinary `execute` but does not yet implement `executeCanary`. The restored enabled Canary runtime requires `executeCanary`; current unit runtime/adapter contracts use test doubles. Its fail-closed behavior is tested, but real-gateway Canary execution is not integrated or verified.
2. Application-level bootstrap, Canary HTTP routes, and role authentication integration have not been restored in this stage. The restored `canary/bootstrap.js` file alone does not mean the application calls it.
3. No live Active Canary run, live spend observation, deployment, production migration, advertising gate enablement, or merge into baseline/main occurred. A CI PASS is not live Naver verification evidence.
4. Access/Activation Control (0008), Hierarchy/Lifecycle (0009), and Reporting Evidence (0010) have not been imported into this recovery branch.

The next recovery unit must inspect and restore the original internal Canary gateway boundary and its actual-gateway tests, then restore access/HTTP/application wiring while preserving the existing async write runtime. Continue with 0008–0010 in separately verified units. Any necessary changes to protected baseline paths or original blobs must be explicit, reviewed compatibility changes with updated provenance and regression tests, not silent relaxation of the preservation checks.
