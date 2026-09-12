# SearchAd 0009 — Storage/Risk Recovery Slice B2a and B2b Handoff

> Continue with superpowers:executing-plans task by task. This supplements the main 0009 recovery plan; it does not close its overarching Task B2 or issue#26.

## Current checkpoint — 2026-09-12

**B2a VERIFIED at `5c4be3077e67bfd257ce176c3fe9727d9331a101`; next B2b.** CI34674108418/job103500743097 completed/success; full332/0/0, requiredPG53/0/0, repeatedstorage+risk21/0/0. Complete job logs and final status checked. See [the verification report](../../SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md) for exact evidence, hashes and limits.

B1 starting documentation SHA: `035098228dbabdd48669f42f36c054cc38fc68af`. Historical source: `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`. Branch `codex/searchad-original-recovery-20260912`, Draft PR24, issue26 OPEN. Protected base `0adbd11359440efe43fd07c279bd01a4d8914568`.

## Phase0 — reviewed boundary

- [x] Inventory historical schema, repository, risk service, hierarchy orchestrator and activation/write integration dependencies; retain separate exact-original versus adapted-source provenance.
- [x] Keep the old orchestrator unconnected: review found token consumption before risk/dispatch persistence and insufficient authoritative stopped-parent revalidation.
- [x] Preserve current awaited execution, existing0007/0008 services, role/Customer boundary, readiness/close, dependencies, default gates and prior migration bytes.

The review is not independent reviewer approval or a whole-system security audit. The default gate remains OFF. No production mutation/migration/deployment/merge is authorized by these checkboxes.

## B2a — completed storage slice

- [x] Add isolated real-PostgreSQL recovery contracts: one UUID schema for the parent,16 child scenarios, fetch trap and owned-resource cleanup.
- [x] Restore original0009 schema, original risk service/tests, and explicitly adapted lifecycle repository.
- [x] Test Customer/run/parent binding, durable reads after repository/connection reconstruction, immutable events and scoped lookups.
- [x] Test server-owned units/capacity/UTC date, shared storage accounting, reservation identity and concurrent bounded capacity with two PG connections.
- [x] Test persisted pending/unknown-state exclusion, reservation-to-run binding, one-winner dispatch/cleanup claims, and release restricted to eligible pre-dispatch dry runs.
- [x] Test child-first cleanup selection/state, redaction and previous empty lifecycle grant compatibility.
- [x] Observe the current regression failure before correcting it: diagnostic20655c9/CI34672961239/job103497683302 is331pass/1fail/0skip. The sole failure expects an eight-migration inventory. This is regression RED, not a fabricated claim that every storage test failed before implementation.
- [x] Update exactly six version expectations in four pre-existing tests. Preserve all other content with read-only reverse-hash verification.
- [x] Retain all previous CI stages and exact source protections; pass full/current required and repeated PostgreSQL CI, both migration reruns, static/safety/coverage/dependency checks.

Documentation-only successor verification and tracker synchronization are recorded separately in issue26/PR24; B2a record publication is not overall TaskF completion.

### Existing test exceptions — exact and reversible

| File | Allowed expectations |
| --- | --- |
| `test/postgres-searchad-active-canary.integration.test.js` | `first.currentVersion`:0008->0009 |
| `test/postgres-searchad-activation.integration.test.js` | `first.currentVersion`:0008->0009 |
| `test/postgres-searchad-write.integration.test.js` | `first` and `second` currentVersion:0008->0009 |
| `test/postgres-migrator.test.js` | Ordered inventory adds0009; final filename becomes0009 hierarchy |

The preservation script reverses only these changes and compares original Git blobs. The migrator ordering, wrapper-removal and checksum checks remain unchanged. No existing assertion is dropped and no existing production file changes in this slice.

### Provenance

Schema original blob `ec8f25be8654febf25e5d30b5f9bb4ee45858ac7`; risk service original `75f375f59752674ffd28f11c39582c3a73d73e98`; original risk test `75673597c6801fdfb33ea2c6de09330516144702`. Repository original `a17e6b51c3d300b44c41a868e4f8c68905fda4901` is adapted to `b63fd592d186ea56297fc2f60dac13e92e97203b`. New storage test `9a092eee2a5530491142a64f56aae14c2f3dd70e`; preservation script `ac840c24cba6d2b2babcac862a19285a6f71e7fb`. These are pinned in canonical CI.

## B2b — NEXT, not implemented by storage verification

- [ ] Re-read current HEAD and deferred orchestrator dependencies before adding execution code; do not copy the old synchronous executor or replace existing async approval/token/lock code.
- [ ] Add an explicitly bounded orchestration contract with failing tests and no operational gate change. Missing runtime/guard/approval dependency must fail closed, not become an allow-all test path.
- [ ] Re-read the authoritative top campaign before every relevant child mutation and require stopped/paused state; validate exact returned Customer/parent/type and persisted server-owned IDs.
- [ ] Reject malformed IDs, duplicate/partial/heterogeneous keyword batch responses; do not infer ownership from a caller record or names.
- [ ] Prove hierarchy progression, persistent unknown outcome and child-first cleanup using controlled upstream fixtures. A cleanup list ordering assertion is not a remote delete test.
- [ ] Provide read-only reconcile for unknown outcomes without blind resend. Distinguish repository reconstruction from actual application restart.
- [ ] Record exact modified source provenance and current focused/full/PG CI, preserving prior checkpoints.

## C/D/E dependencies — remain mandatory

- [ ] Implement/prove approval-token claim + risk consumption + dispatch intent atomicity with real PG. A storage run/risk transaction or a single dispatch CAS does not satisfy this requirement.
- [ ] Integrate legacy0007 Canary start with shared risk atomically where required; fixture-ledger shared accounting alone is insufficient.
- [ ] Enforce exact lifecycle activation, ownership holds, child-existence parent-delete protection and destructive double confirmation in the current approved async path.
- [ ] Prove actual role HTTP/application/PG composition, scope isolation, authoritative actor binding, public readiness/shutdown preservation and restart/reconcile behavior.

The risk clock currently uses UTC date and risk units are internal capacity, not advertising currency or a verified Korea-day budget rule. Do not quietly reinterpret that policy when adding runtime code.

Issue26F, #21 independent review/concurrent-suspend operational readiness, and separately authorized#22 deployment/live Capability/Canary/scoped activation remain open. Later reporting#18, durable worker/registry through0019#19, and profitability/Auto#20 are not completed by this slice.
