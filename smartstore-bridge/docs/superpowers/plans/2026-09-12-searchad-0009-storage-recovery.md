# SearchAd 0009 — Corrected storage scope and remaining B2b plan

Use superpowers:executing-plans task by task. This supplements the original0009 plan. Current dashboard/verification supersede its old resume pointers. Issue#26 remains OPEN and PR24 Draft on `codex/searchad-original-recovery-20260912`.

## Checkpoints and explicit correction

B2a code5c4be3077e67bfd257ce176c3fe9727d9331a101/CI34674108418 passed332/0/0. Later read-only implementation6445e52122b974f59dab341cd404c0ed666b0d88 and transport compositionefaab63ae5a58ab370d607cce5cd446e12f46473 are now verified together: CI34678162318/job103511667129 completed/success, full373/0/0, requiredPG83/0/0, new GatewayPG16/0/0.

The earlier version of this plan incorrectly checked off dispatch/cleanup claims, atomic run+risk binding, raw composite parent enforcement, dry-run release restriction and generic event redaction as B2a results. Those claims are withdrawn. Historical/current raw repository is the sameb63fd592d186ea56297fc2f60dac13e92e97203b blob, not an adaptation. Each storage subtest owns a separate UUID schema. See [corrected storage report](../../SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md) and [current read-only verification](../../SEARCHAD_0009_RECONCILE_VERIFICATION.md).

## B2a completed — storage only

- [x] Exact historical0009 schema/repository/risk service and original risk tests restored; prior migrations preserved.
- [x] Populated0008 upgrade/repeat, prior checksums/empty lifecycle scopes and immutable evidence/grants/events verified.
- [x] Explicit Customer-filtered queries/patches, unresolved-run and ownership uniqueness, validator checks on stored parent records, pool reconstruction and live-child queries verified. These are not composite-FK or HTTP authorization guarantees.
- [x] Server-owned internal units/capacity/UTC date, immutable intent identity, concurrent reserve/consume/release, SQL rollback, consumed-risk non-release and UTC rollover verified through independent real PG connections.
- [x] Observed inventory regression331/1/0 corrected without dropping assertions. Four old test files differ only in six version expectations, reverse-hash checked.
- [x] Canonical full/PG/repeat/migration/safety/coverage/dependency checks completed; reporting inaccuracies are explicitly corrected rather than inferred from CI.

## B2b completed slice — read-only observation

- [x] Existing service/repository implement authenticated exact-scope observations of stored targets, no caller remote-ID/name targets or mutation methods.
- [x] Consistent internally issued snapshots, graph/context revalidation, concurrent settlement and atomic local object/ownership/audit settlement tested with real PG.
- [x] Actual adapter/Gateway/registry/credentials/signing client composition tested with simulated upstream only; exact HMAC GET,404/error/malformed distinction and no activation/risk side effects verified.
- [x] Documented runtime boundary: no application HTTP wiring, no live create evidence, no whole-application reboot and no mutation dispatch atomicity.

## First unfinished unit — B2b mutation orchestration

- [ ] Re-read current head and the deferred orchestrator's dependencies. Do not wholesale restore the old orchestrator or replace the repaired async writer.
- [ ] Write failing tests for durable create-response/object/ownership binding, including invalid identifier types and conflicting/partial/duplicate batch responses. Never promote caller IDs or guessed names to ownership.
- [ ] Add authoritative top-campaign reads immediately before relevant mutations; require stopped/paused and exact Customer/parent/type. A prior stored stopped fixture or generic successful GET is insufficient.
- [ ] Coordinate same-run mutation progression with persistent dispatch intent. Missing approval/guard/runtime dependencies must fail closed. Define this jointly with C/D before exposing a mutation path.
- [ ] Prove child-first remote cleanup, pre-delete ownership/child checks and unknown-outcome handling without blind resend. Local absence settlement is not proof of DELETE execution.
- [ ] Use controlled upstream only, preserve old tests/pins/gates and record exact behavioral RED/GREEN and fresh real-PG/full CI for each new implementation increment.

## C/D/E/F still required

- [ ] Prove one-time approval-token consumption + risk consumption + dispatch intent atomicity in real PG. A raw risk transaction or read-only snapshot settlement is not this guarantee.
- [ ] Integrate existing0007 Canary start with shared risk where required; fixture owner-kind accounting is not production integration.
- [ ] Enforce exact lifecycle operation scope, ownership holds, parent-with-live-children deletion refusal and destructive double confirmation in the current awaited execution path.
- [ ] Wire and directly test actual application/role HTTP, authenticated actors, readiness/shutdown, whole-application restart and read-only recovery alongside mutations.
- [ ] Close#26 only after all acceptance conditions, final focused/PG/repeat/full verification and issue/Master/dashboard/PR synchronization. A read-only checkpoint is not F completion.

## Preserved controls and deferred work

Protected base0adbd11359440efe43fd07c279bd01a4d8914568; completed0008 checkpoint5a5ae1c713bfc8343be774635a8d63532030db55. Existing writer/approval/locks/activation/bootstrap/server/readiness/close, dependencies/default gates and0001–0009 migration bytes stay unchanged in the read-only slice. Narrow future edits require explicit provenance and tests, not disabled checks.

No real Naver calls, operational gate changes, production migration, deployment, main changes or merge. Evidence is CI-only. Internal risk units/UTC date are not currency or a verified Korea-day budget policy. Post-guard concurrent suspension/independent review remain#21; live validation/deployment#22 needs separate authorization. Reporting#18, worker/registry through0019#19 and profitability/Auto#20 remain pending.
