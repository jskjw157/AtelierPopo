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

- [x] RED: add real producer/PG tests and run focused Actions. Missing new exports failed the explicit availability assertion; a skipped suite was not counted as RED.
- [x] GREEN: implement service and repository only after inspecting that failure. Default OFF rejects before DB access; current identity is server-injected and synchronous.
- [x] Verify: unapproved and approved expiry, exact time boundary, already-expired plan from approval service, explicit fresh prepare/approval/execution with synthetic transport, old-token denial, scope/role rejection, prior-work refusal cases, storage rollback, context/time drift, concurrent calls and COMMIT ambiguity.
- [x] Inspect focused and full npm test completed logs. Review changed-file scope. Append exact evidence to PR #28 and Issue #26, without treating this bounded unit as complete #26.

## Execution ledger

Starting head: `77945a95a3dd7f73bbc235085a18e3e56e73c3d0`. Pre-flight: new retirement consumes unchanged producer records and changes only the old plan/run states plus audit; subsequent fresh prepare/approval stays in existing services. No runtime edits are needed to teach creation to ignore old events because the replacement has a new hierarchy run.

**Task 1: complete — bounded root campaign CREATE plan retirement only.**

- RED `16584c7ec1d6db390924096669e9666498f8d88a`: Actions run `35505108120`, job `106063480005`, explicit `CampaignPlanRetirementService must be implemented` assertion failed because the service did not exist.
- Implementation `98db1eb52c45ed92c0ddc43fea55e4a793a3b1ad`: first run `35505248401`, job `106063838269`, was NOT green. First12 nested cases passed; retained fixture pools plus parallel12-table snapshots exhausted the PG client limit (`53300: sorry, too many clients already`).
- Ruling: change only fixture snapshots to sequential table reads rather than raise the server client limit or weaken concurrency tests. Real independent-pool cases remain. Test-only correction `cd3b746ccd8528522efd71a3bdb4f8a76203a5f5`; compare confirms one test file +7/-1 and no production change for the failure.
- **Verified code/test SHA `cd3b746ccd8528522efd71a3bdb4f8a76203a5f5`: Actions run `35505466878`, job `106064408924`, completed SUCCESS.** Completed decoded logs inspected: retirement integration24 nested plus wrapper = **25/25 PASS**; full bare `npm test` **769 passed / 0 failed / 0 skipped / 0 cancelled**, `1..353` top-level. Focused counts overlap with the full suite.
- Existing scan PG11/11, scan unit12/12, inventory-to-cleanup fence12/12, sibling/extended cleanup checks and remote-absence disposable negative-control/restoration remained green. Existing action/runtime deprecation and SQLite experimental warnings remain; this is not a warning-free claim.
- Base-to-verified-head comparison:3 commits, exactly5 files: new service, new repository, new integration test, this plan document and3 added workflow lines. Existing runtime source, schemas, dependencies and gate configuration are unchanged.
- Durable checkpoint: PR #28 comment `5749291694`; Issue #26 RESUME HERE comment `5749293696`. This ledger update is documentation-only and does not change the tested implementation.

## Acceptance scope and limits

Real migrations, PostgreSQL persistence, existing campaign producer/approval/dispatch code and signed gateway are exercised. Activation rows and upstream transport are synthetic. The explicit replacement acceptance case sends one POST only to fixture transport after its new approval; it is not a live Naver call. No independent review approval or operational lifecycle evidence is claimed.

Local retirement is not an upstream delete, remote absence proof, mutation retry, risk refund or automatic replacement. It retains historical object/approval records. A locally failed retired run does not mean the remote system rejected a request; the eligible request was never dispatched. Uncertain commit acknowledgement is reported as unknown and requires inspecting the same local scope.

Child/sibling-create and cleanup-plan retirement/replanning remain pending. A run containing remote objects must not be terminated using this root-only rule. Deletion-safe remote completeness/consistency and all-writer observation-to-mutation fencing also remain unresolved. No parent cleanup authority, HTTP/bootstrap integration, main merge, deployment, production migration or operational gate change was added. Keep Issue #26 OPEN and PR #28 Draft/unmerged.
