# SearchAd PR #11 integration recovery — 2026-09-06

## Scope and baseline

- Repository: `jskjw157/AtelierPopo`; branch: `codex/searchad-write-execution-v0.7.0`.
- Inspected parent: `593b440e8a542e5cd6dc111b3e83872c5fccbad3`.
- This change repairs the existing execution foundation, not a new SearchAd design.
- The approved policy remains: implement all officially supported and account-authorized SearchAd functions, then enable them after real-account Capability/Canary verification. Initial OFF gates are temporary.
- No live credentials, campaign changes, remote product synchronization, production deployment or branch merge were performed by the tests.

## Root causes and changes

1. **Gateway signature:** the adapter passed a single descriptor object to `execute`, but the production gateway takes `(operationKey, input)`. It now uses that explicit contract; speculative method-name fallbacks are removed.
2. **Read/mutation separation:** verification reads require `sideEffect === false` in the pinned manifest. A mutation cannot be smuggled into plan/preflight/reconcile reads. Mutation calls require `sideEffect === true`.
3. **HTTP error projection:** sanitized remote/write errors retain a recognized error type so gate, drift and token errors reach HTTP callers with their intended status and code. Nested sensitive details remain redacted.
4. **Master write switch:** execute and rollback check `ATELIER_HTTP_ALLOW_WRITES` before network I/O or token consumption. Read-only reconciliation remains available during a write stop.
5. **Legacy generic endpoint:** direct mutation payloads no longer bypass the saved approval flow. The same endpoint delegates to the same execution service using a matching `planId`, `customerId`, single-use token and idempotency key. Approved request values cannot be overwritten at execution time. Read operations retain their existing behavior.
6. **Audit correlation:** mutation attempts now retain `upstream.requestId` from the real gateway envelope.
7. **CI:** migration discovery explicitly includes `0006_searchad_write_execution.sql`. The SearchAd job supplies `TEST_DATABASE_URL`, uses non-TLS only for its disposable localhost PostgreSQL service, runs required schema integration tests and watches the full application dependency graph.
8. **Safety scan:** the exact declaration rejecting `rawUrl` is not mistaken for an executable raw URL reference. The scan still rejects raw network calls and raw URL references elsewhere; a positive/negative regression test verifies that distinction.

## Generic execute compatibility contract

```http
POST /api/v1/searchad/operations/{operationKey}/execute
Authorization: Bearer <application-key>
Idempotency-Key: <request-key>
Content-Type: application/json
```

For mutation operations:

```json
{
  "planId": "<previously approved plan>",
  "customerId": "<same customer as plan>",
  "executionToken": "<single-use approval token>"
}
```

`idempotencyKey` in the JSON body is also accepted. `body`, `query`, `pathParams`, raw URLs, confirmation overrides and other extra fields are rejected on this compatibility route. The mutation descriptor is taken only from the stored approved plan. Successful writes return HTTP 200 with `{ok:true,result:<verified plan>}`, not the old unverified HTTP 202 queue receipt. OpenAPI documents the change. Missing plan IDs return `SEARCHAD_CHANGE_PLAN_REQUIRED` with the plan endpoint, not a permanent-write-prohibition message.

## Regression evidence

The new HTTP fixture uses the **pinned official manifest and actual credential registry, signing client, gateway, remote adapter, SQLite services and HTTP server**. Only the upstream network boundary is simulated. It does not simulate a different gateway signature.

Recorded baseline: 136 tests, 134 passed, 1 failed (migration list), 1 skipped (PostgreSQL unavailable locally).

Before fixes: the updated adapter regression and new integration suite failed as expected, including the real signature mismatch and unapproved generic mutation acceptance. After the adapter fix, seven HTTP guard/delegation cases still failed; those passed after the HTTP fixes.

Local verification commands:

```sh
npm run check
node --test test/searchad-write-*.test.js
npm test
node scripts/searchad-write-safety.mjs
npm run commerce:coverage
npm run searchad:coverage
git diff --check
```

The local environment has Node 22.16.0 but no PostgreSQL server. Local full-suite result at this revision: 156 tests, 154 passed, 0 failed, 2 explicitly skipped PostgreSQL integration tests. The required PostgreSQL 16 CI job is the authority for those integration tests, migration first/second pass, and the production dependency audit. A green local run is **not** a claim that those CI or live-account checks have passed. Attach final CI evidence to PR #11 after the push.

## Remaining before production activation

This patch does not complete the whole operational roadmap. In particular:

- SearchAd write runtime is still SQLite; a PostgreSQL schema is not a PostgreSQL runtime adapter.
- Persisted per-customer Capability/Canary promotion and object-scope enforcement still need work.
- Mutation/read/rollback target binding, field-policy limits and broad role isolation need a dedicated review.
- Cross-plan entity locking, crash recovery and unknown rollback reconciliation require further work.
- Create validators, batch partial-failure compensation, deletion workflows, Active Canary, limits, automation and reports remain tracked follow-up work.
- Existing channel-product exact matching/merge/API completion and production deployment SHA verification are separate tasks.

Do not turn on real-account writes merely because this repair or its CI passes. Continue from the verified PR head, finish the remaining gates, then perform the approved real-account rollout without dropping the full-function target.
