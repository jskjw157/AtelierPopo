# SearchAd Hierarchy Canary + Lifecycle Implementation Plan

> Issue #17. Execute with strict TDD: write the smallest failing contract, obtain a fresh CI RED, implement minimally, obtain fresh GREEN, then add the next slice. Never perform real Naver SearchAd mutation during this plan.

**Goal:** Add safe campaign→adgroup→keyword/creative hierarchy canaries and exact lifecycle create/batch/delete activation without weakening the existing #16 update guard.

**Architecture:** New `src/naver/searchad/lifecycle/` module, additive PostgreSQL migration `0009`, dedicated hierarchy recipes/services, lifecycle activation scope, shared Customer daily risk ledger, and durable Canary ownership holds. Existing normal write and campaign Active Canary remain backward compatible.

---

## Task 1 — Register lifecycle CI and freeze operation/validator contracts

**Files**
- Modify: `.github/workflows/searchad-active-canary-ci.yml`
- Create: `smartstore-bridge/test/searchad-hierarchy-validator.test.js`
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/operations.js`
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/hierarchy-validator.js`

**RED tests**
- exact pinned campaign/adgroup/keyword/creative create/read/delete operation keys
- wrong Customer parent rejected before network
- wrong parent type rejected
- caller-supplied `remoteId`, `nccCampaignId`, `nccAdgroupId`, `nccKeywordId`, `nccAdId` target injection rejected unless inserted by server recipe builder after trusted parent resolution
- top campaign not stopped/paused rejected
- keyword batch count 0 or 101 rejected; 1..100 accepted
- creative type must equal `TEXT_45`

**Implementation**
- immutable operation descriptor map
- `KEYWORD_CREATE_MAX_BATCH = 100`
- pure fail-closed validator functions with stable `SearchAdWriteError` codes
- no gateway call in validator module

**Verify**
- focused validator suite green
- existing activation/write suites green

---

## Task 2 — PostgreSQL 0009 schema + hierarchy repository

**Files**
- Create: `smartstore-bridge/migrations/postgres/0009_searchad_hierarchy_lifecycle.sql`
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/postgres-repository.js`
- Create: `smartstore-bridge/test/postgres-searchad-lifecycle.integration.test.js`
- Modify existing PG migration-version assertions from 0008 to 0009 where the test runs the full migration set.

**RED tests**
- migration expected currentVersion 0009 fails before migration exists
- lifecycle scope columns default to empty arrays for existing evidence/grants
- hierarchy run/object/event persistence survives repository recreation
- ownership unique `(customer_id, object_type, remote_id)`
- cross-Customer ownership queries do not leak
- immutable event rows reject UPDATE/DELETE
- repeat migration returns `applied: []`

**Schema**
- evidence/grant `lifecycle_kinds_json`
- hierarchy runs
- hierarchy objects
- hierarchy events
- remote ownership
- daily risk capacity
- risk reservations

**Verify**
- PG integration fresh GREEN under PostgreSQL 16
- migrations 0001–0009 first apply, second apply no-op

---

## Task 3 — Shared per-Customer daily risk capacity

**Files**
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/risk-service.js`
- Create: `smartstore-bridge/test/searchad-lifecycle-risk.test.js`
- Extend PG integration for concurrent reservations

**RED tests**
- server-owned risk units only; client units ignored/rejected
- same Customer/day cannot reserve above capacity
- different Customers have independent capacity
- duplicate intent is idempotent
- reserve→consume; reserve→release only before dispatch
- consumed or ambiguous intent cannot be released and reused
- concurrent reservations cannot oversubscribe

**Implementation**
- transaction + row lock on Customer/day balance
- durable reservation state machine
- injectable clock/date function for deterministic tests

---

## Task 4 — Lifecycle activation scope

**Files**
- Modify: `smartstore-bridge/src/naver/searchad/activation/activation-service.js`
- Modify: `smartstore-bridge/src/naver/searchad/activation/activation-guard.js` or add `src/naver/searchad/lifecycle/activation-guard.js`
- Modify: `smartstore-bridge/src/naver/searchad/activation/postgres-repository.js`
- Create: `smartstore-bridge/test/searchad-lifecycle-activation.test.js`

**RED tests**
- passive evidence cannot authorize lifecycle mutation
- exact Customer required
- exact operationKey required
- exact lifecycle kind required
- create grant does not authorize delete/batch_create
- batch_create grant does not authorize create
- stale spec/fingerprint/upstream/expiry blocked
- suspended account blocks lifecycle execution
- gateway descriptor revalidated immediately before authorization
- existing #16 update activations with empty lifecycle kinds still work unchanged

**Implementation**
- activation grant copies lifecycle kinds from trusted evidence
- lifecycle evidence must be Active/Hierarchy Canary-backed
- separate lifecycle guard method; never reinterpret field scope

---

## Task 5 — Campaign and hierarchy recipes

**Files**
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/recipe-campaign.js`
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/recipe-hierarchy.js`
- Create: `smartstore-bridge/test/searchad-hierarchy-recipes.test.js`

**RED tests**
- campaign recipe creates server-owned stopped WEB_SITE payload only
- child recipe cannot accept raw caller remote IDs
- adgroup binds persisted owned campaign of same Customer/run
- keyword binds persisted owned adgroup and batch <=100
- creative binds persisted owned adgroup and forces `TEXT_45`
- response ID extractor accepts only returned response ID; missing/ambiguous ID fails closed
- read/delete builders use persisted returned ID only
- no name lookup API or fallback exists

**Implementation**
- builders receive trusted repository object records, not external parent IDs
- sanitize output and persist no secrets

---

## Task 6 — Hierarchy Canary orchestration and ambiguous outcome recovery

**Files**
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/hierarchy-canary-service.js`
- Create: `smartstore-bridge/test/searchad-hierarchy-canary-service.test.js`

**RED tests**
- start requires Admin + Customer access + unsuspended account + trusted activation/evidence as designed
- existing remote ID injection rejected before remote call
- top campaign state rechecked before each child mutation
- approval/risk/dispatch intent established before gateway side effect
- successful create persists only response-returned ID and ownership hold
- ambiguous create => `unknown_outcome`, zero resend
- ambiguous delete => `delete_unknown`, zero resend
- reconcile is read-only
- cleanup deepest-first and returned-ID-only
- parent delete blocked while live child exists
- destructive confirmation propagated to gateway
- restart from persisted `dispatching`/unknown state does not replay mutation

**Implementation**
- dedicated Canary execution path through `gateway.executeCanary`; no global create/delete gate enabling
- append-only dispatch/reconcile events
- terminal manual-review state for unresolved ambiguity

---

## Task 7 — Canary ownership hold in normal write path

**Files**
- Modify: `smartstore-bridge/src/naver/searchad/write/execution-service.js` and/or production execution adapter
- Create: `smartstore-bridge/test/searchad-write-canary-ownership.test.js`

**RED tests**
- normal write cannot mutate campaign/adgroup/keyword/creative held by Canary ownership table
- cross-Customer object with same textual ID does not cause false block/leak
- deleted/released ownership state behavior is explicit and tested
- ownership check occurs before approval token claim/remote mutation where possible so a policy rejection does not burn approval
- existing regular update of non-owned object stays green

**Implementation**
- inject ownership guard into production write runtime
- derive object type/remote ID from pinned operation inputs only

---

## Task 8 — Runtime/bootstrap and API surface

**Files**
- Create: `smartstore-bridge/src/naver/searchad/lifecycle/runtime-production.js`
- Create/modify bootstrap wiring as needed
- Create: `smartstore-bridge/src/http/routes-searchad-lifecycle.js`
- Create: `smartstore-bridge/src/http/openapi-searchad-lifecycle.js`
- Create: `smartstore-bridge/test/searchad-http-lifecycle.test.js`
- Modify CI syntax/path registration

**Contract**
- Reader: hierarchy status/reconcile views
- Operator: read-only planning/status as applicable
- Executor: approved lifecycle execution endpoint if policy permits
- Admin: hierarchy Canary start/cleanup and lifecycle activation administrative actions
- exact Customer isolation; inaccessible/missing resource same 404
- public projections omit credential fingerprint, raw errors, secrets
- request bodies do not accept remote target IDs or risk units

**Verify**
- runtime can initialize with gates OFF
- startup/readiness sanitized
- no live calls in tests

---

## Task 9 — Final regression, evidence, close #17

**Fresh verification**
- hierarchy/lifecycle focused suite
- full Active Canary/SearchAd HTTP contract suite
- SearchAd activation focused suite
- SearchAd write regression
- PostgreSQL 16 integrations sequentially, currentVersion 0009, repeat `applied: []`
- syntax/bootstrap checks
- explicit production mutation defaults OFF check

**GitHub ledger**
- add #17 completion comment with exact commit SHA, workflow run ID, pass/fail/skip counts, migration result, and statement `real Naver SearchAd mutation = 0`
- close #17
- update Master #23: mark #17 complete, set verified commit, set resume point #18
- continue automatically with #18 only after #17 evidence is fully green
