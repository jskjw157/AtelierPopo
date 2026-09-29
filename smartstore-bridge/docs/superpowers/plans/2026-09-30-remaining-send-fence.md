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
- [ ] Add six real-PostgreSQL regressions: update, rollback, Canary create/update/restore/cleanup. Commit tests first and inspect behavioral RED.
- [ ] Add explicit method-bound fence scope and private gateway facade; wire only the two PostgreSQL runtime adapters. Fail closed without a supported final transport; never fall back to an unfenced mutation.
- [ ] Verify no shared-client mutation, wrong-scope/transport/identity rejection, original read recovery, no replay, and prior lifecycle regressions.
- [ ] Run focused and full CI, inspect exact SHA and counts, review diff, record final evidence on PR without a documentation-only CI loop.
