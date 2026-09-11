# SearchAd Reporting / Circuit Breaker / Automation Design

Date: 2026-09-11
Issue: #18
Branch: `codex/searchad-active-canary-20260910`

## 1. Goal

Reconstruct HAAR SearchAd reporting evidence, per-Customer Circuit Breaker, and deterministic automation on top of the already verified activation, normal-write, Active Canary, and hierarchy lifecycle control planes.

This design does not reuse the old local implementation as source code. The 2026-09-08 checkpoint is evidence of intended behavior only. Current checked-in Naver Swagger and the current branch are authoritative.

## 2. Non-negotiable safety boundaries

1. Real Naver SearchAd mutation remains zero until the later live-validation issue.
2. All production mutation gates remain OFF by default.
3. No new raw-network execution path. Reporting uses pinned SearchAd operation keys; report file download uses one dedicated server-internal adapter pinned to `/report-download` and only a server-returned persisted download URL.
4. Ambiguous POST report registration is never resent. Recovery is GET-only.
5. Client input cannot fabricate spend, stabilization, report success, evidence, approval, circuit state, risk capacity, or remote IDs.
6. Missing/empty/stale reporting data is never converted to zero.
7. Automation `auto` never mutates through a new executor. It must use the existing change-plan -> one-time approval -> execution service path.
8. Circuit pause blocks new mutations but never blocks read, rollback, or reconcile.
9. Circuit bookkeeping failure is isolated from the primary mutation outcome.
10. Create/delete automation remains fail-closed unless a dedicated lifecycle executor and exact active-canary lifecycle evidence are both available. #18 limited auto is update-family first.

## 3. Official reporting semantics pinned from checked-in Swagger

### Explicit stats

Source: `ncc-report.json`.

- Single entity: GET `/stats` from source operation `getSingleEntityStatUsingGET`.
- Bulk entities: GET `/stats` from source operation `getBulkEntityStatUsingGET`.
- Explicit `timeRange` is JSON `{since: YYYY-MM-DD, until: YYYY-MM-DD}` based on KST.
- `timeRange` takes precedence over `datePreset`.
- `timeIncrement=1` is daily, `allDays` is summary.
- `cycleBaseTm` is the latest available upstream datetime.
- `salesAmt` is explicitly documented as `Cost Summation (VAT included)`.

The reporting layer therefore stores spend as:

- currency: `KRW`
- VAT basis: `VAT_INCLUDED`
- source field: `salesAmt`
- source operation/spec reference
- explicit KST date range
- upstream `cycleBaseTm`

### Stat report jobs

- POST `/stat-reports`: register job.
- GET `/stat-reports`: list jobs.
- GET `/stat-reports/{reportJobId}`: read one job.
- Registration is a side effect and is treated as a non-idempotent POST unless the local intent proves it was not dispatched.

### Master report jobs

Source: `master-report.json`.

- POST `/master-reports`: create job.
- GET `/master-reports`: list jobs.
- GET `/master-reports/{id}`: read one job.
- A master report request contains server-validated `item` and optional `fromTime`.

### Report download

`downloadUrl` is returned by the report job response. It is not a caller-controlled generic URL.

A dedicated download adapter may use it only after:

- URL was persisted from a successful/reconciled official report job response;
- scheme is HTTPS;
- origin exactly matches current SearchAd upstream origin;
- pathname is exactly `/report-download`;
- no userinfo or fragment exists;
- request is signed through `NaverSearchAdClient` for the normalized path/query;
- response size is bounded by server configuration;
- redirect does not escape the pinned origin contract.

No HTTP API accepts a raw `downloadUrl`.

## 4. Architecture

Use three isolated domains sharing PostgreSQL contracts:

### A. `reporting/`

Responsibilities:

- explicit-range `/stats` observation/evidence;
- stat/master report registration intent;
- ambiguous registration recovery;
- report file download and content-addressed storage;
- schema fingerprint/registry;
- semantic mapping or quarantine;
- D+1/D+2/D+3 stabilization.

It does not decide whether an ad mutation should happen.

### B. `circuit/`

Responsibilities:

- durable Customer state;
- spend limit;
- baseline deviation limit;
- realized loss limit;
- consecutive-failure ceiling;
- unknown-outcome ceiling;
- unresolved hold;
- cooldown;
- sticky manual pause;
- mutation guard;
- durable signal projection.

It does not perform reporting I/O and does not mutate ads.

### C. `automation/`

Responsibilities:

- server-owned automation policies;
- deterministic evaluation from trusted reporting evidence;
- observe/recommend/approve/auto mode progression;
- update-family plan materialization;
- optional limited-auto handoff to the existing approval and execution services.

It does not directly call the SearchAd gateway for mutation.

### Shared integration contract

Normal write and lifecycle execution emit small post-outcome signals into a no-throw Circuit signal sink. The sink persists Circuit evidence separately. If the sink fails, the already-persisted primary SearchAd mutation result is unchanged and the sink error is logged/surfaced as Circuit health degradation only.

## 5. PostgreSQL model

Current migration head is `0009`. #18 adds additive migrations beginning at `0010`.

### 0010 Reporting evidence

#### `searchad_stats_observations`

Immutable observation rows:

- observation_id UUID PK
- customer_id
- entity_id
- entity_type nullable
- operation_key
- spec_sha
- credential_fingerprint
- upstream_base_url
- since_date / until_date (KST calendar dates)
- fields_json
- time_increment
- breakdown nullable
- raw_response_json
- raw_response_sha256
- sales_amt_krw nullable
- vat_basis = `VAT_INCLUDED`
- cycle_base_tm nullable
- observed_at
- source_request_id nullable
- validity = `valid | missing | malformed | stale`

No valid `salesAmt` means `sales_amt_krw` stays null.

#### `searchad_report_intents`

- report_intent_id UUID PK
- customer_id
- report_kind `stat | master`
- intent_key unique per Customer/kind
- operation_key
- request_json
- request_sha256
- status `planned | dispatching | registered | unknown_outcome | reconciled | manual_review | failed`
- returned_job_id nullable
- persisted_download_url nullable
- created_by_principal_id
- request_id nullable
- created_at / updated_at
- last_error_json sanitized

Same `intent_key` + same request hash is idempotent. Same key + different request is conflict.

The transition to `dispatching` is persisted before the POST. `dispatching` or `unknown_outcome` is never POSTed again after restart.

#### `searchad_report_events`

Append-only intent/job audit events.

#### `searchad_report_blobs`

Content-addressed report storage:

- blob_sha256 PK
- content_bytes BYTEA
- byte_length
- content_type
- created_at

A maximum server-side byte limit is enforced before persistence.

#### `searchad_report_job_blobs`

Links Customer/report intent/job to blob SHA and download metadata without duplicating content.

#### `searchad_report_schemas`

- schema_sha256 PK
- report_kind
- report_type/item
- ordered_columns_json
- semantic_mapping_json
- state `known | quarantined`
- created_at / reviewed_at
- reviewed_by_principal_id nullable

Exact ordered-column fingerprint match is required for semantic mapping. Unknown/changed schema is quarantined and cannot produce trusted spend evidence.

#### `searchad_stabilized_spend_evidence`

Immutable evidence:

- evidence_id UUID PK
- customer_id
- entity_id
- stat_date (KST)
- d1_observation_id nullable
- d2_observation_id nullable
- d3_observation_id NOT NULL
- sales_amt_krw NOT NULL
- vat_basis `VAT_INCLUDED`
- stabilized_by_policy boolean NOT NULL
- stabilization_policy `D3`
- source_spec_sha / credential_fingerprint / upstream_base_url
- created_at / expires_at

Only a valid non-stale D+3 observation can create trusted evidence. D+1 and D+2 remain provisional history and are never silently promoted. Zero is trusted only when the official D+3 observation explicitly contains numeric zero.

### 0011 Circuit Breaker

#### `searchad_circuit_policies`

Server/admin configured per Customer policy:

- spend_limit_krw
- baseline_deviation_limit_ratio
- realized_loss_limit_krw
- consecutive_failure_ceiling
- unknown_outcome_ceiling
- cooldown_seconds
- updated_by_principal_id
- updated_at

#### `searchad_circuit_signals`

Append-only, idempotent by `(customer_id, source_kind, source_id, signal_kind)`:

- success
- failure
- unknown_outcome
- reconcile_resolved
- rollback_resolved
- trusted_spend
- realized_loss
- unresolved_opened
- unresolved_closed

No secrets/tokens/raw credentials.

#### `searchad_circuit_state`

One durable projection per Customer:

- state `open | hold | cooldown | manual_pause`
- consecutive_failures
- unknown_outcomes
- unresolved_count
- latest_trusted_spend_krw nullable
- baseline_spend_krw nullable
- realized_loss_krw nullable
- cooldown_until nullable
- manual_pause boolean
- reason_codes_json
- updated_at

`manual_pause=true` is sticky and is never automatically cleared.

#### `searchad_circuit_events`

Append-only state transition audit.

Circuit guard order for a new mutation:

1. Customer/account suspension guard;
2. activation/ownership guards already in existing path;
3. Circuit guard;
4. one-time approval claim;
5. remote mutation.

Read/rollback/reconcile bypass the Circuit new-mutation block.

### 0012 Automation

#### `searchad_automation_policies`

- automation_policy_id UUID PK
- customer_id
- mode `observe | recommend | approve | auto`
- enabled
- allowed_operation_keys_json
- max_spend_krw
- max_realized_loss_krw
- max_change_ratio
- cooldown_seconds
- created/updated principal and timestamps

Policy values are server/admin-owned. Evaluation requests cannot override ceilings.

#### `searchad_automation_runs`

Immutable/durable evaluation header with selected trusted evidence IDs, policy snapshot hash, circuit snapshot, and terminal state.

#### `searchad_automation_recommendations`

Deterministic recommendation record:

- recommendation_id
- run_id
- operation_key
- target descriptor / expected patch
- reason codes
- status `observed | recommended | planned | blocked | executed | failed`
- plan_id nullable
- execution result reference nullable

## 6. Reporting state machines

### Explicit stats observation

Caller supplies only Customer + server-validated entity/range/field selection. It cannot supply response/spend/stabilization.

1. Verify Reader/Operator role and Customer grant.
2. Build pinned operation descriptor.
3. Execute read through gateway.
4. Validate exact requested range and parse response.
5. Persist immutable observation with validity.
6. Return sanitized projection.

### Report registration

1. Validate a server-owned/allowlisted stat report type or master item.
2. Create/reuse exactly-once intent.
3. Persist `dispatching` event before POST.
4. POST once.
5. On successful canonical returned job ID, persist `registered`.
6. On network/timeout/ambiguous response, persist `unknown_outcome` and never resend POST.
7. GET-only reconcile searches official job list/by-ID evidence using request semantics and creation window. Exactly one canonical match -> `reconciled`; zero/multiple -> `manual_review` or stays unresolved.

No name-based destructive behavior is involved.

### Download / schema

1. Job must be BUILT and have persisted server-returned URL.
2. Validate pinned `/report-download` URL contract.
3. Signed bounded download.
4. SHA-256 bytes and insert/reuse blob.
5. Parse header only through deterministic parser.
6. Fingerprint exact ordered columns.
7. Known schema -> semantic map; unknown/changed -> quarantine.
8. Quarantined data never becomes trusted automation evidence.

## 7. Stabilization policy

All dates use KST calendar semantics from the official `/stats` contract.

For stat date D:

- D+1 valid observation: `provisional_d1`
- D+2 valid observation: `provisional_d2`
- D+3 valid observation: eligible for `stabilized_by_policy=true`

A D+3 evidence row requires:

- explicit numeric `salesAmt`, including explicit zero;
- VAT basis `VAT_INCLUDED`;
- non-stale `cycleBaseTm` according to server policy;
- exact Customer/spec/credential/upstream binding;
- no quarantined schema dependency when evidence comes from a downloaded report.

D+1/D+2 values are retained for drift diagnostics. They do not need to equal D+3; late upstream aggregation is allowed. The D+3 value is the authoritative policy snapshot. Missing D+3 means no trusted evidence.

## 8. Circuit evaluation

Circuit transitions are deterministic and Customer-scoped.

A new mutation is blocked when any of these is true:

- manual pause;
- unresolved hold;
- trusted spend > Customer spend limit;
- absolute/relative deviation from configured baseline exceeds ceiling;
- realized loss exceeds ceiling;
- consecutive failures >= ceiling;
- unknown outcomes >= ceiling;
- cooldown_until is in the future.

When a threshold trips, state is persisted before future mutations may proceed. Manual pause remains sticky until an Admin explicitly resumes it. Automatic conditions may transition to cooldown/open only when the underlying unresolved/threshold condition is cleared by trusted evidence or reconcile.

## 9. Primary mutation signal isolation

Normal write and hierarchy lifecycle paths receive an optional `circuitSignalSink`.

- Primary mutation state is persisted first.
- Signal emission occurs afterward.
- Sink exceptions are caught and never replace the primary result/error.
- The sink records only sanitized identifiers/status/counters, not raw credentials or tokens.
- If signal persistence fails, Circuit health reports degradation and subsequent limited-auto is fail-closed until repaired.

This avoids a PostgreSQL/SQLite cross-database transaction pretending to be atomic.

## 10. Automation semantics

### observe

Select latest trusted evidence server-side, evaluate policy, persist run. No recommendation, plan, approval, or mutation.

### recommend

Additionally persist deterministic recommendation. No change plan.

### approve

Materialize the recommendation into the existing `SearchAdChangePlanService`, but do not manufacture or persist an execution token. A human Executor/Admin uses the existing approval endpoint. This mode means "automation may prepare an approvable plan", not "automation self-approves".

### auto (limited auto)

Allowed only when:

- policy mode is `auto`;
- operation is in policy allowlist;
- trusted stabilized evidence selected server-side;
- Circuit is open;
- update activation/ownership guards pass;
- spend/loss/change ceilings pass;
- operation is supported by the existing normal update path.

Then:

1. create/reuse change plan;
2. call existing `SearchAdApprovalService.approve` with server actor `automation:<policyId>` and the existing approval confirmation constant;
3. keep raw one-time token only in memory;
4. call existing `SearchAdExecutionService.execute` immediately with that token;
5. persist only approval/execution IDs/status, never raw token.

No direct `gateway.execute` mutation from automation.

Create/delete/batch lifecycle auto remains blocked unless a later explicit lifecycle automation executor is attached and exact lifecycle active-canary evidence is present. Recommendation can still say that an action is blocked.

## 11. Roles and HTTP surface

### Reader

- reporting/circuit/automation status and evidence/recommendation reads
- report job/blob/schema metadata reads (no raw blob unless separately authorized)

### Operator

- request explicit stats observation
- register/reconcile/download report jobs
- trigger observe/recommend evaluation within granted Customer

### Executor

- existing change-plan approval/execution APIs remain the approval boundary
- may trigger `approve` automation plan materialization

### Admin

- Circuit manual pause/resume
- Circuit policy update
- schema registry review/quarantine handling
- automation policy create/update/enable/disable
- may invoke all lower-role reads/actions

Role-specific OpenAPI must omit operations the role cannot call.

All list/get endpoints apply explicit Customer grants and project cross-Customer/missing resources as the same 404 where appropriate.

## 12. Runtime / bootstrap

New production runtime components:

- `reporting/runtime-production.js`
- `circuit/runtime-production.js`
- `automation/runtime-production.js`

Bootstrap ordering:

1. existing SearchAd core
2. activation
3. write runtime
4. lifecycle runtime
5. reporting runtime
6. circuit runtime
7. attach Circuit guard/signal sink to normal write + lifecycle
8. automation runtime
9. existing Active Canary (ordering may remain earlier if no dependency, but no mutation gate is enabled)

Each runtime has independent sanitized startup error and close handling. Reporting/Circuit read/control runtimes may be ready while automation mutation remains `observe` and gates OFF.

## 13. TDD / implementation partitions

Implement in these bounded slices:

1. pinned reporting operation contracts + explicit stats parser/evidence
2. migration 0010 + reporting repository
3. stat/master exactly-once report registration + read-only reconcile
4. safe report download + content-addressed blob + schema quarantine
5. D+1/D+2/D+3 stabilized spend evidence
6. migration 0011 + Circuit policy/state/signals/guard
7. primary write/lifecycle signal integration with no-throw bookkeeping
8. migration 0012 + automation policy/evaluation
9. approve/auto reuse of existing plan/approval/execution path
10. runtime/bootstrap/HTTP/OpenAPI
11. final focused/full/PG/raw-network-scan verification and issue ledger update

Every implementation slice uses: failing test -> fresh RED -> minimal implementation -> fresh GREEN -> relevant regression.

## 14. Completion evidence

Issue #18 is complete only when fresh CI proves:

- reporting/circuit/automation focused tests all green;
- existing #12-#17 regression remains green;
- PostgreSQL migrations through 0012 apply and repeat with `applied: []`;
- raw network call scanner reports zero new direct network paths;
- production mutation gates remain OFF and automation default remains observe;
- no live SearchAd credentials/calls/mutations were used.
