# Root-only campaign cleanup retirement and replacement

Baseline: 339d96647a927bafbe0e81e8b49b1a024416517a; existing Draft PR #28 branch codex/searchad-extended-cleanup-20260914. User requested continuation of this explicitly named next bounded unit.

## Intent and boundaries

Extend the existing CampaignCleanupService only: locally retire an expired, never-claimed first DELETE plan, retain its campaign and all creation/approval/risk history, and explicitly prepare one new deletion plan with a new approval. This is separate from campaign CREATE retirement and ChildFirst cleanup replacement. Never resurrect the old token, replay an ambiguous deletion, infer a target, refund risk, or convert inventory into absence authority. No new HTTP/bootstrap integration, migration, dependencies, default gate changes, deployment or main/base merge.

## Design and rulings

- Ruling: retain root-specific metadata and audit phases rather than translating root events into ChildFirst provenance. Cost is a small separate validator; avoids inventing equivalence between owners.
- Ruling: permit one successor only. Generation 3 and retiring a successor remain rejected.
- Ruling: local retirement requires Admin/exact local scope and current identity, but not a live delete grant, unsuspended account or remote read/write gates. Replanning retains existing owned/inventory/authority checks and requires explicit predecessor plus new approval.
- Ruling: load exact target-linked history without Customer filters that could conceal corrupt rows. Validate predecessor again during execution and recovery; retain history in stale-read signatures.
- Ruling: this container has no GitHub DNS or PostgreSQL server. Use immutable Git tree edits on the existing isolated WIP branch and its Actions PostgreSQL service. Local checks are syntax only, not a full checkout, worktree or local integration pass.
- Ruling: continue the already-requested bounded flow without a new approval loop. Broader architecture remains outside this unit.

## Interfaces

CampaignCleanupService.retire/replan -> root repository -> first-plan retirement proof -> generation-2 execution/recovery. Existing approval service remains the only token issuer. Inventory remains a veto, never authority. Existing generic recovery owner veto must still reject root cleanup targets.

## Verification ledger

- [ ] RED: new integration fails for the absent root maintenance methods, not import or infrastructure failure.
- [ ] Implement root maintenance and complete-history plan selection without changing legacy plan metadata.
- [ ] GREEN: new real-PostgreSQL cases, existing root/child cleanup and full npm test; inspect completed logs and exact counts.
- [ ] Review actual diff, document any limits, persist verified checkpoint and next work in #28/#26; keep Draft/open/unmerged.

Integration matrix: normal approved/unapproved expiry, approval-only expiry rejection, explicit predecessor, old token and retired recovery rejection, at-most-one successor, untouched history, suspended/local-only retirement, inventory veto, tampered descriptors/audits/reasons, foreign linked work, prior consumed/released risk, committed-zero-send and ambiguous deletion, separate-pool read-only recovery, audit rollback, final identity/clock drift, commit uncertainty, concurrency, role/scope/default-OFF gates.
