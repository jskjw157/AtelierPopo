# Bounded campaign plan and one-shot create handoff

> Continue with executing-plans/TDD; approved #26 recovery sequence. This is not all B2b/C/D/E/F.

**Goal:** Produce one server-owned stopped campaign plan, use existing real approval and atomic dispatch coordinator, send once through the signing Gateway, and durably retain the validated returned ID before GET verification.
**Source:** SEARCHAD_0009_CAMPAIGN_DISPATCH_VERIFICATION.md and Master23/#26. Baseline a1dfe180; isolated exported snapshot93a522e. No historical-source replacement.
**Tech:** Node22 ESM/node:test, real PostgreSQL16. No dependency/schema/default-gate change.

## Design and boundaries

- Add `campaign-create-service.js` (strict inputs, genuine credentials/registry/signing-client/Gateway composition, default disabled) and `postgres-campaign-create-repository.js` (plan transaction, post-claim handoff and response settlement). Tests in `postgres-searchad-campaign-create.integration.test.js`.
- Prepare accepts Customer and existing activation UUID only. Server generates run/object/plan IDs, stopped WEB_SITE body, reason and bounded expiry. Copy authenticated Admin scope before awaiting. Persist run+object+plan+audit together. Do not mint approval, evidence, ownership or risk. Existing approval service remains the only token issuer.
- Execute accepts only local IDs and issued token. Reuse `PostgresCampaignDispatchRepository.claim`, never reimplement its atomic token+risk+dispatch writes. Validate dedicated Canary/read gates before claim; keep ordinary write/create/delete gates OFF. Synthetic active-create evidence is test-only and never becomes a production bootstrap shortcut.
- Post-claim transaction revalidates account, immutable authority, exact plan and dispatch evidence; records a distinct transport intent and releases locks before I/O. Private issued stage tickets plus row versions reject forged/replayed/stale outcome settlement. COMMIT ambiguity never yields permission to send.
- Immediately before POST, recheck current identity/gates/expiry. Acknowledged handoff allows one in-process Gateway invocation only. A crash/lost ack may leave zero actual sends and unresolved risk; never resume by resending. This is not exactly-once upstream effect or a proof of the final concurrent-suspension barrier (#21).
- Compose existing signing client with a server-owned fetch wrapper requiring `redirect: error`, maxRetries0, fixed official origin. Existing generic client follows redirects, so do not reuse that behavior for a credential-bearing new mutation route. No existing client code is modified.
- Only an exact typed200 POST response with matching Customer/campaign ID/WEB_SITE/name/stopped/budget may persist an ID. Insert the local ID and manual-review ownership hold atomically before verification GET; no name search. A subsequent exact GET may promote object/hold to owned and plan to applied; run stays cleanup_pending, never passed. Malformed/partial/mismatched responses never fabricate ownership. Network failures leave unknown, not retryable failed.
- A read outage keeps the returned ID and hold; existing read-only reconcile may observe it but cannot promote a create from GET alone. No DELETE or automatic rollback in this bounded increment. Response body, headers, raw token and raw errors are not persisted.
- Scope does not wire application HTTP/bootstrap, issue real lifecycle evidence, create children/batches, delete campaigns or generalize legacy0007 shared-risk integration. No live Naver call, production migration/deploy/main change/merge.

## Tasks

- [x] Observe failure-first prepare/approve/execute contracts before new production module exists.
- [x] Implement transactional server-owned prepare and test rollback, scope, concurrency and plan compatibility.
- [x] Implement one-shot handoff, returned-ID/hold capture and exact GET settlement; test real signed transport with only fetch responses simulated.
- [x] Add adversarial tests for gates, no-token/replay, wrong-response identity, post-commit suspension/rotation, stale state, commit ambiguity, rollback and read outage. No skipped PG accepted as verification.
- [x] Run fresh full/required/repeated PG, static/provenance checks; negative control for duplicate send or non-atomic capture; restore exact source after control.
- [ ] Publish narrow code/test/workflow changes, remove temporary resume export, observe completed CI; sync current dashboard/#23/#26/PR24 without closing overall issue.

## Local observed checkpoint

Baseline414/0/0; new real-PG parent+47 children48/0/0; full462/0/0; requiredPG172/0/0.
First missing-module RED was0/1/0. Risk-date rebinding regression was42/2/0 including parent;
exact risk date/consumption timestamp and approval-use timestamp binding fixed it.
A disposable duplicate-POST mutant produced29/19/0; exact source was restored and all48 passed again.
Fresh syntax/static/write-safety pass; both final migration reruns0009/applied:[].
No historical clone or independent reviewer approval is claimed. Code publication/remote CI is pending.
