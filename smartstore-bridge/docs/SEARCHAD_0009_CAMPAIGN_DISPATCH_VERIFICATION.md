# SearchAd 0009 — bounded campaign dispatch transaction

## Checkpoint — 2026-09-12

**The bounded LOCAL transaction for one fresh approved campaign is implemented and verified in both local PostgreSQL and completed canonical GitHub CI. This does not complete B2b mutation orchestration, C/D as a whole, E or F.**

- Code/test/workflow SHA: `ecb817f6037253d909f8731de2c27792bcb0df25`.
- Branch: `codex/searchad-original-recovery-20260912`; Master23, issue26 OPEN, PR24 Draft.
- Protected PR base: `0adbd11359440efe43fd07c279bd01a4d8914568`.
- Immediate source baseline: `1aace72e45635c35ced4263a835347fa6a204662` (temporary export workflow only after c066856).
- Canonical CI: [34680617480](https://github.com/jskjw157/AtelierPopo/actions/runs/34680617480), job103518472081, **completed/success**. Complete job logs and final job/step conclusions were read. A documentation-only successor and its CI are separate checkpoints recorded in issue26/PR24.

## Implemented boundary

The new internal `PostgresCampaignDispatchRepository` uses ONE checked-out PostgreSQL connection. It consumes the existing approved token, consumes server-defined internal risk, records a dispatching campaign and unknown-outcome run/plan, and writes both a plan attempt and immutable hierarchy dispatch intent in one transaction. No source in the existing executor, approval, raw risk store, reconciliation, HTTP or bootstrap is replaced.

It accepts only explicit local Customer/run/object/plan IDs plus the issued token. Authenticated Admin and explicit Customer access are required; input and actor are copied before the first await. No caller descriptor, budget override, returned ID or evidence is accepted. The default component gate is OFF and no production factory wires it in.

The scope is deliberately ONE planned top campaign in a fresh matching run with no existing parent, remote ID, ownership, child or prior dispatch intent. The exact stopped WEB_SITE descriptor is rebuilt with the existing recipe and compared to the stored approved plan. The current pinned registry must retain the exact public tier-B allowlisted POST operation. Grant AND evidence must match Customer, spec, credential, upstream, operation, create lifecycle, unexpired times and equal scopes. Creation additionally requires the explicit namespaced fields `campaign.campaignTp`, `campaign.name`, `campaign.userLock`, `campaign.dailyBudget`. This new creation policy does not promote old update-only grants or reinterpret existing evidence.

Lock order: account -> run -> objects -> ownership -> plan -> approval -> advisory risk intent -> daily balance. Reconciliation's run/object/ownership order is preserved. This is not proof that all existing raw writers or future dispatchers participate in the lock protocol. Expiration and identity are rechecked after waits and before COMMIT; UTC rollover aborts rather than charging an old day. Established capacity cannot be raised silently, and no old intent can be reused, even when released.

Successful return means `dispatchCommitted:true, remoteDispatched:false`. It is NOT a network send, an upstream exactly-once guarantee, a returned-ID ownership proof, or permission to bypass remaining runtime gates. `unknown_outcome` is used conservatively because the existing plan schema has no executing state. No run becomes passed and no remote ID, ownership or activation evidence is manufactured.

Any failure before COMMIT rolls back the token, balance, reservation, object, run, plan and audit writes. A COMMIT send/acknowledgement failure is conservatively reported as `SEARCHAD_HIERARCHY_DISPATCH_COMMIT_UNKNOWN` and the connection is discarded. The caller gets no successful receipt and must inspect persisted state, not blindly resend. Confirmed consumed risk cannot be released by the existing store. Post-commit suspension/credential changes still require a separately proven dispatch handoff.

## Actual verification and limits

A temporary read-only-permissions workflow exported an exact tracked-source snapshot plus disposable PG runtime. Archive digests and344 exported Git blobs were checked. It is not an original-history Git clone. Local Node22.16/PostgreSQL16.15 ran the real migrations, existing approval service, raw write/lifecycle repositories, risk service and checked-in registry. Each of40 child tests owns a UUID schema and cleans up its own pools/schema. A global fetch trap rejects escaped transport.

Evidence/grant/run/plan fixtures are synthetic DB records; the token is issued by the real approval service. The stopped plan is inserted through the existing raw plan repository because the production campaign planner and HTTP flow are still pending. This test does not issue real lifecycle evidence or run a live Canary. Pool reconstruction is not whole-app restart. Shared-capacity competition uses the existing risk service with a synthetic legacy owner, NOT the existing0007 Canary start path.

Forty child scenarios plus the parent test cover successful joint commit, two-pool same-plan competition, four injected write failures, shared-capacity exhaustion/race, wrong input/actor/Customer/state/operation/descriptor/token, failed/Passive/expired/out-of-scope evidence, manifest invalidation, synchronous resolver/default gate, mutable caller input, pre-COMMIT identity change, reused/released intent, capacity rebinding, consumed-risk release refusal, prior ownership/children/intents, actual row-lock expiration and UTC-day rollover, COMMIT ambiguity on both sides of commit, and bounded connection failure.

| Fresh local command | pass / fail / skip |
| --- | --- |
| Baseline full suite, before implementation |373 /0 /0|
| New campaign transaction suite, final and repeated |41 /0 /0|
| Required PostgreSQL integration suite |124 /0 /0|
| Full regression after implementation |414 /0 /0|

373+41=414 counts the parent and40 children. Focused/repeated counts overlap the full suite; do not sum them or treat them as feature completion percentages. Static checks and new source syntax pass. Both final migration reruns remain0009/applied:[]. No migration is added or changed.

## Completed canonical code CI

Code ecb817f, CI34680617480/job103518472081 ran the full repository with PostgreSQL16.15 and Node22.23.2. Every configured step succeeded; no pending/skipped step was counted as passing.

| Canonical check | pass / fail / skip |
| --- | --- |
| Canary/Gateway/Canary role HTTP |51 /0 /0|
| Activation core/Customer |30 /0 /0|
| Hierarchy recipes plus read-only units |29 /0 /0|
| Existing write focused |49 /0 /0|
| Existing HTTP/readiness/runtime lifecycle |14 /0 /0|
| **Required PostgreSQL** |**124 /0 /0**|
| Prior Canary/activation/application PG repeat |31 /0 /0|
| Storage/risk repeat |21 /0 /0|
| Read-only unit+PG repeat |25 /0 /0|
| Signed Gateway/PG repeat |16 /0 /0|
| **New campaign transaction repeat** |**41 /0 /0**|
| **Full regression** |**414 /0 /0**|

All historical source pins, protected diffs, reversible test changes and new source/test pins passed. Final migration reruns twice reported0009/applied:[]. Existing write scanner reports16 sources/rawnetwork0. Bundled Commerce116/SearchAd126unique117allowlisted/no internal-runtime leaks are classification checks, not live validation. Bridge production dependency audit reports0 vulnerabilities, not a root audit. SQLite experimental and Actions Node-version warnings remain. CI does not independently validate documentation prose or confer reviewer approval.

## Observed failure evidence

The first added test was run before the production coordinator existed:0pass/1fail/0skip, an explicit missing-coordinator assertion. This is not a claim of40 independently observed behavioral REDs. Manifest/field-scope hardening produced additional failures. A dedicated connection-failure regression was observed failing before its error wrapper was added (39pass/2fail including parent), then all41 passed.

As a negative control, a disposable local source inserted COMMIT then BEGIN immediately before the risk-balance UPDATE, wrongly committing approval by itself. All four fault-injection rollback tests failed, along with three dependent cases:33pass/8fail including parent. The exact original source bytes were restored before final GREEN; the mutant is not committed.

| Local evidence log | SHA256 |
| --- | --- |
| Missing-coordinator RED |`b146a004f58ec3d421e1791e49dfb2d3c9b153bcc00c47e500ab4c21fb7a56b7`|
| Connection failure RED |`6df4d4aab30827f65d4599e595f29a7b66eeac54f6ff9c1b13b6e9d837e72128`|
| Premature-commit negative control |`7dc3cf1b412061de0560ee219b7df073d90ac180f463608af8c1aa9dbf9df1a5`|
| Final local full GREEN |`cc8a3c5e290d1b253df196dd92bbd52398f9b2209d3d06beec952d06faefa89e`|
| Final local required-PG GREEN |`3d5136896093ba90a97375f84c63b91a1f1fc1098b995dbd6a5f5c9c219f3282`|

These are local log identities, not substitutes for canonical CI or independently signed attestations.

## Exact changes and preservation

| File at verified code checkpoint | Git blob |
| --- | --- |
| New coordinator,210 lines |`3add8f099699e5a941deded3c77ff3ebf888f977`|
| New integration test,375 lines |`76e193591bdd5ffc6d7f6cf89523a7751bb6edef`|
| Canonical workflow |`397bfa6c826d9be8c9c2b00b2e6c669c24eb5c38`|
| Plan |`87df4bccdad5494df32f62e8d4edfcb7d18c9cd6`|

The compare to1aace72 has only these four files plus removal of this turn's temporary workspace-export workflow. Relative to c066856 the export workflow has no net presence. The workflow retains every previous line/step/pin, adds exact new-file exemptions, a stricter baseline diff, new file pins and a repeated actual-PG step; its formerly missing EOF newline is normalized (27added/1removed lines,26 net).

Local hash checks prove242 existing source/test/migration/package files still match the exported baseline. Historical Git diff/pin checks are delegated to the canonical full-repository CI rather than fabricated in the snapshot repository. Existing0007/0008 application, current async executor, approval/locks, read-only hierarchy reconciliation, default gates, dependencies and migrations0001–0009 remain unchanged. The prior B2a correction remains authoritative; this new local transaction is not retroactively attributed to that storage stage.

The existing write-safety scanner covers its16 sources only, not this entire lifecycle subsystem. Coverage classification is not live validation; a dependency audit is not independent code review. No independent reviewer approval is claimed.

## Next task, not a completed implementation

Continue with a server-owned campaign plan producer and one-shot mutation handoff using this transaction, then validate actual response-returned ID/Customer/type/stopped state and atomically record ownership, with read-only unknown-outcome recovery and no blind send retries. Production evidence issuance must satisfy this new explicit creation scope; synthetic fixture rows must never be promoted or copied into production. Preserve the current executor and read-only service while connecting the real path.

B2b child/batch progression, per-mutation stopped ancestor checks, returned-ID provenance, partial/duplicate batch handling and child-first cleanup remain pending. C/D must generalize exact lifecycle authorization and transaction adoption, including existing0007 start; E must prove application/role HTTP, readiness/close and whole-app restart. F is full acceptance, not this checkpoint. #18/#19 through0019/#20/#21 and separately authorized#22 remain open as previously tracked.

**No actual Naver request, advertising mutation, operational gate change, production migration, deployment, main change or merge occurred.**
