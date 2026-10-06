# SearchAd #22 preparation inventory — 2026-10-07 KST

Initial repository/GitHub inspection for [issue #22](https://github.com/jskjw157/AtelierPopo/issues/22). This is a preparation record, not deployment, full historical-branch review, production dry-run or live qualification. Reference software is `6013903`, exact [CI37497778627](https://github.com/jskjw157/AtelierPopo/actions/runs/37497778627) SUCCESS / 1601 tests passed. See the [preserved evidence and limitations](SEARCHAD_COMPLETION_EVIDENCE_2026-10-07.md).

## Subsequent preparation progress

Read the [main integration and actual deployment/restore findings](SEARCHAD_MAIN_INTEGRATION_2026-10-07.md). The initial inventory below is preserved as its earlier checkpoint: actual VPS identity and v0.3 Commerce were subsequently verified; production SearchAd/PostgreSQL configuration is absent, actual SQLite restore passed, and local main-schema PostgreSQL upgrade/restore passed. These are separate from live SearchAd capability or a production PostgreSQL-data rehearsal.

## Integration inventory

Refs were fetched from origin before this inventory. At the recorded code checkpoint:

| Ref / PR | SHA | Relationship / disposition |
|---|---|---|
| main | b7ca236bdcfc0d1e9f730880c0d68fe0b4e0efb6 | Ancestor of current code; 277 commits behind |
| PR11, write-execution-v0.7.0 | 56abf47c1eeb8124fa9fb8f4f60b81e36376c109 | OPEN, base main; ancestor of current code, 243 commits behind |
| Historical active-canary-20260910 | f20111858c3b52bae2c7249702a73b998a6eed37 | 171 commits on its side versus 83 on original-recovery; diverged. Do not merge it wholesale or mistake its later timestamp for current accepted source |
| PR24, original-recovery-20260912 | 18a4201e5a2467e7ffed914f34c956eabdf5ad42 | OPEN/Draft; base recovery-2026-09-11, current code's ancestor |
| PR28, extended-cleanup-20260914 | 6013903de2b8c2a7457698381dfb8c7e27723690 | OPEN/Draft, base original-recovery-20260912; 160 commits beyond that base |

Main-to-current diff is 366 files (360 smartstore-bridge, 6 workflows), 50334 insertions / 592 deletions. PR11-to-current is 345 files, 46734 insertions / 716 deletions. Counts exclude this later documentation publication. The current accepted source is the recovered continuation; the old active-canary branch is neither its ancestor nor a drop-in integration source. No tracked `.searchad-bootstrap` files appear in either current or historical active-canary trees; this does not prove old untracked recovery chunks were correct.

Proposed integration route: retain PR28 and its recovery ancestry as the review checkpoints, then prepare an explicit main-target integration of the accepted continuation. PR11's changes are already ancestors, so merging/reapplying them does not supply missing completion work. Review the complete main-to-candidate diff and required main-target workflows before choosing stacked merges or a main-target PR. No base switch, new integration PR, merge, force push or branch deletion was performed here; that decision remains #22 work.

## Workflow inventory

Eight tracked workflows exist. `searchad-extended-cleanup-wip.yml` is the current continuation verification workflow; `searchad-write-ci.yml` covers selected older branches and main-target PRs. Channel-import and multi-source workflows also run on main-target PRs. Export-source, export-test-runtime, dev-snapshot and storage-diagnostic workflows are historical diagnostics with narrow branch/path triggers. Their inventory is complete; obsolete-workflow removal is deferred to a reviewed integration change. No workflow was removed or disabled to make checks pass.

## Runtime configuration names and safe initial settings

These names were derived from source; production values, identities, credentials and deployment state were not read or changed.

- Database/runtime: `DATABASE_URL`, `ATELIER_POSTGRES_SSL_MODE` (production default require), `NODE_ENV=production`, Node >=22.5.0, `ATELIER_POPO_CONFIG`, `ATELIER_WORK_DIR`, `ATELIER_DATABASE_PATH`. Existing SQLite ledger/work paths must stay persistent independently of PostgreSQL.
- SearchAd topology: `NAVER_SEARCHAD_PRINCIPALS_JSON`, `NAVER_SEARCHAD_CUSTOMERS_JSON`, `NAVER_SEARCHAD_GRANTS_JSON`; alternatively single-principal access-license/secret/customer settings. Choose explicit Customer/principal/grant topology and verify credential binding and role; do not assume the single-principal fallback grant is production authorization. Secret JSON and keys belong in the deployment secret store, never issue bodies or committed examples.
- HTTP role keys/scopes: for each `ROLE` in `READER`, `OPERATOR`, `EXECUTOR`, `ADMIN`, verify `ATELIER_SEARCHAD_ROLE_API_KEY`, `ATELIER_SEARCHAD_ROLE_CUSTOMERS`, `ATELIER_SEARCHAD_ROLE_PRINCIPAL_ID` (replace ROLE with the exact role name), plus `ATELIER_SEARCHAD_HTTP_API_KEY_MIN_LENGTH`. Roles require distinct keys and explicit numeric Customer lists; `*` is rejected. Existing Commerce bearer keys use `ATELIER_API_KEYS`/`ATELIER_API_KEY`. These current bindings must be checked against the actual deployment; the legacy Hostinger runbook describes v0.2.0 Commerce and does not establish current SearchAd/PostgreSQL deployment readiness. Current start is `node src/http-v05.js`.
- Safe initial gates: `ATELIER_SEARCHAD_AUTOMATION_MODE=observe`; `ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=false`; `ATELIER_SEARCHAD_ALLOW_WRITES=false`; `ATELIER_SEARCHAD_ALLOW_CREATES=false`; `ATELIER_SEARCHAD_ALLOW_BATCH_WRITES=false`; `ATELIER_SEARCHAD_ALLOW_DELETES=false`; `ATELIER_SEARCHAD_ALLOW_ROLLBACK=false`; `ATELIER_SEARCHAD_ALLOW_ACCOUNT_ADMIN=false`; `ATELIER_SEARCHAD_ALLOW_UNVERIFIED_OPERATIONS=false`; `ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS=false`; `ATELIER_SEARCHAD_WORKER_ENABLED=false`. Preserve existing Commerce/HTTP mutation locks OFF too. Configured policies and schedules start disabled; do not infer them from environment gates alone.
- Reads are separately configured and default on (`ATELIER_SEARCHAD_ALLOW_READS`, billing reads); a read is still a real upstream request. The initial preparation does not run Passive Probe, remote smoke or service bootstrap against live credentials.
- Reporting storage: `ATELIER_SEARCHAD_REPORT_S3_BUCKET`, `ATELIER_SEARCHAD_REPORT_S3_ENDPOINT` (HTTPS if supplied), `ATELIER_SEARCHAD_REPORT_S3_REGION`, `ATELIER_SEARCHAD_REPORT_S3_PREFIX`, and SDK credential-provider configuration. Verify storage IAM, encryption, retention, persistence and actual ingestion readiness privately. `ATELIER_SEARCHAD_REPORT_INGESTION_REQUIRED` and `ATELIER_SEARCHAD_REPORTING_ENABLED` must reflect the intended readiness contract; disabling required infrastructure is not a workaround.
- Future worker activation additionally needs `ATELIER_SEARCHAD_WORKER_CUSTOMERS`, `ATELIER_SEARCHAD_WORKER_PRINCIPAL_ID` and validated scope. Keep worker disabled during preparation.

## Backup, restore and migration rehearsal

The migration CLI performs writes; it has no read-only dry-run mode. `npm run postgres:migrate` uses `DATABASE_URL` and the database's search_path. Do not point a rehearsal at production.

Before any production migration, establish the exact server/database identity, current migration filenames/checksums, PostgreSQL major version, ownership/roles, database size and backup destination. Take an access-controlled consistent PostgreSQL backup, retain required role/ownership configuration through the approved secret-safe mechanism, and prove restore into an isolated disposable database. Also preserve report blobs and SQLite/work volumes. A successful dump command alone does not prove recovery.

Run candidate migrations against the restored copy with no upstream credentials/network access; require exact 0001–0015 checksums, immediate second pass applied=[], latest0015, compatible rows/triggers and application readiness/restart checks. Rehearse the rollback as code rollback plus tested database restore/recovery; no automatic down-migration is promised. CI's clean disposable DB acceptance does not substitute for this production-data restore rehearsal. None of these production backup/restore/dry-run operations was executed in this preparation.

## Live validation prerequisites and remaining evidence

Before Passive Probe, bind the actual Customer, credential fingerprint, spec and read-only operation/field scope, confirm permitted account/network conditions and secure evidence storage. Actual Hostinger target, outbound identity/allow conditions, principal/role/grant and credentials remain unverified. No live capability evidence has been collected.

A later stopped WEB_SITE Active Canary uses its dedicated recipe/gate, immediately persists only the returned remote ID, reads back stopped state, applies and restores bounded budget, verifies returned-ID cleanup, then observes at least 48h and official /stats salesAmt spend delta zero. Unknown outcomes use GET-only recovery without blind resend. This private Canary cleanup is distinct from unavailable generic public parent cleanup (#26); it does not remove that blocker or promote an entire family.

Actual finance/estimate/balance and production Circuit baseline remain incomplete. Generic parent deletion remains blocked. Automation starts observe; a successful Canary alone does not authorize recommendation execution or Limited Auto. Promotion is exact Customer/spec/credential/upstream/operation/field scope, followed by explicit staged operating qualification. Real Passive evidence, Active Canary, production migration/deployment and operation activation remain unstarted.

Next concrete #22 work is to settle the main integration strategy and obtain a verified deployment target/configuration inventory for backup/restore rehearsal. Gate changes, production mutations and real advertising calls require their own concrete execution scope; this preparation does not grant them.
