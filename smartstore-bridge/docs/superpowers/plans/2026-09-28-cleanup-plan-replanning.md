# Expired unused child-first cleanup plan retirement and explicit replacement

Starting SHA: b08970338eec8a767f326dde44be4a7925538505. Issue #26, existing Draft PR #28. User requested continuation of the remaining work; the latest handoff identifies cleanup-plan expiry/retirement/replanning as next.

## Intent and constraints

Allow an Admin to retire an expired DELETE plan only when that particular plan was never claimed/dispatched. Preserve the actual remote object, owned/quarantined hold, run state, all old approvals and all creation risk. A separate explicit action may create one replacement deletion plan for the SAME target and request. It still requires fresh authority, a separate new approval token, destructive confirmations, authoritative preflight and one DELETE followed by independent GET404.

No operating-account calls, deployment, production DB/gate changes, schema/dependency changes, HTTP/bootstrap exposure or main/base merge. #26/#23 stay OPEN and #28/#24 Draft/unmerged. This is not a complete remote-absence proof or live lifecycle evidence.

## Bounded design / rulings

- Existing ChildFirstCleanupService / repository are the execution path. Add internal retirePlan and replan methods; keep ordinary prepare's prior-history rejection.
- Exact retire confirmation: RETIRE_EXPIRED_UNUSED_CLEANUP_PLAN. Exact replan confirmation: REPLAN_EXPIRED_UNUSED_CLEANUP_PLAN. Caller provides only Customer/run/object and old-plan identifiers, plus a new activation ID for replan. No caller remote ID, target payload, time, actor or approval reuse.
- Retirement validates original delete/read descriptors, target/create metadata, planning event AND attempt, expiry, unused approval history, absent execution lock/risk/intent and unchanged pre-dispatch target state. It changes only old plan status/last_error and appends a non-authorizing event+attempt. Audit lifecycle_kind is NULL, not deletion evidence.
- Terminal local reason: UNUSED_CLEANUP_PLAN_EXPIRED. Result explicitly says targetRemoteDispatched:false, replacementCreated:false, cleanupAuthority:false. Existing object may have been created remotely; this is not a statement about the whole run.
- Replacement metadata pins cleanupGeneration:2, predecessorPlanId, predecessorRetirementEventId and predecessorRetirementHash. All old rows remain in locked graph/signatures/inventory vetoes. Only one replacement is supported; generation 3 and retiring a replacement are out of scope.
- Binding/execution/GET-only recovery/descendant deletion-proof consumers must validate the same complete predecessor chain. No history filtering based on expired flags alone. Exactly one target DELETE intent may exist across both generations, belonging to the replacement.
- Local retirement is allowed while remote gates are OFF/account suspended; explicit replan and execution remain subject to existing authority and inventory/parent safeguards. Retirement is not a mutation permission.
- Root campaign-only cleanup (CampaignCleanupService) is a separate path and remains unchanged. This unit covers supported targets of ChildFirstCleanupService, including owned leaves, known partial quarantine leaves, adgroup and campaign in that graph.
- Remote downloads and local PostgreSQL are unavailable in the container; immutable Git trees on the approved branch plus disposable Actions PostgreSQL provide isolation and execution. No local full checkout/worktree or independent reviewer is claimed.

## Steps / verification ledger

1. Add actual PostgreSQL integration and a focused CI step. Observe method-availability RED, not a skipped DB test.
2. Add strict cleanup-plan history validation, local retirement, explicit replacement and generation-aware cleanup binding/deleted proof. Preserve generation-1 behavior outside this feature.
3. Run focused tests; fix actual failures without weakening invariants. Run full npm test, existing absence-veto sensitivity and sibling/adgroup/campaign regressions.
4. Inspect completed exact-HEAD logs and compare. Record final evidence and remaining limits in PR #28/#26; no documentation-only commit loop needed.

## Review targets

Old tokens/objects/ownership/risk are not recycled; approvals/risk tied to ambiguous DELETE veto retirement; unexpired plans cannot be retired merely because a token expired; two pools yield one retirement and one successor; both audit writes roll back; COMMIT uncertainty never returns success; old and forged target IDs fail before reads; final identity/clock drift aborts; partial parents and unproven inventory stay blocked; replacement deleted proof works without treating predecessor as absence.

The exact full-test count must come from this session's completed logs; do not copy either of the contradictory prior conversational totals.
