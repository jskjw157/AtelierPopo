# Account suspension to lifecycle transport initiation

Baseline: 3de64c29f4bd9b4615e1381886c8080e2d5ac036 / Draft PR28 / Issue26.

## Approved continuation and ruling

Fix the documented final post-claim suspension gap. Scope: five current bounded lifecycle services (campaign/adgroup/sibling CREATE, root/child-first DELETE). Reuse the actual searchad_canary_accounts row lock used by AccountControlService; do not change suspension meaning, grant issuance, risk accounting, migrations or any operational default. Legacy generic writer and 0007 Canary adoption remain a separate audit; this is not whole-system closure of #21.

Ruling: order **the synchronous entry into the configured fetch implementation**, not remote delivery/completion. If suspend commits first, deny a later initiation. If send holds the lock first, start fetch while holding it then release immediately without awaiting the remote response. Suspension may complete while an earlier request remains in flight. No promise of exactly-once delivery, cancelling already-sent requests, or distributed fencing after unobservable PostgreSQL connection loss. No all-writer remote absence claim.

Architecture: private AsyncLocalStorage send context per service instance, consumed once at the actual fetch boundary; exact signed Customer binding; copy URL/options before await. SELECT FOR UPDATE after claim on a separate short read/rollback transaction. Strict existing account/not suspended check. Rerun the existing synchronous handoff identity/gate/expiry/risk-date validator after lock acquisition. Check aborted signals before actual fetch. Capture fulfillment/rejection immediately, release transaction before awaiting transport, destroy unhealthy connections, preserve known remote response even if unlock acknowledgement is lost. Denial never refunds consumed approval/risk or makes a plan replayable. GET-only verification/recovery bypasses mutation fencing.

PostgreSQL row-lock basis: https://www.postgresql.org/docs/16/explicit-locking.html . Ordinary account UPDATE and the existing AccountControlService FOR UPDATE conflict with the fence's row lock. Requests which bypass these five adapters are not covered.

## Work / evidence ledger

- [ ] Behavioral RED: real services/approval/signing/PG with real suspension committed after claim before control returns to execute; cover four create and four delete entity cases. Setup/grants/upstream are labelled fixtures, all external fetch trapped.
- [ ] GREEN: shared final-fetch fence and minimal five-service adoption. Preserve existing transport retry0/redirect:error, capture/verification/reconcile and unknown-outcome policy.
- [ ] Focused PG: both lock orderings, old-token/risk preservation, GET recovery, context/Customer/missing-account rejection, cancellation/validator recheck, one-shot scope, DB/unlock failure response preservation.
- [ ] Full regression, exact diff and review. Commit+CI evidence recorded in PR28/Issue26 checkpoint, not invented here.

No local repository checkout or PG runtime is available; direct Git access failed. Use immutable Git objects and non-force fast-forward on approved Draft branch; isolated Actions PG execution. No local full-suite/worktree or independent reviewer claim. No main/base merge, deploy, real Naver call, production DB/gate change or new permission/evidence.
