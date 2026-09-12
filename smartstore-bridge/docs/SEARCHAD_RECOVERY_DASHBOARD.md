# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-12

**#26 remains OPEN. B1 pure descriptors and B2a storage/risk are verified within the corrected boundaries below. The B2b read-only reconciliation slice is now verified through the real signing client/Gateway/PostgreSQL. First unfinished work is B2b mutation orchestration; C/D/E/F remain pending.**

Do not redo the already-present reconciliation implementation or confuse local observation settlement with mutation dispatch. Do not advance to reporting before #26 acceptance is complete.

| Checkpoint | Value |
| --- | --- |
| Repository / app | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Branch | `codex/searchad-original-recovery-20260912` |
| Draft PR / Master / current issue | [#24](https://github.com/jskjw157/AtelierPopo/pull/24) / [#23](https://github.com/jskjw157/AtelierPopo/issues/23) / [#26](https://github.com/jskjw157/AtelierPopo/issues/26) |
| Protected base | `codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568` |
| Existing read-only implementation | `6445e52122b974f59dab341cd404c0ed666b0d88` |
| **Verified code/test/workflow** | **`efaab63ae5a58ab370d607cce5cd446e12f46473`** |
| **Completed canonical CI** | **[34678162318](https://github.com/jskjw157/AtelierPopo/actions/runs/34678162318), job `103511667129`, completed/success; complete log and final conclusions reviewed** |
| **Full regression** | **373 passed /0 failed /0 skipped** |
| Migration head |0009 in isolated test databases; no production migration|

This is a repository Markdown dashboard, not a claimed GitHub Projects board. The subsequent documentation-only SHA/CI are recorded separately in #26/PR24. [Current verification](SEARCHAD_0009_RECONCILE_VERIFICATION.md), [corrected B2a verification](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md), [storage/remaining plan](superpowers/plans/2026-09-12-searchad-0009-storage-recovery.md), [read-only design](superpowers/plans/2026-09-12-searchad-0009-reconcile.md).

## Sequential board

| Scope | State |
| --- | --- |
|0007 Canary/Gateway/role HTTP/bootstrap|VERIFIED, unmerged/undeployed|
|0008 activation/current async/actual PG+HTTP/readiness/close|COMPLETED #25; regression preserved|
|#26-A inventory / B1 pure hierarchy descriptors|INVENTORIED / VERIFIED|
|#26-B2a schema/repository/risk storage|VERIFIED within corrected storage-only scope|
|#26-B2b read-only observation/atomic local settlement/signed GET composition|**VERIFIED bounded slice, efaab63**|
|#26-B2b create/batch/child-first remote cleanup orchestration|**NEXT — PENDING**|
|#26-C/D lifecycle scope/ownership/approval-token+risk+dispatch|PENDING|
|#26-E actual lifecycle application/role HTTP/readiness/restart|PENDING|
|#26-F full0009 acceptance/closure|PENDING; do not close on this read-only result|
|#18 reporting/Circuit/automation|PENDING|
|#19 durable worker/scheduler/operation registry through0019|PENDING|
|#20 profitability/recommendation/limited Auto|PENDING|
|#21 broader readiness/concurrent-suspend/independent review|PENDING|
|#22 deployment/live Capability/Canary/scoped activation|NOT STARTED, separate authorization|

## What changed and what was verified

The remote branch already contained read-only reconciliation at6445e52 when resumed. This increment added only a236-line transport-composition test and14 workflow lines. Previous production sources/tests/migrations/dependencies/default gates were preserved.

Real PG repositories, reconciliation/risk services, pinned registry, credentials, existing adapter, Gateway and signing client were composed. Only upstream responses were simulated. The new15 child scenarios plus parent verify exact signed GETs for four hierarchy types, typed404 versus matching/malformed/wrong-scope200,401/503/outages, read-gate denial, role/Customer/input isolation, credential rotation before/during GET, terminal-state reconnection, unchanged suspension/consumed-risk and no new approvals/grants/evidence. Escaped network calls are trapped.

The existing reconciliation tests additionally cover graph/ownership changes, a new child during observation, concurrent settlement, append-audit rollback and forged snapshot rejection. Settlement updates local observation records, not remote objects. No create/update/delete or HTTP route was added. Synthetic stored remote IDs are not observed-create evidence. Pool/service reconstruction is not whole-application reboot. No run is promoted to passed.

| CI check | Pass / fail / skip |
| --- | --- |
|Canary / activation|51/0/0;30/0/0|
|Hierarchy recipes+read-only unit|29/0/0|
|Existing write / role HTTP|49/0/0;14/0/0|
|**Required PG**|**83/0/0**|
|Previous PG repeat / storage+risk repeat|31/0/0;21/0/0|
|Read-only unit+PG repeat|25/0/0|
|**New signed Gateway+PG composition**|**16/0/0**|
|**Full regression**|**373/0/0**|

Counts overlap and are not completion percentages.332+25 existing read-only+16 new composition=373 counted tests. All configured steps/pins/protected diffs/static checks passed. Both migration reruns0009/applied:[]. Existing write scanner16source/rawnetwork0 is limited; manifest Commerce116/SearchAd126unique117allowlisted is not live validation; bridge production audit reports0, not root audit. SQLite/Actions Node warnings persist.

## Explicit correction of earlier B2a reporting

The earlier dashboard/report/#26 descriptions wrongly attributed composite parent enforcement, run+risk binding, dispatch/cleanup single-winner claims, dry-run-only release, generic event redaction and child-first remote cleanup to B2a. **Those claims are withdrawn, not marked complete.** B2a actually tests explicit Customer-filtered queries, validator checks on stored parent records, uniqueness, reconnection, immutable events and transactional risk accounting.

The raw repository is exact historical blob `b63fd592d186ea56297fc2f60dac13e92e97203b` at1051fa1, not the previously described adaptation from a17e6b51. Its16 subtests each own a UUID schema. The332-test result is valid, but passing CI did not prove the prose correct. The current separate observation-settlement transaction is not a mutation-dispatch claim and cannot be retroactively credited to B2a.

## Resume contract and limits

Start with B2b mutation-orchestration tests: authoritative stopped top campaign before relevant mutations, safe response-ID and parent binding, malformed/duplicate/partial batch handling, durable ownership acquisition and child-first remote cleanup. Preserve the current awaited writer rather than copying the historical synchronous directory. C/D must still atomically bind one-time approval token, risk consumption and dispatch intent; raw risk transactions or read-only settlement do not suffice. Actual0007 shared-risk start integration and E role HTTP/application wiring remain unverified.

Evidence remains bound to Customer/spec/credential/upstream/operation/field/lifecycle. No raw URL, name cleanup, caller-supplied success/ID/evidence, blind retry or recycling of ambiguous/dispatched risk is permitted. Existing global/Canary defaults stay OFF; internal risk uses UTC/internal units, not KRW/Korean-day advertising budgets. Public readiness remains initialization status, not account execution permission.

Prior exact histories: [0008/293](https://github.com/jskjw157/AtelierPopo/blob/5a5ae1c713bfc8343be774635a8d63532030db55/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md), [B1/311](https://github.com/jskjw157/AtelierPopo/blob/035098228dbabdd48669f42f36c054cc38fc68af/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md). The old9ce4142 B2a prose is superseded by the explicit correction, not current proof. Historical closed issues and unpublished late checkpoints are not current completion. Damaged bootstrap chunks remain unused; final cleanup is pending.

**No actual Naver request, advertising mutation, operational gate change, production migration, deployment, main change or merge occurred. #26 OPEN; PR24 Draft; independent review not yet approved.**
