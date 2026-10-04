# Bounded descendant scan — observation, not deletion-safe absence

Date: 2026-09-20. Issue #26 / Draft PR #28.
Base: `c2714bd3db1399377fa7f6857d332c4c3bfaacd1`.
This unit preserves the inventory-to-cleanup veto already present at that base.

## Intended outcome and constraints

Read more than one descendant page without converting an incomplete or inconsistent traversal into deletion authority. Preserve existing single-page inventory, Customer authorization, persisted parent scope, audit-only persistence, and default-OFF/internal application boundaries. No live Naver call, deletion, deployment, migration, gate change or merge is authorized.

## Internal entry point

`DescendantInventoryService.scan(input, context)` accepts the same exact local scope as `inventory`: `customerId`, `hierarchyRunId`, `parentObjectId`, `childType`. It loads one repository snapshot for the whole traversal. Caller cursors, raw parent IDs, query overrides, page sizes and operation overrides are rejected. `inventory()` remains the existing single-page method with its existing response shape.

Campaign-to-adgroup and adgroup-to-keyword scans use the pinned list operations with `recordSize=1000`, at most ten logical read-adapter invocations and at most 10,000 accepted IDs. The first request has no cursor. Each subsequent request uses the exact last returned child ID from the last accepted page and `selector=NEXT`; opaque IDs are not sorted to derive cursors. Short nonempty pages do not end the scan. Adgroup-to-creative uses its non-paginated operation exactly once, without invented cursor parameters; the existing 1000-row validation bound is retained.

Every page is checked for operation, HTTP status, Customer, parent, shape, bounded length, safe exact string IDs and duplicates. A malformed page is rejected as a whole. Repeated IDs across pages stop the scan without accepting the repeated page. Prior valid presence is retained on a later invalid page, repeated ID, or read failure. Exceptions do not persist upstream body, headers, credentials or error text. The scan loop adds no retries.

`requests` counts logical adapter invocations, not lower-level transport attempts. The injected read adapter remains responsible for transport timeout, read permission, request signing and any existing low-level policy. This unit does not add a wall-clock deadline, gateway/bootstrap/HTTP wiring, or live capability verification.

## Observation semantics

The usual `kind`, `count`, `remoteIds` and `completeAbsence:false` are accompanied by validated `scan` metadata:

- `requests`: logical adapter invocations, 1–10.
- `acceptedPages`: entirely validated responses, including an observed empty response.
- `termination`: `empty_page_observed`, `single_response_observed`, `request_limit`, `repeated_id`, `invalid_page`, or `read_unavailable`.
- `snapshotConsistency`: always `unproven`.

`empty_page_observed` means only that this traversal received an empty page. It is NOT a server-certified exhaustive, consistent snapshot or permission to delete a parent. A valid earlier nonempty page remains `present_remote_descendants` even if a later page fails. No valid page before a failure is `unresolved`; an observed empty first response is `empty_unproven`.

SearchAd identity is checked before and after every read. Identity failure rejects the entire scan rather than being mistaken for a network outage. Existing row-version and audit-count binding is checked under repository locks before appending one event; a graph or audit change during any page invalidates the original snapshot. This is local drift protection, not isolation against advertising-UI changes or other integrations.

Persistence uses the existing `descendant_inventory` phase and adds only validated `scan` metadata. Discovered raw IDs/cursors are not persisted; the sorted-ID digest is stored. Run/object/ownership/plan/approval/risk/attempt data remains unchanged. Existing subtree veto consumers therefore continue treating scan observations as negative evidence, never positive cleanup authority. Reusing a successfully recorded snapshot fails stale instead of appending the same observation twice.

## Official evidence and remaining gap

The [official pagination note](https://naver.github.io/searchad-apidoc/release/2016/06/29/release-note/) specifies NEXT/PREVIOUS and exclusion of `baseSearchId`. The checked-in descendant contract pins the supported parameter shapes. Advancing via the last returned ID and stopping on an empty response is a bounded traversal strategy here, not an assertion of an undocumented consistent-snapshot guarantee.

The [official Master Report Swagger](https://raw.githubusercontent.com/naver/searchad-apidoc/gh-pages/assets/json/master-report.json), reviewed 2026-09-20, distinguishes a delta request with `fromTime` from one without it, describes `updateTime` as report generation time, and enumerates report job states including BUILT. In that reviewed material, neither BUILT nor updateTime is specified as a transactional snapshot/version covering all relevant entity types at deletion time. No claim is made that an adequate guarantee can never be obtained. No report job was created in this unit.

Deletion-safe absence still requires authoritative completeness and consistency evidence plus an enforceable observation-to-mutation fence (for example a supported upstream snapshot/conditional mutation or isolation covering all writers), exact domain/identity/time/digest binding, independent destructive approval and acceptance tests. See [the existing decision](SEARCHAD_REMOTE_ABSENCE_DECISION.md). Legacy unsampled internal paths remain unchanged and are not cleared for operational exposure.

## Verification scope

Unit tests exercise cursor selection, short pages, non-paginated creatives, duplicate/cycle and size rejection, request limits, identity changes and failure retention. Real PostgreSQL integration tests exercise 1001 IDs over three requests, one hash-only event, later-page identity/audit drift, malformed metadata, snapshot reuse, subtree veto compatibility and legacy single-page behaviour. Stored hierarchy/identity and upstream results in the new integration suite are synthetic fixtures, not operational lifecycle evidence; migrations, persistence, classifier and veto are production code. Final CI SHA/run/counts are recorded in PR #28 and Issue #26 only after completed logs are observed.
