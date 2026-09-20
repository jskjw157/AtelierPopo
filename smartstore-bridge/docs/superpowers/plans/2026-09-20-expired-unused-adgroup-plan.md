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

- [ ] RED: commit tests plus focused CI; inspect the explicit missing-export assertion on real Actions, not a skipped PG suite.
- [ ] GREEN: implement the two new internal modules, leaving all existing producer/consumer source and schema unchanged.
- [ ] Verify focused and full regression completed output, including preservation, expiry boundary, old tokens, prior-work refusal, actual committed child claim, rollback, context/time drift, input copying, concurrency and COMMIT ambiguity.
- [ ] Review exact diff, record evidence and remaining replanning boundary in this ledger, PR #28, Issue #26 and parent tracking where appropriate. Do not close #26.

## Execution ledger

Starting head: fa061f110092b460e29e5f687b4ef8634f944008. Its previously pending documentation CI 35505839087/job106065392446 is now completed/success, including full regression.

Pre-flight: existing child producer stores parentRemoteId/parentCreatePlanId/parentAfterHash/activationId in before_json, with immutable adgroup_plan event+attempt. Retirement must consume that exact binding. Existing producer refuses any prior adgroup history and parent cleanup refuses a planned child; this unit preserves both restrictions.
