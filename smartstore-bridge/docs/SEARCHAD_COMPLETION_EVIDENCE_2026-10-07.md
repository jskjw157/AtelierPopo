# SearchAd completion checkpoint — 2026-10-07 KST

This records validated software at `6013903de2b8c2a7457698381dfb8c7e27723690`, tree `b1a485674361937e3c75c88c8e3cc239162f69f0`. Subsequent documentation commits do not inherit an exact-head CI result. PR #28 remains OPEN/Draft and targets `codex/searchad-original-recovery-20260912`, not main.

## Verified CI

[Run 37497778627](https://github.com/jskjw157/AtelierPopo/actions/runs/37497778627), [job 112386653823](https://github.com/jskjw157/AtelierPopo/actions/runs/37497778627/job/112386653823): SUCCESS on the exact code SHA above, all 40 steps successful. Full suite: **1601 tests / 1601 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**. Full duration 621296.205434 ms. The downloaded CI log SHA256 is `8966c84a2afa34142f3978f0039c1497ee61600540e2ee5f554822c4e86ea867`.

Clean PostgreSQL applies exact migrations 0001–0015; immediate and post-full repeats report `applied: []`, `currentVersion: '0015'`. Automation protocol is 0013, worker is 0014, profitability is 0015. CI verifies dependency audit (0 vulnerabilities), 258 source/script syntax checks, SearchAd 126 operations / 117 runtime allowlisted / 9 internal, Commerce 116 unique operations, descriptive validation and bounded execution safety scanning. These checks establish their reviewed scope, not general security or live capability.

| Completion plan | Implemented and tested software |
|---|---|
| Task 5 / #18 | Immutable automation policies, deterministic observe/recommend/approve using the existing plan/approval/execution engine |
| Task 6 / #19 | Durable worker queue, leases, schedule slots, restart and unresolved-outcome recovery |
| Task 7 / #19 | Descriptive 126-operation registry and expanded execution-source scanner |
| Task 8 / #20 | HAAR/channel/ad mappings and Customer-bound provider evidence |
| Task 9 / #20 | Exact-decimal profitability and deterministic recommendations with partial/missing provenance |
| Task 10 / #20 | Bounded delegated auto with original writer, activation, Circuit, lease and account gates |
| Task 11 / #21 | Actual HTTP/bootstrap/headless composition, roles, privacy, restart, KST and final acceptance |

## Preserved original local execution and internal AI review

The following are byte-exact recovered historical artifacts, not a new test run or newly written review. [The manifest](searchad-evidence/2026-10-07/manifest.json) records their byte counts and SHA256 values. Original references to the old ignored `.superpowers/sdd/` scratch are historical; that scratch was removed after acceptance. The preserved copies below are the durable review entry points.

- [Whole-branch initial review](searchad-evidence/2026-10-07/final-review-initial.md) and [bookkeeping-corrected review](searchad-evidence/2026-10-07/final-review.md): review of the predecessor through `f3a45ce`, with Important F-I1 still requiring fixes. The second report only corrects two reviewer/implementer labels.
- [Final scoped correction review](searchad-evidence/2026-10-07/final-fix-review.md): separate AI reviewer checked `f3a45ce..6013903`; all findings addressed, no new Critical/Important breakage. Its original cutoff says fresh CI was pending. The subsequently observed exact-head success above supplies that later controller checkpoint.
- [Original full result JSON](searchad-evidence/2026-10-07/final-fix-full-result.json), [actual runner terminal result](searchad-evidence/2026-10-07/local-run-terminal.json), and [reviewer's original TAP verification output](searchad-evidence/2026-10-07/reviewer-tap-verification.txt): historical local **1601/1601**, fail/cancel/skip/todo 0, 882 top-level, 155 files, 314342.083417 ms. The original JSON retains its then-pending review/CI fields; they are not rewritten retrospectively.

The local run names 691 tracked files and source aggregate `9791662aa9db99926cd41dc8ce2deb82fe48370e8e2d1ac0604d7e71a7412c19`. The aggregate is SHA256 of sorted UTF-8 `path + NUL + per-file SHA256 + LF`; it describes the validated code commit, not this documentation successor. Local whole TAP SHA256 was `e4ef605cd0f8f136cdc964c7fb3e45cb7a1cf45230ee22d62658d5cbc563aa40`. **The complete local TAP was deleted during scratch cleanup and has not been recovered.** These execution records support the historical result but cannot reproduce every deleted TAP byte. The GitHub CI log is a distinct remotely accessible run.

“Independent review” here means an internal separate AI agent, not an external human or official GitHub APPROVED review. GitHub's official PR review list was empty at this checkpoint. Historical reports mentioning sealed artifacts do not imply all of those original artifacts survived cleanup. No private full session transcript is published.

## Remaining boundaries

Operational defaults remain observe, disabled policies and mutation/Canary/worker gates OFF. No live Naver advertising/Commerce/storage request, production DB or gate change, deployment or main/base merge was performed in the completion work or this documentation synchronization.

Actual profitability remains partial: Naver settlement reconciliation/unique-ledger identity, Cafe24 finance qualification, verified bid estimate/balance and production Circuit baseline are unavailable. Essential missing costs keep contribution null. Positive bounded-auto tests use explicitly synthetic private financial fixtures, not live evidence. Bid-estimate POST operations remain create-gated and unavailable to read-only recommendations; #20's corresponding original requirement is still open.

The 100000 KRW / 20 percent budget constraints also apply to Automation policy/recipe recommend/approve proposals, not just automatic execution. Supported automated recipes are campaign dailyBudget and userLock=true. D-9..D-3 is the seven-day stabilized history; current statistics still require 30-minute freshness and product/order evidence 15-minute freshness.

#26 remains OPEN: public campaign/adgroup parent DELETE is absent, cleanup=false, completeAbsence=false, snapshotConsistency=unproven and cleanupAuthority=false. Dedicated returned-ID Canary cleanup is a separate gated path; it does not authorize generic parent deletion.

Issue trackers stay OPEN while bounded software completion is distinguished from remaining original requirements and operational acceptance. See [#22 preparation](SEARCHAD_LIVE_VALIDATION_PREPARATION_2026-10-07.md) and the [completion runbook](SEARCHAD_COMPLETION_RUNBOOK.md).
