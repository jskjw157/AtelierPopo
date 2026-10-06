# Final whole-branch review — f3a45ce

**Verdict: Needs fixes before whole-branch software acceptance.** Findings: **0 Critical, 1 Important, 2 Minor** (both Minors carried forward and explicitly dispositioned below). One actual-service counterexample establishes the Important finding despite the passing frozen suite. This is the final review of the complete supplied range, not a restart of individual task reviews.

## Scope and evidence

- Repository: `/Volumes/X9 Pro/source/AtelierPopo`; application paths below are relative to `smartstore-bridge/`.
- Base: `290af32276f373a799b9ce2cdd6d2722564b710b`; head: `f3a45cecb5278eae27db97245c66a6bc6eaaacfb`; tree: `0ae858dd4872e6b2fcea4c31ac02d158ec66b30d`.
- Read all 98 changed files in `review-290af32..f3a45ce.diff`: 17 commits, 7924 additions, 132 deletions, 971616-byte review package. Review proceeded through schema/authority, source selection and profitability, worker/recovery, public composition/scanner, tests/fixtures, and workflow/documentation. The 126-row registry was read as every key/scope and the grouped repeated metadata. Named affected unchanged seams were consulted only where needed. Hashing 690 files is integrity verification, not a claim of separately auditing every unchanged file.
- Read the entire plan and design, controller context, complete progress ledger including all eight Rulings and their costs, original deferred-Minor dispositions, and final Task11 fix report/review/manifests. Later protocol rulings govern migration numbering and other superseded plan prose.
- Independently rehashed all 690 current source files: zero mismatches; compact sorted-map SHA256 `78082db52f794edd7f5e50712a8753aa82d94693e4677d4e149140187cbe8ed7`. HEAD/tree match the supplied values and tracked worktree is clean. All 32 closed final artifacts match recorded bytes and SHA256; final fix report SHA256 is `081fa2f51ed19aa909452c923dfb4906a4d74300b792b2ccc834b68b030b85ee`.
- Rehashed the exact frozen full TAP: `8882a28b5f19391589e4c02c12ddececcec019bb3aefd56ddd95797c443334d8`. It records 1576/1576 passing, 865 top-level tests, fail/cancel/skip/todo all zero, 312644.236583 ms. Controller source pairing records all 154 files, native PostgreSQL16, UTC and concurrency1. No source changed after that freeze. `final-review-evidence-check.json` retains these checks.
- Existing focused UTC/KST, scanner, migration, static and audit evidence is retained and matched through the closed manifests; I did not rerun full/broad suites, migration application, native tests or audit/network requests. The additional clock probe imports the actual service, observation and eligibility code with closed in-memory collaborators and no socket/database/provider call.
- Before final report delivery, the controller reported fresh CI `37490809772`, job `112362735681`, **SUCCESS** on exact f3a45ce. Its downloaded `task-11-ci-37490809772.log` confirms 1576/1576, fail/cancel/skip zero, clean exact0001–0015 application, immediate/postfull `applied:[]`, and audit0. This terminal observation is controller-owned; I made no remote call. Predecessor CI `37482686719` on 577367b remains separate evidence. The successful current CI does not resolve F-I1.

## Strengths

1. Authority is traced through persisted ownership, not route claims. Immutable policy revisions, run/plan/approval links, accepted Customer ordinals, consumed reservations and current account/activation/Circuit checks converge at the existing writer. Unknown/acknowledgment-loss paths hold authority rather than replaying or issuing replacement tokens. The worker recovery correction requires exact primary terminal proof, and tests retain the misleading terminal-plan/incomplete-attempt counterexample.
2. Later Auto changes preserve earlier review fixes: a single owned transaction client reaches product/cost/report selectors; account-first serialization and source/grant locks retain membership through local initiation; synchronous expiry includes worker leases, mappings/scheduled successors and estimate/balance deadlines. Native tests cover saturated pools, real lock waiters and exact equality boundaries.
3. Product evidence has clear Customer/canonical-product/channel/binding ownership, including raw-SQL enforcement. Provider rotation cannot silently reuse an old mapping. Exact decimal arithmetic, immutable raw provenance, catalog hashes and historical joint cost/link intervals avoid fabricated zeros, double refunds and stale snapshot reuse. Financial uncertainty remains visible in actual runtime results.
4. The scanner is substantially stronger than a token search: recursive import closure, AST nodes plus enclosing contexts, explicit capability transfers, constructor provenance and callable serializer-hook controls. Its limitations are documented. Mutation tests include actual fake-call execution before rejection, not only expected diagnostic strings.
5. Composed acceptance uses real bootstrap, HTTP routes, separate headless worker, native seven-generation history, the ordinary approval/writer engine and GET reconciliation across restart. Private synthetic financial positives are explicitly separated from actual provider blockers. The logging correction now captures real HTTP/worker events and excludes request credentials and arbitrary exception fields.

## Findings

### Important — F-I1: evaluation time precedes the current-value observation it must validate

**Location:** `src/naver/searchad/automation/service.js:53`, `:56`, `:61`, `:68`; producer `automation/recipes.js:11`–14; predicate `automation/eligibility.js:7`, `:41`.

`evaluate()` captures `now` before awaiting identity resolution, the Campaign GET and observation persistence. `observeCurrent()` timestamps the successful read using the clock after the awaited read/identity check. Limited-Auto eligibility then compares this newer `observedAt` to the older captured `now`. Its correct future-evidence guard rejects the current observation whenever the asynchronous path advances the clock by even one millisecond.

**Reproduction:** from repository root, run:

```sh
node .superpowers/sdd/2026-10-05-searchad-completion/final-review-clock-probe.mjs
```

This invokes actual `AutomationService.evaluate`, `observeCurrent` and `evaluateAutoEligibility`; only repositories, Circuit and the read adapter are closed synthetic collaborators. An otherwise complete permitted 1000→800 budget policy has these results:

| Fake GET elapsed time | Actual service state | Reasons | Same selected facts evaluated at actual completion |
| --- | --- | --- | --- |
| 0 ms | ready | none | eligible |
| 1 ms | blocked | CURRENT_VALUE_UNAVAILABLE | eligible |
| 100 ms | blocked | CURRENT_VALUE_UNAVAILABLE | eligible |

`final-review-clock-probe.json` retains exact instants. For each case, genuine future (`completion+1 ms`) and stale (`completion−1800001 ms`) current observations remain ineligible with `CURRENT_VALUE_UNAVAILABLE`. The proof creates no plan, token, database row or outbound request.

**Impact:** a supported and otherwise eligible limited-Auto policy cannot become ready during ordinary asynchronous execution. Production's present financial blockers mask this additional implementation blocker; they do not make the accepted limited-Auto software behavior correct. Fixed-clock native/composed positives miss it.

**Fix:** separate the logical scheduling-slot instant from the instant used to assess completed observations. Capture/reconcile evaluation time after awaited collection, and assess selected facts at a current consistent instant, including elapsed time during source/Circuit reads. Preserve original evidence timestamps, the true-future guard, freshness/expiry checks and final synchronous fence. If selection crosses a KST window boundary, reselect or fail closed against the current window rather than reuse mismatched history. Add an advancing-clock actual-service positive, true-future/stale negatives and elapsed-deadline/window controls as appropriate. Do not fix this by backdating observations or deleting `observedAt <= now`.

### Minor — T11-F1-M1 retained: safe HTTP log ID cannot be recovered from a response

**Location:** `src/http/server-v05.js:140`–144, `:201`–215.

The response uses `requestId`, but both HTTP log events use a distinct server-owned `logRequestId`. That safe UUID is absent from response headers/body. This occurs even without a caller-supplied ID. The original scoped review's actual-handler probe recorded response header/error IDs equal to each other, neither matching any HTTP log; info/error shared the separate internal UUID. The final source retains exactly that behavior.

**Impact:** support cannot locate a request's HTTP events from its ordinary response correlation ID. Privacy and denial behavior remain correct; severity stays Minor.

**Disposition:** recommend correction in the one final fix wave: expose the safe server UUID through a separate response header while retaining existing response IDs. Assert response-to-log equality for both ordinary and caller-ID requests, and retain the private URL/path/exception/caller-ID absence controls. Do not put the caller's ID back into logs. If the controller elects to defer, record the lost support correlation explicitly; the prior scoped acceptance did not resolve it.

### Minor — T6-M1 retained: inherited visible SQLite ExperimentalWarning

**Location:** unchanged `src/infrastructure/ledger.js:1`; final full TAP first occurrence at line96 (48 occurrences in that TAP); original `task-6-review.md:39`–42.

Node22's existing `node:sqlite` import emits the known ExperimentalWarning during application/test bootstrap. The new headless/composed paths make the inherited warning visible; no new behavioral failure or lost evidence was established.

**Disposition:** accept as nonblocking for this branch, explicitly carry the runtime warning forward. Preserve visibility and identify the known warning when inspecting logs. No blanket warning suppression and no SQLite/runtime migration in this final correction wave. Such a migration would require separate compatibility work and is not justified by this warning alone.

## Cross-task and spec assessment

The plan's intent is usable observe/recommend/approve automation, safe durable scheduling, descriptive operation coverage, canonical commerce evidence, honest profitability/recommendations and bounded Auto through the existing engine. The branch largely satisfies that software design, but F-I1 prevents the supported Auto positive under a moving clock and therefore blocks final acceptance.

Previously reviewed seams remain present in the final source: Task5 primary recovery/claim cleanup and acknowledged-current persistence; Task6 exact primary-outcome reconciliation; Task7 request-capability and serialization-hook rejection; Task8 replacement binding/mapping and direct SQL ownership; Task9 source/canonical snapshot identity and joint historical intervals; Task10 same-client source graph, retired-binding scheduled boundaries and synchronous time expiry; Task11 actual logger capture, fixed metadata and SQL DATE text reads. No regression in those corrected contracts was established beyond the newly identified cross-task timing issue.

All eight recorded Rulings were assessed rather than silently substituting the earliest plan text:

| Ruling | Review disposition and retained cost |
| --- | --- |
| 1 — selected cloned checkout | Accepted review boundary; shared-checkout coordination and rework cost retained, no second source checkout introduced. |
| 2 — later migration protocol | Accepted 0013/0014/0015 split; earlier 0001–0012 remain frozen. Historical renumbering cost occurred before publication. |
| 3 — reviewed feature-branch increments | Recorded controller-authorized fast-forward publication, with reversible feature-commit cost; no main merge permission inferred. |
| 4 — pinned Campaign userLock PUT | Exact body/field mapping and activation remain required; narrow revert cost accepted, no broader gate change. |
| 5 — caps also in Task5 | Conservative 20%/100000 limits accepted for recommendations/preparation too; reduced proposal range is explicit. |
| 6 — fresh Task6 implementer after capacity | Accepted recorded implementation continuity/context-reconstruction cost; independent review remained required. |
| 7 — seven fully ended D+3 dates | Accepted D-9..D-3, selected freshness<=24h; delayed/conservative eligibility is explicit. F-I1 is additional unintended denial, not this ruling. |
| 8 — fresh Task10 implementer after capacity | Accepted recorded implementation recovery/context-reconstruction cost; original Important fixes remain checked in final integration. |

## Considered behaviors not requested as changes — controller adjudication

These are explicit dispositions, not silence interpreted as permission:

1. **Enable live Auto, provision storage, fill real financial evidence or activate gates:** declined. Current Naver settlement lacks guaranteed ledger identity/reconciliation, Cafe24 finance is unverified, and mapping/cost/allocation are manual. Actual contribution/eligibility must remain partial/unknown. Synthetic facts establish software predicates only.
2. **Call POST estimates or use registry labels as authority:** declined. Pinned estimate operations remain create-gated side effects and unavailable to the read-only adapter. The 126/117/9 classifications and liveVerified=false grant nothing. No ordinary bid/create/delete/unlock/relaunch expansion is justified.
3. **Promote keyword-tool registry coverage after Task9:** considered its conservative public_unverified row. This registry describes validation level, not whether a later bounded adapter exists. Understating implementation does not enable execution; no correctness/security change is required here. Controller may clarify the descriptor-only wording separately without implying live proof.
4. **Make partial/missing evidence zero or actual:** declined. Unknown cost, unallocated spend, empty settlement and disjoint/ambiguous historical relationships retain explicit reasons/nulls. No guessed allocation, order-to-variant assignment or provider reconciliation is appropriate.
5. **Relax future/age bounds to make Auto pass:** expressly declined. F-I1 requires a correct assessment instant; the true-future/stale controls remain mandatory.
6. **Replace the whole seven-day window or add caller evidence overrides:** declined. Current server-selected schema/generation/history predicates and the conservative Ruling7 window are retained. Increases continue to require positive actual contribution, conversions and verified estimate/balance.
7. **Enable public parent cleanup from empty inventory/owned IDs/Admin flags:** declined. #26 complete remote absence and exclusion of other writers remain unproven; DELETE remains absent/404, cleanupfalse. No remote deletion was attempted.
8. **Automatically replay unresolved report registration or mutation, reissue tokens, clear pauses or refund unknown reservations:** declined. Holds/manual review are the supported ambiguity outcome. Reconciliation reads remain distinct from dispatch authority and preserve exact primary proof.
9. **Add worker-lease cancellation to the already-issued report creator permit:** considered the existing native turnover test where the original report source owner may finish its single authorized attempt while the successor stays manual-review. That opaque source permit is not reconstructed or double-dispatched; the successor cannot settle the old generation. This existing report protocol is distinct from limited-Auto's final job-owner check. No newly demonstrated duplicate-write defect warrants a protocol rewrite in final review.
10. **Replace coarse table/source/grant locks or claim throughput:** declined. Locks are an explicit conservative membership tradeoff; native progress/deadline tests do not constitute a throughput benchmark. A contention optimization needs its own invariant-preserving design and measurements.
11. **Treat the scanner as whole-program security proof or extend it to arbitrary reflection/third-party behavior:** declined. It is bounded static analysis with independently reviewed records and adversarial controls. No general proof, sandbox claim or directory exemption is accepted.
12. **Reopen broad response-error normalization after the logging fix:** considered only to trace emitted data. The concrete new regression is T11-F1-M1; no additional demonstrated changed-path leak was established. Restoring raw exception/caller values to diagnostics would regress the resolved Important issue.
13. **Rewrite earlier task-specific documentation wholesale:** considered the registry document's historical Task11/KST obligation sentence. The final acceptance/runbook explicitly records the DATE fix and current evidence. It is a historical handoff statement, not renewed permission to alter time/risk checks; no additional blocking defect assigned. Controller may update tense for clarity.
14. **Normalize every historical UUID spelling or redesign all source schemas:** considered a possible uppercase mapping/allocation input edge; no accepted unsafe authority or concrete incorrect financial result was demonstrated. Case-equivalent profitability identity is directly covered. No speculative schema/refactor finding is raised.
15. **Large formatting/complexity refactor:** dense automation/profitability/SQL code raises future maintenance cost, but a broad rewrite would expand this final wave without a demonstrated behavioral defect. Keep the correction localized and readable. No measured cyclomatic-complexity or >80% line-coverage claim is made.
16. **Rerun broad/full native suites, reset schemas, reapply migrations or rerun network audit:** declined under the frozen review contract. Exact artifacts are verified; only the named offline counterexample was added. Existing zero vulnerabilities at the recorded audit cutoff are not a timeless security certification.
17. **Merge/deploy, issue comments/messages, start #22 or clean the workspace:** declined. These are outside this review's authority; source/index/HEAD/branch stayed unchanged. The controller owns final adjudication, any subsequent authorized publication and preservation/cleanup of this plan workspace.

## Required final wave and readiness

Address **F-I1** in one bounded fix wave, with moving-clock actual-service coverage and retained future/stale/deadline guards. Include the recommended safe response correlation header for **T11-F1-M1**, or explicitly accept its diagnostic cost. **T6-M1 is accepted as a visible nonblocking inherited warning**. Then perform the single scoped re-review and the controller's required exact-source validation/CI accounting; do not restart individual task loops.

**Ready for whole-branch software acceptance: No, pending F-I1 correction and review. Ready to merge/deploy/live-activate: No authorization or live qualification is supplied by this report.** PR28 remains open/Draft, base/main unmerged, #26 unresolved, #22 unstarted, production defaults observe/gatesOFF and live validation0. The controller-observed passing CI on this SHA does not invalidate the demonstrated timing defect; a correction requires its own exact-source validation and fresh CI.
