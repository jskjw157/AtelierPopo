# SearchAd Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and verify the supported reporting, Circuit, worker, profitability and limited-auto software while retaining explicit live-activation and parent-delete blockers.

**Architecture:** Extend the existing PostgreSQL application and server-owned SearchAd services; retain the existing plan/approval/execution and account-send boundaries. Build eleven independently reviewable increments with HTTP/bootstrap/OpenAPI wiring in the increment owning each behavior. Descriptive registries and business observations never confer activation authority.

**Tech Stack:** Node.js >=22.5.0 ES modules, node:test, PostgreSQL 16, existing pg/zod and gateway clients; an S3-compatible SDK adapter for durable blobs and an ECMAScript parser for the expanded static scanner.

**Spec:** `smartstore-bridge/docs/superpowers/specs/2026-10-05-searchad-completion-design.md`.

## Global Constraints

- Node.js >=22.5.0; ES modules; node:test; PostgreSQL 16 acceptance.
- Preserve migrations 0001–0009 byte-for-byte; only append 0010–0014.
- No live Naver request, production DB/config/gate change, deployment, main/base merge, or merge of PR #28.
- Default automation mode is `observe`; new report registration and worker gates default OFF.
- Reuse change plan → one-time approval → execution → verification/reconcile; no second execution engine.
- Parent campaign/adgroup deletion remains disabled and absent from public routes/OpenAPI.
- Empty inventory, stale evidence, missing values and unknown outcomes never become positive authority.
- Every authority-bearing value is server-derived and bound to Customer, entity, current spec SHA, credential fingerprint, upstream origin, collection time and source record.
- Raw execution tokens, credentials, temporary report URLs/authtokens and customer PII never enter persisted request/result/audit payloads or logs.
- Read-only recovery never issues Canary PASS, restores a consumed token, refunds unknown risk, or blindly replays POST/DELETE.

All file paths below are relative to `smartstore-bridge/` unless prefixed `.github/`. Run commands from `smartstore-bridge`. This plan implements sequentially; Tasks 1–3 report, 4–5 control, 6–7 worker/registry, 8–10 product/Auto, 11 acceptance. No stage-by-stage user confirmation is required by the preserved user instruction. The controller performs the skill's implementation/review gates and commits approved increments to the feature work, publishing only to the already authorized Draft PR branch.

## Review Focus

- A connection fails after a registration claim commits but before response capture: retain unknown/manual review and never replay POST (Task 2).
- Same-shaped reports or mappings from another Customer, rotated credentials or changed schemas: no trusted evidence or automatic action (Tasks 1, 3, 8).
- Circuit projection fails after a remote success: preserve primary result, deny the next ordinary dispatch until durable catch-up (Task 4).
- A worker loses its lease while paused immediately before dispatch: stale completion fails and durable downstream intent prevents a second mutation (Task 6).
- Shared adgroup spend, refund reversals and missing costs produce misleading profit: exact allocation/deduplication and null/partial quality prevent increases (Tasks 8–10).

## Shared verification and integration contract

Use `test/helpers/searchad-completion-fixture.js` for deterministic `clock`, canonical identity, scoped principals, fake gateway and an explicit outbound-call trap. Use `test/helpers/postgres-searchad-completion-fixture.js` for unique UUID schemas and full bootstrap/HTTP restarts. A fixture must not emulate the production approval/repository/activation guard when testing authority. Upstream responses and seeded activation evidence are clearly synthetic and never live proof.

Every task follows RED → minimal implementation → GREEN → reviewable commit. Record exact failing assertion and passing run; missing-module failure is acceptable initially but add behavioral RED for the important safety boundary. Do not claim every behavior had independent RED unless observed. Integration commands below may be explicitly skipped locally only when `TEST_DATABASE_URL` is absent; each owning task adds its named suite to `.github/workflows/searchad-extended-cleanup-wip.yml`, where PostgreSQL is required and skips fail acceptance. Current local runtime supports Node/npm; local PostgreSQL availability must be verified, never assumed.

At each migration task, update `test/postgres-migrator.test.js`, exact current-version expectations in existing PG tests, and the clean-DB workflow's expected filenames. Do not replace exact lists/checksums with “at least N” or erase 0009-specific constraints. Test clean first apply, immediate no-op repeat and original0001–0009 checksums. Migrations are applied only to disposable test schemas/CI DB.

## Task 1: Durable scoped reporting observations and application slice

**Files:** Create `migrations/postgres/0010_searchad_reporting.sql`; `src/naver/searchad/reporting/{contracts,config,postgres-repository,stats-service,runtime}.js`; `src/naver/searchad/completion-bootstrap.js`; `src/http/routes-searchad-reporting.js`; `src/http/openapi-searchad-completion.js`; fixture helpers above; `test/searchad-reporting-stats.test.js`; `test/postgres-searchad-reporting.integration.test.js`. Modify `src/bootstrap-v05.js`, `src/http/server-v05.js`, `src/http/routes-system-v04.js`, migration tests and `.github/workflows/searchad-extended-cleanup-wip.yml`.

**Interfaces:**

- Produce `loadSearchAdReportingConfig(env)`, `currentReportingIdentity({customerId,registry,credentialsRegistry,config}) -> Identity` and strict `validateStatsInput(input)`.
- Produce `PostgresReportingRepository({pool,clock})` with `appendObservation(observation)`, `getObservation({customerId,observationId})`, `listObservations({customerId,entityType,entityId,limit})`, `findLatestTrustedObservation({customerId,entityType,entityId,identity,now,maxAgeMs})`.
- Produce `StatsObservationService({repository,gateway,identityResolver,clock}).collect(input,context)` and `createReportingRuntime(dependencies)`.
- Produce `bootstrapSearchAdCompletionRuntime({app,env,clock,blobStorage,logger}) -> {runtime,startupError}` with `runtime.status()`/`close()`; later tasks add services without replacing ownership.
- Consume `CANARY_OPERATION_KEYS.readSingleStat`, `credentialFingerprintForCustomer`, existing access-control/principal checks. `/stats` observations are explicitly `provisional`; trusted lookup returns none until Task 3 establishes qualifying report-derived evidence.

- [ ] **RED:** Add named tests `stats_rejects_injected_evidence_before_io`, `stats_zero_is_valid_but_missing_is_not_zero`, `stats_sales_amt_is_vat_included_cost`, `stats_rechecks_rotated_identity_after_io`, `stats_scope_and_kst_cycle_are_exact`. Assert nonnumeric/negative/NaN values never become zero, exact range/entity matching, invalid Gregorian dates, cross-Customer lookup denial and redacted public errors. PG test proves immutable observations and Customer-separated IDs survive reconnect.
- [ ] **Run RED:** `node --test test/searchad-reporting-stats.test.js`; required PG: `node --test test/postgres-searchad-reporting.integration.test.js`. Expect failures for missing service/schema or the named incorrect behavior, no real external request.
- [ ] **GREEN:** Implement the0010 schema described in the spec, retaining existing report-job/schema tables. Add shared DTO validation, strict stats collector and sanitized repository mapping. Add GET observations/metrics placeholder with explicit unavailable metrics until ingested, POST `/reporting/stats`, Reader/Operator authorization, role docs, runtime/readiness/close. Bootstrap passes one injected clock through completion services. Create only server-requested evidence; never accept arbitrary observations over HTTP.
- [ ] **Verify:** Run the two suites, `node --test test/searchad-http-readiness.test.js test/searchad-http-access.test.js`, migration checks and `git diff --check`; CI must observe PG no-skip success. Full application fixture verifies route access and retained observation after actual reconstruction.
- [ ] **Commit:** stage the named implementation/test/workflow files and commit `feat(searchad): persist scoped reporting observations` after controller review.

## Task 2: Single-attempt stat/master registration and conservative recovery

**Files:** Create `src/naver/searchad/reporting/{operations,job-service,remote-adapter}.js`; `test/searchad-reporting-jobs.test.js`; `test/postgres-searchad-report-jobs.integration.test.js`. Modify reporting repository/runtime/routes/OpenAPI, `src/naver/searchad/{gateway,config}.js`, `src/naver/searchad/lifecycle/postgres-mutation-gateway.js`, the fake-upstream helper and workflow.

**Interfaces:**

- `REPORT_OPERATION_KEYS` resolves and freezes exact pinned sourceOperationIds `registerReportJobUsingPOST`, `getReportJobByReportJobIdUsingGET`, `getReportJobListUsingGET`, `createMasterReport`, `getMasterReport`, `getAllMasterReports`; resolver asserts kind/path/method uniqueness.
- `ReportJobService({repository,remote,identityResolver,clock,config}).register(input,context)`, `.poll({customerId,reportJobId},context)`, `.reconcile({customerId,reportJobId},context)`.
- Repository `createReportIntent(intent)`, `claimReportDispatch({customerId,reportJobId,requestHash,identity,now})`, `captureReportRegistration({customerId,reportJobId,claimId,remoteJobId,reportCreatedAt,identity,now})`, `settleReportJob(...)`, `getReportJob({customerId,reportJobId})`. Claim result is usable only after acknowledged COMMIT.
- Add `SearchAdOperationGateway.executeReportJob(operationKey,input)` and scoped adapter `register/get/list`; expose no generic URL/method override. Dedicated config `ATELIER_SEARCHAD_ALLOW_REPORTING_JOBS=false`.

- [ ] **RED:** Tests `report_intent_same_key_conflicts_on_hash`, `two_connections_only_one_dispatch`, `commit_ack_loss_never_sends`, `timeout_after_send_never_reposts_on_restart`, `missing_remote_id_single_list_match_stays_manual_review`, `known_id_reconcile_is_get_only`, `report_gate_does_not_enable_ad_create`. Assert canonical ID captured only from that POST response; no persisted temp URL; payload injection and wrong Customer/type returned responses fail closed.
- [ ] **Run RED:** `node --test test/searchad-reporting-jobs.test.js test/postgres-searchad-report-jobs.integration.test.js` (PG required in CI). Expect duplicate dispatch/unknown ownership tests to fail until fixed.
- [ ] **GREEN:** Implement two-kind registration lifecycle, independent processing/quality fields and exact gateway report scope. Claim→one request→capture; failed capture leaves unresolved and cannot return usable success. Known-ID polling refreshes canonical response without storing URL. Unknown-ID list reads are diagnostics only, no auto adoption, report deletion or retry. Wire `/reporting/jobs`, `/reporting/jobs/:id`, `/poll`, `/reconcile` with Customer/role gates and restart persistence.
- [ ] **Verify:** Rerun RED command plus `node --test test/searchad-gateway-capability.test.js test/searchad-postgres-mutation-gateway.test.js`; PG fixture tests suspend before initiation and identity changes. Run report HTTP through bootstrap with local fake signed transport, assert POST count exactly one over repetition/restart.
- [ ] **Commit:** `feat(searchad): add guarded report job intents and recovery`.

## Task 3: Signed report download, durable blobs, exact schemas and stabilized evidence

**Files:** Create `src/naver/searchad/reporting/{download-adapter,blob-storage,s3-storage,schema-registry,tsv-parser,ingestion-service,spend-evidence-service}.js`; `src/naver/searchad/transport/report-download.js`; `specs/naver-searchad/report-schemas.json`; `test/searchad-reporting-ingestion.test.js`; `test/searchad-report-download.test.js`; `test/postgres-searchad-report-ingestion.integration.test.js`; source fixtures under `test/fixtures/searchad/reports/`. Create narrow `migrations/postgres/0011_searchad_reporting_generation.sql` to make existing ingestion `report_created_at` nullable without altering0010; preserve stat exact generation as null and derived bounds in provenance. Update exact migration/current-version/clean-repeat tests. Modify client for explicit redirect/body-limit options, reporting repository/runtime/routes/OpenAPI, package/lock if adding `@aws-sdk/client-s3`, correction provenance and workflow.

**Interfaces:**

- `ReportDownloadAdapter({jobService,transport,identityResolver,clock}).download({customerId,reportJobId},context) -> {bytes,remoteJobId,reportCreatedAt,identity}`; transport retains temporary upstream URL only during one call.
- `LocalReportStorage({root})` and `S3CompatibleReportStorage({client,bucket,prefix})` implement `put({customerId,sha256,bytes,contentType,retainUntil})`/`get({customerId,key})` from the spec; SDK client is injectable, configured production client is real.
- `selectReportSchema({kind,reportType,reportCreatedAt,statDate,parserVersion},registry) -> descriptor`; `parseReportTsv(bytes,descriptor,{customerId}) -> normalized rows or quarantine reasons`.
- `ReportIngestionService(...).ingest({customerId,reportJobId},context)`; repository `commitIngestion({job,blob,schema,rows,quality,identity,now})`, `quarantineIngestion(...)`, `listMetrics(...)`.
- `SpendEvidenceService(...).evaluateGeneration({customerId,reportJobId},context)`; repository `selectSpendEvidence({customerId,entityType,entityId,identity,now,maxAgeMs})` includes validity/current-generation checks.

- [ ] **RED:** Add `download_signature_uses_path_only_and_preserves_fileVersion`, `download_rejects_redirect_ssrf_duplicate_token_and_oversize`, `download_token_absent_from_db_errors_logs`, `blob_checksum_failure_cannot_ingest`, `same_count_wrong_order_quarantines`, `partial_parse_promotes_no_rows`, `recollection_does_not_double_count`, `d3_48h_boundary_is_kst`, `late_generation_invalidates_evidence`. Test2026-11-16 generation-time switch, old statDate/new generation, NAVERPAY retirement, missing VAT provenance, UTF8/BOM/CRLF/trailing fields and storage/DB failures.
- [ ] **Run RED:** `node --test test/searchad-report-download.test.js test/searchad-reporting-ingestion.test.js test/postgres-searchad-report-ingestion.integration.test.js`.
- [ ] **GREEN:** Vendor minimal primary-source column descriptors/checksums with notice URLs, not guessed schemas or full copied documents. Required functioning formats are AD, AD_CONVERSION, EXPKEYWORD and master Campaign/Adgroup/Keyword/Ad, plus the two ADEXTENSION boundary formats. Exact official StatReport tables are in pinned `assets/i18n/markdown-en-US.json`, available for inspection at `/workspace/scratch/12f4c61df5c6/searchad-official-markdown-en-US.json`; vendor derived descriptors with its pinned commit/hash. Official MasterReport embeds `https://gist.github.com/naver-searchad/186ca42e1e8596b0e3dcf74e3a86c04f`; pin gist revision `8f5aed7a003af91e00fc2eede43e8452fd369a33` and SHA256 `7d94d45b4db76e2faa1a828eeb9611f7e398d9b2ba1c06af53a8d690027d818e` (cached `/workspace/scratch/12f4c61df5c6/searchad-official-master-reports-spec.md`) and derive ordered master tables (Campaign12, Adgroup19 including AI Ads, Keyword13, Ad11) with notice provenance. Empty or all-quarantined format support does not complete this task. Preserve search-term enum5 as exact where the pinned official table specifies it; do not collapse an incomplete correction mapping into an invented enum. Pin remaining report-type support/unsupported status. Verify official signed-download sample and fill VAT correction provenance from pinned `_posts/2026-02-11-notice1.md` at `https://naver.github.io/searchad-apidoc/notice/2026/02/11/notice1/`:2026-03-30 statDate switches COST to rounded long/VAT-included; regenerated preboundary dates retain historical representation/basis. Unavailable proof for any other mapping remains explicit blocked normalization, not inferred trusted cost. Stream bounded downloads through the existing signer/client-owned transport with redirect:error, store blobs before atomic staging/promotion, choose complete D+3/48h generations. Wire ingestion and archived-content retrieval through application roles; missing production durable storage makes required ingestion unready. No live storage provisioning/request is needed for tests; configured SDK adapter contract is exercised with injected transport.
- [ ] **Verify:** Rerun focused suites and reporting HTTP restart tests; assert report-download capability is separate from126 raw operations; property table for all date boundaries passes. Required PG verifies immutable spend evidence, Customer-scoped dedupe, concurrent ingestion and rollback on malformed row.
- [ ] **Commit:** `feat(searchad): ingest exact-schema reports into durable evidence`.

## Task 4: Circuit policies, resilient projection and all existing writer integration

**Files:** Create `migrations/postgres/0012_searchad_circuit_automation.sql`; `src/naver/searchad/circuit/{policy,postgres-repository,projection-service,service}.js`; `src/http/routes-searchad-circuit.js`; `test/searchad-circuit.test.js`; `test/postgres-searchad-circuit.integration.test.js`; `test/postgres-searchad-circuit-writer.integration.test.js`. Modify completion bootstrap/OpenAPI/server, `write/runtime-production.js`, `write/production-execution-service.js`, `lifecycle/postgres-account-send-fence.js`, `lifecycle/postgres-mutation-gateway.js`, `lifecycle/runtime-production.js`, `canary/runtime-production.js`, migration checks/workflow.

**Interfaces:**

- `CircuitProjectionService({repository,sources,clock}).catchUp({customerId}) -> {ready,cursors}` reads committed existing attempts/intents/events; `sources` are server-owned concrete repository adapters.
- `CircuitService({repository,projection,spendEvidence,clock}).evaluate(input,context)`, `.pause({customerId,reason},context)`, `.resume({customerId,reason},context)` and `.assertDispatchAllowed(dispatch,{client,now})`.
- Dispatch is immutable `{customerId,purpose,operationKey,entityType,entityId,ruleId?,actionClass,incrementalSpendKrw?}` derived by trusted adapters, never body input. Add optional internal fifth argument to `PostgresAccountSendFence.run(customerId,validate,task,method,{dispatch,beforeSend})`; `beforeSend(client,dispatch)` executes inside locked authoritative account transaction, followed by the existing synchronous identity check/fetch initiation.
- Repository `projectOnce({customerId,sourceKind,sourceId,event,now})`, `getState(...)`, `reserveDispatch(...)`, `appendManualControl(...)`; unique projection sources avoid recounting.0012 creates automation tables now for Task5 with no automation runtime activation.

- [ ] **RED:** `primary_success_survives_projection_error`, `next_dispatch_denied_until_projection_catches_up`, `duplicate_event_does_not_increment_failure_count`, `three_unknowns_stop_normal_customer_writes`, `pause_is_sticky_across_midnight_and_restart`, `rollback_and_read_recovery_survive_circuit_pause`, `manual_hold_and_cooldown_boundary_exact`. PG competitors test Circuit pause committed before fetch initiation across ordinary, lifecycle and Canary paths; report/read recovery does not masquerade as ordinary ad mutation.
- [ ] **Run RED:** `node --test test/searchad-circuit.test.js test/postgres-searchad-circuit.integration.test.js test/postgres-searchad-circuit-writer.integration.test.js`.
- [ ] **GREEN:** Implement policy defaults from spec, separate gross/net units, projection checkpoints and server-derived unresolved holds. Preserve the primary result/error if projection fails; check backlog authoritatively before the next mutation. Inject guard into every production writer composition, not only automation. Missing store/failed projection denies new ordinary writes. Wire Reader status and Admin pause/resume; document rollback exemption limited to Circuit, not account suspension/activation/after-hash.
- [ ] **Verify:** Rerun focused suites plus `node --test test/searchad-send-fence-*.test.js test/searchad-postgres-mutation-gateway.test.js test/postgres-searchad-application-send-fence.integration.test.js`; prove no await appears between final synchronous check and transport initiation. Real HTTP/restart assertions cover scope, sanitized error and independent primary outcome persistence.
- [ ] **Commit:** `feat(searchad): enforce durable Circuit checks across writers`.

## Task 5: Deterministic observe/recommend/approve automation with existing approvals

**Files:** Create `src/naver/searchad/automation/{policy,postgres-repository,service,recipes}.js`; `src/http/routes-searchad-automation.js`; `test/searchad-automation.test.js`; `test/postgres-searchad-automation.integration.test.js`. Modify completion bootstrap, shared write-runtime accessor, reporting evidence lookup, Circuit/OpenAPI/server/workflow.

**Interfaces:**

- `AutomationService({repository,evidenceSelector,circuit,getWriteRuntime,identityResolver,clock}).evaluate({customerId,policyId,slotAt?},context)`, `.prepare({customerId,runId},context)`, `.executeApproved({customerId,runId,executionToken},context)`, `.getRun(...)`.
- `AutomationRepository.createPolicyRevision(policy)`, `findPolicy({customerId,policyId})`, `createDecisionOnce({decisionKey,...})`, `reserveRun({customerId,runId,now})`, `attachPlan({customerId,runId,planId})`, `settleRun(...)`.
- Reuse `SearchAdChangePlanService.create`, `SearchAdApprovalService.approve`, and `ProductionSearchAdExecutionService.execute/reconcile/rollback` exact existing signatures. Resolve write runtime with a single app-owned accessor; no raw client in automation.
- Server recipes return existing plan-service inputs for supported campaign budget/userLock only. New policy mode auto remains blocked until Task10 eligibility/delegation implementation.

- [ ] **RED:** `observe_never_creates_plan_or_token`, `same_inputs_same_decision_key`, `payload_cannot_select_evidence_or_current_value`, `latest_evidence_is_exact_scope_and_identity`, `approve_creates_one_plan_and_reuses_existing_token_claim`, `replayed_execute_has_no_second_mutation`, `cross_customer_run_is_inaccessible`, `unknown_run_never_generates_new_approval`.
- [ ] **Run RED:** `node --test test/searchad-automation.test.js test/postgres-searchad-automation.integration.test.js`.
- [ ] **GREEN:** Implement policy revisions and deterministic evaluation with selected source hashes; durable run reservation precedes plan creation. Record modes and blocked reasons accurately. Admin policy updates are local configuration only, cannot create activation evidence. Wire evaluate/prepare/execute-approved/read endpoints, strict allowlists and existing explicit approval surface; no token in persisted worker/job payload. Activation/Customer/Circuit guards remain final authority.
- [ ] **Verify:** Focused suites and existing write approval/execution tests; full application restart after plan creation, token claim and unknown result. Inject failures between run reserve/plan persist/attach and prove orphan detection/manual review rather than duplicate plan/remote mutation.
- [ ] **Commit:** `feat(searchad): add deterministic approval-based automation`.

## Task 6: Durable leased worker and bounded schedules

**Files:** Create `migrations/postgres/0013_searchad_worker.sql`; `src/naver/searchad/worker/{config,postgres-repository,scheduler,handlers,runtime}.js`; `src/searchad-worker.js`; `src/http/routes-searchad-worker.js`; `test/searchad-worker.test.js`; `test/postgres-searchad-worker.integration.test.js`. Modify package scripts, completion bootstrap/disposal/OpenAPI/server, migration checks/workflow.

**Interfaces:**

- `PostgresWorkerRepository.enqueueSlot({customerId,scheduleId,slotAt,kind,payload,requestHash,now})`, `.claim({workerId,now,leaseMs})`, `.heartbeat({jobId,ownerToken,leaseGeneration,now,leaseMs})`, `.finish({jobId,ownerToken,leaseGeneration,state,result,now})`.
- `SearchAdScheduler({repository,clock}).tick({now?}) -> scheduled/skipped counts`.
- `SearchAdWorker({repository,handlers,clock,workerId}).runOnce()`, `.start()`, `.stop({drainTimeoutMs})`. Named handlers: `collect_stats`, `register_stat_report`, `collect_report_generation`, `evaluate_automation`, `reconcile_automation`.
- Entrypoint `main({env,clock,bootstrap,logger})`; script `searchad:worker`. `bootstrap` is real application composition by default; tests inject it. Add Admin schedules/jobs routes; schedules cannot carry evidence objects/IDs or execution tokens.

- [ ] **RED:** `two_workers_skip_locked_claim_distinct_jobs`, `unique_schedule_slot_survives_restart`, `expired_owner_cannot_finish`, `stale_worker_cannot_double_dispatch`, `ambiguous_registration_crash_recovers_without_post`, `stale_backlog_records_skip`, `report_dates_follow_kst_at_utc_midnight`, `payload_evidence_injection_rejected`, `shutdown_leaves_recoverable_history`.
- [ ] **Run RED:** `node --test test/searchad-worker.test.js test/postgres-searchad-worker.integration.test.js`.
- [ ] **GREEN:** Implement row-lock leasing, monotonic generations, bounded retries, source-service idempotency and history. Use spec15m/1h/03:00KST and7-day backfill defaults. Never reclaim a job by creating a new report/automation intent. Worker default disabled; when enabled, missing PG or service readiness fails startup. Keep schedules and worker principal Customer scope server-configured.
- [ ] **Verify:** Focused suites with real two-pool PG race and process-equivalent runtime reconstruction; CLI start/stop fixture observes zero raw external calls and owned-resource disposal. CI requires database variable and zero skips; unit-only local results are labeled separately.
- [ ] **Commit:** `feat(searchad): add durable scheduled reporting and automation worker`.

## Task 7: Descriptive 126-operation validation registry and expanded safety scanner

**Files:** Create `src/naver/searchad/validation/{registry,service}.js`; `specs/naver-searchad/validation-registry.json`; `scripts/searchad-execution-safety.mjs`; `scripts/searchad-validation-coverage.mjs`; `test/searchad-validation.test.js`; `test/searchad-execution-safety.test.js`. Modify completion OpenAPI/reader routes/runtime, package/lock for an ECMAScript parser if required, existing safety script and workflow. If extracting transport implementation, create `src/naver/searchad/transport/account-send-fence.js` and retain `lifecycle/postgres-account-send-fence.js` as a compatibility re-export; do not change fence behavior in this task.

**Interfaces:**

- `loadValidationRegistry({manifest,entries}) -> frozen registry`, `validateOperationCoverage({manifest,registry}) -> {rawCount,classifiedCount,unclassified,leaks}`; `ValidationService.list({state?})` is read-only.
- `scanExecutionSources({root,transportAllowlist}) -> {scannedFiles,violations,reviewedTransportBoundaries}` parses imports/calls across all required dirs plus entrypoints, including files added later.
- Exact four statuses from spec; records include bounded scope, source/test references, `liveVerified` and reason. Signed download is separate transport capability and does not change126.

- [ ] **RED:** `registry_classifies_exactly_126_unique_keys`, `registry_never_mutates_runtime_allowlist`, `internal_nine_never_become_public`, `canary_family_does_not_imply_live_customer_authority`, `scanner_rejects_fetch_alias_http_undici_dynamic_network_import`, `scanner_visits_nested_and_new_source_files`, `approved_transport_boundary_is_explicit_not_whole_directory_exemption`.
- [ ] **Run RED:** `node --test test/searchad-validation.test.js test/searchad-execution-safety.test.js`.
- [ ] **GREEN:** Build descriptive mapping from current code scope, not blanket “implemented” labels. Scanner covers write/canary/lifecycle/reporting/circuit/automation/worker/validation and profitability, routes and bootstraps. Permit only explicit reviewed transport initiation boundaries; adapters must delegate approved methods. Keep existing16-file scanner as a legacy narrow check, report expanded counts truthfully. Add Reader GET `/validation/operations`, no promote/activate action.
- [ ] **Verify:** `node scripts/searchad-execution-safety.mjs`, `node scripts/searchad-validation-coverage.mjs`, `npm run searchad:coverage`, named tests; disposable mutation fixtures introducing forbidden direct network call must fail, restored source must pass. Retain account fence behavioral suite if extraction was needed.
- [ ] **Commit:** `feat(searchad): classify operation validation and audit execution boundaries`.

## Task 8: Canonical HAAR mapping and real provider-backed commerce evidence

**Files:** Create `migrations/postgres/0014_searchad_profitability.sql`; `src/naver/searchad/profitability/{contracts,postgres-repository,product-evidence-service,commerce-provider,naver-commerce-provider,cafe24-commerce-provider,mapping-service}.js`; `src/http/routes-searchad-profitability.js`; `test/searchad-product-evidence.test.js`; `test/postgres-searchad-product-evidence.integration.test.js`. Modify completion bootstrap/OpenAPI/server, existing Commerce/Cafe24 composition only as necessary, migration tests/workflow.

**Interfaces:**

- `ProductMappingService(...).bindCustomerChannel(input,context)`, `.createRevision({customerId,haarProductId,channelProductKey,entityType,entityId,method,allocation},context)`, `.resolve({customerId,haarProductId,at})`.
- `CommerceEvidenceProvider` methods `collectProductState(scope)`, `collectOrderLines(scope)`, `collectAdjustments(scope)`, `collectSettlements(scope)` return `{rows,complete,sourceIdentity,observedAt,missingReasons}`. `scope={customerId,channelId,channelProductId,remoteProductId,since,until}` is server-built.
- `ProductEvidenceService(...).collect({customerId,haarProductId,since,until},context)`; repository `appendCommerceObservation`, `appendCostInput`, `selectProductInputs` and `getVerifiedChannelBinding`.
- Naver adapter invokes the existing `CommerceOperationGateway.execute(operationId,input,context)` using exact pinned read-only operation descriptors. Cafe24 adapter invokes `Cafe24AdminClient.get` for documented read endpoints only. Add a server-owned descriptor table listing each capability; unsupported source methods return explicit missing reason and never fabricate rows.

- [ ] **RED:** `canonical_uuid_and_text_channel_key_are_not_confused`, `haar_own_mall_not_duplicated_as_cafe24_channel`, `same_supplier_sku_different_sources_do_not_merge`, `customer_channel_binding_required`, `manual_mapping_cannot_claim_live_evidence`, `shared_ad_mapping_needs_weights`, `commerce_provider_is_wired_in_bootstrap`, `order_adjustment_identity_deduplicates`, `missing_settlement_is_partial_not_zero`, `buyer_pii_never_persists`.
- [ ] **Run RED:** `node --test test/searchad-product-evidence.test.js test/postgres-searchad-product-evidence.integration.test.js`.
- [ ] **GREEN:** Implement0014 without legacy mapping destruction; new source-independent rows require canonical HAAR/channel links and Customer scope. Effective-dated cost/mapping revisions, immutable provider observations and explicit capability results. Read official provider contracts when a response field is not documented locally and pin minimal mapping fixtures. Wire Operator product collection, Admin binding/mapping/cost input, Reader evidence summaries. Source unsupported/incomplete data remains visible and blocks actual profit/Auto eligibility, with no manual “trusted=true” escape hatch. At least SmartStore product state/order/adjustment provider methods and the existing Cafe24 product/variant reads must invoke real configured read-only adapters in application composition; mocks-only or every-provider-unavailable implementation does not complete this task. Implement available settlement reads whose pinned descriptors and official field semantics are verified; retain explicit missing capability only for genuinely unsupported/unverifiable sources.
- [ ] **Verify:** Focused unit/PG+HTTP restart suites plus existing multi-source and channel-import regression. Assert no Commerce write operation can be selected by provider and no input can replace the server-chosen operation/path/account. Exact0014 migration acceptance includes repeat and original checksum identity.
- [ ] **Commit:** `feat(searchad): connect HAAR product mappings and commerce evidence`.

## Task 9: Explainable profitability and deterministic recommendations

**Files:** Create `src/naver/searchad/profitability/{calculator,service,recommendation-service,recommendation-rules,tool-adapter}.js`; `test/searchad-profitability.test.js`; `test/searchad-recommendations.test.js`; `test/postgres-searchad-profitability.integration.test.js`. Modify profitability repository/routes, automation evidence selector, completion runtime/OpenAPI/workflow.

**Interfaces:**

- `calculateProfitability(inputs,policy) -> {metrics,quality,missingReasons,componentProvenance,basis,asOf}` is pure exact-money arithmetic.
- `ProfitabilityService(...).calculate({customerId,haarProductId,since,until},context)`, `.getLatest(...)` persists immutable snapshot with source-set hash.
- `RecommendationService(...).generate({customerId,haarProductId,since,until},context)`, `.list(...)`; server-owned `SearchAdRecommendationToolAdapter.keywordIdeas(scope)`/`.bidEstimate(scope)` resolve pinned read-only descriptors and enforce capability.
- Recommendation records use deterministic ID/key derived from Customer, canonical product, rule version, input hashes and proposed patch; include confidence, reason, expiry, validator/activation constraints and `executable` flag.

- [ ] **RED:** Table tests pin complete actual, explicit estimated, partial and unknown states; net100000−COGS30000−fees5000−shipping3000−sellerDiscount2000−returnProvision1000−adCost10000 produces contribution49000 when none of those deductions is already netted. `missing_cogs_yields_null_contribution`, `zero_denominator_yields_null`, `refund_not_subtracted_twice`, `shared_spend_allocated_once`, `ad_attribution_is_not_commerce_revenue`, `same_inputs_same_recommendations`, `two_conversions_cannot_recommend_increase`, `unsupported_negative_keyword_is_nonexecutable`.
- [ ] **Run RED:** `node --test test/searchad-profitability.test.js test/searchad-recommendations.test.js test/postgres-searchad-profitability.integration.test.js`.
- [ ] **GREEN:** Implement formulas/bases, effective costs, explicit unallocated spend and exact rounding policy; preserve raw values/provenance. Produce keyword/search-term, bid-estimate, budget, negative/stop recommendations with known validator/capability restrictions. Persist all decisions including blocked reasons; no nonexecuted proposal can claim outcome proof. Reader profitability/recommendation surfaces and Operator generation use real runtime providers.
- [ ] **Verify:** Focused suites plus multi-Customer HTTP reads/restart and repeated ingestion/recollection cases. Cross-product/cross-channel joins cannot duplicate spend/orders. Golden calculations include same HAAR product sold on both configured channels and multiple suppliers/variants.
- [ ] **Commit:** `feat(searchad): calculate product profitability and evidence-based recommendations`.

## Task 10: Policy-delegated limited Auto through the existing execution engine

**Files:** Create `src/naver/searchad/automation/{eligibility,auto-executor}.js`; `test/searchad-limited-auto.test.js`; `test/postgres-searchad-limited-auto.integration.test.js`. Modify automation policy/service/repository/recipes, worker handlers, Circuit dispatch integration, completion bootstrap/OpenAPI/workflow.

**Interfaces:**

- `evaluateAutoEligibility({policy,evidence,profitability,mapping,history,capability,now}) -> {eligible,reasons,allowedPatch}` is pure and cannot issue permission.
- `LimitedAutoExecutor({repository,automationService,getWriteRuntime,circuit,identityResolver,clock}).execute({customerId,runId},context)` performs server-policy delegation checks, run reservation, server plan and transient one-time approval then calls existing execution service.
- Policy delegation is a revision-bound server record `{authorizedByPrincipalId,authorizedAt,expiresAt,customerId,operationKeys,fieldScope,maxChangePercent,maxDailyBudgetKrw,maxIncrementalSpendKrw,maxDailyOperations}`. Public worker payload cannot specify actor/delegation/approval. Stored delegation is distinct from and subordinate to existing activation grants.

- [ ] **RED:** `default_observe_produces_zero_mutation`, `seven_elapsed_days_without_complete_observations_is_ineligible`, `stale_stock_stats_profit_or_identity_blocks_auto`, `manual_hold_circuit_and_cooldown_block_auto`, `unsupported_bid_create_delete_unlock_cannot_execute`, `twenty_percent_and_daily_limits_are_atomic`, `missing_estimate_balance_blocks_increase`, `auto_calls_real_plan_approval_execute_once`, `restart_after_token_issue_never_reissues_or_replays`, `verification_failure_holds_followup`, `delegation_revoked_before_send_blocks_dispatch`.
- [ ] **Run RED:** `node --test test/searchad-limited-auto.test.js test/postgres-searchad-limited-auto.integration.test.js`.
- [ ] **GREEN:** Implement seven complete KST days, freshness15m/30m/24h, mapping>=0.90, conversion>=3 for increases, existing exact campaign fields and spec ceilings. Normal policy choices can tighten but cannot exceed hard limits. Recheck policy revision, identity, Circuit and activation immediately before dispatch. Budget reservations aggregate by Customer/KST day atomically and consumed/unknown reservations are not recycled. Raw approval token remains transient; crash window ends in durable reconcile/manual review. Worker may execute eligible runs only with enabled policy and unchanged operational gates; no actual environment is enabled here.
- [ ] **Verify:** Focused suites with actual PostgreSQL writer/approval/activation and injected signed upstream, concurrent policy/day-limit claims, HTTP dispatch/restart. Demonstrate stopped/budget bounded recipe outcome verification and negative controls for every blocked family. Read/reconcile/rollback remain reachable under Circuit hold while their original gates still apply.
- [ ] **Commit:** `feat(searchad): add bounded policy-delegated automatic execution`.

## Task 11: Full application acceptance, explicit blockers and reproducible handoff

**Files:** Create `test/postgres-searchad-completion-http.integration.test.js`; `test/searchad-completion-openapi.test.js`; `docs/SEARCHAD_COMPLETION_ACCEPTANCE_2026-10-05.md`; `docs/SEARCHAD_COMPLETION_RUNBOOK.md`. Modify `src/http/openapi-searchad-completion.js`, completion status only for blocker fields, `docs/SEARCHAD_RECOVERY_DASHBOARD.md`, `.github/workflows/searchad-extended-cleanup-wip.yml`, and root planning report if discovered limitations need precision.

**Interfaces:**

- `runtime.status().blockers` returns sanitized descriptive entries for `parent_remote_absence_unproven`, `live_validation_not_performed` and any unsupported schema/provider capability; never flags as permission.
- Acceptance fixture reconstructs full `bootstrapV05` + `createHttpApiV05` and separate worker using realPG with fake upstream. Role docs must enumerate exactly implemented endpoints/methods and request schemas, no speculative executable operations.

- [ ] **RED:** Add one integrated Customer workflow: stats→report intent/poll/ingest→trusted generation→Circuit projection→HAAR mapping/commerce→profit/recommendation→observe/approve/limited-auto fixture→outcome verification→restart→GET-only recovery. Pin role matrix, wrong Customer denial, expired identity, shutdown, missing DB/storage readiness, schedule duplicate prevention and secret/temp-token absence in responses/logs/DB. Retain parent cleanup routes404 and `cleanup:false` before/after restart; empty inventory still has no authority.
- [ ] **Run RED:** `node --test test/searchad-completion-openapi.test.js test/postgres-searchad-completion-http.integration.test.js`; see intended failures for any unwired subsystem rather than acceptance against hand-constructed services.
- [ ] **GREEN:** Complete any missing composition/close/readiness/documentation connections. Do not relax a safety assertion to obtain closure. Run full tests, clean0010–0014 migration acceptance, expanded scanner, exact126 registry and117 baseline runtime count (explain any separately justified correction), all syntax checks, diff/secret scans and production dependency audit. Include report/worker/Auto focused jobs as well as full `npm test` so file omission cannot hide gaps.
- [ ] **Verify and document:** `npm ci`; `npm run check`; syntax-check every tracked source/script; `npm test`; `node scripts/searchad-write-safety.mjs`; `node scripts/searchad-execution-safety.mjs`; `node scripts/searchad-validation-coverage.mjs`; `npm run searchad:coverage`; `npm run commerce:coverage`; `git diff --check`; `npm audit --omit=dev --audit-level=high`. Use fresh CI with required realPG and zero skips for acceptance, record exact SHA/run/job/counts and limits. Network audit failure is `unverified`. Distinguish software-supported, provider/schema-blocked, #26 unresolved and #22 unstarted. Preserve PR28 Draft/unmerged and publish only through the controller's authorized feature-branch workflow.
- [ ] **Commit:** `test(searchad): verify composed completion and retain operational blockers`.

## Self-review and handoff

Coverage: reporting/stat/master/download/storage/schema/VAT/stabilization1–3; Circuit/all-writer local dispatch4; deterministic automation5; durable worker/scheduler6; descriptive126 registry/expanded scanner7; HAAR identities/provider facts8; profitability/recommendations9; limitedAuto10; remaining whole-system acceptance and #26 disposition11. Every new public route has a runtime owner and role OpenAPI task. The five Review Focus conditions have named owning tests above. Types use consistent Customer scope, canonical HAAR ID, UUID channel_product_id and text channel_product_key. No task fabricates live proof, guesses an unknown report ID, promises complete external absence or changes production gates.

Execution is authorized to continue autonomously under the user's existing instruction; controller review precedes implementation and each reviewable commit. If official semantics are missing, implement the explicit fail-closed unsupported status and report it, without silently shrinking a claim of completion or demanding unnecessary stage approvals.
