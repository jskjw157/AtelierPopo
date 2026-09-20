# Expired unused campaign-plan retirement implementation plan

> **For agentic workers:** Use superpowers:executing-plans. This continues the approved Issue #26 expired-unused-plan backlog item without reopening completed inventory work.

**Goal:** Retire a genuinely expired, never-dispatched root campaign creation plan locally, then permit an explicitly requested fresh prepare and separate approval through the unchanged campaign producer.

**Architecture:** New default-disabled internal service validates exact local scope and Admin identity. A new PostgreSQL repository locks the existing account/run/object/plan rows in producer order, validates original plan provenance and absence of any dispatch evidence, and commits plan expiration, local run failure and two sanitized audit records atomically. No transport or automatic replacement is injected.

**Tech Stack:** Node.js 22 ESM, node:test, PostgreSQL 16, existing migrations 0006/0009.

**Spec:** Issue #26 and its verified handoff comment 5748454078; exact existing CampaignCreateService/PostgresCampaignDispatchRepository and immutable campaign_plan provenance at starting SHA 77945a95a3dd7f73bbc235085a18e3e56e73c3d0.

## Global constraints and bounded ruling

- Only a single planned root campaign with no returned ID, ownership, child, dispatch/transport event, non-planning attempt, execution lock, or risk reservation is eligible.
- The plan itself must be expired; an expired approval alone does not suffice. Existing planned/approved/expired statuses are supported only with unused approvals.
- Retain original descriptors, local object, approval rows, tokens' stored hashes, immutable events and risk accounting. No physical DELETE, risk release, approval reuse, inferred remote ID, lifecycle evidence or PASS.
- Existing schema supports plan expired and run failed. Use these states with an explicit UNUSED_CAMPAIGN_PLAN_EXPIRED reason; failed means local never-dispatched run ended, not an observed upstream failure. Keep the historical object planned, not deleted.
- A fresh plan/run/approval must be created by existing services in a separate call. Retirement itself creates no replacement and grants no remote write permission.
- Ruling: first bounded implementation covers root campaign CREATE plans only. Child/sibling creation and cleanup-plan retirement require their own provenance/replanning work and remain pending. Parent-absence uncertainty and inventory veto stay unchanged.
- Ruling: no local repository checkout is mounted. Use immutable Git trees on the existing designated Draft branch and real disposable Actions checkouts/PG for execution; do not claim a local git worktree or independent review.
- Preserve Draft PR #28, Issue #26 OPEN, main, deployment, operational gates and production database. No live Naver request.

## Review focus

1. A used older approval, any released risk, or a committed intent without an actual send must block retirement.
2. Original producer event/attempt and descriptor hash must bind exact run/object/plan; state flags alone are insufficient.
3. Account-to-plan locking must serialize existing dispatch, concurrent retirement and fresh planning without stale success.
4. Identity and time must be revalidated after audit I/O; storage failure or uncertain COMMIT must not return success.
5. Repeated local retirement may return unchanged only when its exact prior retirement proof is intact; old tokens must not authorize a replacement.

## Task 1: Eligibility, atomic retirement and explicit replan acceptance

Files:
- Create src/naver/searchad/lifecycle/campaign-plan-retirement-service.js
- Create src/naver/searchad/lifecycle/postgres-campaign-plan-retirement-repository.js
- Create test/postgres-searchad-campaign-plan-retirement.integration.test.js
- Add one focused command to .github/workflows/searchad-extended-cleanup-wip.yml

Interfaces:
- Service: new CampaignPlanRetirementService({repository,enabled=false}).retire({customerId,hierarchyRunId,hierarchyObjectId,planId,confirmation},context).
- Confirmation: RETIRE_EXPIRED_UNUSED_CAMPAIGN_PLAN. Caller actor, remote ID, expiry, status, token and payload overrides are rejected.
- Repository: new PostgresCampaignPlanRetirementRepository({pool,dailyBudget,current,clock}).retire(copiedScope).
- Result identifies local scope, planStatus expired, runStatus failed, changed boolean, remoteDispatched false, replacementCreated false, requiresNewApproval true.

- [ ] RED: add real producer/PG tests and run focused Actions. Missing new exports must fail the explicit availability assertion; do not report a skipped suite as RED.
- [ ] GREEN: implement service and repository only after inspecting that failure. Default OFF rejects before DB access; current identity is server-injected and synchronous.
- [ ] Verify: unapproved and approved expiry, exact time boundary, already-expired plan from approval service, explicit fresh prepare/approval/execution with synthetic transport, old-token denial, scope/role rejection, all prior-work refusal, storage rollback, context/time drift, concurrent calls and COMMIT ambiguity.
- [ ] Inspect focused and full npm test completed logs. Review changed-file scope. Append exact evidence to PR #28 and Issue #26, without treating this bounded unit as complete #26.

## Execution ledger

Starting head: 77945a95a3dd7f73bbc235085a18e3e56e73c3d0. Pre-flight: new retirement consumes unchanged producer records and changes only the old plan/run states plus audit; subsequent fresh prepare/approval stays in existing services. No runtime edits are needed to teach creation to ignore old events because the replacement has a new hierarchy run.
