# SearchAd 0009 Recovery — source inventory and B1 verification

## Decision and verification boundary

Current issue #26 remains OPEN. A source inventory/scope partition and B1 pure validators/descriptor recipes are complete within the boundaries below. B2 PostgreSQL hierarchy/orchestration and C/D/E approved lifecycle execution/application HTTP are not restored or verified. Migration head remains **0008**. This is not a complete security audit, independent reviewer approval or live capability validation.

- Repository/application: `jskjw157/AtelierPopo` / `smartstore-bridge`.
- Branch: `codex/searchad-original-recovery-20260912`; Draft PR #24; Master #23.
- Protected base: `0adbd11359440efe43fd07c279bd01a4d8914568`.
- Completed 0008 starting checkpoint: `5a5ae1c713bfc8343be774635a8d63532030db55`, implementation `9a0b0c8a20154258b6d71369ae63cd8214cb2e8a`.
- Historical comparison: `9cf5cf2913a4b8b182e2bef3e4c2676278a58918...1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`. GitHub reports 53 commits. Historical #17 completion does not establish current recovery completion.
- **Verified B1 code/test/workflow SHA: `0fe2bd013e99c29a7469b5471368847d5084d012`.**
- **[GREEN CI 34670962167](https://github.com/jskjw157/AtelierPopo/actions/runs/34670962167), job `103492109034`, completed/success; full job logs read. Full regression 311/0/0.**

The final documentation-only successor and its CI are recorded separately in #26/PR24. Publishing this report itself is not proof that a successor CI passed.

## A — historical change inventory and integration decisions

The per-file comparison and historical implementation plan were read. The four selected source modules and two original test files were read in full. Migration0009, historical lifecycle runtime and activation service were also inspected; selected hierarchy orchestration and old/current execution sections were compared. Remaining service and HTTP behavior needs its own deeper review in B2–E. Inventory completion does not mean every future component has already passed review.

Paths in the following tables are relative to `smartstore-bridge/` unless stated otherwise.

| Historical change group | Current recovery decision |
| --- | --- |
| `lifecycle/operations.js`, `hierarchy-validator.js`, `recipe-campaign.js`, `recipe-hierarchy.js` | Restore exact historical blobs as pure modules in B1, using current local registry contracts. No runtime registration. Full paths and hashes below. |
| `lifecycle/postgres-repository.js`, `risk-service.js`, `hierarchy-canary-service.js` | Defer to B2: review dependencies, restore isolated storage/orchestration contracts with actual PostgreSQL and fail-closed dispatch. Not imported in B1. |
| `lifecycle/activation-guard.js`, `ownership-guard.js`, `runtime-production.js`, `bootstrap.js` | Defer to C–E: review scope, ownership, runtime wiring and current awaited execution compatibility. Not imported. |
| `migrations/postgres/0009_searchad_hierarchy_lifecycle.sql` | Read but do not install in B1. Add only after isolated migration/schema tests; never edit0001–0008 to make it pass. |
| `src/http/routes-searchad-lifecycle.js`, `openapi-searchad-lifecycle.js` | Defer to actual role/Customer/application integration. Recipe tests do not authorize adding working endpoints. |
| Historical hierarchy validator/recipe tests | Restore the two exact original test blobs; keep all existing0008 tests unchanged. |
| Other historical hierarchy children/orchestration, activation, ownership, approval-dispatch, risk, PostgreSQL and HTTP tests | Defer alongside the corresponding component. Do not count their old results as current verification. |
| Historical changes to `test/searchad-activation-service.test.js`, `test/searchad-production-bootstrap.test.js` | Do not replace existing tests in B1. Any later adaptation must preserve old assertions and show its diff/reason. |
| Root `.github/workflows/searchad-contract-ci.yml` | Do not import the old branch workflow. Extend the current `searchad-write-ci.yml` without dropping existing checks. |
| Historical spec/implementation-plan documents | References, not code provenance or proof of deployment; the current recovery plan controls the incremental port. |

### Existing production files: six explicit decisions

| Historical modified path | Decision / required future evidence |
| --- | --- |
| `src/naver/searchad/write/execution-service.js` | **Never copy wholesale.** Inspected historical execute uses synchronous plan/token access; current repaired implementation awaits PostgreSQL-compatible contracts. Later ownership/lifecycle additions must preserve awaited authorization, token use, lock/finally release, drift, unknown outcome, rollback and read-only reconcile. |
| `src/naver/searchad/write/runtime-production.js` | Preserve current async service composition. Add only reviewed dependencies later, with real PG execution tests. A historical runtime factory is not a safe replacement. |
| `src/naver/searchad/activation/activation-service.js` | Defer historical lifecycle evidence extensions. Existing update-only/passive restrictions must remain; require exact Customer/operation/lifecycle scope regression tests before modifying. |
| `src/naver/searchad/activation/postgres-repository.js` | Defer historical storage extensions pending schema/repository review, immutable evidence/grant contracts and restart tests. Do not replace the current repository merely to satisfy an old caller. |
| `src/bootstrap-v05.js` | Preserve actual0008 CapabilityService/activation startup and fail-closed behavior. Later lifecycle bootstrap must show dependency ordering, no automatic migration and owned resource closure. |
| `src/http/server-v05.js` | Preserve role/Customer authorization, awaited reads/approvals, public readiness and coordinated close. Later lifecycle routes require direct actual HTTP/PG tests, not inferred composition. |

All six files are unchanged in B1. The selected descriptor modules are not imported into any existing production execution path in this increment.

## B1 — exact historical provenance

These six existing Git blobs from historical commit `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae` were referenced directly in the new tree. CI independently ran `git hash-object` against their checked-out bytes.

| Path | Verified historical blob SHA |
| --- | --- |
| `src/naver/searchad/lifecycle/operations.js` | `77ce4a3e3c4e02abb868f1c887ee8a952ca6b7ec` |
| `src/naver/searchad/lifecycle/hierarchy-validator.js` | `bfaabbb7fb25a1396273e176a80882124a3acfb3` |
| `src/naver/searchad/lifecycle/recipe-campaign.js` | `96bf88b605d1c0c537350e510c5f578361f5c4f8` |
| `src/naver/searchad/lifecycle/recipe-hierarchy.js` | `5fef7015926e3ba04bf9e9c2996fc4e41b704e02` |
| `test/searchad-hierarchy-validator.test.js` | `1a5248d57ce8838bdafbaefd2b635d93836c67ed` |
| `test/searchad-hierarchy-recipes.test.js` | `b0e956601c330ef61bb797155fe7aeb5cd56a798` |

New `test/searchad-hierarchy-recovery.test.js` is current recovery code, not a historical original. The current plan and workflow changes are also new and are not labelled historical blobs.

## Actual tested contracts

The original two test files contain12 tests; the new recovery file adds6. All18 are pure module/descriptor tests, not newly added PG or role HTTP tests.

- All12 frozen create/read/delete operation keys resolve in the current checked-in registry with expected method, runtime allowlist/state and side-effect classification. This is not a claim about current live Naver support.
- Recursive existing-target ID injection is rejected in nested objects and arrays; Customer/run/type/ownership-state mismatches fail validation.
- Campaign descriptors use server-derived stopped `WEB_SITE` settings. Default write/create/delete/batch/ActiveCanary gates remain false, observe mode unchanged.
- The actual graph is **campaign -> adgroup**, with **keyword and creative as separate adgroup children**. Keyword is not the creative's parent.
- Keyword batch bounds include empty/100/101 and the configured maximum100. Unsupported creative type fails the `TEXT_45` type contract.
- Read/delete descriptors retain their stored object's Customer/run/type/state and response-returned ID. Missing or conflicting returned IDs are rejected in the tested response shapes.

Every new recovery test installs a failing `globalThis.fetch` mock and asserts zero calls. No real Naver request is issued. The ownership-looking parent/object records are explicit fixtures: passing a plain record to a builder does not establish actual database ownership. Stopped-parent validation is not proof that a live parent was read or held stopped across dispatch.

Further service-facing ID type validation, duplicate or partial batch response handling, database ownership acquisition and stale remote state must be reviewed/tested before wiring real lifecycle execution. B1 does not claim exhaustive malformed-response coverage or token/risk/dispatch atomicity.

## Observed RED -> GREEN

| Checkpoint | Run / job | Actual outcome |
| --- | --- | --- |
| `a226d15a90d343c6214a7bb49db082d7651aca80` | [34670682168](https://github.com/jskjw157/AtelierPopo/actions/runs/34670682168) / `103491332326` | Full299: previous293 pass, six new explicit missing-module assertions fail, skip0. No production source changed. |
| **`0fe2bd013e99c29a7469b5471368847d5084d012`** | **[34670962167](https://github.com/jskjw157/AtelierPopo/actions/runs/34670962167) / `103492109034`** | **All configured steps completed/success. Full311/0/0.** |

| GREEN check | pass / fail / skip |
| --- | --- |
| Canary/Gateway/Canary role HTTP |51/0/0|
| Activation core/Customer |30/0/0|
| Hierarchy validator/recipes/recovery |**18/0/0**|
| Existing write focused |49/0/0|
| Existing role HTTP/readiness/runtime lifecycle |14/0/0|
| Required PostgreSQL |36/0/0|
| Repeated Canary/activation/application PostgreSQL |31/0/0|
| Full regression |**311/0/0**|

Focused/repeated suites overlap the full total. The293->311 increase is18 leaf tests (12 restored +6 new), not18 new execution capabilities. The unchanged36/31 PG totals verify prior0008 regression, not new0009 storage/execution.

Static/syntax checks, prior24 historical hashes, five25-D/E integration hashes, seven reverse-edit checks (sourceWrites0), new sixB1 hash pins and exact prior-checkpoint preservation all passed. Existing write scanner reports16 source files/rawnetwork0; it is not a whole-lifecycle security scanner. Bundled coverage remains Commerce116, SearchAd126unique/117allowlisted/no internal-deprecated runtime leaks. Both migration reruns report0008/applied:[]. Bridge production dependency audit reports0 vulnerabilities; root dependencies were not audited. SQLite experimental and Actions Node warnings remain.

## Complete increment and CI protection

Comparison `5a5ae1c...0fe2bd0` contains four new pure source files, three new test files, one current plan and a40-line additive workflow change. No existing production file, existing test assertion, dependency/lockfile, gate/config or migration changed.

The workflow keeps all prior checks and adds four exact source-path exclusions, not a lifecycle-directory wildcard. It separately pins all six historical B1 blobs. A second protected diff against `5a5ae1c...` covers root/app package files, all existing app source, migrations and tests, excluding only the selected four sources/three tests. Subsequent B2 work must update this narrowly and explicitly, never simply disable the protection.

## Next — B2, then C/D/E/F

Restore/review hierarchy PostgreSQL schema/repository and orchestration dependencies using fresh UUID schemas, real migrations, restart and repeated-run checks. Then adapt lifecycle activation/ownership, approval token + risk + dispatch intent atomicity, shared daily capacity and actual role HTTP/application integration on the current async implementation. Keep parent-child/returned-ID cleanup and no-blind-retry contracts. Do not close #26 until every acceptance condition is proven on a current SHA.

Independent review and post-guard concurrent suspend atomicity remain separate #21 readiness work. Public readiness is an initialized infrastructure projection, not per-account mutation permission or a live DB probe. No real Naver request/ad change, operational gate change, production migration, deployment, main change or PR merge occurred.

Prior complete0008 evidence: [fixed dashboard at5a5ae1c](https://github.com/jskjw157/AtelierPopo/blob/5a5ae1c713bfc8343be774635a8d63532030db55/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md) and closed #25. Later #18 reporting/Circuit/automation, #19 worker/scheduler/operation validation through0019, #20 profitability/Auto, #21 readiness and separately authorized#22 deployment/live activation remain pending.
