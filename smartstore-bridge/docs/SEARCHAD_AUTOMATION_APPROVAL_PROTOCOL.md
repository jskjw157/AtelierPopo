# SearchAd deterministic approval protocol

Task 5 adds local observe/recommend/approve policies using the existing change-plan, approval, execution, verification, reconciliation and rollback services. It does not enable Auto, live operational gates, activation evidence or reporting baselines. The production baseline supplier remains unavailable, so rule-bound mutations remain blocked even for budget reductions and user locks.

## Policy and evaluation

Admin `POST /api/v1/searchad/automation/policies` accepts an exact Customer, campaign identity, reason, optional mode/enabled/current-age and either a campaign budget or `userLock=true` recipe. Defaults are `mode=observe`, `enabled=false`, and 30-minute maximum current/evidence age. Updates require the existing policy ID and expected revision and cannot change its entity. Each revision is immutable. The Customer/entity rule ID is shared across revisions, replacement policies and recipe variants so a new policy cannot reset failures.

Budget values are integer KRW, at most 100000, with a maximum 20% change from the exact current value. Unlocking is rejected. These conservative limits are applied now although the original caps also form part of the later limited-Auto proposal.

Operator evaluation selects native reporting observations for the exact Customer, entity, spec SHA, credential fingerprint and upstream identity. Both the original observation time and stats cycle must satisfy the policy age; stats remain provisional. An exact pinned Campaign GET through the application-owned read adapter establishes current dailyBudget/userLock and entity type. It records the original canonical snapshot hash and successful read time; cached recalculation does not refresh either. Missing or malformed GET data, or an unacknowledged observation insert, yields `CURRENT_VALUE_UNAVAILABLE`. A successful remote GET is selected only after its immutable persistence is acknowledged; failed inserts never produce a ready decision. No body can supply evidence, current values, rule IDs, dispatch owners or approval authority.

The decision key hashes the Customer, policy revision, entity, canonical selected source hashes and canonical hourly logical slot. Duplicate inputs return the existing run with its original selected evidence. Re-observation cannot revive expired authority on that run. Current identity and persisted selected observations are checked again at preparation, approval, claim and final initiation; the final snapshot callback also checks elapsed freshness.

## Ownership and ambiguity

| Stage | Durable behavior |
| --- | --- |
| Evaluation | Stores observed/recommended/blocked/ready run; creates no plan or token. |
| Preparation reservation | Account-first transaction commits preparing plus one reservation; only an acknowledged commit yields an opaque in-process capability. |
| Plan creation | Existing plan service GET must match original before hash. The capability atomically persists the generated plan, unique run association and preparation audit. |
| Approval pending | Valid current prepared authority becomes approval_pending before token persistence. |
| Ordinary explicit approval | Existing approval service stores only the token hash. Approval and exact run association become approved atomically. The raw token is returned once. |
| Claim pending | Exact unexpired token and run association are validated before spending claim_pending authority. |
| Accepted execute | Existing account-first one-shot claim allocates a durable Customer ordinal, consumes approval/reservation and records executing in one transaction. |
| Final send fence | Rechecks persisted current policy, selected evidence, owned plan, consumed approval and exact unresolved ordinal under existing account/activation/Circuit fences; no initiating state is persisted in this always-ROLLBACK transaction. |
| Primary outcome | Immutable ordinal versions are committed with the source attempt; unknown results require the existing GET-only reconcile path. |

COMMIT failure before or after acknowledgement never reconstructs an opaque capability, plan, token or dispatch. Pending/manual-review states remain non-executable after restart. A failed claim rolls back and releases its checked-out database connection (discarding it if rollback fails) before attempting retirement in another transaction. Retirement failure preserves the original claim error and the durable pending hold. A losing concurrent preparation cannot revoke the acknowledged winner. An orphan reservation remains a conservative hold. Public run reads never reconstruct execution tokens, and generic/direct existing approval and execution methods derive attached automation authority from the same persisted association.

## Ordered failures and recovery

A later accepted Customer claim cannot overtake an earlier claim without a known terminal outcome. `failed` and `not_applied` count as unsuccessful. Only verified `applied` or `applied_reconciled` resets the ordered rule suffix. Unknown outcomes block subsequent claims until a new immutable known reconciliation version is committed. Wall-clock and event-delivery order cannot establish execute order. Neutral planning, read, remote acceptance and rollback do not reset the suffix. Pre-claim rejections allocate no ordinal.

Unlinked legacy failures remain a separate conservative component that later successes cannot erase. Older immutable not_applied projections are classified against their original primary attempts, and historical campaign type names map to the stable entity lineage. An exact same-Customer primary `reconcile/not_applied` attempt with a matching terminal plan status resolves the earlier unknown for that logical mutation, while still contributing a failure. State and recovery use the same reduction before applying exact recovery exemptions, so a recovered terminal cannot expose its older unknown again, even under late projection. Arbitrary failed events cannot resolve ambiguity. Neither history nor its original projection is rewritten.

Admin `POST /api/v1/searchad/circuit/recover-rule` requires Customer, policy ID, expected policy revision, a reason and `RECOVER_SEARCHAD_KNOWN_FAILURES`. The server selects exact current known failed terminal versions and exact unresolved legacy failed events, appends an immutable audit, increments the rule recovery revision and revokes old rule runs. Unknown, in-flight, projection backlog or orphan reservation refuses recovery. Recovery does not reset account suspension, manual pause, entity holds, risk capacity, consumed reservations or tokens. It never deletes source history.

## HTTP and ownership

Reader can list policies/runs and read an exact scoped run. Operator can evaluate and prepare. Executor can call execute-approved with the one-time ordinary token, subject to the existing HTTP and SearchAd write gates. Admin owns policy revisions and scoped recovery. Role OpenAPI exposes these exact contracts. All endpoints reject extra fields and ambiguous Customer queries.

Completion and ordinary HTTP routes share one lazy application-owned write runtime and native account store. Completion shutdown rejects new operations and drains accepted operations before releasing its resources. Migration 0013 appends the protocol tables and composite ownership constraints; 0001–0012 remain byte-identical. Worker/profitability additions follow as 0014/0015.

Native PostgreSQL acceptance uses a closed fake upstream, real writer/Circuit and full application restart. Positive mutation tests inject deterministic server spend/baseline evidence and synthetic fixture-only activation evidence. Separate production-composition tests verify that actual missing baseline remains blocking. This is software acceptance, not live account qualification.
