# Expired unused adgroup-plan retirement implementation plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. Continue Issue #26 on its designated Draft branch.

**Goal:** Retire only an expired, never-dispatched adgroup creation plan while preserving its already-created parent campaign and live hierarchy run.

**Architecture:** A default-disabled internal service validates copied local identifiers, Admin/Customer scope and exact confirmation. A PostgreSQL transaction validates both parent creation provenance and the original child plan/event/attempt, then expires only the child plan and appends two non-authorizing audit records. No transport or automatic replacement is injected.

**Tech Stack:** Existing Node.js 22 ESM, node:test and PostgreSQL 16; migrations through 0009 unchanged.

**Spec:** Issue #26 expired-unused-plan backlog and handoff comment 5749293696; existing AdgroupCreateService/PostgresAdgroupCreateRepository/adgroup-create-contract.js at fa061f110092b460e29e5f687b4ef8634f944008 are the producer contract. The user's next-step approval continues that backlog, not live advertising operations.

## Global constraints and rulings

- Preserve PR #28 Draft/open/unmerged and #26 OPEN. No main merge, deployment, production DB/migration, gate change, HTTP/bootstrap wiring or live Naver request.
- Only one verified owned root campaign and one planned child adgroup, with the exact original parent-linked CREATE plan, are eligible. Do not generalize root-run termination to this live-parent run.
- Child plan must itself be expired. Approval expiry alone is insufficient. Planned/approved/expired plans with unused approvals are supported.
- Preserve run status cleanup_pending and all run fields, parent/child object rows, ownership, descriptors, old approvals/token hashes, risk accounting, grants and evidence. Only target plan status/last_error and two new audit records may change.
- Reject a child returned ID/hold, used approval, execution lock, any child risk intent (including released), dispatch/non-planning attempt, unknown/applied state, extra or foreign linked object, or inconsistent immutable provenance.
- The existing consumed parent campaign risk reservation is expected prior work; preserve it, do not confuse it with unused child work and do not refund it.
- The audit says targetRemoteDispatched:false, NOT that the entire hierarchy never dispatched. It also says runTerminated:false, replacementCreated:false and cleanupAuthority:false.
- Ruling: this bounded unit is adgroup retirement only. Replanning remains pending because existing producer/cleanup/sibling consumers assume one child and one immutable adgroup_plan event. A safe successor must validate retirement history across those consumers before introducing replacement generations. Do not silently ignore old objects/events or claim this unit enables fresh prepare.
- Ruling: no repository checkout is mounted and direct raw download failed in this environment. Use immutable Git trees/fast-forward updates on the approved Draft branch and disposable Actions PostgreSQL for execution; no local worktree or independent-review claim.

## Review focus

1. Parent ownership, applied creation snapshot and consumed risk survive child retirement byte-for-byte.
2. State flags cannot substitute for exact original child descriptor, parent metadata hash, planning event and attempt.
3. Concurrent retirement, used-token/dispatch state, audit rollback and ambiguous COMMIT cannot manufacture success or authorize a send.
4. Context/clock are server-derived and rechecked after final audit I/O; caller mutation cannot redirect an awaited transaction.
5. Repeating retirement needs exact matching audit proof. Existing prepare and parent cleanup remain blocked; no unknown descendant is erased or deemed absent.

## Task 1: Parent-preserving local retirement

Files: new src/naver/searchad/lifecycle/adgroup-plan-retirement-service.js, new src/naver/searchad/lifecycle/postgres-adgroup-plan-retirement-repository.js, new test/postgres-searchad-adgroup-plan-retirement.integration.test.js, this ledger, and one focused command in .github/workflows/searchad-extended-cleanup-wip.yml.

Interfaces:
- new AdgroupPlanRetirementService({repository,enabled=false}).retire({customerId,hierarchyRunId,parentObjectId,hierarchyObjectId,planId,confirmation},context).
- Exact confirmation: RETIRE_EXPIRED_UNUSED_ADGROUP_PLAN. No caller actor, remote ID, token, payload, expiry or status.
- Repository receives those five local identifiers plus copied actorPrincipalId; constructor {pool,dailyBudget,current,clock}.
- Result: local scope, planStatus:'expired', runStatus:'cleanup_pending', changed, targetRemoteDispatched:false, runTerminated:false, replacementCreated:false, requiresNewApproval:true, replanningSupported:false, cleanupAuthority:false.

- [x] RED: commit tests plus focused CI; inspect the explicit missing-export assertion on real Actions, not a skipped PG suite.
- [x] GREEN: implement the two new internal modules, leaving all existing producer/consumer source and schema unchanged.
- [x] Verify focused and full regression completed output, including preservation, expiry boundary, old tokens, prior-work refusal, actual committed child claim, rollback, context/time drift, input copying, concurrency and COMMIT ambiguity.
- [x] Review exact diff and record canonical evidence and the remaining replanning boundary in this ledger.
- [ ] Check this documentation successor's CI and synchronize PR #28, Issue #26, Master #23 and PR #24 via checkpoint comments. Those comments are the completion record for this final handoff step; do not close #26 or merge either PR.

## Execution ledger

Starting head: fa061f110092b460e29e5f687b4ef8634f944008. Its previously pending documentation CI 35505839087/job106065392446 is now completed/success, including full regression.

Pre-flight: existing child producer stores parentRemoteId/parentCreatePlanId/parentAfterHash/activationId in before_json, with immutable adgroup_plan event+attempt. Retirement must consume that exact binding. Existing producer refuses any prior adgroup history and parent cleanup refuses a planned child; this unit preserves both restrictions.

### Canonical implementation checkpoint — 2026-09-20

- RED commit: 242f3b8f91b6d856328f89ecb50dd5016ec4304c, run 35507717250 / job 106070230853. PostgreSQL/setup/dependencies succeeded; the focused test failed on the intended explicit assertion `AdgroupPlanRetirementService must be implemented` (undefined rather than function). 1 test failed, 0 skipped. This is feature-availability RED, not independent mutation sensitivity evidence for every guard.
- GREEN canonical code/test commit: d7348fd28570c4754335c722c26975ee85b1841b.
- Canonical workflow: https://github.com/jskjw157/AtelierPopo/actions/runs/35507855918 ; job 106070580554. Completed SUCCESS; decoded completed job logs inspected.
- New adgroup retirement integration: 32 nested cases plus wrapper = 33/33 passed; 0 failed, skipped or cancelled.
- Full `npm test`: 802 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo; 354 top-level tests. Full summary at 2026-09-20T11:29:57Z. Focused totals overlap the full count and are not additive.
- Existing root retirement, remote-absence negative control/restoration, bounded scan, inventory cleanup fences and sibling/extended child-first cleanup steps all succeeded.
- Exact diff fa061f1..d7348fd: 2 commits, 5 files. New service (41 lines), repository (185), integration test (282), plan document (52), and 3 additive focused CI lines. No existing runtime producer/consumer, migration, dependency or gate configuration was changed.

### Review and verification boundary

The integration fixtures create the parent through the existing CampaignCreateService, independent approval service, signed gateway/client and real PostgreSQL. They then prepare the child through the existing AdgroupCreateService. Authority rows and Naver responses are synthetic. Per-subtest pools/schemas are closed and dropped; sequential table snapshots avoid retaining a growing fan-out of test connections. An independent transport-error accumulator checks assertions even if a service catches an injected transport error, and a global fetch trap rejects accidental external requests.

Executed cases cover exact state preservation; unapproved/approved/already-expired plans; token expiry versus plan expiry; 1ms expiry boundary; default OFF and Admin/Customer/input guards; parent snapshot and child metadata provenance; used tokens, locks, returned IDs, foreign descendants and released child risk; a real committed child claim with zero child POST; a genuinely created child; both audit-insertion rollbacks; final identity/clock drift; copied input/actor during connection acquisition; independent-pool concurrency/reconstruction; both COMMIT-send and COMMIT-acknowledgement failure; tampered prior-retirement proof; suspension/read-write gates OFF; and continued parent-cleanup denial.

Inline review checked the bounded write set, producer-order lock prefix, immutable child/parent bindings, parent-risk preservation and absence of transport/replanning hooks. No independent reviewer, real advertising canary evidence, operational readiness or warning-free execution is claimed. Existing action Node-version deprecation and SQLite experimental warnings remain.

### Resume boundary

This completes only the internal **adgroup plan retirement** unit. Adgroup **replanning is not supported yet**, as explicitly returned by the service. Historical child objects/events still block fresh child prepare and parent cleanup. A successor must introduce proof-validated retirement history/generation selection across the existing adgroup producer, dispatch, sibling and cleanup consumers before it can safely create and independently approve a replacement. Do not just filter out old planned objects or terminate the live hierarchy run.

Keyword/creative sibling retirement and cleanup-plan retirement/replanning remain pending. Remote inventory still does not establish deletion-safe complete absence, and parent cleanup vetoes remain unchanged. No HTTP/bootstrap wiring, evidence issuer, live activation, production mutation or risk refund has been introduced.

This ledger update is documentation-only above canonical d7348fd. The successor commit/run and tracker-comment IDs must be taken from the actual ensuing GitHub results, not inferred in advance. PR #24's recovery branch is separate and does not gain this PR #28 code merely by receiving a tracking comment.
