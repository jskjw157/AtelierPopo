# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**현재 이슈: [#25 — 0008 Activation Control 복구](https://github.com/jskjw157/AtelierPopo/issues/25). 상태: CORE_VERIFIED / WIRING_PENDING. 이슈는 OPEN이다.**

**첫 미완료 작업은 #25-C: 현재 repaired async write 실행 경로에 activation guard를 연결하고, 승인 토큰 소비 전에 검증하도록 회귀 테스트를 추가하는 것이다. 아직 0009로 넘어가지 않는다.**

| 기준 | 값 |
| --- | --- |
| Master roadmap | [#23](https://github.com/jskjw157/AtelierPopo/issues/23) |
| Current work issue | [#25](https://github.com/jskjw157/AtelierPopo/issues/25) |
| Draft recovery PR | [#24](https://github.com/jskjw157/AtelierPopo/pull/24) |
| Working branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `0adbd11359440efe43fd07c279bd01a4d8914568` on `codex/searchad-recovery-2026-09-11` |
| Verified code/test checkpoint | `c3397b64f3dfa42e7b02912b4121a3fddced5c97` |
| Completed GREEN CI | [Run 34662636388](https://github.com/jskjw157/AtelierPopo/actions/runs/34662636388), job `103468121432` |
| Full regression | **244 passed, 0 failed, 0 skipped** |
| Migration head in CI | `0008` |
| Earlier 0007 handoff | [SEARCHAD_RECOVERY_STATUS_20260912.md](SEARCHAD_RECOVERY_STATUS_20260912.md), historical record, not current 0008 status |

This is a repository Markdown dashboard linked to GitHub issues and PRs; it does not claim a GitHub Projects board was created or updated. The checkpoint above is the verified code/test commit. This dashboard is a subsequent documentation-only update, whose CI is tracked on PR #24.

## Sequential work board

| Order | Scope | Current recovery state | Issue |
| --- | --- | --- | --- |
| 1 | 0007 Canary core / dedicated Gateway / role HTTP / application bootstrap | VERIFIED, unmerged and undeployed | #24, historical #12–#15 |
| 2A | 0008 activation core / schema / contracts / PostgreSQL service composition | **VERIFIED** at `c3397b6` | #25-A/B, original #16 |
| 2B | 0008 repaired async write guard / role HTTP / application integration | **NEXT — PENDING** | #25-C/D/E/F |
| 3 | 0009 hierarchy / lifecycle | PENDING — only after #25 completion | original #17 |
| 4 | 0010 reporting and later Circuit / automation | PENDING | #18 |
| 5 | Durable worker / scheduler / operation validation | PENDING | #19 |
| 6 | Profitability / recommendation / limited Auto | PENDING | #20 |
| 7 | Full integrated regression / PostgreSQL / safety / migration readiness | PENDING | #21 |
| 8 | PR integration / deployment / real-account verification and activation | NOT STARTED — separate authorization required | #22 |

Prior closed issues describe the previous branch, not automatic completion on this repaired recovery branch. The overall target includes later 0019 functionality and #20–#22; migration counts and historical test counts do not provide a completion percentage.

## What was recovered for 0008

Original 0008 source is pinned to `9cf5cf2913a4b8b182e2bef3e4c2676278a58918`, the final historical #16 checkpoint. Later `f20111858c3b52bae2c7249702a73b998a6eed37` includes 0009/0010 changes and was not imported wholesale.

Seven activation sources, additive migration 0008, and the missing passive Customer-override protection in `capability.js` were restored as exact original Git blobs. Six original test files were restored unchanged. Two new recovery-boundary tests and one real PostgreSQL runtime composition test were added. Three existing migration tests changed only their expected migration head/list/latest filename to 0008; their schema, status, token, immutability, wrapper and checksum assertions remain intact.

### Exact 0008 production/schema provenance

Paths are relative to `smartstore-bridge/`. CI checks these nine hashes plus the fifteen restored 0007 production/schema hashes: **24 exact hash checks**.

| Path | Original/restored blob SHA |
| --- | --- |
| `src/naver/searchad/activation/runtime-production.js` | `83c7e6fd582d41443e461ccf9f19a28454acfc97` |
| `src/naver/searchad/activation/activation-guard.js` | `3426759e7f8cdcc6120db8751a66d3642163600d` |
| `src/naver/searchad/activation/passive-evidence-service.js` | `678e881c3b3eff8d0685248ac7c5459efe4ed137` |
| `src/naver/searchad/activation/activation-service.js` | `033bec66b8f094b7693f185f438a14658ceb1b4e` |
| `src/naver/searchad/activation/postgres-repository.js` | `493c7a9650702b08258e5901be579d7abd157bdd` |
| `src/naver/searchad/activation/account-control-service.js` | `68c04a934b34321fc2870b44373549297c5ac75a` |
| `src/naver/searchad/activation/bootstrap.js` | `d35a6cd57b0a35d7c81a751425c5641dacacdbc0` |
| `migrations/postgres/0008_searchad_activation_control.sql` | `f612606526a55b12e09a62e16e2eeee4f433296e` |
| `src/naver/searchad/capability.js` | `647b2e75c60613a723cc51cfa3be9d404ad6269b` |

**The repaired async write subsystem and its HTTP runtime were not replaced or modified in this increment.** Package/lock files, migrations 0001–0007, and recovered 0007 application/HTTP wiring remain preserved. Original provenance does not itself prove full correctness or live-account capability.

## Actual verification at c3397b6

| Check | Observed result |
| --- | --- |
| Canary / Gateway / HTTP focused | 51 passed, 0 failed, 0 skipped |
| 0008 activation / Customer-boundary focused | 30 passed, 0 failed, 0 skipped |
| Existing write focused | 41 passed, 0 failed, 0 skipped |
| Required PostgreSQL suite | 9 passed, 0 failed, 0 skipped |
| Repeated Canary + activation PostgreSQL contracts | 4 passed, 0 failed, 0 skipped |
| Full regression suite | **244 passed, 0 failed, 0 skipped** |
| Source hashes / protected baseline | 24 hashes matched; preservation passed |
| Syntax/static checks | Passed |
| Existing write safety scanner | Passed; zero raw network calls in its 16-file write-subsystem scan |
| Bundled Commerce manifest coverage | 116 operations |
| Bundled SearchAd manifest coverage | 126 unique, 117 allowlisted, no internal/deprecated runtime leaks |
| Migration reruns | Both report `currentVersion: 0008`, `applied: []` |
| Bridge production dependency audit | 0 vulnerabilities reported |

Counts overlap; focused/repeated tests are included in the full suite and are not added to 244. This increment adds 32 tests relative to the prior 212-test checkpoint. Manifest coverage is not live API validation. The existing write safety scanner has not yet been expanded to claim complete activation-subsystem coverage. Dependency audit scope is `smartstore-bridge`, not the preserved root project.

### Test boundaries

New `test/postgres-searchad-activation-runtime.integration.test.js` composes real PostgreSQL, migrations, pinned registry, credentials, signing client, Gateway, Passive issuer, activation service, guard and account-control service. **Only upstream GET responses are simulated.**

It verifies server-selected Passive requests, durable actor/request-ID evidence, Admin-only idempotent activation, rejection of Passive-backed writes, operation/field restrictions, suspension surviving runtime reconstruction through a separate PostgreSQL connection, resume, expiry, credential rotation, and unchanged global mutation/Canary gates.

Synthetic Active Canary evidence is inserted only into the isolated CI database to exercise guard behavior. It is not evidence from a live Canary and must never be promoted or used in production. The existing 0007 composition test separately exercises simulated stopped-campaign mutation and cleanup; its result remains `spend_check_pending`, not live activation.

**Not yet verified here:** application bootstrap → role HTTP → repaired async executor → activation guard → one-time token → mutation in one composed request. This is remaining #25-C/D/E work, not a passed test.

## Observed RED → GREEN history

| Commit | CI run / job | Observed result |
| --- | --- | --- |
| `590576aabdeaa47856507e5f38879dfd4f0fc129` | `34661830314` / `103465755636` | 212 passed, 2 failed: missing 0008 sources and missing pre-I/O Customer-override rejection |
| `d284d9938f9125fb8d5d59701091977c0911d528` | `34662221067` / `103466900692` | Activation contracts passed; old write schema test expected 0007 instead of 0008 |
| `f2ad1835e207f47bca822eac3e515fef146505fd` | `34662452177` / `103467579372` | Required/repeated PG suites passed; full 243 passed, 1 failed on old ordered migration inventory |
| `c3397b64f3dfa42e7b02912b4121a3fddced5c97` | `34662636388` / `103468121432` | All configured checks passed; full **244/0/0** |

## Next unit — #25-C, then D/E/F

1. Read current async executor/rollback/runtime and original #16 integration contracts before changing code. Do not copy the historical synchronous write directory over the repaired PostgreSQL implementation.
2. Add a failing composition test showing absent, expired, mismatched or suspended activation is rejected **before token consumption and remote mutation**. Revalidate execution and rollback without weakening one-time-token, drift, reconcile or no-blind-retry behavior.
3. Wire the guard incrementally into the current async path. Then restore role/Customer HTTP, application bootstrap, readiness and shutdown integration. Any provenance-protected file changed for integration needs an explicit diff and fresh tests.
4. Run combined real PostgreSQL + HTTP + current async execution regression and full CI. Update #25, this dashboard, #23 and #24 with the verified SHA. Close #25 only after all its acceptance conditions pass; then proceed to 0009.

## Operating rules

One incomplete stage at a time: issue contract → observed RED → minimal implementation → GREEN → record exact CI SHA → synchronize issue/dashboard/PR. Core-only success stays CORE_VERIFIED / WIRING_PENDING; historical closed issues and unpublished local checkpoints do not override current evidence.

No merge, main change, Hostinger deployment, production migration, real SearchAd request, advertising mutation, or operational gate enablement occurred in this recovery increment. Live effects remain a separate authorized stage.
