# Remaining PostgreSQL Send Fence Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this continuation with TDD.

**Goal:** Order ordinary PostgreSQL update/rollback and initial Active Canary fetch entry against committed account suspension.

**Architecture:** Reuse the account-row fence through a private signed mutation gateway, not by monkey-patching the shared client. Keep existing lifecycle scopes POST/DELETE-only unless an exact additional HTTP method is explicitly bound. Preserve original read paths and all upstream approval/activation/intent checks.

**Tech Stack:** Node.js 22, node:test, PostgreSQL 16, existing SearchAd registry/client/gateway.

**Spec:** Approved continuation of PR #28 checkpoint 09d5d361; no new live capability.

## Constraints
- Draft PR #28 and existing branch only; no merge, deployment, live Naver call or production DB/gate change.
- No retries, token resurrection, risk refunds, inferred IDs or evidence/PASS fabrication.
- Fetch implementation entry ordering only, not packet delivery, cancellation or remote-writer fencing.
- Ordinary SQLite runtime and common-risk adoption are outside this change; do not claim all-writer closure.

## Tasks
- [x] Add six real-PostgreSQL regressions: update, rollback, Canary create/update/restore/cleanup. Commit tests first and inspect behavioral RED (c667280, run 36623870145, six expected assertion failures).
- [x] Add explicit method-bound fence scope and private gateway facade; wire only the two PostgreSQL runtime adapters. Fail closed without a supported final transport; never fall back to an unfenced mutation.
- [x] Verify no shared-client mutation, wrong-scope/transport/identity rejection, original read recovery, no replay, and prior lifecycle regressions. Initial candidate a522a307 passed the new PG focused step; method tests have local RED/GREEN evidence on exact baseline blob 948e0298.
- [x] Add distinct account-store composition regression. c5df792 / run 36625161038: 12 adapter/method tests passed, only the wrong-account-store case failed (one unexpected send).
- [ ] Run final focused and full CI, inspect exact SHA and counts, review diff, record final evidence on PR without a documentation-only CI loop.

## Rulings and limits
- Native activation repository.pool, not a potentially different write-plan database, is the authority for ordinary runtime account suspension. Repository-free injected guards retain the explicitly supplied pool as their account store; an existing repository without a usable pool fails closed at mutation.
- Initial Canary uses its own account repository pool; deployment must compose Canary and account-control on the same authoritative store. Cross-database distributed account control is not introduced.
- No activation-grant expiry redesign, common daily-risk adoption, SQLite fencing, live acceptance, or whole-app restart claim is included.
- Gateway protocol doubles are replaced with real signing/client transport in the existing successful PG write test. Unsupported abstract mutation transports are rejected, never used as an unfenced fallback.
- No independent reviewer tool is available; inline review and CI evidence are recorded separately from independent review.
