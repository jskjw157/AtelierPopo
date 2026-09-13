# SearchAd 0009 Recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. This is current recovery #26, not historical issue #17 completion.

**Goal:** Restore the historical hierarchy/lifecycle contracts incrementally on the verified async0008 foundation without importing the old executor or claiming live activation.

**Architecture:** Pure operation/validator/recipe modules first; then PostgreSQL hierarchy storage and orchestration; then approval/activation/ownership/risk and actual role HTTP. Each increment needs observed RED/GREEN and exact provenance. Pure recipe tests are not a working lifecycle executor.

**Tech Stack:** Existing Node.js22 ESM, node:test, PostgreSQL16 CI. No new dependency.

**References:** Historical hierarchy/lifecycle spec and implementation plan at `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`; current issue#26 under Master#23. [Current source inventory and B1 evidence](../../SEARCHAD_0009_RECOVERY_AUDIT.md).

## Current checkpoint

A inventory/scope partition and B1 are recorded within the audit's stated review boundary. **B1 code/test/workflow `0fe2bd013e99c29a7469b5471368847d5084d012`, CI34670962167/job103492109034, completed/success, full311/0/0.** The documentation-only successor and synchronization are tracked separately in#26/PR24. **Next B2; issue#26 remains OPEN and F is not complete.**

## Global constraints

- Branch `codex/searchad-original-recovery-20260912`; Draft PR#24. No main change, merge or deployment.
- Increment starting checkpoint `5a5ae1c713bfc8343be774635a8d63532030db55`; completed0008 implementation `9a0b0c8a20154258b6d71369ae63cd8214cb2e8a`.
- Historical range `9cf5cf2913a4b8b182e2bef3e4c2676278a58918...1051fa1a64ab78b5f6b3adf5cb794a342ade39ae` spans53 commits. Do not wholesale cherry-pick it onto the repaired async branch.
- Preserve existing0007/0008 historical hashes,25-D/E integration hashes, reverse-edit provenance, assertions, package/lockfiles, default gates and prior migrations. Narrow changes require explicit diff and new tests.
- No actual Naver request, operational gate change, production migration, synthetic production grant, Hostinger deployment or PR merge.
- Parent graph: campaign -> adgroup; keyword and creative are separate adgroup children.

## Task A — source inventory and integration decisions

- [x] Fetch current PR/head and#26, historical per-file comparison and implementation plan.
- [x] Read four pure source modules and two original tests; identify exact historical blobs.
- [x] Record historical additions, six existing production integration decisions and remaining review risks in `SEARCHAD_0009_RECOVERY_AUDIT.md`.

A means inventory and port decisions, not a full behavioral/security review of every deferred source. Those reviews are mandatory in B2–E. The old executor's synchronous plan/token contracts must not replace the current awaited implementation.

## Task B1 — pure hierarchy validators and descriptor recipes

| Path relative to smartstore-bridge/ | Historical blob |
| --- | --- |
| src/naver/searchad/lifecycle/operations.js |77ce4a3e3c4e02abb868f1c887ee8a952ca6b7ec|
| src/naver/searchad/lifecycle/hierarchy-validator.js |bfaabbb7fb25a1396273e176a80882124a3acfb3|
| src/naver/searchad/lifecycle/recipe-campaign.js |96bf88b605d1c0c537350e510c5f578361f5c4f8|
| src/naver/searchad/lifecycle/recipe-hierarchy.js |5fef7015926e3ba04bf9e9c2996fc4e41b704e02|
| test/searchad-hierarchy-validator.test.js |1a5248d57ce8838bdafbaefd2b635d93836c67ed|
| test/searchad-hierarchy-recipes.test.js |b0e956601c330ef61bb797155fe7aeb5cd56a798|

**Interfaces:** frozen operation map, `KEYWORD_CREATE_MAX_BATCH`, `assertHierarchyParent`, `assertNoCallerRemoteIds`, `assertTopCampaignStopped`, `assertKeywordBatch`, `assertText45Creative`, `createHierarchyCampaignRecipe`, `createHierarchyChildRecipe`. Inputs are trusted-service record shapes; a plain record fixture is not durable ownership. Recipes return descriptors and do not execute them.

- [x] Add six explicit missing-module assertions in `searchad-hierarchy-recovery.test.js` before restoring production modules.
- [x] Observe RED at `a226d15a90d343c6214a7bb49db082d7651aca80`, CI34670682168/job103491332326: existing293 pass/new6 fail/skip0.
- [x] Restore only the six historical blobs. Add exact source-path exclusions and six hash pins while retaining every previous check.
- [x] Run hierarchy focused18/0/0 and full311/0/0 at `0fe2bd0`; read full actual CI logs.
- [x] Compare against completed0008 checkpoint; no existing production source, test, config, dependency or migration changes. Workflow diff40 additions/0 deletions.

B1 record synchronization, including the documentation HEAD CI, is tracked in#26/Master/dashboard/PR24 rather than equated with full0009 taskF completion.

**Additional verified contracts:** all12 operation keys resolve in the current local registry; maps frozen; nested-array target injection and wrong Customer/run/type/state rejected; server-derived stopped campaign payload; keyword/creative sibling graph; empty/100/101 batch bounds and creative type; stored returned-ID targets and missing/conflicting ID rejection. All six new tests trap fetch and assert0 calls. No new PG/HTTP/live-validation claim is made.

## Task B2 — PostgreSQL hierarchy and orchestration: NEXT

- [ ] Review the complete historical schema/repository/risk/orchestration sources and actual dispatcher dependencies before importing services.
- [ ] Restore/review `0009_searchad_hierarchy_lifecycle.sql`, lifecycle `postgres-repository.js`, `risk-service.js`, `hierarchy-canary-service.js` with focused failure-first tests.
- [ ] Use fresh UUID schemas and real PostgreSQL to verify repeat migration, immutable records, Customer/run ownership, restart, unknown outcomes and child-first cleanup.
- [ ] Verify service-facing ID types, duplicate/partial batch responses, authoritative remote stopped state and no name-based cleanup; pure record fixtures are insufficient.
- [ ] Preserve migrations0001–0008 byte-for-byte. Document necessary version-expectation or CI-protection changes without deleting old assertions.

## Tasks C/D/E — approved execution integration: PENDING

- [ ] Review historical activation service/repository changes independently; retain existing update-only/passive restrictions while adding exact lifecycle scope.
- [ ] Integrate ownership and lifecycle guards into the current awaited execution path; never replace the repaired async directory.
- [ ] Test approval token + risk + dispatch intent atomicity and shared per-Customer daily capacity with realPG, including replay/concurrency and non-recycling of ambiguous/dispatched risk.
- [ ] Integrate actual application/bootstrap/role HTTP/readiness/shutdown and directly test the whole path. Keep wrong Customer/parent, active parent, existing-ID injection, batch limit and scope leakage denials.
- [ ] Prove ambiguous create/delete are not resent and read-only reconcile/restart preserves state/ownership. Keep two-factor destructive confirmation, ownership holds and child-presence parent-delete checks.

## Task F — final gate: PENDING

- [ ] Close#26 only when all full A–F acceptance conditions pass on a current SHA, with complete CI logs, fixture boundaries and synchronized Master/dashboard/PR.

B1 is not complete0009 recovery. Independent reviewer approval, post-guard concurrent suspend atomicity, production readiness, live capability/evidence and deployment are separate#21/#22 gates. Reporting/worker/profitability tasks remain pending.
