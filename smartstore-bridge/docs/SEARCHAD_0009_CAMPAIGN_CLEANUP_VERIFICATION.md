# 0009 — Bounded approved campaign cleanup verification

## Checkpoint

- Implementation: `b4f150eb85c6dc47817e7e741a2f15a46ffd7abb`.
- Parent: `022a8d2bc1790b1bebfe2d696a5effaea050acbe`; branch `codex/searchad-original-recovery-20260912`; Draft PR24, protected base `0adbd11359440efe43fd07c279bd01a4d8914568`.
- Canonical code CI: [34728180337](https://github.com/jskjw157/AtelierPopo/actions/runs/34728180337), job103645987241. **completed/success; complete job log and every final step conclusion reviewed.**
- Earlier documentation CI34723978483/job103634750459 was freshly observed completed/success in this session; all configured steps succeeded. This closes the previous observation gap, not an implementation gap.
- Migration head remains0009, no schema/dependency/default-gate changes. Test databases only. Issue26 stays OPEN.

## Actual scope

Two new internal production modules, one275-line integration test, one plan and40 additive canonical workflow lines. Remote compare confirms exactly five files, no prior source/test/migration/dependency changes. Every old workflow line/step/pin remains, six earlier preservation comparisons receive only three exact new-path exceptions, followed by a new022a8d2 baseline comparison and exact new blob pins.

`CampaignCleanupService` is default-disabled and is not connected to application HTTP/bootstrap. It cleans up exactly one previously verified server-created campaign with no children. The existing creation service, approval service, dispatch coordinator and generic read-only reconciler are unchanged. This is not generalized hierarchy orchestration or general child-first deletion.

### Planning and authorization

Prepare accepts copied authenticated Admin scope, numeric Customer and exact local run/object/activation UUIDs. A matching applied creation plan, expected body, saved returned-ID snapshot/hash, immutable create-result and create-verification events, object and ownership hold are required. Merely substituting object/hold IDs cannot change the target.

Deletion requires a separate current active_canary evidence/grant pair with exact `[campaign.delete]` operation scope, `['delete']` lifecycle scope and empty mutable-field scope. This conservative internal contract does not reinterpret update/create evidence as deletion authority. A production issuer for this scope is still absent; tests seed authority fixtures.

A server-built DELETE/read plan, exact target metadata/hash and immutable cleanup_plan audit are stored transactionally. The existing approval service issues its own single-use cleanup token. Execution also requires the exact operation confirmation and full `searchad:<Customer>:campaign:<returnedId>` target confirmation. No caller remote target, URL or arbitrary payload is accepted. Request scope and principal are copied before asynchronous access; raw token is hashed before persistence access.

Only one cleanup plan is allowed per target. Expired, unused cleanup plans cannot yet be abandoned or replaced automatically; the API explicitly rejects replanning. This is a remaining usability/recovery limitation, not a completed lifecycle feature.

### Preflight, atomic claim and send

Before token consumption, the signing-client/Gateway performs a GET for the stored ID. Customer, ID, campaign type, server name/budget and userLock=true must match. Missing, active, malformed or unavailable targets do not authorize DELETE. A bounded observation-age check and internal version ticket reject state changes between the GET and claim.

On one PostgreSQL connection, claim consumes the unused approval and shared UTC risk, changes object/hold/plan/run to pending states and writes the immutable cleanup_dispatch_intent and write attempt. Account/run/object/hold/plan locks use the documented order. Capacity and authority/approval expiry are rechecked after lock waits. Intermediate failures roll back all of these changes; COMMIT send/ack uncertainty discards the connection and never returns send permission.

After acknowledged claim, identity/gates/expiry/risk day are checked before entering the gateway. The new transport uses maxRetries0 and redirect:error. There is at most one DELETE attempt from this service for the claimed plan, not guaranteed delivery or exactly-once external effect. A crash, pre-send block or uncertain COMMIT may leave zero sends and consumed risk. There is no automatic replay or risk recycling.

### Observation and recovery

DELETE200/204 is only an acknowledgement. The exact stored ID is read again, and only an explicitly classified upstream GET404 confirms absence. Matching200 or outages remain delete_unknown; malformed200 requires manual_review. Object/hold/cleanup-plan/run/audit updates commit together. The creation plan remains its historical applied record. Even verified deletion leaves the hierarchy run cleanup_pending, never passed, and issues no activation evidence.

The cleanup-specific read-only reconcile entry point uses persisted plan/dispatch intent and ID. It needs no unused token or new/unexpired mutation grant and works with mutations OFF and account suspended when current identity and read gate remain usable. Failed send-result or observation audit persistence can be recovered with GET only. Pool/service reconstruction is tested; whole-application reboot and HTTP routes are not.

## Test evidence

Each of47 children owns a UUID PostgreSQL schema and its resources. Existing CampaignCreateService actually prepares, approves, POSTs through the simulated transport, captures the returned ID and GET-verifies the campaign before each cleanup scenario. Cleanup plans and both token types come from real services. PostgreSQL/migrations/repositories/registry/credentials/Gateway/signing are real; upstream fetch responses and authority evidence/grants are fixtures. Global fetch is trapped and transport assertion counters prevent swallowed assertions being mistaken for harmless outages.

Coverage includes separate approval/two confirmations; default-OFF/role/Customer/input rejection; authority mismatches; active/missing/wrong preflight identity/type; substituted saved IDs; a foreign-Customer child added during preflight; five claim failure points and rollback; independent-pool competition; DELETE302/429/503 and no retries; lost COMMIT before/after ack; post-claim gate/credential changes; stale observations; changed stored plan; exact input/principal copying; read-only recovery under suspension; send-result/observation audit failures; and ownership drift during absence observation. An actual capacity row lock is held by another client and verified in pg_stat_activity before advancing the test clock to check expiry after the wait.

| Evidence | Pass / fail / skip | Meaning |
| --- | --- | --- |
| Initial local missing-service RED |0/1/0|Expected missing-feature assertion|
| Local plan-expiry regression |44/2/0|One child plus parent failed before final pre-COMMIT expiry check|
| Disposable duplicate-DELETE control |38/8/0|Earlier46-test version rejects repeated DELETE; not published or run by canonical CI|
| Restored pre-expansion suite |46/0/0|Exact service source restored|
| Final cleanup-focused, publication bytes |48/0/0|47 children plus parent|
| Local exported regression |462/0/0|Old414 baseline plus new48, excludes the earlier creation test file|
| Local exported required PG |172/0/0|Old124 PG plus new48, excludes earlier creation PG test file|
| Canonical whole-branch regression |510/0/0|Includes the unchanged earlier48-test creation file|
| Canonical required PG |220/0/0|Includes all current PG files|
| Canonical repeated cleanup |48/0/0|Same new suite; overlaps whole suite|

The local export is not a historical clone. The348 older exported blobs were checked; current creation modules and workflow were rehydrated and checked against their remote blob IDs. The attempted temporary source-export workflow was blocked and was not created; it was not retried via another mechanism. Local publication changes to two test whitespace positions were matched to the uploaded blob and focused tests rerun. Do not confuse the coincidentally identical local462/172 counts with the previous whole-branch462/172 counts. No claim that every behavior had its own RED.

Canonical preservation/static/safety/coverage/audit and final migration results: **all configured steps passed. Both final migration reruns reported currentVersion:0009 and applied:[]. Bundled Commerce116; SearchAd126 unique/117 allowlisted, no internal/deprecated runtime leaks. Bridge production dependency audit:0 vulnerabilities**. The existing write scanner covers16 write-subsystem sources, not the whole new lifecycle surface. API inventory coverage is not live validation; bridge production audit is not root audit or independent security review. Existing SQLite/Actions runtime warnings are not repaired here.

## Exact published blobs

| File under smartstore-bridge unless prefixed .github | Git blob |
| --- | --- |
|src/naver/searchad/lifecycle/campaign-cleanup-service.js|865dd6b47a3823a95b0d18344630d559081fde9a|
|src/naver/searchad/lifecycle/postgres-campaign-cleanup-repository.js|405318285e187929760c57b4fb313f93edeaab71|
|test/postgres-searchad-campaign-cleanup.integration.test.js|a9b0f1b0330abae305abc823a76a9d984799c884|
|docs/superpowers/plans/2026-09-13-searchad-campaign-cleanup.md at code checkpoint|91bf70622358d7e40f88101ca92d9da801a8862c|
|.github/workflows/searchad-write-ci.yml|10489f2eab6f51b1ed99e05074462a126d9366cd|

Local log SHA256:

```
9ec44f199198b5cef70e0b34d84a38fcc3d550cc040ee869277621455d088e02  cleanup-red.log
86ab1782cfab21e070010188e7069eaf4cf917c97dc9fe9877136cb8c5e468ad  cleanup-expiry-red.log
8bdc31c68891d67d8237f9f55307fcf02e725230395e8f28d8393b653fb33dd4  cleanup-duplicate-delete-mutant.log
672706e1001a87986d535d5f322b766732fab58e98e57f8186a6a20a67a2a4a3  cleanup-restored.log
495aef11a6b9ce2be008ae54a66e7f2a20184a1c578bed7de56def76cc3b6f29  cleanup-publication-focused.log
205c11f034e8b8c1641388eb227c0275e682c503185541e5b7ffb690431c0458  cleanup-published-bytes-exported-regression.log
87b2c8ec3d0a4d2ff815722c121c306c86585e9e3f7c73892988d9f56a6c67c4  cleanup-exported-required-pg.log
```

Hashes identify the local logs; they are not independent review or proof of untested behavior.

## Remaining work and history

Final database account-suspend-to-send fencing remains #21. A remote campaign can change after the preflight GET; no cross-system transaction is claimed. Adoption of a common coordinator/lock protocol by every relevant raw writer and the existing broader executor is not established. A stored child is rejected, but multi-object child-first cleanup has not been implemented.

Next B2b work: campaign→adgroup, then sibling keyword/creative generation, authoritative stopped ancestor checks before relevant mutations, malformed/partial/duplicate batch response binding and child-first cleanup. Also resolve expired unused cleanup-plan abandonment/replanning explicitly. Production lifecycle evidence issuance, generalized C/D and0007 shared-risk start adoption, E application/role HTTP/readiness/close/restart, and F full acceptance remain open. Later#18–22 and0019-level product goals are unchanged.

Previous B2a overclaims remain withdrawn: raw composite Customer/run/parent enforcement, atomic run+risk, universal dispatch/cleanup claims, dry-run-only release, arbitrary event redaction and child-first cleanup were not proven by storage-only tests. Original/restored raw repository blob remains b63fd592d186ea56297fc2f60dac13e92e97203b. This new coordinator is not retroactive B2a or whole-executor coverage.

[Previous create checkpoint](https://github.com/jskjw157/AtelierPopo/blob/022a8d2bc1790b1bebfe2d696a5effaea050acbe/smartstore-bridge/docs/SEARCHAD_0009_CAMPAIGN_CREATE_VERIFICATION.md) and [corrected storage record](SEARCHAD_0009_STORAGE_RECOVERY_VERIFICATION.md) retain prior evidence. Document-successor CI is a separate observation recorded in issue26/PR24, not extra implementation coverage.

**No actual Naver request, live advertising mutation, production gate/migration, HTTP/bootstrap exposure, Hostinger deployment, main change or merge. No independent reviewer approval. Issue26 OPEN / PR24 Draft.**
