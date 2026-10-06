# Sibling retirement atomic-batch boundary verification

Continuation date: 2026-09-23. Issue #26 / Draft PR #28.
Runtime base: `3fa0e636e8c827530446709c14fc6cee220fae16`.

## Scope

This continuation preserves the inherited expired-unused keyword/creative plan retirement implementation. It adds a CI regression-sensitivity runner and changes the existing focused CI command to invoke it. No production source, integration test, schema, dependency, runtime gate, approval scope or replanning capability is changed by this verification unit.

The existing service expires only an unused creation plan and preserves its live campaign/adgroup ancestors, historical leaf objects, approvals and consumed ancestor risk. The per-member condition in `PostgresSiblingPlanRetirementRepository.#binding` rejects a batch containing any non-planned leaf, returned remote ID or deletion timestamp. A partial/unknown or claimed plan is not unused. Retirement remains local-only and does not establish remote absence or replacement authority.

## Executable sensitivity check

Run from `smartstore-bridge`:

```sh
node scripts/verify-searchad-sibling-retirement-boundary.mjs
```

The runner executes the unchanged real-PostgreSQL integration suite three times in separate Node processes:

1. Require a passing baseline with no skipped, cancelled or todo tests.
2. In the disposable checkout only, remove the exact single occurrence of `o.state!=='planned'||o.remote_id!==null||o.deleted_at!==null||` from the batch-member predicate. Preserve the surrounding type, parent, operation, plan, provenance, approval, ownership and risk checks. Require exactly three existing nested tests to fail with `Missing expected rejection.`: one returned keyword ID, one dispatching keyword and one manual-review keyword. The wrapper must be the only additional failed test, all other tests must pass, and the total number of tests must match baseline.
3. Restore the exact original source bytes in `finally`, require the restored suite to pass with precisely the original counts, and require `git diff --exit-code` for the production file to be clean. The normal full regression suite runs afterward.

The script prints the actual baseline, negative-control and restored totals. Counts are derived from executed TAP, not guessed from a previous checkpoint. Syntax/import errors, missing PostgreSQL, extra unrelated failures, missing test names or an un-restored source cannot count as a successful sensitivity check.

This checks sensitivity of three specified existing batch-state regressions. It does not claim every guard has an independent mutation test. Actual sibling creation, signing/gateway and PostgreSQL components are used by the integration fixtures; Naver responses and authority rows are synthetic, with an external-fetch trap. No live Naver API request or production advertising action is performed.

## Review and handoff

Review focus: exact source-marker uniqueness, unchanged test cases, exact failure identities rather than mere nonzero exit status, byte-for-byte restoration even after an assertion/child timeout, and no false success when a test is skipped. This is an author self-review; no independent review approval is claimed.

Keep runtime code and the original implementation ledger unchanged. Record actual verification SHA/run/job, numeric results, exact diff and remaining work in PR #28 / Issue #26 checkpoint comments after CI completion; do not create another documentation-only CI loop.

Keyword/creative **replanning remains unsupported** (`replanningSupported:false`). Historical planned leaves still block fresh sibling planning and parent cleanup. Cleanup-plan retirement/replanning, general lifecycle integration/evidence, deletion-safe parent absence and final acceptance remain separate pending work. Keep #26/#23 OPEN and PRs #28/#24 Draft/unmerged. No merge, deployment, operational migration/DB/gate change, replay or risk refund is authorized by this check.
