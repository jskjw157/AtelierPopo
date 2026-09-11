# SearchAd Reporting / Circuit Breaker / Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct trusted SearchAd reporting evidence, Customer-scoped Circuit Breaker, and deterministic observe/recommend/approve/limited-auto automation without opening production mutation gates or adding a direct mutation path.

**Architecture:** Reporting, Circuit, and Automation are separate modules backed by additive PostgreSQL schemas. Reporting produces immutable trusted evidence; Circuit consumes durable outcome/spend signals and exposes a new-mutation guard; Automation consumes trusted evidence and may only materialize/execute updates through the existing SearchAd change-plan, one-time approval, and execution services.

**Tech Stack:** Node.js 22 ESM, `node:test`, PostgreSQL 16 / `pg`, existing SearchAd gateway/client/spec registry, existing SQLite SearchAd write control plane, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-11-searchad-reporting-circuit-automation-design.md`

## Global Constraints

- Real Naver SearchAd mutation remains 0 until the later live-validation issue.
- Production write/create/batch/delete/rollback/Active Canary gates remain OFF by default.
- Automation default remains `observe`.
- No direct `fetch`, `http`, `https`, or axios calls in new SearchAd reporting/circuit/automation modules.
- Report POST registration persists dispatch intent before remote I/O and never blindly retries ambiguous outcomes.
- Missing/empty/stale spend never becomes zero.
- `salesAmt` is KRW cost with VAT included, exactly as documented by checked-in `ncc-report.json`.
- Automation cannot accept caller-fabricated evidence, approval, spend, circuit state, or remote IDs.
- Circuit bookkeeping failure never rewrites the primary mutation result.
- New mutation Circuit blocking does not block read, rollback, or reconcile.
- Limited auto uses only existing change-plan -> approval -> execution services.

---

### Task 1: CI registration + pinned reporting operation contracts

**Files:**
- Modify: `.github/workflows/searchad-active-canary-ci.yml`
- Create: `smartstore-bridge/src/naver/searchad/reporting/operations.js`
- Create: `smartstore-bridge/test/searchad-reporting-operations.test.js`

**Interfaces:**
- Produces `SEARCHAD_REPORTING_OPERATIONS` with exact operation keys for single/bulk stats, stat report create/list/get, and master report create/list/get.
- Produces `assertReportingOperation(gateway, operationKey, { sideEffect })`.

- [ ] **Step 1: Register new paths/tests in CI**

Add push/PR paths for `src/naver/searchad/reporting/**`, `circuit/**`, `automation/**`, new HTTP files, migrations `0010+`, and tests `searchad-reporting-*.test.js`, `searchad-circuit-*.test.js`, `searchad-automation-*.test.js`, `postgres-searchad-reporting*.integration.test.js`. Add focused test globs to the contract job and PG tests sequentially to the PostgreSQL job.

- [ ] **Step 2: Write failing operation contract tests**

Test exact keys derived from checked-in Swagger generation rules, including:

```js
assert.equal(SEARCHAD_REPORTING_OPERATIONS.stat.single,
  'report.get.get_single_entity_stat_using_get__p_stats__q_breakdown_date_preset_fields_id_time_increment_time_range');
assert.equal(SEARCHAD_REPORTING_OPERATIONS.statReport.create,
  'report.post.register_report_job_using_post__p_stat_reports');
assert.equal(SEARCHAD_REPORTING_OPERATIONS.masterReport.create,
  'master_report.post.create_master_report__p_master_reports');
```

Assert every pinned descriptor is `public_documented`, tier `B`, runtime allowlisted, and has the expected side-effect classification.

- [ ] **Step 3: Push RED and capture fresh CI failure**

Expected: only the new operations module/tests fail; existing suites stay green.

- [ ] **Step 4: Implement minimal pinned operation module**

Export frozen constants and gateway descriptor checks. Do not accept arbitrary operation keys from callers.

- [ ] **Step 5: Push GREEN and record workflow run**

---

### Task 2: Migration 0010 + Reporting PostgreSQL repository

**Files:**
- Create: `smartstore-bridge/migrations/postgres/0010_searchad_reporting_evidence.sql`
- Create: `smartstore-bridge/src/naver/searchad/reporting/postgres-repository.js`
- Create: `smartstore-bridge/test/postgres-searchad-reporting.integration.test.js`
- Modify: migration-version expectations in existing PG tests if explicit head assertions exist.

**Interfaces:**

`PostgresSearchAdReportingRepository` methods:

```js
createObservation(row)
getObservation(observationId, customerId)
listObservations({ customerIds, entityId, validity, limit })
createOrGetReportIntent(row)
getReportIntent(reportIntentId, customerId)
findReportIntentByKey(customerId, reportKind, intentKey)
updateReportIntent(reportIntentId, patch, customerId)
appendReportEvent(row)
listReportEvents(reportIntentId, customerId)
putBlob({ sha256, contentBytes, byteLength, contentType, createdAt })
linkJobBlob(row)
getBlobMetadata(sha256)
getSchema(schemaSha256)
putSchema(row)
updateSchemaReview(schemaSha256, patch)
createStabilizedEvidence(row)
getStabilizedEvidence(evidenceId, customerId)
findLatestStabilizedEvidence({ customerId, entityId, statDate })
```

- [ ] **Step 1: Write PG RED tests**

Verify schema/table existence, immutable observation/evidence/events, report-intent unique `(customer_id, report_kind, intent_key)`, content-addressed blob dedupe, exact Customer scope, and migration head `0010`.

- [ ] **Step 2: Run fresh PG RED**

Expected: missing `0010`/repository methods.

- [ ] **Step 3: Implement additive migration and repository**

Use CHECK constraints for all enumerated states and immutable trigger for evidence/event rows. Blob bytes use `bytea`; no raw credential/token columns.

- [ ] **Step 4: Verify first migration applies 0001..0010 and second pass `applied: []`**

- [ ] **Step 5: Commit GREEN evidence**

---

### Task 3: Explicit-range `/stats` observations

**Files:**
- Create: `smartstore-bridge/src/naver/searchad/reporting/stats-evidence-service.js`
- Create: `smartstore-bridge/src/naver/searchad/reporting/stats-parser.js`
- Create: `smartstore-bridge/test/searchad-reporting-stats.test.js`

**Interfaces:**

```js
class SearchAdStatsEvidenceService {
  async observe(input, context)
}
```

Input accepts exactly:

```js
{
  customerId,
  entityId,
  fields,
  sinceDate,
  untilDate,
  timeIncrement = 'allDays',
  breakdown = null
}
```

Caller cannot provide `salesAmt`, `result`, `cycleBaseTm`, `stabilized`, spec/credential/upstream fields, or raw response.

- [ ] **Step 1: Write RED tests**

Cover explicit KST range construction, numeric `salesAmt` parsing, explicit zero preservation, missing/malformed -> nullable spend + non-valid state, VAT basis `VAT_INCLUDED`, stale `cycleBaseTm` classification, Customer role checks, and descriptor side-effect false.

- [ ] **Step 2: Fresh RED**

- [ ] **Step 3: Implement parser and service**

Gateway response is the only evidence source. Persist response SHA and sanitized raw JSON; bind current spec/credential/upstream context.

- [ ] **Step 4: Fresh GREEN + prior regression**

---

### Task 4: Exactly-once stat/master report registration and GET-only reconcile

**Files:**
- Create: `smartstore-bridge/src/naver/searchad/reporting/report-job-service.js`
- Create: `smartstore-bridge/test/searchad-reporting-report-jobs.test.js`

**Interfaces:**

```js
registerStatReport({ customerId, intentKey, reportType }, context)
registerMasterReport({ customerId, intentKey, item, fromTime? }, context)
reconcile(reportIntentId, context)
```

- [ ] **Step 1: RED tests**

Assert same intent/same hash returns existing result, same key/different request conflicts, `dispatching` is persisted before POST, success stores canonical returned job ID/download URL, ambiguous timeout -> `unknown_outcome`, second registration never POSTs again, restart from `dispatching` never POSTs again, reconcile uses GET only, zero/multiple matches -> manual review.

- [ ] **Step 2: Fresh RED**

- [ ] **Step 3: Implement state machine**

Never infer a job ID from caller input. All remote job IDs/download URLs come from official GET/POST responses.

- [ ] **Step 4: Fresh GREEN**

---

### Task 5: Safe report download, content-addressed blob, schema registry/quarantine

**Files:**
- Create: `smartstore-bridge/src/naver/searchad/reporting/download-adapter.js`
- Create: `smartstore-bridge/src/naver/searchad/reporting/report-schema.js`
- Create: `smartstore-bridge/src/naver/searchad/reporting/report-ingest-service.js`
- Create: `smartstore-bridge/test/searchad-reporting-download.test.js`
- Create: `smartstore-bridge/test/searchad-reporting-schema.test.js`

**Interfaces:**

```js
validateReportDownloadUrl(downloadUrl, upstreamBaseUrl)
class SearchAdReportDownloadAdapter { async download({ customerId, persistedDownloadUrl }) }
class SearchAdReportIngestService { async ingest(reportIntentId, context) }
fingerprintOrderedColumns(columns)
```

- [ ] **Step 1: RED security tests**

Reject HTTP, foreign origin, userinfo, fragment, any pathname other than `/report-download`, caller-provided raw URL, oversized body, redirect escape. Assert download uses `NaverSearchAdClient.request` signed for the normalized `/report-download` path and trusted query only.

- [ ] **Step 2: RED schema tests**

Exact ordered header match maps semantics; reordered/unknown/changed columns produce a distinct fingerprint and `quarantined`. Quarantine cannot yield trusted evidence.

- [ ] **Step 3: Implement adapter and ingestion**

Hash bytes SHA-256 before blob persistence; reuse identical blob; persist only sanitized metadata in events.

- [ ] **Step 4: Fresh GREEN + raw network scanner**

Scanner must find zero direct `fetch/http/https/axios` use in reporting source except the existing SearchAd client abstraction itself.

---

### Task 6: D+1/D+2/D+3 stabilized spend evidence

**Files:**
- Create: `smartstore-bridge/src/naver/searchad/reporting/stabilization-service.js`
- Create: `smartstore-bridge/test/searchad-reporting-stabilization.test.js`

**Interfaces:**

```js
class SearchAdSpendStabilizationService {
  async evaluate({ customerId, entityId, statDate }, context)
}
```

- [ ] **Step 1: RED tests**

D+1/D+2 are provisional; D+3 valid numeric spend creates immutable evidence with `stabilizedByPolicy=true`, `policy='D3'`, `vatBasis='VAT_INCLUDED'`. D+3 explicit zero is valid zero. Missing/malformed/stale D+3 never produces evidence. D+1/D+2 need not equal D+3.

- [ ] **Step 2: Fresh RED**

- [ ] **Step 3: Implement server-side observation selection**

The caller supplies no observation IDs or spend. Service finds observations by Customer/entity/statDate and observation date.

- [ ] **Step 4: Fresh GREEN**

---

### Task 7: Migration 0011 + durable Customer Circuit Breaker

**Files:**
- Create: `smartstore-bridge/migrations/postgres/0011_searchad_circuit_breaker.sql`
- Create: `smartstore-bridge/src/naver/searchad/circuit/postgres-repository.js`
- Create: `smartstore-bridge/src/naver/searchad/circuit/policy-service.js`
- Create: `smartstore-bridge/src/naver/searchad/circuit/signal-service.js`
- Create: `smartstore-bridge/src/naver/searchad/circuit/guard.js`
- Create: `smartstore-bridge/test/searchad-circuit-service.test.js`
- Create: `smartstore-bridge/test/postgres-searchad-circuit.integration.test.js`

**Interfaces:**

```js
class SearchAdCircuitGuard {
  async assertNewMutationAllowed({ customerId, operationKey })
}
class SearchAdCircuitSignalService {
  async record(signal)
}
```

Signal is server-generated:

```js
{
  customerId,
  sourceKind,
  sourceId,
  operationKey,
  signalKind,
  occurredAt,
  trustedSpendKrw?,
  realizedLossKrw?
}
```

- [ ] **Step 1: RED policy/state tests**

Trip on spend limit, baseline deviation, realized loss, consecutive failures, unknown outcome ceiling, unresolved hold, cooldown. Manual pause is sticky. Customer isolation exact. Reads/rollback/reconcile do not use new-mutation guard.

- [ ] **Step 2: PG RED tests**

Signals append-only/idempotent; state survives restart; migration repeat no-op.

- [ ] **Step 3: Implement migration/repository/services/guard**

Projection updates occur transactionally inside Circuit DB operations, not across primary SearchAd write transactions.

- [ ] **Step 4: Fresh GREEN**

---

### Task 8: Integrate Circuit guard/signal sink with normal write and lifecycle execution

**Files:**
- Modify: `smartstore-bridge/src/naver/searchad/write/execution-service.js`
- Modify: `smartstore-bridge/src/naver/searchad/write/runtime-production.js`
- Modify: `smartstore-bridge/src/naver/searchad/lifecycle/hierarchy-canary-service.js`
- Modify: `smartstore-bridge/src/naver/searchad/lifecycle/runtime-production.js`
- Create: `smartstore-bridge/src/naver/searchad/circuit/signal-sink.js`
- Create: `smartstore-bridge/test/searchad-circuit-write-integration.test.js`
- Create: `smartstore-bridge/test/searchad-circuit-lifecycle-integration.test.js`

**Interfaces:**

```js
class NoThrowCircuitSignalSink {
  async emit(signal) // always resolves { recorded, errorCode? }
}
```

- [ ] **Step 1: RED order tests**

For a normal new mutation: activation -> ownership -> Circuit guard -> approval claim -> remote mutate. Circuit rejection consumes no approval token and makes no remote call.

For lifecycle create/delete: lifecycle activation/risk/preflight -> Circuit guard before approval claim/dispatch.

- [ ] **Step 2: RED isolation tests**

Primary success remains success when signal sink throws; primary known failure remains its original error; unknown outcome remains unknown. Signal sink error is sanitized and does not expose token/credentials.

- [ ] **Step 3: Implement optional guard/sink hooks**

Default absent hooks preserve existing behavior for tests/runtime startup. Runtime wiring later injects real Circuit components.

- [ ] **Step 4: Fresh GREEN + #12-#17 regression**

---

### Task 9: Migration 0012 + deterministic automation policy/evaluator

**Files:**
- Create: `smartstore-bridge/migrations/postgres/0012_searchad_automation.sql`
- Create: `smartstore-bridge/src/naver/searchad/automation/postgres-repository.js`
- Create: `smartstore-bridge/src/naver/searchad/automation/policy-service.js`
- Create: `smartstore-bridge/src/naver/searchad/automation/evaluator.js`
- Create: `smartstore-bridge/src/naver/searchad/automation/service.js`
- Create: `smartstore-bridge/test/searchad-automation-evaluator.test.js`
- Create: `smartstore-bridge/test/postgres-searchad-automation.integration.test.js`

**Interfaces:**

```js
class SearchAdAutomationService {
  async evaluate({ automationPolicyId }, context)
}
```

No evidence/spend/target override is accepted from callers.

- [ ] **Step 1: RED mode tests**

`observe` -> run only; `recommend` -> deterministic recommendation; `approve` -> existing change plan only; `auto` -> eligibility gate only at this task. Policy ceilings and Customer scope enforced. Create/delete actions become `blocked` without lifecycle automation executor.

- [ ] **Step 2: PG RED tests**

Policy/run/recommendation durability, exact Customer scope, policy snapshot hash, migrations through 0012 + repeat no-op.

- [ ] **Step 3: Implement deterministic evaluator**

Select latest trusted stabilized evidence server-side. Circuit must be open. No LLM/free-form action generation.

- [ ] **Step 4: Fresh GREEN**

---

### Task 10: Approve/limited-auto through existing plan -> approval -> execution only

**Files:**
- Modify: `smartstore-bridge/src/naver/searchad/automation/service.js`
- Create: `smartstore-bridge/test/searchad-automation-execution.test.js`

**Interfaces:**

Automation service receives existing:

```js
{
  planService,
  approvalService,
  executionService,
  circuitGuard
}
```

- [ ] **Step 1: RED tests**

`approve` calls `planService.create` and stops: zero approval, zero execution.

`auto` order:

```text
trusted evidence -> policy ceilings -> circuit guard -> planService.create -> approvalService.approve -> executionService.execute
```

Assert raw execution token exists only in the in-memory call and is never passed to automation repository persistence methods.

Assert create/delete/batch operation is blocked before plan/approval/execution when lifecycle automation executor is absent.

- [ ] **Step 2: Fresh RED**

- [ ] **Step 3: Implement orchestration**

Use `SEARCHAD_APPROVAL_CONFIRMATION` and actor `automation:<policyId>` for auto approval. Do not call gateway mutation directly.

- [ ] **Step 4: Fresh GREEN + write regression**

---

### Task 11: Production runtimes, bootstrap, HTTP, permissions, OpenAPI

**Files:**
- Create: `smartstore-bridge/src/naver/searchad/reporting/runtime-production.js`
- Create: `smartstore-bridge/src/naver/searchad/circuit/runtime-production.js`
- Create: `smartstore-bridge/src/naver/searchad/automation/runtime-production.js`
- Create: `smartstore-bridge/src/naver/searchad/reporting/bootstrap.js`
- Create: `smartstore-bridge/src/naver/searchad/circuit/bootstrap.js`
- Create: `smartstore-bridge/src/naver/searchad/automation/bootstrap.js`
- Create: `smartstore-bridge/src/http/routes-searchad-reporting.js`
- Create: `smartstore-bridge/src/http/routes-searchad-circuit.js`
- Create: `smartstore-bridge/src/http/routes-searchad-automation.js`
- Create: `smartstore-bridge/src/http/openapi-searchad-reporting.js`
- Create: `smartstore-bridge/src/http/openapi-searchad-circuit.js`
- Create: `smartstore-bridge/src/http/openapi-searchad-automation.js`
- Modify: `smartstore-bridge/src/bootstrap-v05.js`
- Modify: `smartstore-bridge/src/http/server-v05.js`
- Create: `smartstore-bridge/test/searchad-http-reporting.test.js`
- Create: `smartstore-bridge/test/searchad-http-circuit.test.js`
- Create: `smartstore-bridge/test/searchad-http-automation.test.js`

- [ ] **Step 1: RED runtime/bootstrap tests**

Verify sanitized startup errors, migration readiness, default observe/off behavior, correct dependency order, Circuit injection, close/readiness wiring.

- [ ] **Step 2: RED role/API tests**

Reader reads; Operator reporting/evaluation actions; Executor approve-plan materialization; Admin Circuit/schema/policy control. Generic HAAR key and cross-Customer access rejected. HTTP bodies reject fabricated evidence/spend/approval/remote IDs.

- [ ] **Step 3: Implement runtimes/routes/OpenAPI**

OpenAPI is role-scoped and uses `additionalProperties:false` for mutation/control inputs.

- [ ] **Step 4: Fresh GREEN + syntax checks**

---

### Task 12: Final #18 verification and ledger handoff

**Files:**
- Modify only if verification exposes a real defect.
- Update GitHub Issue #18 and Master #23 after fresh evidence.

- [ ] **Step 1: Run fresh reporting/circuit/automation focused suite**

Expected: 0 failures/skips for required tests.

- [ ] **Step 2: Run full Active Canary/SearchAd HTTP + activation + hierarchy/lifecycle + write regressions**

Expected: prior behavior remains green.

- [ ] **Step 3: Run PostgreSQL 16 integrations sequentially**

Expected first migration includes `0010`, `0011`, `0012`; repeat result `applied: []`.

- [ ] **Step 4: Run raw network scanner and syntax checks**

Expected zero new direct network calls in reporting/circuit/automation source and no syntax errors.

- [ ] **Step 5: Verify defaults**

Write/create/batch/delete/rollback/Active Canary/hierarchy mutation gates OFF; automation `observe`.

- [ ] **Step 6: Record exact commit, CI run, pass/fail/skip counts, migration evidence, and `real Naver SearchAd mutation = 0` in #18**

- [ ] **Step 7: Close #18 and update Master #23 to resume #19**
