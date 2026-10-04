# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-10-04

**Current verified code/test HEAD is `5371a7dba889ec151cb75eda1dd4001704201da6` on `codex/searchad-extended-cleanup-20260914` / Draft PR #28. Issue #26 remains OPEN.**

Do **not** repeat root campaign, adgroup, keyword/creative sibling public creation wiring, leaf cleanup/read-only recovery, descendant inventory scan, generic hierarchy reconciliation, account suspension send fences, or role-scoped hierarchy OpenAPI work. Those bounded units are already implemented and verified.

The current application exposes a bounded server-owned hierarchy lifecycle, but **campaign/adgroup parent deletion is intentionally not public**. Empty/list inventory observations remain non-authorizing and cannot prove trustworthy complete remote absence.

| Checkpoint | Value |
| --- | --- |
| Branch | `codex/searchad-extended-cleanup-20260914` |
| Draft PR | [#28](https://github.com/jskjw157/AtelierPopo/pull/28) |
| Work issue | [#26](https://github.com/jskjw157/AtelierPopo/issues/26) |
| Master | [#23](https://github.com/jskjw157/AtelierPopo/issues/23) |
| Verified code/test HEAD | `5371a7dba889ec151cb75eda1dd4001704201da6` |
| Latest verification | [run 37187130719](https://github.com/jskjw157/AtelierPopo/actions/runs/37187130719), job 111391342507, completed SUCCESS |
| Full regression | **1059/1059 PASS**, 453 top-level, 0 failed |
| Schema | 0009 retained; this checkpoint adds no migration |
| Live SearchAd calls | **0** |
| Main/deploy/production gate changes | **none** |

This dashboard supersedes the old 2026-09-13 resume text for progress. Historical checkpoints remain available in Git history and in PR #28 / issues #26 and #23 comments.

## Current public hierarchy surface

Application/bootstrap/runtime/role HTTP are wired for the following bounded operations.

### Creation

- Root campaign:
  - `POST /api/v1/searchad/hierarchy/campaigns/prepare`
  - separately approved execute route
- Adgroup:
  - `POST /api/v1/searchad/hierarchy/adgroups/prepare`
  - separately approved execute route
- Keyword sibling batch:
  - server-owned bounded request only
  - exact `batch_create` authority
  - no caller keyword text, remote ID, or arbitrary recipe
- TEXT_45 creative sibling:
  - server-owned bounded request only
  - exact `create` authority
  - no caller ad copy, remote ID, or arbitrary recipe

Every mutation remains behind the existing activation/approval/risk/identity/account-suspension controls. One-time execution tokens are not replayable.

### Leaf cleanup and recovery

Keyword/creative leaf cleanup is publicly wired through the verified `ChildFirstCleanupService`.

- prepare is local only
- execute requires separate delete activation + approval + destructive confirmations
- target is preflight-read
- DELETE is attempted at most once for the acknowledged claim
- independent qualified GET404 is required before local deleted proof
- unknown outcomes use read-only recovery; DELETE is never blindly replayed

Known partial-keyword quarantine cleanup remains leaf-only. Unreturned sibling IDs are never invented.

### Descendant inventory

`POST /api/v1/searchad/hierarchy/inventory/scan`

- Admin + explicit Customer scope
- remote GET-only
- public response omits raw discovered remote IDs
- local audit stores sanitized count/traversal metadata plus remote-ID hash
- `localMapping:false`
- `cleanupAuthority:false`
- empty response remains `empty_unproven`
- `completeAbsence:false`
- `snapshotConsistency:'unproven'`

Inventory observation does **not** unlock parent cleanup.

### Generic hierarchy recovery

`POST /api/v1/searchad/hierarchy/reconcile`

This is plan-safe GET-only remote recovery for non-cleanup unknown outcomes.

- exact input: Customer + hierarchy run + hierarchy object
- Admin + explicit Customer scope
- current SearchAd identity checked before and after remote read
- remote adapter retained by the service exposes only `read`
- explicit upstream 404 may settle a persisted `delete_unknown` object to locally deleted
- no DELETE replay
- no risk refund or approval revival
- no Canary PASS/evidence issuance from GET404 alone
- target with cleanup history/DELETE plan is rejected with specialized-recovery requirement
- generic recovery never guesses a latest cleanup plan
- audit/event-count drift makes the issued snapshot stale

## Role-scoped Hierarchy OpenAPI

Verified at `8504ba40745813ac09646f56548959869e27e4fb`, then retained by the current acceptance HEAD.

Public role documents:

- `/openapi-searchad-hierarchy-reader.json`
- `/openapi-searchad-hierarchy-operator.json`
- `/openapi-searchad-hierarchy-executor.json`
- `/openapi-searchad-hierarchy-admin.json`

Reader/operator/executor hierarchy docs contain no hierarchy mutation paths. Admin documents exactly the current bounded 13-route hierarchy surface.

The OpenAPI deliberately does **not** document:

- arbitrary remote URLs or remote IDs
- caller keyword/ad copy/recipe payloads
- campaign parent cleanup
- adgroup parent cleanup

Actual HTTP acceptance verifies readiness and this OpenAPI surface through the full application before and after application reconstruction.

## Sequential work board

| Stage | Current state |
| --- | --- |
| 0007 Canary/Gateway/role HTTP | Verified baseline retained |
| #25 / 0008 activation/async/PG+HTTP/readiness/shutdown | Completed baseline retained |
| #26-A/B1 operation inventory / validators / hierarchy recipes | Verified |
| #26-B2a 0009 schema/repository/risk | Verified storage foundation |
| Generic hierarchy read-only reconciliation core | Verified |
| Root campaign create | Verified + public application wiring |
| Adgroup create | Verified + public application wiring |
| Keyword/creative sibling create incl. exact/partial contracts | Verified + public application wiring |
| Partial keyword quarantine + known-leaf cleanup | Verified |
| TEXT_45 creative cleanup | Verified |
| Leaf cleanup read-only recovery | Verified + public application wiring |
| Descendant inventory scan | Verified + public read-only application wiring |
| Generic non-cleanup hierarchy recovery | Verified + public application wiring |
| Replacement-generation / cleanup-plan consumer safety | Verified for implemented bounded generations |
| Expired unused-plan retirement/replacement | Verified for documented bounded paths; no generalized automatic replacement |
| Account suspension -> fetch initiation ordering | Verified for lifecycle services + remaining PG writer/Canary + application composition |
| Hierarchy readiness/restart/role HTTP | **Verified for current bounded public surface** |
| Hierarchy role-scoped OpenAPI | **Verified** |
| Trustworthy complete remote absence across unmanaged/all writers | **UNRESOLVED** |
| Public campaign/adgroup parent deletion | **BLOCKED / NOT EXPOSED** |
| Generalized generation 3 / arbitrary replacement | NOT SUPPORTED |
| Whole #26 / 0009 F acceptance | **PENDING** |
| #21 full repository regression / PG / safety / migration acceptance | OPEN |
| #18 reporting/Circuit/automation | PENDING |
| #19 worker/scheduler/registry | PENDING |
| #20 profitability/recommendation/limited Auto | PENDING |
| #21 final whole-system validation | OPEN |
| #22 deployment/live validation/activation | separate authorization; NOT STARTED here |

## Safety boundaries that remain authoritative

### Parent deletion

Internal historical child-first/root cleanup implementations do not mean parent deletion is safe for public operation.

Current remote inventory contracts deliberately do not claim complete absence. In particular, an empty remote list is not converted into proof that no unmanaged descendants exist. Therefore:

- no public adgroup DELETE route
- no public campaign DELETE route
- no parent cleanup path in hierarchy OpenAPI
- no inferred remote IDs
- no name/position mapping of observed children
- no local state flag alone can authorize parent deletion

Do not weaken this boundary merely to complete #26.

### Send fence limits

The PostgreSQL account-row fence orders committed suspension against synchronous entry into the configured mutation fetch implementation. It does **not** guarantee:

- physical delivery
- upstream completion
- cancellation after fetch initiation
- remote exactly-once semantics
- correctness across unknown external advertising writers
- recovery from every database/network partition

Consumed approval/risk is not refunded or made replayable merely because later transport certainty is unavailable.

### Evidence limits

Synthetic test evidence/upstream fixtures are never live HAAR advertising proof. GET-only recovery and local deleted settlement do not issue positive lifecycle evidence or activation authority.

## Latest verification chain

### Generic public reconciliation

- RED `72e8f5bb9074fc09ef4d3297ad70ac87626086c2`
- GREEN `6ea4d0fdc71d52cddbcb6b55e8a83865a37372c2`
- run 37173078469 / job 111349865856
- full 1056/1056 PASS

### Hierarchy OpenAPI

- focused RED pin `70e7c72489d05872b7d27f3a8e31cca5cec07283`
- intended failure: missing `openapi-searchad-hierarchy.js`
- corrected GREEN `8504ba40745813ac09646f56548959869e27e4fb`
- run 37186390206 / job 111389091008
- new OpenAPI contract 3/3 PASS
- full 1059/1059 PASS

### Application acceptance pin

- `5371a7dba889ec151cb75eda1dd4001704201da6`
- full app HTTP checks readiness + hierarchy role OpenAPI before and after reconstruction
- run 37187130719 / job 111391342507 completed SUCCESS
- full **1059/1059 PASS**, 453 top-level, 0 failed

## Next bounded work

1. Keep the current public parent-delete veto unchanged.
2. Treat the current hierarchy application/bootstrap/readiness/restart/OpenAPI surface as completed bounded E work; do not reimplement it.
3. Reassess remaining #26 F blockers against the unresolved trustworthy-complete-remote-absence boundary.
4. Move whole-repository validation items to #21 rather than inflating #26 with duplicate regression work.
5. Only after the remaining acceptance boundary is explicitly resolved should #26 be considered for closure.
6. Live Naver validation/deployment remains separate #22 authorization.

**No main/base merge, deployment, production database/migration/config change, operational gate enable, or live Naver advertising request is represented by this dashboard.**
