# Bounded approved campaign cleanup implementation plan

> Use superpowers:executing-plans. This is the next approved B2b unit, not all of #26.

**Goal:** Safely clean up one campaign produced and verified by the existing internal creation path, with distinct approval, atomic local claim, one DELETE attempt and read-only absence confirmation.
**Architecture:** New default-OFF internal service plus PG coordinator; preserve every existing production/test/schema byte. The existing CampaignCreateService produces fixture campaigns and the existing approval service issues cleanup tokens. Immutable cleanup-plan events bind a server-built stored-ID DELETE to its own delete-only activation. Separate transactions surround, but never span, upstream I/O. Local version snapshots reject drift between preflight/claim and observation/settlement. Existing generic reconciliation remains unchanged.
**Tech Stack:** Current Node ESM, pg, checked-in 0009 migrations and pinned SearchAd registry/client/Gateway.
**Spec:** SEARCHAD_RECOVERY_DASHBOARD.md / issue26 B2b-rest and previous campaign verification report.

## Constraints
- No live requests, credentials, production gates/migrations, HTTP/bootstrap wiring, main changes or merge.
- Delete authority is a separate current active_canary grant/evidence pair: exact delete operation, lifecycle [delete], field scope [] (delete is not a mutable-field update).
- Accept local UUID scope only. Preview returns full target confirmation; execute requires issued token plus exact destructive confirmation and full target key. No caller target or arbitrary body/URL.
- Campaign-only: all children/extra holds reject, even malformed cross-run/Customer records; generic child-first expansion remains later work.
- Require applied create plan, exact server recipe, returned snapshot/hash and matching create-result/verification events, matching stored object/hold.
- One cleanup plan per target in this slice; automatic abandonment/replanning of an expired unexecuted plan is not provided.
- Before consumption, re-read the stored target through the real signing/Gateway stack, requiring exact Customer/ID/type/name/budget and userLock true; reject absence/errors/mismatch/stale snapshot.
- Atomically consume unused approval, shared UTC risk, object/hold/plan state and immutable dispatch intent. Unknown COMMIT gives no send permission. No automatic retries or redirects.
- Post-send GET404 alone confirms absence; DELETE success is insufficient. Object/hold/cleanup-plan/audit settlement is atomic, never Canary PASS/evidence or risk release. Read-only recovery remains possible with mutation OFF/account suspended.
- Final account suspend-to-send barrier and external change after preflight remain limitations, not claims solved by this increment. No independent reviewer approval.

## Task 1 — cleanup plan, claim and observation as one bounded feature
- [x] Add failing real-PG integration test with existing create/approval services and simulated fetch/authority only.
- [x] Implement src/naver/searchad/lifecycle/campaign-cleanup-service.js and postgres-campaign-cleanup-repository.js.
- [x] Test denied scope/confirmation/authority, stopped preflight, atomic rollback/COMMIT loss, two pools, redirect/error, persisted-ID drift, children, recovery and no evidence/risk recycling.
- [x] Run explicit negative control (duplicate DELETE), restore source, run fresh focused and regression checks.
- [x] Add narrowly scoped CI preservation exceptions/new pins/repeat step without removing previous checks.
- [ ] Publish only verified files; observe fresh canonical CI. Sync dashboard/issue23/issue26/PR24 with exact scope and evidence. Keep issue OPEN and PR Draft.

## Local checkpoint and pending publication

Fresh cleanup suite: 48 passed / 0 failed / 0 skipped (47 children + parent). Initial missing-module RED: 0/1/0. Expiry regression: 44/2/0 before the final pre-COMMIT expiry check. Duplicate-DELETE negative control on the earlier 46-test suite: 38/8/0; exact source restored and 46/0/0, then the two additional contracts gave 48/0/0. Do not claim each behavior had its own RED.

Local workspace is an isolated exported baseline, not a historical clone. The 348 older exported blobs and the current create modules were hash-checked; the current workflow was rehydrated and matched blob 4d93d8f1642f938a7ed895854a64ee01c0ece3f4. The previous 48-test creation integration file is absent locally, so the exported full/required counts are NOT canonical whole-branch counts. Remote canonical CI must include it unchanged before claiming whole-branch regression. No source-export workflow was created this turn: that attempted action was blocked.

Independent reviewer approval and remote CI are pending. Final suspension/send fencing, all child/batch operations, expired-plan abandonment/replanning, lifecycle evidence issuance and application HTTP remain out of scope. No live execution or merge.
