# SearchAd 0009 — B2a PostgreSQL storage verification

## Verified checkpoint — 2026-09-12

**B2a storage/risk accounting is verified. B2 hierarchy orchestration as a whole, C/D/E approved lifecycle execution and F final acceptance remain pending. Issue #26 stays OPEN and PR #24 stays Draft.**

| Item | Value |
| --- | --- |
| Repository / app | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Working branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `codex/searchad-recovery-2026-09-11` / `0adbd11359440efe43fd07c279bd01a4d8914568` |
| B1 documentation checkpoint | `035098228dbabdd48669f42f36c054cc38fc68af` |
| Verified code/test/workflow SHA | **`5c4be3077e67bfd257ce176c3fe9727d9331a101`** |
| Completed CI | **[34674108418](https://github.com/jskjw157/AtelierPopo/actions/runs/34674108418), job `103500743097`, completed/success** |
| Full regression | **332 passed / 0 failed / 0 skipped** |
| Test database migration head | **0009**; not a production migration |

The complete code-CI job log was read, followed by a completed/success job-status check. A later documentation-only commit and its CI are separate checkpoints recorded in #26/PR24. Documentation publication is not itself a test result.

## What was already on the branch and what was corrected

Resuming from the recorded B1 handoff found additional remote storage work: `d65824cf3e091929d06ba7e66bce5c24b1d66b1c`, a provenance correction, and diagnostic HEAD `20655c9f73ce94e11e5a6921d8fe44350838031c`. The source/schema were not re-added as duplicate work. The failing current regression was diagnosed and corrected.

At diagnostic HEAD20655c9, [CI34672961239](https://github.com/jskjw157/AtelierPopo/actions/runs/34672961239), job `103497683302`, reported **331 pass / 1 fail / 0 skip**. The sole failing test was the complete migration inventory: it still expected0001–0008 after0009 was added. Focused and PostgreSQL stages passed. This observed regression RED is not a claim that all storage tests were observed failing before their implementation.

Commit5c4be30 changes exactly three files relative to20655c9:

- `test/postgres-migrator.test.js`: extend the exact ordered inventory to0009 and change the exact last filename. Transaction-wrapper and checksum assertions remain unchanged.
- `scripts/searchad-lifecycle-storage-provenance.mjs`: retain the previous three-file reverse checks and add inventory reversal. It proves four existing test files differ only in six explicit migration-version expectations.
- `.github/workflows/searchad-write-ci.yml`: add one exact inventory-test preservation exception, update the provenance-script pin and explanatory comment. Existing steps remain; the EOF newline is normalized.

Local syntax/YAML/step-preservation and exact inventory reversal, including three tamper-negative checks, were checked before publishing this correction. Local checks were not substituted for the fresh complete GitHub PostgreSQL/application CI.

## Restored source and exact provenance

Historical source: `1051fa1a64ab78b5f6b3adf5cb794a342ade39ae`. Paths below are relative to `smartstore-bridge/`.

| File | Current Git blob | Provenance |
| --- | --- | --- |
| `migrations/postgres/0009_searchad_hierarchy_lifecycle.sql` | `ec8f25be8654febf25e5d30b5f9bb4ee45858ac7` | Exact historical schema |
| `src/naver/searchad/lifecycle/postgres-repository.js` | `b63fd592d186ea56297fc2f60dac13e92e97203b` | Adapted storage implementation, NOT an exact historical blob |
| `src/naver/searchad/lifecycle/risk-service.js` | `75f375f59752674ffd28f11c39582c3a73d73e98` | Exact historical service |
| `test/searchad-lifecycle-risk.test.js` | `75673597c6801fdfb33ea2c6de09330516144702` | Exact historical tests |
| `test/postgres-searchad-lifecycle-storage.integration.test.js` | `9a092eee2a5530491142a64f56aae14c2f3dd70e` | New recovery integration tests |
| `scripts/searchad-lifecycle-storage-provenance.mjs` | `ac840c24cba6d2b2babcac862a19285a6f71e7fb` | New recovery preservation checker, updated in5c4be30 |

The original repository blob is `a17e6b51c3d300b44c41a868e4f8c68905fda4901`. The adapted repository adds or tightens scoped parent/run ownership validation, reservation identity checks, transactional run/risk binding and compare-and-set transitions. Its current behavior is tested as an adaptation; historical-byte identity is not claimed.

The existing0007/0008 historical24 pins, five application-integration pins, seven activation reverse-edit checks and B1 six historical pins still pass. Existing application sources, async writer, approval/locks, activation services/guards, bootstrap, server/readiness/close, dependencies, default gates and migrations0001–0008 remain unchanged by the B2a slice. Four pre-existing test files have only the six explicitly reversed version expectations changed. The diagnostic workflow remains a diagnostic artifact, not the canonical acceptance CI.

## Actual PostgreSQL test boundary

`postgres-searchad-lifecycle-storage.integration.test.js` uses a disposable UUID PostgreSQL schema for the parent test, real migrations, the real lifecycle repository and risk service, and16 child scenarios. It reconstructs repository objects and uses new PostgreSQL connections/pools. **This is not an actual HTTP application reboot or a remote Naver mutation/reconcile test.** Fixtures use separate customer/run identities where required, but this is not16 independent schema deployments.

Global fetch is trapped; no upstream API is used. Synthetic IDs, snapshots, records and grants are test inputs, not authoritative remote returned-ID or live capability evidence. Teardown removes only the schema created by the test and closes its owned resources.

| Storage scenario | Verified behavior / limit |
| --- | --- |
| Schema and rerun | Required tables/columns exist; full migration reaches0009, second application is empty |
| Connection reconstruction | Persisted hierarchy runs/objects are readable from a reconstructed repository/new connection |
| Customer/run/parent binding | Cross-Customer, missing run, wrong parent type and cross-run parent ownership are rejected |
| Active-run exclusivity | Another active run for the same Customer is blocked, including persisted unknown outcome |
| Audit and query isolation | Immutable hierarchy event UPDATE/DELETE is rejected; scoped listing/lookup and empty allowlist isolation hold |
| Server-owned risk | Caller units/capacity/date overrides are rejected; service derives units and UTC date |
| Shared accounting | Legacy Canary and hierarchy fixture records charge the same Customer/day capacity; this is not live spend accounting or atomic legacy-start wiring |
| Reservation identity | A reused reservation cannot silently change Customer/date/operation/units/capacity/plan/run binding |
| Concurrent capacity | Two real PG connections competing for a bounded capacity cannot both oversubscribe it |
| Pending legacy/ambiguous state | Persisted pending work blocks new capacity use |
| Reservation-to-run binding | Mismatched reservation context and run replay are rejected |
| Dispatch claim | Competing database compare-and-set claims have one winner; persisted unknown outcome blocks another claim |
| Release boundary | Only eligible pre-dispatch dry-run risk can be released; dispatched/unknown/completed charges are not recycled in the tested path |
| Cleanup ordering/state | Child-first object selection and one-winner cleanup claim persist; this does NOT execute or verify an actual remote delete |
| Redaction | Stored event payloads exclude tested credential/token fields |
| Prior grant compatibility | Empty lifecycle scope remains empty; existing update-only grant fixtures are not promoted by0009 |

The hierarchy graph remains campaign -> adgroup, with keyword and creative as separate adgroup children. The internal risk clock uses `toISOString().slice(0,10)` (UTC day), not a verified Korea-time advertising budget policy. Risk units are not KRW and are not official spend evidence.

## Fresh code-CI results

| Check | Pass / fail / skip |
| --- | --- |
| Canary/Gateway/Canary role HTTP | 51 / 0 / 0 |
| Activation core/Customer | 30 / 0 / 0 |
| Hierarchy validators/recipes | 18 / 0 / 0 |
| Existing write focused | 49 / 0 / 0 |
| Existing role HTTP/readiness/runtime lifecycle | 14 / 0 / 0 |
| Required PostgreSQL | **53 / 0 / 0** |
| Repeated prior Canary/activation/application PostgreSQL | 31 / 0 / 0 |
| Repeated storage plus risk service | **21 / 0 / 0** |
| Full regression | **332 / 0 / 0** |

311 ->332 adds a PostgreSQL parent plus16 children and four risk tests:21 counted tests,20 leaf scenarios. The storage test itself counts17; required PG grows36 ->53. Focused/repeated suites overlap the full suite and must not be added together or converted into a product-completion percentage.

All configured code-CI steps, source pins/preservation, syntax/static checks and the read-only reverse checker passed. The latter reports `existingTestsChecked:4`, `allowedVersionChanges:6`, `sourceWrites:0`. Both final migration reruns report `currentVersion:0009, applied:[]`.

Existing write safety reports16 source files and0 raw network calls. This is not a whole lifecycle/HTTP security audit. Bundled coverage remains Commerce116 and SearchAd126 unique/117 allowlisted with no internal/deprecated runtime leaks; this is not live API validation. Bridge production dependency audit reports0 vulnerabilities; root dependencies were not audited. SQLite experimental and Actions Node-version warnings remain.

## Next required work — B2b / C / D / E

Do not import the historical hierarchy orchestrator wholesale merely because storage passes. Its earlier source review identified approval-token consumption before risk reservation/dispatch intent, and missing authoritative stopped-parent revalidation before each child mutation. Storage tests do not resolve those execution issues.

Next, implement/review a bounded orchestration slice with explicit tests for server-owned returned IDs, exact read-back Customer/parent/type, malformed or duplicate/partial batch responses, authoritative stopped top campaign and child-first cleanup. Preserve current async execution and fail closed when a required component is absent. No new runtime route should be enabled just to exercise a storage fixture.

C/D must prove the one-time approval token, risk consumption and dispatch intent form the required atomic execution boundary with real PostgreSQL. A run/risk transaction or a single database dispatch claim alone is not that guarantee. Existing0007 Canary start must also not be declared atomically integrated with shared risk based only on fixture rows.

E must separately prove actual application/role HTTP composition, lifecycle scope/ownership holds, destructive double confirmation/parent-with-children protection, restart and read-only unknown-outcome reconcile without blind retry. F closes#26 only after full acceptance and synchronized fresh evidence. Concurrent suspension after the guard check, independent review and broader operational readiness remain#21; deployment and live capability/Canary/scoped activation remain separately authorized#22.

**No actual Naver request, advertising mutation, operational gate change, production migration, deployment, main change or PR merge was performed.**
