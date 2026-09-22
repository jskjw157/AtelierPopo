# Expired unused keyword/creative sibling-plan retirement

> Execute inline with Superpowers TDD and verification-before-completion. Issue #26, Draft PR #28.

## Intent and scope

Continue the approved expired-unused-plan backlog from c48cf46a809a269c8d5eb7baa05346a6f07a40e9. Retire a wholly unused keyword batch or TEXT_45 creative CREATE plan locally without terminating the live campaign/adgroup run. Existing root and generation-2 adgroup work must remain intact.

Ruling: implement sibling retirement, not sibling replacement generation, in this unit. The existing sibling producer/cleanup contracts assume one sibling_plan and one ordered objectIds batch; returning a replacement without adapting those consumers would strand or misidentify children. Cost: explicit sibling replanning remains a subsequent unit, not silently claimed complete.

Ruling: no local checkout/PG is mounted and the prior development runtime artifact has expired. Use the designated Draft branch, immutable Git trees/fast-forward ref updates and disposable Actions PostgreSQL. Do not claim a local worktree or local full-suite run. Preserve the pre-existing development-snapshot workflow unchanged.

## Interfaces and invariants

- SiblingPlanRetirementService({repository,enabled=false}).retire({customerId,hierarchyRunId,parentObjectId,planId,kind,confirmation},context).
- kind is keywords or creative. Confirmations are RETIRE_EXPIRED_UNUSED_KEYWORD_PLAN and RETIRE_EXPIRED_UNUSED_CREATIVE_PLAN respectively. No caller objectIds, remote IDs, token, actor, body or expiration overrides.
- PostgresSiblingPlanRetirementRepository({pool,dailyBudget,current,clock}).retire receives a copied local scope with actorPrincipalId; it has no transport/approval/prepare adapter.
- Verify exact ancestor creation snapshots and current adgroup-generation proof; only the current owned adgroup may be selected. Read all linked objects/holds/audits, including malformed foreign links.
- All IDs from the original sibling_plan must be unique, exact, ordered and complete. All target leaves must still be planned, remote-id-null, undeleted, unchanged since planning and have no ownership hold.
- Compare the original descriptor, exact before_json/hash, ordered objectIds, planning hierarchy event and planning write attempt. The existing sibling planning attempt stores details without planId and with NULL request_fingerprint; do not invent a different producer contract.
- Plan itself must be expired. Approval expiry alone is insufficient. Reject any used token, execution lock, risk intent even released/wrong-owner, non-planning attempt, result, partial/duplicate/malformed response, claimed/unknown/applied state, extra sibling or competing cleanup history.
- Preserve all objects, holds, live run, old approvals, ancestors' consumed risk/capacity, activation/evidence and descriptors. Only target plan status/last_error plus exactly one hierarchy event and one write-attempt audit may change.
- Audit sibling_plan_retired/expired_unused with lifecycle_kind NULL; targetRemoteDispatched:false, runTerminated:false, replacementCreated:false, requiresNewApproval:true, replanningSupported:false, cleanupAuthority:false. Audit contains fingerprints/ordered local IDs, not keyword text, creative body, token or raw error.
- Repeats/concurrency require exact prior retirement proof. Audit failure rolls back. COMMIT uncertainty reports COMMIT_UNKNOWN and discards the connection; never return replacement/send authority. Recheck server identity and monotonic time after final audit I/O.
- Default OFF, internal only, no migration/dependency/gate/HTTP/bootstrap change. No main/base merge, deployment, live Naver request, deletion, risk refund or guessed IDs. PR #28 remains Draft and #26 OPEN.

## Task and test gates

- [ ] RED: test imports require the missing service/repository, then real-PG cases use existing CampaignCreateService, AdgroupCreateService, SiblingCreateService and approvals with trapped/synthetic signed upstream calls. Pin test in the WIP workflow and inspect expected failure.
- [ ] GREEN: add the two internal modules. No edits to existing producer, generation or cleanup runtime modules.
- [ ] Verify both types, generation-2 parent, batch atomicity, exact expiries, original audit shape, preserved ancestors/tokens/risk, partial/claimed/malformed/used-token rejection, tampering/foreign links, rollback, identity/time drift, caller copying, independent-pool concurrency, COMMIT ambiguity and continued prepare/parent-cleanup refusal.
- [ ] Run full npm test; inspect completed logs, review exact feature diff, record evidence in tracker comments without a docs-only CI loop.

## Review focus

A retirement flag cannot erase a returned/unknown object. Batch order must come from immutable producer history, not UUID sorting. Parent risk is expected old work, not refundable child work. A valid generation-2 parent must not cause its retired generation-1 object to be mistaken for a sibling. Foreign links and execution records must not be hidden by tenant or owner filters.

## Execution ledger

Base c48cf46, prior full-suite checkpoint 806/806. Current feature is not yet verified. Append actual RED/GREEN SHAs and completed CI evidence to PR #28/Issue #26; no inferred counts or independent reviewer claim.
