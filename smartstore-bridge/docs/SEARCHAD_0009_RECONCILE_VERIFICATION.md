# SearchAd 0009 — Read-only reconciliation verification

## Current checkpoint — 2026-09-12

**The bounded B2b read-only reconciliation slice is verified. Mutation orchestration, approved lifecycle execution, application HTTP integration and overall issue #26 are NOT complete.**

| Item | Verified value |
| --- | --- |
| Repository / application | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Branch / Draft PR | `codex/searchad-original-recovery-20260912` / #24 |
| Protected base | `0adbd11359440efe43fd07c279bd01a4d8914568` |
| Already-present reconciliation implementation | `6445e52122b974f59dab341cd404c0ed666b0d88` |
| This transport-composition test checkpoint | **`efaab63ae5a58ab370d607cce5cd446e12f46473`** |
| Completed canonical CI | **[34678162318](https://github.com/jskjw157/AtelierPopo/actions/runs/34678162318), job `103511667129`, completed/success** |
| Full regression | **373 passed / 0 failed / 0 skipped** |
| Migration head | **0009**, isolated test databases only |

The complete job log was read and the final job/step conclusions were confirmed. A documentation-only successor is recorded separately in #26/PR24; publishing documentation is not a test result. No independent reviewer approval is claimed.

## Work attribution and implementation boundary

Resumption found commit `6445e52` already on the remote branch, beyond the previous B2a handoff. Its canonical CI34676814455 was completed/success. That implementation was inspected rather than duplicated. The existing reconciliation plan records an earlier missing-service RED at b46ec66/CI34676258799; this is historical evidence, not a claim that every behavioral test was newly observed failing in this session.

Commit `efaab63` changes only two files relative to6445e52: one new236-line PostgreSQL transport-composition test and14 additive workflow lines. No production source, existing test, migration, package/lockfile or default gate changes in this increment. It adds composition coverage over existing behavior; no fabricated new behavioral RED or new production implementation is claimed.

### Existing read-only slice

`HierarchyReconcileService` accepts exactly Customer/run/object identifiers and requires the authenticated Admin's Customer grant. Targets and operation keys come from stored records, not caller-supplied remote IDs or names. It validates the current context before and after the GET. Missing remote IDs cannot become guessed targets or new ownership.

The dedicated PostgreSQL reconciliation repository captures an internally issued consistent snapshot, releases the read transaction before network I/O, then locks and compares the relevant stored graph before settlement. Changed ownership, a new child, competing observations or a failed audit insert cannot silently commit a stale result. Object/ownership/local run state and the sanitized audit event settle together. This is **observation settlement**, not approval-token consumption or a mutation dispatch claim. Existing raw writers are not proven integrated with this coordinator.

A typed upstream404 may confirm absence of the exact stored object. A successful matching response confirms presence, not successful deletion. Unavailable reads preserve unresolved state; inconsistent responses require manual review. No branch in this slice sends a create/update/delete, issues activation evidence, releases consumed risk, or marks the hierarchy run passed. Local `deleted` records an observed absence, not proof this service performed a DELETE.

## New real-component composition

The new test composes real PostgreSQL/migrations, both repository classes, the reconciliation and risk services, checked-in operation registry, credentials registry, existing Canary remote adapter, Gateway and signing client. **Only the client's fetch implementation supplies simulated upstream responses.** A global fetch trap rejects escaped external calls.

Every child scenario owns a fresh UUID PostgreSQL schema and cleans up only its own schema/resources. Stored remote IDs, ownership, account suspension and consumed-risk records are explicit synthetic fixtures. They are NOT authoritative create-response evidence or a live account activation. Reopening a pool and reconstructing services is not an HTTP application restart.

The transport asserts exact GET method/origin/path, stored target ID, absence of query/body, correct Customer/API-key headers and an independently computed HMAC signature. An assertion counter prevents transport assertion failures being swallowed as simulated outages. Tests use maxRetries0; they do not establish all production read-retry policies.

| New scenario group | Verified result |
| --- | --- |
| Campaign, adgroup, keyword, creative404 | Exact signed GET; local absence settlement once; reconnection does not replay GET after terminal state |
| Matching200 followed by404 | Presence remains unresolved; a later GET confirms absence without DELETE |
| Wrong Customer, parent, returned ID or type in200 | Manual review; persisted target ID is not replaced |
| Real client401/503 and transport outage | Unavailable, not fabricated absence; pending state preserved |
| Local read gate OFF | No signed transport and no false404 settlement |
| Credential rotation before/during GET | Context mismatch; no state settlement or audit insertion |
| Reader, foreign Customer or caller remote-ID injection | Denied before transport |
| Malformed200 | Manual review, not deletion evidence |

Each fixture verifies all mutation gates remain OFF, account suspension and consumed risk/balance remain unchanged, and no approval/grant/evidence record is created. Events omit the sensitive fixture response/request details. This does not establish arbitrary event-redaction safety in the raw storage repository.

## Completed canonical CI results

| Check | Pass / fail / skip |
| --- | --- |
| Canary/Gateway/Canary role HTTP |51 / 0 / 0|
| Activation core/Customer |30 / 0 / 0|
| Hierarchy recipes plus read-only unit contracts |29 / 0 / 0|
| Existing write focused |49 / 0 / 0|
| Existing HTTP/readiness/runtime lifecycle |14 / 0 / 0|
| **Required PostgreSQL** |**83 / 0 / 0**|
| Repeated previous Canary/activation/application PG |31 / 0 / 0|
| Repeated storage/risk |21 / 0 / 0|
| Repeated read-only unit + reconciliation PG |25 / 0 / 0|
| **New signed Gateway + PG composition** |**16 / 0 / 0**|
| **Full regression** |**373 / 0 / 0**|

The new transport test has15 child scenarios plus one parent:16 counted tests. The pre-existing read-only slice adds25 counted tests over B2a; 332+25+16=373. Focused and repeated counts overlap the full suite and must not be added together. Test counts do not represent activated production capabilities or completion percentages.

All prior source pins, protected diffs, reverse-edit checks, syntax/static checks and configured CI steps passed. The added6445e52 preservation check permits only the new test among source/schema/test/dependency paths. Both final migration reruns report0009/applied:[]. Existing write scanner reports16 sources/raw network0, not whole-system security coverage. Bundled manifest coverage remains Commerce116/SearchAd126unique/117allowlisted/no internal-deprecated runtime leaks; it is not live API validation. Bridge production dependency audit reports0 vulnerabilities; root dependencies were not reaudited. SQLite experimental and Actions Node warnings remain.

## Exact new-slice provenance

Paths are relative to `smartstore-bridge/` except the workflow.

| Path | Git blob at efaab63 |
| --- | --- |
| `src/naver/searchad/lifecycle/hierarchy-reconcile-service.js` | `99f0e49295d1950de916cdfd10bd866d238e8909` |
| `src/naver/searchad/lifecycle/postgres-hierarchy-reconcile-repository.js` | `af07e783a8240e2d892caf28ba6445827a585dd9` |
| `test/searchad-hierarchy-reconcile.test.js` | `994f3b589335cac92e16fbdff407932fad5c37a6` |
| `test/postgres-searchad-hierarchy-reconcile.integration.test.js` | `d39f5ae7420157877ba2c16f4430927f901c9b38` |
| `test/postgres-searchad-hierarchy-gateway.integration.test.js` | `958c49b846ebd815990dcb18d1f1187b4079f434` |
| `.github/workflows/searchad-write-ci.yml` | `4235d620d35fd06adfcbb8ce936857ebf019a45c` |

## Explicit correction to the earlier B2a report

The earlier332-test report overstated the raw storage implementation. Historical1051fa1 and recovered storage repository both have blob `b63fd592d186ea56297fc2f60dac13e92e97203b`; it is exact historical code, NOT an adaptation from the previously claimed a17e6b51 blob. The storage test creates a separate UUID schema for each of16 children, not one shared parent schema.

B2a proves explicit Customer-filtered queries, validator checks using stored parent records, uniqueness, reconnection persistence, immutable audit events and transactional risk accounting. It does **not** prove raw composite Customer/run/parent enforcement, atomic run+risk binding, one-winner dispatch/cleanup claims, dry-run-only release, generic event redaction or child-first remote cleanup. The corrected [storage report](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md) replaces those unsupported descriptions; historical332 results remain valid. The newly tested reconciliation settlement cannot be retroactively attributed to B2a or treated as mutation dispatch.

## First unfinished work

Continue #26-B2b mutation orchestration with failure-first tests, including current top-campaign stopped-state checks, actual create-response provenance, malformed/duplicate/partial batch responses, atomic object/ownership recording and child-first remote cleanup. Do not import the old synchronous executor or old orchestrator wholesale.

C/D must still prove approval-token consumption + risk consumption + dispatch intent atomicity and shared-risk integration with existing0007 Canary start. E must wire and test actual application/role HTTP, lifecycle activation/ownership holds, destructive confirmation, readiness/shutdown and whole-application restart. F closes#26 only after all acceptance conditions pass. Post-guard concurrent suspension and independent review remain#21; deployment/live validation remains separately authorized#22. Later#18/#19 through0019/#20 are pending.

**No actual Naver request, advertising mutation, operational gate change, production migration, deployment, main change or merge occurred. #26 remains OPEN and PR24 Draft.**
