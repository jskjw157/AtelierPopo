# SearchAd 0009 — Bounded campaign creation verification

## Checkpoint — 2026-09-13

**One fresh stopped campaign can now be prepared, approved through the existing approval service, handed off once, and verified in the internal implementation. The tests use real PostgreSQL and signing/Gateway components but simulated upstream responses. This is not live activation, complete hierarchy execution, or completion of #26.**

| Item | Value |
| --- | --- |
| Repository / app | `jskjw157/AtelierPopo` / `smartstore-bridge` |
| Branch / Draft PR | `codex/searchad-original-recovery-20260912` / #24 |
| Protected PR base | `0adbd11359440efe43fd07c279bd01a4d8914568` |
| Existing coordinator / starting documentation | `ecb817f6037253d909f8731de2c27792bcb0df25` / `a1dfe180a08d812f850e33e6146e4adbfe886093` |
| New code/test/workflow SHA | `649dafcb622799ed88acb257b6a08fe55d965403` |
| Canonical code CI | **[34723583543](https://github.com/jskjw157/AtelierPopo/actions/runs/34723583543), job103633700622, completed/success; complete job log and final step conclusions checked** |
| Local full / required PG / new focused PG | **462/0/0 · 172/0/0 · 48/0/0** |
| Migration head | **0009**, disposable test databases only; no schema change |

The documentation-only successor and its CI are recorded separately in #26/PR24. No independent reviewer approval is claimed.

## Actual increment and preservation

Resumption found the existing ecb817f local token-risk-intent coordinator, beyond the previously reported read-only checkpoint. Its code was reused, not recreated. Fresh local baseline was414/0/0. A tracked-source export at93a522e supplied348 hash-checked source/workflow blobs; dependencies and portable PostgreSQL came from the separately hash-checked earlier artifact. The local workspace is an isolated exported source snapshot, not a clone with historical Git commits. GitHub CI performs the real-history protected diffs.

Relative to a1dfe180, the new commit adds two production modules, one230-line PG integration test and a plan. Canonical CI has37 added lines and zero removed lines. Every previous workflow line, step and pin is retained; only the exact three new source/test paths are exempted, pinned again, and permitted by a stricter starting-SHA diff. The temporary resume-source workflow was removed, leaving no net addition from that export. No existing source/test/migration/package/default gate was replaced.

| File | Exact Git blob |
| --- | --- |
| `src/naver/searchad/lifecycle/campaign-create-service.js` | `8699f57ffc318d8e5abe1bc143bf3a66e84451b6` |
| `src/naver/searchad/lifecycle/postgres-campaign-create-repository.js` | `998d5f381e70f91dcda7383e3377373ffd447c78` |
| `test/postgres-searchad-campaign-create.integration.test.js` | `9438aa94acdcc8bed8fcba5184bfb7c441ba0455` |
| `.github/workflows/searchad-write-ci.yml` (repository root) | `4d93d8f1642f938a7ed895854a64ee01c0ece3f4` |

All four remote blobs matched locally tested bytes before branch publication. Existing dispatch source remains `3add8f099699e5a941deded3c77ff3ebf888f977` and its41-counted PG test remains `76e193591bdd5ffc6d7f6cf89523a7751bb6edef`.

## Implemented flow

1. `CampaignCreateService` is explicitly default-disabled and not wired to HTTP/bootstrap. Prepare accepts only Customer and existing activation UUID, validates authenticated Admin scope, and generates all run/object/plan identifiers, stopped WEB_SITE payload, reason and expiry on the server. A single PG transaction writes run/object/plan and audit. It creates no evidence, approval token, ownership or risk charge.
2. Existing `SearchAdApprovalService` issues the token; execute uses existing `PostgresCampaignDispatchRepository.claim` for the joint approval consumption, risk consumption and immutable dispatch intent. Existing ordinary mutation gates and existing async writer are unchanged. The dedicated Canary gate and read gate are checked before consumption.
3. A distinct post-claim transaction revalidates account, authority, exact descriptor, consumed approval/risk and immutable intent. It records transport intent and returns an internal single-use ticket only after acknowledged COMMIT. Lost commit acknowledgements cannot yield permission to send. Current credential/spec/gates/expiry/day are rechecked immediately before one signing-Gateway POST invocation. The new scoped transport rejects redirects and uses maxRetries0.
4. A bounded200 response must match exact Customer, safe campaign ID, WEB_SITE/name/stopped flag and numeric budget before the ID and a manual-review ownership hold commit together. GET starts only after that capture commits. No name-based lookup or guessed target is used.
5. A matching GET may make object/hold owned and plan applied. Run remains **cleanup_pending**, never passed. An outage preserves the captured ID/hold as unresolved; mismatches require review. Network/DB/commit ambiguity never triggers another create or a compensating DELETE. Raw upstream bodies/errors/headers and raw tokens are not written by this result path; only allowlisted projections are stored.

## Actual tests and failure-first evidence

The new parent has47 child scenarios,48 counted tests. Every child owns a UUID schema, real migrations/repositories/approval/coordinator/registry/credentials/Gateway/signing client and closes only its resources. Upstream fetch responses and evidence/grant records are synthetic fixtures; they are not real-account evidence. The plan is now produced by the new service and the token by the existing approval service, not hand-built plan/token fixtures. A global fetch trap rejects escaped requests; assertion counters prevent failed transport assertions being swallowed as an outage.

Covered: transactional prepare/audit rollback; default OFF, exact input/role/scope; concurrent prepares; genuine prepare-approve-create-read chain; token denial and pre-consumption gates; two independent executions plus reconstruction;429/503/302/204/outage without replay; wrong Customer/type/ID/name/lock/budget; ID+hold before GET and after reconnection; GET mismatch; capture rollback at hold/event/attempt inserts; ownership collision/in-flight changes; post-claim suspend/rotation/gate/expiry; handoff COMMIT failure before/after acknowledgement; post-handoff key/gate change; keys changing during GET; copied caller scope; bounded output redaction.

Local observed RED was one explicit missing-module assertion (0pass/1fail/0skip), not47 separate pre-implementation behavioral failures. Later the risk-date-rebinding regression produced42pass/2fail (including its parent). The missing date binding was fixed, with consumed-at and approval-used-at binding to the original intent. A disposable duplicate-POST mutant produced29pass/19fail and broke the exact-one-POST test. The exact production source was restored and fresh48/0/0, full462/0/0 and requiredPG172/0/0 followed. No mutant is published.

| Local log | SHA-256 |
| --- | --- |
| Missing-module RED | `371bccf312a715af58b88b4eced3ebd60ee4d5267b4c003c9c68d3931c701d57` |
| Risk-date regression RED | `d1579e3f65f231ec31f188c41199af676bc48c071fc233495ce68c17b6cf22c0` |
| Duplicate-POST negative control | `69c61998fe08482f30a63996b1f349b66e600056a8627e4a6578a03f7876c99c` |
| Restored focused GREEN | `8cb7525360eabb65e2583b008c118ff03de8dd14fa3e2af051c841ce54243ce1` |
| Full local GREEN | `4703d745c4da55879335760bd1ce9f03d3ad55d9e0f2ef3c9b37fcedea911934` |
| Required PG local GREEN | `2d0a744cd2ce358f8733e5361e19188faa2ffc05d7500a64f3c59339dd6a5b9b` |

Local log hashes identify this session's observed files; the negative control was not run by canonical CI and the logs are not repository artifacts. The full local static check, new-module syntax, YAML/shell checks and existing write scanner pass. Both final local migration reruns are0009/applied:[].

## Canonical CI results

| Canonical code CI check | Pass / fail / skip |
| --- | --- |
| Canary/Gateway/role HTTP |51 /0 /0|
| Activation core |30 /0 /0|
| Hierarchy recipes + read-only unit |29 /0 /0|
| Existing write / HTTP-readiness |49 /0 /0 ·14 /0 /0|
| **Required PostgreSQL** |**172 /0 /0**|
| Existing Canary/activation/application PG repeat |31 /0 /0|
| Storage/risk repeat |21 /0 /0|
| Read-only unit+PG / signed Gateway PG |25 /0 /0 ·16 /0 /0|
| Existing atomic campaign dispatch PG repeat |41 /0 /0|
| **New campaign creation PG repeat** |**48 /0 /0**|
| **Full regression** |**462 /0 /0**|

All configured code-CI steps and prior/new source pins and protected diffs passed. Both final migration reruns reported `currentVersion:0009, applied:[]`. Bundled Commerce coverage116; SearchAd126 unique/117 allowlisted with no internal/deprecated runtime leaks. The bridge production dependency audit reported0 vulnerabilities. These are recorded tool results, not live-account capability or whole-system security approval.

414+48=462; focused/repeated checks overlap the full suite and must not be added as distinct tests or converted into product completion percentages. The old write scanner covers16 sources only, not these new lifecycle modules or a whole-system security audit. Bundled operation coverage is not live validation. Dependency-audit results are scoped to bridge production dependencies, not root dependencies. SQLite/Actions Node warnings are not addressed in this increment.

## Remaining boundaries and exact next work

**This is at-most-one in-process send attempt after a durable claim, not exactly-once external effect or guaranteed delivery.** A crash, gate change or ambiguous COMMIT may produce zero sends with consumed risk left unresolved. Do not release/recycle that risk or resend the plan. A response-persistence failure may leave the dispatch intent without a saved remote ID; storage durability cannot be promised during a DB failure. Missing/mismatched IDs are never guessed.

Account suspension is rechecked at the post-claim handoff, but a suspension arriving after the final handoff commit and before the network send is **not atomically fenced here**. The final suspension-to-send barrier and shared locking adoption by all relevant raw writers remain#21. Credential/gate synchronous rechecks do not prove that account barrier. Reopening a pool/service is not whole-application restart.

B2b still needs approved campaign cleanup, child progression (campaign -> adgroup with keyword/creative as siblings), authoritative stopped ancestors before relevant mutations, strict duplicate/partial batch binding and child-first remote cleanup. The current service deliberately rejects a graph containing children. Do not call it a general orchestrator. Cleanup safety/availability and correct lifecycle evidence issuance are prerequisites before exposing a live route.

C/D remain partial: generalize exact create/batch/delete scope, destructive confirmations, ownership/parent protections and atomic dispatch across the proper existing execution paths and relevant0007 shared-risk start. E actual app/role HTTP/bootstrap/readiness/shutdown/whole-app restart and F whole0009 acceptance remain pending. Later#18 reporting, #19 worker/registry through0019, #20 profitability/Auto and separately authorized#22 live validation/deployment are not complete.

The [B2a corrections](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md) remain effective; neither this coordinator integration nor returned-ID capture is retroactively attributed to B2a. Historical closed issues/local-only checkpoints are not completion evidence.

**No actual Naver request, live advertising change, operational gate change, production migration, Hostinger deployment, main change or merge occurred. #26 stays OPEN and PR24 stays Draft.**
