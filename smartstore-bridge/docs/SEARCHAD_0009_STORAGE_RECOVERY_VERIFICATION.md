# SearchAd 0009 — B2a PostgreSQL storage verification (corrected)

## Reporting correction — 2026-09-12

**The earlier version of this report overstated B2a behavior and misstated provenance/test isolation. The332-test CI result remains valid; the unsupported behavioral claims do not.** This correction follows a direct comparison of historical/current source and the actual storage test. It is not a new storage implementation or additional test coverage.

Historical `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae` and restored `src/naver/searchad/lifecycle/postgres-repository.js` both have Git blob **`b63fd592d186ea56297fc2f60dac13e92e97203b`**. The earlier claim that this was adapted from `a17e6b51...` was incorrect. Each of16 child scenarios creates its own fresh UUID schema; the parent owns the administrative pool/fetch trap, not one shared test schema.

B2a does NOT establish raw Customer/run/parent composite validation, atomic run+risk binding, one-winner mutation dispatch/cleanup claims, release restricted to pre-dispatch dry runs, generic event redaction or child-first remote cleanup. Those descriptions are withdrawn. The later dedicated reconciliation repository has separately tested observation-settlement transactions; that is not a B2a or mutation-dispatch guarantee. Current status is in [the dashboard](SEARCHAD_RECOVERY_DASHBOARD.md) and [read-only verification](SEARCHAD_0009_RECONCILE_VERIFICATION.md).

## Historical verified B2a checkpoint

| Item | Value |
| --- | --- |
| Branch / issue / PR | `codex/searchad-original-recovery-20260912` / #26 OPEN / #24 Draft |
| B1 predecessor | `035098228dbabdd48669f42f36c054cc38fc68af` |
| B2a code/test/workflow | `5c4be3077e67bfd257ce176c3fe9727d9331a101` |
| Canonical CI | [34674108418](https://github.com/jskjw157/AtelierPopo/actions/runs/34674108418), job `103500743097`, completed/success |
| Full regression |332 passed /0 failed /0 skipped|
| Test migration head |0009; not production|
| Historical documentation successor | `9ce414244ec1d978372e04d961ea4b8082ce6b73`, CI34674443739/job103501665569 completed/success |

The code-CI log and final status were reviewed at the checkpoint. A successful documentation CI did not verify the accuracy of prose; that is why this explicit correction is necessary.

## Exact source provenance

Paths relative to `smartstore-bridge/`.

| File | Git blob | Provenance |
| --- | --- | --- |
| `migrations/postgres/0009_searchad_hierarchy_lifecycle.sql` | `ec8f25be8654febf25e5d30b5f9bb4ee45858ac7` | Exact historical schema |
| `src/naver/searchad/lifecycle/postgres-repository.js` | `b63fd592d186ea56297fc2f60dac13e92e97203b` | Exact historical repository |
| `src/naver/searchad/lifecycle/risk-service.js` | `75f375f59752674ffd28f11c39582c3a73d73e98` | Exact historical service |
| `test/searchad-lifecycle-risk.test.js` | `75673597c6801fdfb33ea2c6de09330516144702` | Exact historical tests |
| `test/postgres-searchad-lifecycle-storage.integration.test.js` | `9a092eee2a5530491142a64f56aae14c2f3dd70e` | New recovery tests |
| `scripts/searchad-lifecycle-storage-provenance.mjs` | `ac840c24cba6d2b2babcac862a19285a6f71e7fb` | Recovery preservation checker |

## Actual storage coverage

Real PostgreSQL, existing migrations, repository and risk service are used. Each child creates and removes only its own schema, closes its own pools and may reconnect. Global fetch is trapped. Synthetic remote IDs, records and grants are fixtures, not observed upstream create responses. Reconnection is not application reboot.

| Tested behavior | Boundary |
| --- | --- |
| Populated0008 ->0009 ->repeat | Prior checksums and empty lifecycle scopes retained; immutable evidence/grants stay protected |
| Unresolved-run uniqueness | Same-Customer unresolved run conflicts; another Customer remains independent |
| Explicit Customer-filtered queries/patches | Foreign reads return empty/null and patches do not alter the original; optional unscoped internal methods are not authorization |
| Validator applied to stored parent/ownership records | Wrong Customer/run/type/state rejected by the validator; not a composite-FK/storage enforcement claim |
| Ownership/object uniqueness | Duplicate Customer/type/remote identifier cannot overwrite the first record |
| Pool/repository reconstruction | Synthetic IDs, unknown states, holds and live-child queries persist; no remote cleanup is performed |
| Append-only hierarchy events | UPDATE/DELETE rejected; arbitrary event payload redaction is not tested |
| Server-owned risk input | Caller units/capacity/date and unconfigured operations rejected before database writes |
| Concurrent identical intent | Independent pools reserve once; same immutable intent identity retained |
| Concurrent shared capacity | Fixture owner kinds share Customer/UTC-day capacity without oversubscription; real Canary start remains unintegrated |
| Intent/capacity rebinding | Customer/date/operation/lifecycle/units/owner kind/run identity and established capacity conflicts are rejected |
| Consume/release transitions | Consume and release are idempotent for their permitted states; consumed risk is not released, released intent is not revived |
| SQL failure rollback | Capacity update and reservation insertion roll back together |
| Consume-versus-release race | One consistent terminal state, no negative accounting |
| UTC rollover | New day's balance does not recycle/rebind earlier intent |

The16 child scenarios include separate transition/race cases. There is no raw-repository dispatch or cleanup-claim method in this recovered source. Merely storing `unknown_outcome` does not prove every mutation caller is prevented from redispatching. Risk units are internal capacity, not KRW, and UTC day is not a verified Korea-time advertising budget policy.

## Observed regression repair and preservation

After storage sources had been added remotely, diagnostic20655c9/CI34672961239/job103497683302 reported331pass/1fail/0skip. The sole failure was an ordered migration inventory still expecting0001–0008. Commit5c4be30 changed two exact inventory/last-filename expectations, extended the reverse-hash checker and updated the narrow workflow exception/script pin. Production sources did not change in that correction. This is observed regression RED/GREEN, not evidence every storage behavior was first tested RED.

Four pre-existing test files differ only in six explicit migration-version expectations. The read-only checker reverses those edits to original full-file Git hashes. Wrapper/checksum/schema/token/immutability assertions remain. Existing application/async writer/approval/locks/activation/readiness/shutdown, dependencies/default gates and migrations0001–0008 were preserved.

| Historical B2a check | Pass / fail / skip |
| --- | --- |
| Canary / activation / hierarchy |51/0/0;30/0/0;18/0/0|
| Existing write / role HTTP |49/0/0;14/0/0|
| Required PG / previous repeated PG |53/0/0;31/0/0|
| Repeated storage+risk |21/0/0|
| Full regression |332/0/0|

311->332 is one PG parent+16 children+four risk tests,21 counted/20 leaf. Counts overlap and do not measure product completion. All configured stages/pins/protected diffs passed; both final migration reruns0009/applied:[]. Existing write scan16source/rawnetwork0 is not whole-system security coverage; bundled Commerce116/SearchAd126unique117allowlisted is not live validation; dependency audit0 is scoped to bridge production dependencies. SQLite/Actions Node warnings remain.

## Remaining requirements

B2b mutation orchestration and C/D/E/F are not completed by storage. Approval token+risk+dispatch atomicity, authoritative pre-mutation stopped parent checks, source-bound returned IDs/batches, child-first remote cleanup, lifecycle activation/ownership guards and actual application/role HTTP/restart require their own tests. Read-only reconciliation now has a separately recorded bounded checkpoint; consult the current dashboard rather than historical next-step prose.

No live Naver request, advertising mutation, operational gate change, production migration, deployment, main change or merge was performed at this checkpoint.
