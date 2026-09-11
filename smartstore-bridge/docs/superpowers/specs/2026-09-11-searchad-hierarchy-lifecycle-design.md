# SearchAd Hierarchy Canary + Lifecycle Design

Date: 2026-09-11
Issue: #17
Branch: `codex/searchad-active-canary-20260910`
Status: approved scope from Master #23 / Issue #17, implementation pending TDD

## 1. Goal

Extend the already verified SearchAd activation layer with a dedicated hierarchy/lifecycle safety boundary for campaign → adgroup → keyword → creative creation and returned-ID-only cleanup. This layer must prove exact operation/lifecycle capability without weakening the existing normal update activation guard.

No real Naver SearchAd mutation is permitted during this issue. Production mutation gates remain OFF by default. All tests use fakes or PostgreSQL only.

## 2. Non-goals

- Do not make passive capability evidence sufficient for writes.
- Do not enable global `allowCreates`, `allowBatchWrites`, or `allowDeletes` merely for Canary.
- Do not broaden the #16 update activation semantics.
- Do not allow arbitrary raw URLs, operation keys, existing remote object IDs, name-based lookup, or blind retry after ambiguous mutations.
- Do not merge to `main` in this issue.

## 3. Source-verified lifecycle operations

Pinned SearchAd operation keys from the checked-in operation manifest:

| Object | Create | Read | Delete |
| --- | --- | --- | --- |
| Campaign | `ncc.post.add_using_post_3__p_ncc_campaigns` | `ncc.get.get_using_get_13__p_ncc_campaigns_campaign_id` | `ncc.delete.remove_using_delete_5__p_ncc_campaigns_campaign_id` |
| Adgroup | `ncc.post.add_using_post_6__p_ncc_adgroups` | `ncc.get.get_using_get_16__p_ncc_adgroups_adgroup_id` | `ncc.delete.remove_using_delete_7__p_ncc_adgroups_adgroup_id` |
| Keyword | `ncc.post.add_using_post_4__p_ncc_keywords__q_ncc_adgroup_id` | `ncc.get.get_using_get_14__p_ncc_keywords_ncc_keyword_id` | `ncc.delete.remove_using_delete_6__p_ncc_keywords_ncc_keyword_id` |
| Creative | `ncc.post.add_using_post_1__p_ncc_ads` | `ncc.get.get_using_get_10__p_ncc_ads_ad_id` | `ncc.delete.remove_using_delete__p_ncc_ads_ad_id` |

The checked-in Naver Swagger states that keyword create accepts at most **100** requests. The Ad type enum includes **`TEXT_45`**. These become server-side hard validation rules.

## 4. Architecture

Add a new module namespace:

`src/naver/searchad/lifecycle/`

Suggested files:

- `operations.js` — pinned operation descriptors and lifecycle kinds.
- `hierarchy-validator.js` — object/parent/customer/type/batch validation.
- `recipe-campaign.js` — stopped WEB_SITE campaign create/read/delete recipe, separate from child hierarchy recipe.
- `recipe-hierarchy.js` — adgroup/keyword/creative create/read/delete using only parent IDs loaded from trusted persisted Canary ownership.
- `postgres-repository.js` — hierarchy runs/objects/events, ownership holds, daily risk ledger.
- `risk-service.js` — atomic per-Customer daily capacity reservation/release/consume.
- `activation-service.js` / guard helper — exact lifecycle scope revalidation.
- `hierarchy-canary-service.js` — orchestration, dispatch intent, ambiguous outcome handling, read-only reconcile, returned-ID-only cleanup.
- later runtime/HTTP wiring only after core contracts are green.

The existing campaign Active Canary remains intact. #17 hierarchy capability is additive and must not change its existing evidence contract.

## 5. Lifecycle scope model

Lifecycle semantics must not be encoded inside `field_scope_json`.

Migration `0009` adds `lifecycle_kinds_json jsonb NOT NULL DEFAULT '[]'::jsonb` to:

- `searchad_verification_evidence`
- `searchad_activation_grants`

Allowed lifecycle kinds for #17:

- `create`
- `batch_create`
- `delete`

Existing #16 update activations keep `lifecycle_kinds_json=[]` and continue to authorize only field-scoped update operations.

A lifecycle activation is usable only when all of these match at decision time and again immediately before dispatch:

- `customer_id`
- current `spec_sha`
- current credential fingerprint
- normalized upstream base URL
- exact `operation_key`
- exact requested `lifecycle_kind`
- unexpired evidence/grant
- evidence type is trusted Active Canary / hierarchy Canary evidence, never passive-only evidence
- account is not suspended
- gateway operation remains public documented, runtime allowlisted, correct tier, and side-effect class compatible with lifecycle kind

No activation for one lifecycle kind implies another. `create` does not authorize `delete`; `batch_create` does not authorize single create.

## 6. Server-owned hierarchy and ID provenance

### 6.1 Campaign recipe separation

Campaign creation is a separate recipe and produces the top-level stopped WEB_SITE campaign. Child recipes cannot accept a caller-provided campaign ID.

### 6.2 Parent binding

Child creation accepts logical parent object references internal to the hierarchy run, not arbitrary SearchAd IDs. The service resolves the parent from the persisted ownership table and verifies:

- same `customer_id`
- same hierarchy run / proven ownership chain
- parent type is exactly expected
- parent remote ID came from a successful create response and was persisted by the server
- top campaign remains stopped/paused before child mutation

Expected chain:

`campaign -> adgroup -> keyword / creative`

Keyword and creative both bind to an owned adgroup. Creative type is exactly `TEXT_45` for the #17 recipe.

### 6.3 Remote ID rule

Only IDs extracted from successful create responses can enter durable ownership state. Caller-supplied target IDs are rejected before any network call.

Cleanup/delete uses only the persisted returned ID. No lookup by campaign/adgroup/keyword/creative name is allowed.

## 7. Ownership hold

Migration `0009` introduces durable SearchAd remote-object ownership records keyed by:

`(customer_id, object_type, remote_id)`

Important fields:

- `owner_kind` = `active_canary` or `hierarchy_canary`
- `owner_run_id`
- `parent_object_id` / parent relationship
- `created_operation_key`
- `state` (`owned`, `delete_unknown`, `deleted`, `manual_review`)
- timestamps

Normal SearchAd write execution must check this table before mutation and reject any target that is currently Canary-owned. This prevents the generic write path from modifying or deleting Canary fixtures.

## 8. Shared per-Customer daily risk capacity

There is no existing durable shared SearchAd risk-capacity table. `0009` therefore adds a transactional daily ledger.

Model:

- capacity is per `customer_id` + UTC/KST-normalized risk date chosen consistently by runtime config (default UTC date for deterministic backend behavior).
- reservations are durable and idempotent by intent ID.
- the transaction locks the daily balance row (`FOR UPDATE`) before granting capacity.
- state transition: `reserved -> consumed` when dispatch intent is durably accepted; `reserved -> released` only before remote dispatch.
- ambiguous remote result remains consumed; it must never be released and retried blindly.
- campaign Active Canary and hierarchy lifecycle calls use the same ledger once #17 wiring is complete.

The implementation starts with explicit server-owned unit costs per lifecycle operation. Clients cannot supply risk units or capacity.

## 9. Approval and dispatch atomicity

Reuse the established plan → one-time approval → execution model rather than creating a weaker approval mechanism.

For lifecycle execution, the durable dispatch transaction must atomically establish:

1. approval token is valid, unexpired, and unused;
2. exact Customer/operation/lifecycle activation is valid;
3. account is not suspended;
4. target is not blocked by ownership/hierarchy rules;
5. daily risk capacity is available/reserved;
6. approval token is consumed;
7. dispatch intent event is persisted.

Only after that transaction commits may the gateway be called.

If the process dies after dispatch intent but before result persistence, recovery enters `unknown_outcome` / reconcile-only mode; it does not re-send the mutation.

## 10. Ambiguous outcome behavior

Create and delete are non-retry-safe.

If the remote call times out or otherwise has an ambiguous result:

- persist `unknown_outcome`
- do not repeat create/delete
- expose read-only reconcile/status path
- for create, reconcile may only adopt a remote ID when the server can prove it from a trusted remote response/read correlation; no name lookup
- for delete, reconcile checks the persisted returned ID only

A cleanup record in `delete_unknown` is terminal for automatic cleanup until read-only reconciliation resolves it. Repeated delete is forbidden.

## 11. Delete safety

Delete requires both:

- exact approval confirmation inherited from the write/lifecycle execution flow; and
- resource-specific destructive confirmation expected by `SearchAdGateway`.

Before deleting a parent:

- server checks durable child ownership records;
- if any non-deleted child exists, parent delete is blocked;
- children are cleaned deepest-first: creative/keyword → adgroup → campaign.

No cascade-by-name or best-effort parent delete is allowed.

## 12. Validation rules

`hierarchy-validator.js` must fail closed before a gateway call for:

- customer mismatch
- wrong parent type
- parent from another run/customer
- caller-supplied existing remote target ID
- active/unlocked top campaign
- keyword batch size 0 or >100
- creative type other than `TEXT_45`
- missing required parent ownership
- unsupported lifecycle kind
- operation/lifecycle mismatch

Payload builders are server-owned and copy only approved recipe fields.

## 13. PostgreSQL `0009` persistence

Additive schema, preserving migrations 0001–0008:

1. lifecycle scope columns on evidence/grants.
2. `searchad_hierarchy_canary_runs`
   - run/customer/recipe/state/spec/fingerprint/upstream/actor/request/timestamps.
3. `searchad_hierarchy_objects`
   - local object ID, run, object type, remote ID nullable until returned, parent local ID, create/read/delete operation keys, state.
4. `searchad_hierarchy_events`
   - append-only state/dispatch/reconcile audit, sanitized JSON only.
5. `searchad_remote_object_ownership`
   - durable ownership hold, unique Customer + type + remote ID.
6. `searchad_daily_risk_capacity`
   - Customer/date capacity/consumed/reserved counters.
7. `searchad_risk_reservations`
   - idempotent reservation/consume/release audit keyed by intent.

Immutable audit tables use the existing immutable-trigger pattern. No credentials, signatures, tokens, or raw secrets are stored.

## 14. Recovery

On restart:

- load hierarchy runs in nonterminal states;
- never automatically replay a side-effect with an existing `dispatch_intent` unless the prior state proves no network dispatch occurred;
- `dispatching` without definite result becomes reconcile-only/unknown outcome;
- ownership and risk state are read from PostgreSQL, not process memory;
- cleanup continues only for objects with definite owned IDs and no unresolved prior delete dispatch.

## 15. TDD verification matrix

Required RED → GREEN contracts:

1. hierarchy validator rejects wrong Customer/parent/type/ID injection/batch >100/TEXT_45 violation with zero gateway calls.
2. campaign and child recipes accept only server-owned IDs and stopped parent state.
3. PG migration 0009 applies and re-applies idempotently.
4. shared risk reservation is atomic and Customer/day scoped.
5. lifecycle activation cannot leak across Customer, operation key, or lifecycle kind.
6. ambiguous create/delete persists unknown outcome and has no resend.
7. cleanup uses returned ID only and blocks parent with child.
8. normal write rejects Canary-owned target.
9. PostgreSQL restart recovery preserves ownership/risk/unknown outcome.
10. full existing SearchAd contract/write regression remains green.
11. production mutation defaults remain OFF; actual Naver calls = 0.

## 16. Safety invariants retained

All Master #23 safety invariants remain binding, especially returned-ID-only handling, no name-based cleanup, no blind retry, Customer/spec/credential/upstream binding, Reader/Operator/Executor/Admin isolation, account suspension override, and operation-scoped promotion only.
