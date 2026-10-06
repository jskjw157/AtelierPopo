# SearchAd #21 — implemented baseline acceptance, 2026-10-05 KST

## Result and scope

Verification commit: `ac4164168e745eea0361eede76917bbf10bf2ccd`.
Workflow: [37232432564](https://github.com/jskjw157/AtelierPopo/actions/runs/37232432564), job `111524788448`.
Final result: **completed SUCCESS**.

This checkpoint verifies the implemented 0001–0009 repository baseline. It does
not complete the reporting/Circuit/automation, worker/scheduler/validation, or
profitability work tracked by #18, #19 and #20. #21 remains OPEN for those
dependencies and the expanded execution-source safety acceptance.

## Changes made

Only `.github/workflows/searchad-extended-cleanup-wip.yml` changed in the
verification commit; production source, tests, migrations, dependencies and
operational settings did not change.

The prior successful run at `489ea119` (37188411579 / job 111395258090) ran
both migration steps after the tests had already migrated the shared database.
Both printed `applied: []`; those step names did not establish a clean first
application.

The new acceptance runs immediately after `npm ci`, before any tests. It asserts:

- the CI database's `public` schema initially has no tables;
- migration versions are exactly 0001–0009, with no duplicates;
- the first pass applies every checked-in migration, in order;
- persisted filenames/checksums match the checked-in files;
- the immediate second pass returns `applied: []`, version 0009, with unchanged
  migration metadata.

The post-suite migration step remains as an additional idempotency observation.
Static acceptance now checks all **191 tracked JavaScript source/script files**,
including lifecycle and role HTTP/OpenAPI files outside the package's fixed
`npm run check` list.

## Observed verification

| Item | Evidence |
| --- | --- |
| Fresh dependency install | `npm ci` succeeds |
| Clean PostgreSQL database | Empty public schema; first pass applies all nine migrations |
| Immediate repeat | No new migrations; version 0009; checksum metadata unchanged |
| Full regression | **1059/1059 PASS**, 453 top-level; fail/cancelled/skipped/todo all 0 |
| Focused hierarchy/HTTP/restart/send-fence suites | Every configured focused step succeeds |
| Static | `npm run check`, all tracked source/script syntax checks and base-to-HEAD `git diff --check` succeed |
| Changed-file token-pattern scan | Configured private-key/GitHub-token/OpenAI-key patterns not found |
| Legacy write safety scan | 20 required files, 16 write source files; reported raw network calls 0 |
| Commerce manifest coverage | 116 expected/actual/classified/unique operations |
| SearchAd pinned manifest | Ref `8e250490ab748367a627213f7d7a2917e005cb10`; nine sources; 126 unique operations; 117 runtime-allowlisted |
| Manifest leak checks | Internal/deprecated runtime leaks 0; unclassified 0; duplicate operation keys 0 |
| Production dependency audit | `npm audit --omit=dev --audit-level=high` succeeds; found 0 vulnerabilities |

The manifest coverage count is **not** a count of a completed 126-operation
validation registry. That descriptive validation registry is still #19 work.

The legacy safety scanner's zero applies only to its 16-file `write/` scope.
It is not proof that all canary/lifecycle/reporting/circuit/automation/worker/
validation execution sources have completed the expanded #19 safety scan.

Existing tests in the full suite cover immutable verification evidence and
append-only Canary events (`postgres-searchad-active-canary.integration.test.js`),
one-active-run-per-Customer uniqueness, application reconstruction/recovery,
recursive credential redaction (`searchad-write-canonical.test.js`), HTTP error
redaction (`searchad-write-integration.test.js`) and sanitized startup logs
(`searchad-activation-runtime.test.js`). These are the implemented contracts,
not an independent whole-system security review.

## Outstanding acceptance dependencies

- #18: reporting/Circuit/automation focused acceptance cannot be marked complete
  before those services are reconstructed.
- #19: worker lease/schedule uniqueness, worker/validation focused acceptance,
  the 126-operation validation registry and expanded execution-source safety
  scanning remain incomplete.
- #20: profitability/recommendation/limited-Auto acceptance remains future work.
- #26: trustworthy complete remote absence across unmanaged/external descendants
  and all writers remains unresolved. Public campaign/adgroup parent deletion
  stays disabled and absent from OpenAPI. The bounded public F acceptance was
  already verified at `afc85b1c` / run 37188053714, including restart-preserved
  `cleanup:false` and zero-traffic 404 parent-cleanup routes.

Keep PR #28 Draft/open/unmerged and #21/#26 OPEN. No live Naver advertising
request, operational database/migration/config/gate change, deployment or
main/base merge occurred. PostgreSQL changes in this workflow apply only to
the disposable CI service database; remote behavior in tests uses fixtures.
