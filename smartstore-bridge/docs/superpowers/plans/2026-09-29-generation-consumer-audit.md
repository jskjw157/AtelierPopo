# Replacement-generation consumer audit Implementation Plan

> Use superpowers:executing-plans for this bounded continuation. Starting HEAD: cc335997c6688dfb486df4b49e126bd508ad1059. Issue #26; existing Draft PR #28.

**Goal:** Verify read-only inventory/recovery compatibility with retained historical generations, without letting a legacy reconciler bypass a plan-owning cleanup coordinator.

**Spec:** The existing 2026-09-28-cleanup-plan-replanning.md requires full predecessor/current history validation by recovery and deletion-proof consumers. The user explicitly requested continuing its next consumer-audit step.

**Architecture:** Keep inventory as non-authorizing observations of exact stored parent IDs. For objects managed by a dedicated cleanup plan, refuse generic hierarchy reconciliation before GET and again before settlement; the existing ChildFirstCleanupService.reconcile remains the supported GET-only path and atomically settles its current plan. Do not copy or weaken its generation proof into the older reconciler. Bind legacy reconciliation snapshots to audit changes as inventory already does.

## Constraints and rulings

- No main/base merge, deployment, production DB/gate change, live Naver request, migration or dependency change. #26/#23 OPEN, #28/#24 Draft/unmerged.
- Real PostgreSQL/services/approval/signing are exercised with synthetic upstream responses and test authority rows. These tests do not issue real lifecycle evidence.
- Ruling: retain the explicit plan-owning recovery boundary rather than silently routing an object-only generic request to a guessed current plan. This is intentionally a 409 requiring the dedicated coordinator, including generation 1. Cost: callers must choose the correct internal recovery service.
- Ruling: a local full checkout/PG server cannot be obtained here (network DNS unavailable). Use immutable Git tree edits and the existing isolated Actions PostgreSQL workflow; no local full-suite execution/worktree or independent-review claim.
- Ruling: no additional architecture/approval workflow is required to execute the already requested bounded audit and necessary regression fix. The existing plan and continuation constrain scope; unresolved broader architecture remains deferred.
- Test-adapter correction: the raw NaverSearchAdClient passes redirect=follow, whereas these bounded consumers are tested with an explicit no-redirect adapter. Initial RED f0dcb4b6 had three inventory failures from that fixture mismatch. Test-only 10a1a488 adds the no-redirect read wrapper (no assertion removed, no product change). Corrected RED proves all three inventory cases pass unchanged and isolates the nine intended failing guards.

## Pre-flight interfaces

- Cleanup producer -> generic reconciler: both share object/hold state, but generic repository neither loads nor settles DELETE plan/approval/risk/generation proof. Confirmed: generic reconciliation does not refuse the managed target, unlike its required owner boundary.
- Replacement producers -> inventory: inventory selects exact local parent IDs, includes historical rows, and does not map unresolved IDs or create cleanup authority. Actual producer-generated replacement keyword/creative/partial graphs pass without production inventory changes.
- Legacy unavailable observation -> repeated settlement: original signature omits event count. Confirmed: same issued snapshot can append repeated observations when state rows are unchanged.

## Tasks and verification ledger

### Task 1: Reproduce the consumer boundary in actual PostgreSQL
- [x] Add postgres-searchad-generation-consumers.integration.test.js and a focused workflow step.
- [x] Corrected behavior RED 10a1a488: run 36480705138 / job 109125338443 completed failure. Setup/PG/dependencies passed. Eight cases fail with Missing expected rejection (specialized); unavailable-observation replay fails with Missing expected rejection (stale). Three positive inventory tests pass. TAP 13 total / 3 pass / 10 fail (nine failing subtests plus parent), zero skipped/cancelled/todo. Later workflow steps were skipped because focused RED stopped the job; no full-regression claim.

### Task 2: Minimal bounded correction
- [x] In postgres-hierarchy-reconcile-repository.js, detect exact target-linked cleanup events or DELETE plans without Customer filters that could hide corrupt linked records. Reject before remote read and in the settlement transaction. No new dispatcher or permissions.
- [x] Include hierarchy audit count in the issued snapshot signature so intervening observations cannot reuse a stale receipt.
- [ ] Prove current-plan recovery still works via a reconstructed dedicated service with writes OFF/account suspended, no second DELETE, and old plan/approval/risk history intact.
- [ ] Prove corrupt predecessor rejection, new cleanup during GET, and replaced keyword/creative/partial inventory remains non-authorizing.

### Task 3: Verification and handoff
- [ ] Run the new focused PG test, previous focused regressions, sensitivity/restoration checks and the full npm test command on the exact published HEAD.
- [ ] Inspect completed logs and compare changed files; report exact observed totals rather than copying historical count claims.
- [ ] Append results/remaining work to #28/#26/#23/#24, preserving Draft/open status. No docs-only CI loop is required for final run IDs.

## Still outside this unit

Root-only CampaignCleanupService retirement/replanning, generalized generation 3, deletion-safe all-writer remote absence, suspend-to-send boundary, shared-risk/evidence issuer completion, app/HTTP/bootstrap integration, live acceptance and #18-#22 remain open. Inventory compatibility here is not complete generation-provenance validation of all legacy inventory input corruption cases. The owner veto is not a replacement for the dedicated coordinator's full history/authority proof.
