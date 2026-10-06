# Sibling replacement / real PostgreSQL cleanup integration

Issue #26; existing Draft PR #28 branch. Starting remote SHA: 813f9cbe2c08b5c50b519a13df9aa70d3a6c91bb.

## Agreed scope

Continue the provided local sibling replan patch through real PostgreSQL, current-generation child-first cleanup and partial quarantine. The provided 92 pure/scripted-DB tests are NOT a full repository or actual PostgreSQL run. Publish on the designated Draft branch only, verify exact head CI, and leave overall #26 open.

No main/base merge, HTTP/bootstrap/live activation, schema migration, production DB/gate change, upstream API call, risk refund, guessed ID or relaxed parent-absence rule. A local retired plan remains historical planned/no-ID, not a deleted remote object. Generation 3 and changed-kind/changed-payload replacements are out of scope.

## Decisions

- Reuse the supplied generation validator, explicit kind-specific replan scope and current-plan execution patch. Do not reset an old token or reimplement prior work.
- Independently validate COMPLETE locked predecessor/current history again in cleanup. Keep every historical object/event in signatures and inventory fences. Only after that proof select current generation-2 leaves in their metadata order.
- Preserve legacy generation-1 SQL ordering and result contracts. Do not silently reinterpret already-persisted batches.
- Extend existing exact-result and partial-result verifiers with the verified active plan and generation metadata; do not convert historical plans to fake generation-1 metadata or deletion/absence proof.
- Ancestor verification, separate approval, pre-delete GET, one DELETE attempt, post-delete GET404 and unknown/partial parent veto remain mandatory.
- The temporary container has only a source subset and no PostgreSQL runtime or reachable download network. Execution is on disposable Actions PostgreSQL 16; remote Git objects provide isolated exact-commit snapshots. No local full-checkout/worktree or independent reviewer is claimed.

## Steps / evidence ledger

1. Real PostgreSQL integration RED: e82f8df (test) + dd31ff6 (focused CI pin). Completed run35801759514/job106993463733 fails on `explicit keyword replan method is required` after successful PostgreSQL/setup/npm ci. This is method-availability RED, not a database-flow proof.
2. Published prior local source in 90738c5: sibling-generation-contract, sibling-replan-scope, service methods and plan-local repository writes. Completed run35802420876/job106995533743: 8 TAP total, 4 pass/4 fail (3 cases + wrapper). Real replan/create progressed; independent-pool serialization and PG audit rollback passed. Keyword/creative/partial cleanup fail exactly on old one-plan/one-batch assumptions. This is the targeted cleanup integration RED.
3. Implement current-generation cleanup selection and proof extension. Full locked history is checked before excluding retired IDs from targetable leaves; all rows remain in graph signatures. New helpers cannot authorize an old retired target or unresolved sibling.
4. Run focused, existing boundary-sensitivity checks, existing regression steps and full npm test to completion. Inspect exact-head logs; do not infer pass counts. Add additional guard tests where review exposes an untested boundary.
5. Record final source SHA, completed Actions run/job and exact counts in #26/PR #28 checkpoint comments, avoiding documentation-only CI loops. Only that verification record marks this unit done.

## Test boundaries

The new integration fixture uses real migrations, existing parent create/adgroup create/sibling retirement, approval repository, signature/gateway, replan transactions, current-batch create and actual cleanup services. Only upstream Naver transport and authority evidence/grant data are synthetic. A global fetch trap and independent signing-error accumulator forbid escaped calls or swallowed assertions.

Cases cover keyword and creative replacement with a separate fresh approval; old-token/old-target refusal; one DELETE and independent GET404 per current leaf; old object/plan/approval data AND xmin unchanged; an unproven inventory event still vetoing parent deletion; generation-2 partial response for request index 1 (not index 0); unresolved sibling and parent refusal; two independent pools with one successor winner; real trigger-induced audit failure rolling back objects/plan; tampered predecessor retirement proof; and unknown POST response without replay.

No live readiness or deletion-safe complete remote absence is claimed. Cleanup-plan retirement/replanning, lifecycle application wiring/evidence, all-writer suspend/remote-absence boundaries and broader operational roadmap remain separate work.
