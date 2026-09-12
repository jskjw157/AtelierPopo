# SearchAd 0009 Recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. This is current recovery #26, not historical issue #17 completion.

**Goal:** Restore the historical hierarchy/lifecycle contracts incrementally on the verified async 0008 foundation without importing the old executor or claiming live activation.

**Architecture:** Start with pure operation/validator/recipe modules, then add PostgreSQL hierarchy storage and orchestration, then integrate approval/activation/ownership/risk and actual role HTTP. Each increment has its own RED/GREEN and exact Git provenance. Do not equate pure recipe tests with a working lifecycle executor.

**Tech Stack:** Existing Node.js 22 ESM, node:test, PostgreSQL 16 CI. No new dependency.

**Spec:** Historical `smartstore-bridge/docs/superpowers/specs/2026-09-11-searchad-hierarchy-lifecycle-design.md` and implementation plan at commit `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`; current acceptance is issue #26 under Master #23.

## Global constraints

- Working branch: `codex/searchad-original-recovery-20260912`; Draft PR #24. Do not touch main or merge/deploy.
- Starting HEAD `5a5ae1c713bfc8343be774635a8d63532030db55`; verified implementation `9a0b0c8a20154258b6d71369ae63cd8214cb2e8a`.
- Historical range: `9cf5cf2913a4b8b182e2bef3e4c2676278a58918...1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`. This spans 53 commits; do not cherry-pick the whole range onto the repaired async branch.
- Preserve 0007/0008 historical hashes, 25-D/E integration hashes, reverse-edit provenance, all existing assertions, package/lockfiles, default gates and all prior migrations.
- No actual Naver request, operational gate change, production migration, synthetic production grant, Hostinger deployment or PR merge.
- Parent graph: campaign -> adgroup; keyword and creative are separate adgroup children, not keyword -> creative.

## Task A — source inventory and integration decisions

- [x] Fetch current PR/head and #26 plus historical per-file compare and implementation plan.
- [x] Read the four pure module sources and their two original test files; identify exact historical blobs below.
- [ ] Record all existing-source integration decisions and remaining risks in the recovery audit before marking A complete.

The historical compare contains new lifecycle modules, migration0009, lifecycle HTTP/OpenAPI and tests, plus changes to application bootstrap/server, activation service/repository and write execution/runtime. Only the four pure modules below are selected for the first implementation slice. Other additions and edits are not silently authorized by a passing recipe suite.

## Task B1 — pure hierarchy validator and descriptor recipes

**Create from exact historical blobs after observing RED:**

| Path relative to smartstore-bridge/ | Historical blob |
| --- | --- |
| src/naver/searchad/lifecycle/operations.js | 77ce4a3e3c4e02abb868f1c887ee8a952ca6b7ec |
| src/naver/searchad/lifecycle/hierarchy-validator.js | bfaabbb7fb25a1396273e176a80882124a3acfb3 |
| src/naver/searchad/lifecycle/recipe-campaign.js | 96bf88b605d1c0c537350e510c5f578361f5c4f8 |
| src/naver/searchad/lifecycle/recipe-hierarchy.js | 5fef7015926e3ba04bf9e9c2996fc4e41b704e02 |
| test/searchad-hierarchy-validator.test.js | 1a5248d57ce8838bdafbaefd2b635d93836c67ed |
| test/searchad-hierarchy-recipes.test.js | b0e956601c330ef61bb797155fe7aeb5cd56a798 |

**Interfaces:** `SEARCHAD_HIERARCHY_OPERATIONS`, `KEYWORD_CREATE_MAX_BATCH`, `assertHierarchyParent`, `assertNoCallerRemoteIds`, `assertTopCampaignStopped`, `assertKeywordBatch`, `assertText45Creative`, `createHierarchyCampaignRecipe`, `createHierarchyChildRecipe`. Inputs to recipe parent/object arguments are trusted-service record shapes; a plain record fixture is not proof of durable ownership. Recipes return descriptors only and never execute them.

- [ ] Add `test/searchad-hierarchy-recovery.test.js` first, without production sources. Each test asserts a missing module explicitly before dynamic import.
- [ ] Run the existing full CI and confirm missing-module assertion RED, with the previous regression suite preserved.
- [ ] Restore only the six historical blobs above. In the current workflow exclude only the four exact new source paths from the protected-base diff; pin all six new hashes and retain every existing check.
- [ ] Run `node --test test/searchad-hierarchy-*.test.js` and full existing CI. Read actual job logs, not only queued/in-progress status.
- [ ] Compare the complete increment against starting HEAD; no existing production source may change in B1.
- [ ] Record exact code SHA, CI, counts, fixture boundary and next step in #26/Master/dashboard/PR. Keep #26 open.

**Additional B1 contracts:** all twelve operation keys must resolve to the existing local registry with the expected HTTP methods and runtime classification; operation maps remain frozen; nested-array target injection, wrong Customer/run/type/state, stopped server-owned campaign payload, separate keyword/creative children, batch limits and returned-ID-only descriptor targets must hold. Each new test replaces global fetch with a failure trap and asserts zero fetch calls. These tests are not HTTP/PG/live-validation claims.

## Task B2 — PostgreSQL hierarchy and orchestration

Restore/review `0009_searchad_hierarchy_lifecycle.sql`, lifecycle `postgres-repository.js`, `risk-service.js`, `hierarchy-canary-service.js` and their focused/PG tests. Use fresh UUID schemas and verify repeat migration, immutable records, scoped ownership, crash/unknown-outcome behavior and child-first cleanup. Review actual dispatcher dependencies before importing the service. Existing migrations remain byte-for-byte unchanged; any full-migration version assertion adjustment must be explicitly documented.

## Tasks C/D/E — approved execution integration

Review historical activation service/repository changes separately and preserve existing update-only grants. Integrate lifecycle scope and ownership checks into the current awaited execution path, never replacing the repaired async directory. Test approval token, risk reservation and dispatch intent atomicity with real PostgreSQL, including replay and capacity concurrency. Then integrate application/bootstrap/role HTTP/readiness/shutdown and prove the whole current path directly. Preserve the public readiness contract established in #25. A pure-module or fixture-only pass cannot close these tasks.

## Task F — final gate

Close #26 only after its full A–F acceptance is met with exact current SHA/CI and synchronized records. Independent review, live capability/evidence, guard-versus-concurrent-suspend atomicity and deployment are separate #21/#22 gates. Keep later reporting/worker/profitability tasks open.
