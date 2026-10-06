# 0009 — Bounded Campaign-to-Adgroup Creation Verification

## Checkpoint and scope

Implementation SHA: `ba22f14796a337831c60f0b366b79303d233e78a`.
Starting remote HEAD: `6d9bc90e3261b075e3f6427d01d5e1a485662f2e` (canonical campaign cleanup already present, not recreated).
Branch: `codex/searchad-original-recovery-20260912`; protected base `0adbd11359440efe43fd07c279bd01a4d8914568`; #26 OPEN / PR24 Draft.

**Implemented only one stopped adgroup below an already server-created and verified campaign, through a default-disabled internal service. No HTTP/bootstrap, live request, deployment or merge.** Keyword/creative/batch creation, child-first deletion, lifecycle evidence issuance and general C/D/E/F remain pending.

Previous documentation CI34728631484/job103647227734 was freshly observed completed/success, including all configured final steps. This is confirmation of the existing cleanup checkpoint, not new implementation credit.

## What executes

`AdgroupCreateService.prepare` accepts exact local Customer/run/parent/activation IDs and copies authenticated Admin scope before awaiting I/O. It verifies the actual parent's applied creation plan, returned-ID snapshot/hash, immutable result/verification events, and owned record/hold. A raw supplied ID or ownership row alone is insufficient. Cleanup planning, extra children/holds and wrong Customer/run/parent/state are rejected. Child plan, object and immutable audit are saved together; prepare issues no token, risk, ownership or evidence.

The existing approval service issues a separate token. An adgroup-create-only active evidence/grant with the exact three-field recipe scope is required; campaign or delete authority cannot substitute. These authority records are synthetic fixtures in tests, not a new production issuer.

Execution performs the exact stored campaign GET. The coordinator checks its stopped body/Customer/ID/type/name/budget, unchanged local graph and preflight freshness. In a single PostgreSQL transaction it consumes the token and shared UTC risk capacity, changes the child/plan/run to pending state and records an immutable intent. Actual row-lock waits exercise expiry, freshness and UTC rollover revalidation. No acknowledged COMMIT means no send permission.

The signing Gateway attempts at most one POST with redirects forbidden and retries disabled. The exact response-returned adgroup ID and parent-linked manual-review hold are committed atomically before the child GET. A matching GET can promote the child/hold to owned and its plan to applied. The hierarchy run remains cleanup_pending; there is no Canary PASS or new evidence/grant. Unavailable or inconsistent responses never trigger a new POST, DELETE, name search or guessed ID.

A regression test demonstrated credential rotation during the final verification audit insert could incorrectly permit owned promotion. The coordinator now rechecks current identity after those awaited writes, before COMMIT; a mismatch rolls back the promotion while keeping the previously captured ID/hold.

## Actual composition and test boundaries

The new file has 79 child scenarios plus one parent: **80 counted tests**. Each child owns a UUID PostgreSQL schema and its pools, and drops only its own schema. Every parent campaign is produced through the actual existing prepare/approval/POST/capture/GET chain. Actual migrations, repositories, approvals, registry, credential resolution, Gateway and signing client are composed; upstream responses and active authority records are simulated. Fault tests inject DB errors, clock changes and acknowledgement loss. A global fetch trap prevents accidental external transport; signature/body assertions are counted so caught transport assertions cannot silently pass.

| Coverage | Exercised |
| --- | --- |
| Input/authority | default OFF, roles, explicit Customer, local IDs, caller overrides, wrong operation/lifecycle/fields/type/result/expiry, input copy |
| Parent provenance | actual parent producer, replaced ID/hold, foreign child, exact stopped preflight and wrong identity/body |
| Competing work | two independent prepares, two preflight executions, replay/reconstruction, actual cleanup planning before/after/concurrent with child planning |
| Atomicity/time | preparation audit rollback, four claim failure points, established-capacity mismatch, real PG lock waits for freshness/approval expiry/UTC rollover |
| Responses | POST200/201;429/503/302/204/outage; wrong parent/Customer/stopped/name/missing/unsafe/mixed IDs; GET mismatch/outage; no guessed-target reads |
| Durability/drift | saved ID/hold before GET, capture rollback, ownership collision/change, credential rotation during POST/GET/final audit, claim and capture COMMIT losses |
| Limits | consumed risk not recycled, no repeated POST after committed claim, unchanged ordinary gates, no PASS/evidence, no parent delete with child, bounded metadata |

Pool/service reconstruction is not whole-application restart. Cleanup-planning exclusion is tested against the real existing cleanup service, but child deletion or a complete hierarchy cleanup is not implemented. The generic read-only reconciler remains conservative; no new service restart path promotes an ambiguous adgroup creation automatically.

## Verification results

**Canonical code CI: [34732369828](https://github.com/jskjw157/AtelierPopo/actions/runs/34732369828), job103657392347, completed/success at ba22f147. The full decoded job log and every final step were reviewed.**

| Canonical code check | pass / fail / skip |
| --- | --- |
| Canary / activation / hierarchy |51/0/0 ·30/0/0 ·29/0/0|
| Existing write / role HTTP-readiness |49/0/0 ·14/0/0|
| **Required PostgreSQL** |**300/0/0**|
| Existing application PG repeat |31/0/0|
| Storage-risk / read-only / signed read-only PG |21/0/0 ·25/0/0 ·16/0/0|
| Existing campaign dispatch / create / cleanup repeats |41/0/0 ·48/0/0 ·48/0/0|
| **New adgroup PG repeat** |**80/0/0**|
| **Full regression** |**590/0/0**|

Canonical510 plus80 new counted tests gives590. Unlike the limited local export, the canonical full and required-PG suites included both existing 48-test campaign suites. All preservation/pin/diff, syntax/static/safety and bundled-coverage steps succeeded. Two final migrations returned0009/applied:[]; the bridge production dependency audit found0 vulnerabilities. This is not a root dependency or whole-system security audit. SQLite experimental, Actions Node-version and dependency deprecation warnings remain. Documentation-only successor SHA/CI and tracker synchronization are recorded separately in #26/PR24.

Local available exported regression: **494/0/0**; local available required PG: **204/0/0**; final new PG repeat: **80/0/0**. These are not canonical totals: the mounted source export lacks the existing campaign-create and campaign-cleanup test files, 48 counted tests each. Their production modules were restored by exact hashes; the remote branch and canonical workflow retain both original suites. Focused/repeated suites overlap full regression and are never summed as feature counts or completion percentages.

Local static/syntax, existing write safety scanner and both bundled operation coverage checks pass. Both migration reruns return `0009`, `applied:[]`. The scanner covers its existing 16-source write subsystem, not all new lifecycle/security code. Coverage checks describe the checked-in bundle, not live API availability. A local package audit was not run with the network disabled; canonical audit is recorded separately.

Observed failure-first evidence: missing-service RED **0/1/0**; final-audit rotation regression **78/2/0**, then fixed **80/0/0**. A disposable duplicate-POST control returned **52/28/0**, proving exact-one-send assertions detect that fault. It was not published or run in canonical CI. One immediate restored repeat was interrupted by the command time limit and is not counted as a pass; source bytes were verified and a subsequent complete repeat passed **80/0/0**. Not every scenario has an individually observed pre-implementation RED. An early invalid passive-evidence fixture was corrected from the invalid enum `passive` to schema value `passive_capability`; this was a test setup error, not an application defect.

## Preservation and exact blobs

The available export identifies93a522e09b9e36e474886ad1365d8e4966353e6c; all348 listed tracked blobs were verified before use. The local Git repository is an isolated exported snapshot, not a clone claiming the real remote history. Four current campaign implementation modules were read at6d9bc90 and matched to exact remote blobs. The workflow was reconstructed to current blob10489f2eab6f51b1ed99e05074462a126d9366cd before editing.

The implementation commit changes six paths only: three new modules, one new test, one plan and the canonical workflow. Existing source/tests/migrations/packages/default gates are unchanged. Workflow additions total53 lines, retain every prior line/step/pin, allow only four exact new source/test paths, and add a starting-6d9bc90 preservation check plus exact pins and repeated test. No export/bootstrap workflow is added.

| Path under smartstore-bridge, unless noted | Git blob |
| --- | --- |
|src/naver/searchad/lifecycle/adgroup-create-contract.js|4b0e5606ec91a365cf1056c43687ee9794012b4f|
|src/naver/searchad/lifecycle/adgroup-create-service.js|0984f8f3e9a48858545461ef0eb3265524511a77|
|src/naver/searchad/lifecycle/postgres-adgroup-create-repository.js|bba5939548da720d3d7e683795c6bc004c7dc160|
|test/postgres-searchad-adgroup-create.integration.test.js|65349a76e44a77f299d522537b581a077a66b918|
|repo .github/workflows/searchad-write-ci.yml|74913d4be657626dc8b3addfc170e9560cfbcd12|

Local log SHA-256 hashes (not remote CI log hashes):

- `adgroup-red.log`: `70509ef34090b03023a4e0dcdc31c00686e700a87d32c0f78eb04ff9f3aa5063`
- `adgroup-edge-red.log`: `a082d1d40204365a2b58cad5adfd1d3d822478b41c4ae2d1f7b9aaac58423b2d`
- `adgroup-green.log`: `1d7176dc9e9e28209697b6935c5fedfd5e336e591eac54a32df87b2a6d8061f6`
- `adgroup-duplicate-post-control.log`: `06b2ff8d9d35869c5d5bc3b91aa3dcbee5143006fe52d38156d0f08e1047dd4b`
- `adgroup-restored-final.log`: `55ed8e2b1b5102a28c0efbefde2af0f6898e81e82a78aa969685525fe308ccb5`
- `local-available-full.log`: `4d39256485dbd4434f80f4fd00e9ba6497b8400fd74a1032984f98af69ca550a`
- `local-available-pg.log`: `ed37f24b808c681fd9dce2e1c8cccd78b745dca00b05c406792c76ed83db662e`

## Remaining boundaries and next work

This is an at-most-one internal attempt after an acknowledged durable claim, not guaranteed delivery or exactly-once external effect. Before-ack COMMIT failure may roll back entirely; after-ack failure may leave consumed approval/risk. Neither yields send permission to that invocation. A crash or post-claim gate/identity denial can leave zero sends with consumed risk. A POST response-save failure can leave no recorded ID. These cases must not be automatically replayed, searched by name or refunded as known-unsent work.

The final account suspend-to-send fence is still open (#21), as is adoption of common locking by all relevant raw writers. A stopped parent can be externally changed after the GET; the freshness bound is not an upstream transaction. The new final identity check does not solve either race.

The fixed adgroup recipe contains nccCampaignId/name/userLock. This is a conservative internal contract, not proof that all live adgroup types, business channels or account-required fields are supported. Live schema/account validation and production lifecycle evidence issuance remain prerequisites to activation.

The first remaining hierarchy slice is approved child cleanup (and safe root cleanup after all children), then keyword/creative siblings and partial/duplicate/malformed batches. Existing root cleanup deliberately rejects any child record; do not weaken that guard without the required child-first contract. Expired unused plan abandonment/replanning is separate. Full C/D lifecycle/ownership/destructive approval and legacy0007 shared-risk adoption, E application/role HTTP/readiness/shutdown/restart, F final acceptance and #18–22 remain open. No independent reviewer approval was obtained; this turn performed manual source/test review only.

Previous B2a corrections remain in force: raw composite parent enforcement, generalized token/risk/dispatch claims, universal audit redaction and child-first cleanup were not B2a achievements. The new adgroup coordinator is not retroactive evidence for those withdrawn claims.

**No actual Naver request, live advertising change, production migration or gate change, Hostinger deployment, main update or merge. #26 OPEN / PR24 Draft.**
