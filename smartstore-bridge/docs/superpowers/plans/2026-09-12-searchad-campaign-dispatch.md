# SearchAd campaign dispatch transaction implementation plan

> Use superpowers:executing-plans with TDD. This is a bounded prerequisite of #26-B2b/C/D, not completion of those tasks.

**Goal:** Atomically claim one approved, server-described stopped campaign creation, consume shared internal risk and persist a non-replayable dispatch intent.
**Architecture:** Add a separate PostgreSQL coordinator over existing 0006/0008/0009 tables. Preserve the old async executor, approval service, risk store, reconciliation and migrations. No HTTP or network dispatcher is wired in this slice. Existing callers do not automatically use this transaction.
**Tech stack:** Node22 ESM, node:test, actual PostgreSQL16; no dependency change.
**Source:** Master23/issue26; current c0668561e7306cfa802d3ab9eb960ee3531b8548. Scope follows the approved recovery plan's token+risk+dispatch requirement.

## Bounded contract

- Local IDs + executionToken only; authenticated Admin with explicit Customer grant. Copy inputs before awaiting. Default disabled.
- Exact single planned top-level campaign and run; matching pinned create/read/delete keys. No remote ID, parent, live child, or preexisting ownership. Only created/preflight_verified runs without completedAt. Reject other object types and any unresolved prior intent.
- Lock account -> run -> all run objects -> ownership -> plan -> approval -> risk advisory intent -> daily balance. Reconciliation's run/objects/ownership order remains compatible. No network I/O inside the transaction.
- Require the current checked-in registry to retain the exact public tier-B allowlisted POST /ncc/campaigns operation. Use the existing recipe to rebuild the exact descriptor from persisted run ID, explicit Customer and configured dailyBudget. Require matching stored plan; no caller descriptor/units/date/activation evidence accepted. Pin plan binding with canonical request fingerprint in immutable hierarchy dispatch event.
- Validate actual stored active-Canary grant AND evidence for Customer, spec, credential, upstream, operation and create lifecycle scope, expiry and namespaced field scope (campaign.campaignTp/name/userLock/dailyBudget). This stricter creation scope is new; old update-only evidence is not broadened. Require non-suspended account. A constructor-injected resolver supplies current identity, not authorization. Existing update-only or Passive evidence is insufficient.
- Token hash uses existing SHA256 convention and approval confirmation. Check plan/approval expiration after lock acquisition; verify unused token and exact plan binding.
- Derive UTC day, risk units and capacity from server configuration. Create the new intent directly consumed in the same transaction; preserve existing reserved/consumed balance. Do not reuse any old intent or silently change established daily capacity.
- Consume token, consume risk, set object dispatching and plan/run unknown_outcome, append immutable dispatch intent and write-attempt audit in ONE checked-out connection. Failure at any step rolls everything back; a lost COMMIT acknowledgement returns no dispatch authorization and must never cause a blind resend.
- A successful return is a committed LOCAL dispatch intent, NOT a Naver request or proof of exactly-once external side effect. No remote ID, ownership or PASS is manufactured. No risk-release method exists here.
- After-commit suspension race, cross-writer adoption, returned-ID settlement, actual create/read-back/child/batch/delete execution and app/HTTP are still pending.

## Tasks

- [x] Add actual PostgreSQL failure-first tests with per-case UUID schemas and real existing approval/risk repositories. Observe missing-coordinator RED before implementing it.
- [x] Implement isolated coordinator, fail-closed input/config/current-state checks and transaction.
- [x] Prove successful atomic writes, two-pool same-plan race, wrong scope/state/descriptor/token/grant, shared-capacity exhaustion, expiry after lock wait, failures after token/risk/state/audit writes, unknown-state reconstruction and commit-ack loss.
- [x] Run focused/repeated PG, full regression, syntax, preservation checks; no skipped PG accepted as success.
- [x] Publish narrow source/test/workflow diffs and verify canonical CI34680617480/job103518472081 completed/success at ecb817f6037253d909f8731de2c27792bcb0df25: full414/0/0, requiredPG124/0/0, repeatedcampaign41/0/0. Documentation-successor and tracker checkpoints are recorded separately in #26/PR24.

Transaction reference: https://node-postgres.com/features/transactions (same client), https://www.postgresql.org/docs/16/explicit-locking.html (transaction-held row locks). These justify implementation mechanics, not live Naver compatibility.

## Local evidence before publication

An exact344-blob snapshot of1aace72 was exported by a temporary read-only-permissions Actions workflow, with archive and source-blob hashes verified. Disposable PostgreSQL16.15 and Node22.16 run locally; this is a tracked-source snapshot, not an original-history clone. Full baseline373/0/0.

Observed missing-coordinator assertion RED before production implementation:0pass/1fail/0skip. Later manifest/field-scope and connection-error hardening also produced observed failures. Final local campaign suite41/0/0 (parent+40children), requiredPG124/0/0, full414/0/0, repeatedcampaign41/0/0; migrations0009/applied:[] twice. Focused counts overlap the full suite.

A temporary negative-control source committed approval before the remaining transaction: all four rollback fault tests failed, along with other dependent cases (33pass/8fail including parent). Exact production bytes were restored before final GREEN. The mutant is never published. This is not a claim that every behavioral scenario was independently observed RED.

No independent reviewer approval, upstream send, whole-app integration/restart or generalized lifecycle atomicity is claimed. Existing0007 start has not adopted this coordinator; only its risk service fixture competed for the shared balance. The temporary workspace-export workflow is removed in the implementation commit.
