# HAAR SearchAd — Recovery Dashboard

## RESUME HERE — 2026-09-13

**Current issue #26 remains OPEN. The bounded approved adgroup → campaign cleanup path is implemented and verified. Next: keyword/creative siblings, batch contracts and corresponding ownership/cleanup extension.**

Do not repeat existing campaign create/cleanup, adgroup creation, LOCAL claims or read-only reconciliation. The new cleanup supports exactly one managed campaign and its one managed adgroup, is default OFF and has no application HTTP/bootstrap wiring. Whole0009 is not complete.

| Checkpoint | Value |
| --- | --- |
| Branch | `codex/searchad-original-recovery-20260912` |
| Protected base | `0adbd11359440efe43fd07c279bd01a4d8914568` |
| Starting HEAD | `8e27468993bd0c20fe9fd953d844b6272d983227`, canonical590 |
| Verified implementation | `f88fa859fda4884eac4e2510e9c368ea7bc97ce5` |
| Canonical CI | [34747342643](https://github.com/jskjw157/AtelierPopo/actions/runs/34747342643), job103697577990, completed SUCCESS |
| Full / new cleanup repeat | **658/0/0 / 68/0/0** |
| Required PostgreSQL / all final CI steps | Completed successfully |
| Local exported regression | 482/0/0, incomplete snapshot missing176 existing remote producer cases |
| Migration | 0009, schema/dependencies/operational gates unchanged |

[Master23](https://github.com/jskjw157/AtelierPopo/issues/23) · [Work26](https://github.com/jskjw157/AtelierPopo/issues/26) · [Draft PR24](https://github.com/jskjw157/AtelierPopo/pull/24) · [Verification](SEARCHAD_0009_CHILD_FIRST_CLEANUP_VERIFICATION.md) · [Plan](superpowers/plans/2026-09-13-searchad-child-first-cleanup.md)

Documentation-only successor SHA/CI is recorded separately in the trackers. This document records the code result, not automatic success for its own successor workflow. Master23's older body is preserved for product goals; the latest resume comment and this dashboard take precedence for progress.

## Sequential work board

| Stage | State |
| --- | --- |
| 0007 Canary/Gateway/role HTTP | Verified baseline retained |
| #25 / 0008 activation/async/PG+HTTP/readiness/shutdown | Completed, regression retained |
| #26-A/B1 inventory and descriptors | Existing bounded contracts verified |
| #26-B2a schema/repository/risk | Corrected storage-only scope |
| Read-only hierarchy reconciliation | Existing implementation retained |
| Campaign LOCAL claim/create/capture/GET | Existing bounded implementation retained |
| Childless campaign approved cleanup | Retained; its child-record rejection is unchanged |
| Campaign → one adgroup creation | Existing canonical590 implementation retained |
| Approved adgroup → parent cleanup | **VERIFIED bounded two-node path**, f88fa859 |
| Keyword/creative siblings, batch/partial/duplicate results and extended cleanup | **NEXT — PENDING** |
| Unmanaged remote descendant inventory/full graph validation | PENDING before operational parent deletion |
| Expired unused-plan abandonment/replanning | PENDING; no automatic replacement |
| Actual lifecycle evidence issuance | PENDING; synthetic fixtures are never operational proof |
| C/D general lifecycle/atomicity and existing writer/0007 shared-risk adoption | PARTIAL, incomplete |
| E lifecycle application/role HTTP/bootstrap/readiness/shutdown/restart | PENDING |
| F complete0009 acceptance and issue closure | PENDING; #26 remains OPEN |
| #18 reporting/Circuit/automation | PENDING |
| #19 worker/scheduler/operation registry through0019 | PENDING |
| #20 profitability/recommendation/limited Auto | PENDING |
| #21 final suspend-to-send fence/operations/independent review | PENDING |
| #22 deployment/live validation/activation | NOT STARTED; separate authorization |

## Tested boundary

Each target must match its existing producer's applied creation plan, immutable events, returned-ID snapshot/hash and ownership. Separate exact-type deletion authority and approval are required. Parent planning additionally validates the child's deletion plan, consumed token/risk intent, immutable GET404 observation, applied absence snapshot and timestamps. Deleted flags alone cannot authorize the parent.

Signed preflight reads check the stopped parent and exact child. Before parent DELETE the child is read again for absence. Token/risk/intent commit atomically after expiry/freshness/UTC and actual row-lock checks. DELETE is attempted at most once per acknowledged claim; only a separate qualified GET404 proves absence. Unavailable and mismatched observations remain unresolved. GET-only recovery works with mutations OFF or the account suspended when current identity and read permission are valid.

After both deletions the run remains cleanup_pending, not passed; no evidence/grant is issued. Extra local nodes are rejected. Remote unmanaged children are not inventoried. Pool/service reconstruction is not a full application restart.

## Verification and preservation

Canonical CI completed/success, with all final steps and teardown observed. Returned summaries show full658/0/0, new cleanup repeat68/0/0 and existing adgroup repeat80/0/0. Required PG and every prior focused/repeated suite passed. Provenance and protected diffs, syntax/static, write safety16sources/rawnetwork0, bundled Commerce116/SearchAd126unique117allowlisted and both0009 migration reruns/applied:[] passed. Bridge production dependency audit reported0; root and whole-system security were not independently audited.

New source3/test1/plan1 and workflow+57/-0 only. Every prior production/test/schema/dependency file, default gate and HTTP route is unchanged. The new suite composes real PostgreSQL, existing producers/approval, registry, credentials, signer and Gateway; only upstream responses and authority rows are fixtures. Local482 omits176 remote cases and must not be reported as the canonical suite. Focused/repeated counts overlap full regression and are not completion percentages.

Local RED evidence: missing implementation0/1; two edge defects65/3, then68/0 after stale-observation and read-gate fixes. Disposable duplicate-DELETE control53/15, removed; exact restored source68/0. Interrupted repeats are not passes. Independent reviewer approval was not obtained.

## Safety and historical record

At-most-one internal attempt is not external exactly-once/delivery. Commit uncertainty, crashes or post-claim denial can leave consumed risk and zero sends; no automatic replay/refund. Account suspension between final claim and send, upstream parent drift after GET, common locking across all raw writers and unmanaged remote descendants remain unresolved operational boundaries. Internal risk units are not KRW or Korea-day advertising budgets.

[Prior canonical590 dashboard](https://github.com/jskjw157/AtelierPopo/blob/8e27468993bd0c20fe9fd953d844b6272d983227/smartstore-bridge/docs/SEARCHAD_RECOVERY_DASHBOARD.md) retains510/462/414/373/311/293 and closed25 history. Prior B2a generalized parent/dispatch/cleanup/redaction claims remain withdrawn; the new coordinator does not retroactively validate them. Historical closed17/local-only420 records are not current completion.

**#26 OPEN / PR24 Draft. No actual Naver request, live ad change, production DB/gate change, Hostinger deployment, main update or merge.**
