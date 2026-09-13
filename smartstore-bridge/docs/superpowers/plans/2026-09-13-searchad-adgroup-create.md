# Bounded Adgroup Creation Implementation Plan

> For agentic workers: use superpowers:executing-plans and test-driven-development. This continues the approved #23/#26 hierarchy roadmap; do not recreate existing campaign creation or cleanup.

**Goal:** Create one stopped adgroup under a campaign produced and verified by the existing internal campaign service, with a separate approval, fresh stopped ancestor observation, atomic token/risk/intent, one send attempt and returned-ID capture/verification.
**Architecture:** Add an internal default-OFF service and PostgreSQL coordinator plus strict input/response contracts. Reuse existing child recipe, campaign response validator, approval service, registry, credentials and signing Gateway. Parent provenance and local locking are revalidated around remote I/O; external effects are not a database transaction.
**Tech stack:** Existing Node ESM/node:test, PostgreSQL schema 0009 and pg. No new dependencies or migrations.
**Spec:** #26 B2b-rest and #23 latest canonical-510 resume comment. Protected baseline 6d9bc90e3261b075e3f6427d01d5e1a485662f2e.

## Global constraints

- Leave every existing source/test/schema/dependency/default-gate byte unchanged; workflow exceptions are exact paths with new pins and baseline preservation checks.
- No real Naver request, production migration, operational activation, HTTP/bootstrap exposure, deployment or merge.
- Campaign -> adgroup only. Keyword/creative/batch and child-first cleanup remain unimplemented here.
- Parent is selected by local UUID, never a caller remote ID. Bind its verified creation plan/snapshot/hash/immutable events and owned hold.
- Reject any parent cleanup plan and any extra, malformed, cross-run or cross-Customer child/hold. Existing campaign cleanup remains conservative and rejects children.
- Separate current adgroup-create-only active evidence/grant and new approval token; no inferred permission from campaign or update evidence.
- Claims lock account -> run -> objects -> holds -> plans -> approval -> shared UTC capacity; consume token/risk and record immutable intent in one transaction. Recheck authority/time/freshness after real lock waits.
- Only a successful acknowledged claim can lead to one signed POST. No retries/redirects; response uncertainty never permits automatic replay or guessed-ID recovery.
- Exact POST response ID/parent/stopped fields enter an atomic ownership hold before GET; verification does not mark the hierarchy run passed or issue evidence.
- Remaining risks: final suspend-to-send fence, external state changes after GET, common locking by all raw writers, DB failure losing returned IDs, lifecycle evidence issuer and application integration.

## Tasks

### 1. Contracts and server plan
- [x] Add failing PG integration test using the real existing campaign prepare/approve/execute chain; synthetic upstream and authority rows only.
- [x] Verify missing-service RED, then implement strict input copy, pinned operations and parent provenance.
- [x] Persist one child object and immutable-bound server plan atomically; no risk or approval in prepare.
- [x] Test two prepares and actual campaign-cleanup prepare exclusion, both sequential and competing.

### 2. Approved one-shot dispatch and returned-ID settlement
- [x] Test actual signing Gateway parent GET -> adgroup POST -> adgroup GET, and denial paths.
- [x] Require a separate token and fresh stopped parent observation before atomic claim.
- [x] Test rollback, expiry/day rollover during lock waits, consumed capacity, COMMIT acknowledgement loss, stale graph and wrong credentials/gates.
- [x] Atomically capture returned ID and parent-linked hold before GET; verify exact child response without releasing consumed risk or replaying uncertainty.

### 3. Verification and publication
- [x] Run focused PG repeatedly, local available regressions, syntax/static checks and migration reruns.
- [x] Exercise a disposable negative-control mutant, restore exact source and rerun.
- [x] Review limitations explicitly; no independent reviewer approval unless actually obtained.
- [x] Publish only verified new paths and additive canonical CI changes, preserving remote base tree.
- [x] Read final canonical CI steps/logs; record local missing-suite scope separately from complete remote suite.
- [ ] Synchronize this documentation successor and #23/#26/PR24. Completion and successor CI are recorded in the trackers after publication; this checkbox reflects the documentation-publication checkpoint, not overall #26 completion.

## Local source provenance

The mounted source export is 93a522e09b9e36e474886ad1365d8e4966353e6c (348 hashes verified). Four current campaign implementation files were fetched from 6d9bc90 and restored with exact remote blob hashes. The export lacks the existing campaign-create and campaign-cleanup PG suites (48 counted tests each); local available regression results must not be called the complete canonical suite. Canonical CI retains both original suites. No export workflow is added.

## Local verification checkpoint before publication

New PG 80/0/0 (79 children plus parent). Available exported regression 494/0/0 and available required PG 204/0/0; these omit the two existing 48-test campaign suites and are not canonical totals. Static/syntax/safety/coverage pass; migration reruns are 0009/applied:[] twice. Canonical workflow is reconstructed to exact baseline blob 10489f2eab6f51b1ed99e05074462a126d9366cd, then adds 53 lines; all prior lines/steps/pins remain.

Observed missing-service RED 0/1/0; final-audit credential rotation regression 78/2/0 fixed by a last identity check before owned-promotion COMMIT. Disposable duplicate-POST control 52/28/0 was not published. One immediate restored repeat was interrupted by the command time limit and is not counted as passing; exact source hash was checked and a fresh complete repeat finished 80/0/0. Manual source/test review only; independent reviewer approval is still pending. Remote publication and canonical CI observations will be recorded separately.

## Canonical code checkpoint

Published implementation: ba22f14796a337831c60f0b366b79303d233e78a. CI [34732369828](https://github.com/jskjw157/AtelierPopo/actions/runs/34732369828), job103657392347, completed/success. Full decoded log and every final step reviewed: full590/0/0, requiredPG300/0/0, newadgroup80/0/0; both existing campaign48-test suites are included. Old pins/protected diffs and all configured checks pass. Both final migration reruns0009/applied:[]; bridge production audit0. Documentation successor/tracker synchronization is a separate checkpoint. Child cleanup, keyword/creative/batch, general C/D/E/F, final suspend-to-send fence, lifecycle issuer and independent review remain pending.
