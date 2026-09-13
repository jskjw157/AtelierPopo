# 0009 — Approved two-node child-first cleanup verification

## Checkpoint and exact scope

- Implementation: `f88fa859fda4884eac4e2510e9c368ea7bc97ce5`.
- Starting HEAD: `8e27468993bd0c20fe9fd953d844b6272d983227`.
- Branch: `codex/searchad-original-recovery-20260912`.
- Protected base: `0adbd11359440efe43fd07c279bd01a4d8914568`.
- Issue #26 OPEN; PR #24 Draft and unmerged.

The new internal, default-disabled path deletes **exactly one server-created adgroup and then its one server-created campaign**. Each target requires its own server deletion plan, exact-type deletion authority, existing approval token and operation/full-target confirmations. This is not generic hierarchy cleanup, discovery of unmanaged remote descendants, a lifecycle evidence issuer or application HTTP/bootstrap integration. The existing childless campaign cleanup and its child-record rejection are unchanged.

## Actual execution boundary

Both objects must match their existing producers' applied plans, immutable creation/verification events, returned-ID snapshots and hashes, and ownership holds. The adgroup creation metadata must bind the exact campaign. Broad relation queries expose malformed and foreign linked records instead of hiding them behind Customer filters. Extra local nodes, caller-supplied remote IDs, URLs, bodies and out-of-scope identifiers are rejected.

Child deletion requires the parent to remain owned and free of a parent cleanup plan. Parent planning requires the child's matching server deletion plan, immutable dispatch and GET404 observation, consumed approval/risk, applied absence snapshot/hash and consistent timestamps. Mutable `deleted` flags alone are not sufficient.

Before deleting the child, the actual signing Gateway reads the exact stopped campaign and adgroup. Before deleting the campaign, it re-reads child absence and the stopped campaign. Authority, token expiry, observation freshness and UTC capacity date are rechecked after PostgreSQL row-lock waits. Approval use, shared-risk use, pending states and immutable deletion intent commit together. An ambiguous COMMIT acknowledgement returns no send permission.

DELETE is attempted at most once per acknowledged internal claim, with redirects rejected and retries disabled. DELETE acceptance is not absence evidence. A separate qualified nonretryable upstream GET404 can mark object/hold deleted and apply the deletion plan. Unavailable observations remain unresolved; mismatched bodies require manual review. Identity and freshness are rechecked after awaited audit writes and before final commit.

GET-only reconciliation can inspect a previously claimed deletion with mutation disabled or the account suspended, provided current identity and the read gate remain valid. It cannot replay DELETE or refund consumed risk. Parent deletion needs another separate approval. After both deletions the run remains `cleanup_pending`; no Canary PASS, evidence or activation grant is issued.

## Real composition and observed tests

The new suite contains 67 subtests and their parent: **68 counted tests**. Every subtest owns an isolated UUID PostgreSQL schema. It creates the campaign and adgroup through the existing real services, approvals, response capture and GET verification. PostgreSQL, migrations, repositories, registry, credentials, signer and Gateway are real. Only upstream responses and active-authority rows are synthetic fixtures. External fetch is trapped and transport/HMAC assertion errors are collected independently.

Tests cover child-before-parent execution, planning blocked before proof, fresh child absence before parent dispatch, roles/input/authority rejection, replaced IDs and hashes, foreign descendants, stopped preflight, errors and mismatched observations, concurrent/replayed execution, real capacity-row-lock expiry, UTC rollover, four transaction-failure points, lost COMMIT acknowledgement, credential rotation during I/O and final audit, suspended-account read recovery, corrupted child deletion proof and failed result-audit recovery.

Pool/service reconstruction is not a whole-app restart. This suite does not prove handling of keywords, creatives, multiple adgroups or unmanaged remote children.

## Canonical CI evidence

**[Run 34747342643](https://github.com/jskjw157/AtelierPopo/actions/runs/34747342643), job `103697577990`, completed SUCCESS on `f88fa859fda4884eac4e2510e9c368ea7bc97ce5`.** Returned test summaries and all final job steps were checked, including cleanup.

| Canonical check | Observed result |
| --- | --- |
| Full regression | **658 passed, 0 failed, 0 skipped** |
| New child-first cleanup repeat | **68 passed, 0 failed, 0 skipped** |
| Existing adgroup repeat | 80 passed, 0 failed, 0 skipped |
| Required PostgreSQL and other focused/repeated suites | Completed successfully; no additional count inferred |
| Provenance, protected diffs, syntax/static checks | Passed |
| Existing write safety scanner | 16 sources, 0 raw network calls |
| Bundled Commerce coverage | 116 operations |
| Bundled SearchAd coverage | 126 unique, 117 runtime allowlisted, no internal/deprecated runtime leaks |
| Final migration reruns | Both `0009`, `applied: []` |
| Bridge production dependency audit | 0 vulnerabilities reported |

The full658 result includes the previous590 plus68 newly counted cases. Focused/repeated suites overlap the full run and must not be summed or interpreted as a completion percentage. The scanner is the existing write-subsystem check, not an independent audit of all lifecycle code. Manifest coverage is not live account capability. Root dependencies were not reaudited. Documentation successor SHA/CI is tracked separately in issue #26 and PR #24.

### Local evidence — distinct from canonical CI

- Missing implementation: 0 passed / 1 failed before new source.
- Two real edge regressions: 65 passed / 3 failed, counting the failed parent. Stale final observations and disabled-read-gate audit updates were corrected; subsequent68/0/0.
- An initial routing-fixture problem was corrected as a test setup defect, not an application fix.
- Disposable duplicate-DELETE control: 53 passed / 15 failed; not published or run in canonical CI. Exact source restoration and a complete repeat passed68/0/0. An interrupted repeat was not counted as passing.
- Final uploaded source, including a redundant hold/object equality check, was retested68/0/0.
- Available exported regression passed482/0/0. Its snapshot omits three remote producer suites (48 campaign-create,48 campaign-cleanup,80 adgroup-create); it is not the canonical repository result. Those suites remain present in the remote658 run.
- Local static/safety/bundled coverage and two0009 migration reruns passed. No local network dependency audit was performed.

Not every behavior has an individually observed pre-implementation RED. No independent reviewer approval was obtained.

## Preservation and exact source blobs

GitHub compare confirmed six implementation paths only: new source3, test1, plan1 and the existing workflow. Workflow additions are57 lines, deletions0. Previous production/test/schema/dependency files are unchanged. Four exact new source/test exceptions and their starting-HEAD preservation check supplement all prior pins.

| Path relative to smartstore-bridge unless noted | Git blob |
| --- | --- |
| `src/naver/searchad/lifecycle/child-first-cleanup-contract.js` | `b4094b59b85f66588b7c4be3a198ed089e10b08c` |
| `src/naver/searchad/lifecycle/child-first-cleanup-service.js` | `6e66a1ddcba9e4de868331c8b42bd12449533bb9` |
| `src/naver/searchad/lifecycle/postgres-child-first-cleanup-repository.js` | `28bb693a751ec3cf377b21cd0de0b393ddce0b4a` |
| `test/postgres-searchad-child-first-cleanup.integration.test.js` | `8f5f3352765dbae956e425f09840c0208456d921` |
| Repository `.github/workflows/searchad-write-ci.yml` | `36fa2659623404251cffb31ce3b9d15f7a7849e1` |

Local source came from an exported snapshot with348 verified manifest entries plus five producer files recovered from the pinned remote HEAD by exact hashes. It is not a clone of the complete remote history. Only the six explicit paths were applied to the real remote base tree.

## Remaining limitations and next unit

At-most-one internal attempt is not external exactly-once or guaranteed delivery. A crash, uncertain commit or post-claim denial can leave zero sends with consumed risk. Do not blindly replay, guess IDs, search by name or automatically refund. Final account-suspension-to-send fencing, external parent changes after GET and common-lock adoption by every writer remain open.

**Unmanaged remote descendants are not inventoried by this path.** Keep it default-disabled and internal; passing the managed two-node test is not production authority to delete a parent. Full remote hierarchy/account validation and production lifecycle evidence issuance remain prerequisites.

Next: keyword/creative sibling creation, partial/duplicate/malformed batch contracts and corresponding ownership/cleanup extension. Unsupported extra nodes must remain blocked. Expired-unused-plan abandonment, general C/D and legacy0007 shared-risk adoption, E application/role HTTP/bootstrap/readiness/shutdown/restart, F complete0009 acceptance and #18–22 remain pending.

Historical B2a overclaims remain withdrawn. This new coordinator is not retroactive proof of generalized raw-repository parent enforcement, dispatch atomicity or universal redaction. Previous evidence is retained at the [canonical590 dashboard](https://github.com/jskjw157/AtelierPopo/blob/8e27468993bd0c20fe9fd953d844b6272d983227/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md).

**No actual Naver request, live advertising change, operational gate or production DB change, Hostinger deployment, main update or merge.**
