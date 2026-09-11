# SearchAd Passive Capability / Activation Design

**Status:** Approved for reconstruction under Master Issue #23 / child Issue #16

**Goal:** Rebuild the durable Passive Capability evidence and evidence-ID activation control plane without enabling live SearchAd mutations or trusting client-declared success/scope.

## 1. Existing foundation

The current reconstruction branch already has:

- `SearchAdCapabilityService.runPassive()` for read-only live probes.
- pinned SearchAd manifest/gateway with runtime allowlist and tier checks.
- Reader / Operator / Executor / Admin role-key authentication and explicit Customer grants.
- PostgreSQL `searchad_verification_evidence` and `searchad_canary_accounts` from migration `0007_searchad_active_canary.sql`.
- immutable trigger protection for verification evidence.
- Active Canary evidence validation bound to Customer/spec/credential/upstream/operation/field scope.
- Active Canary start blocked when `searchad_canary_accounts.suspended=true`.
- existing SearchAd write flow: plan -> approval -> one-time token -> drift check -> mutation -> read-back verification.

The missing control-plane pieces are trusted Passive evidence issuance, explicit activation grants, write-time activation checks, durable account state audit, and Customer-scoped HTTP access for the legacy write flow.

## 2. Safety decisions

1. The existing `/api/v1/searchad/capabilities/passive-probe` remains a diagnostic response only. It never becomes trusted activation evidence by itself.
2. Trusted Passive evidence is created only through a separate server-controlled service. The client may provide only `customerId`; it cannot provide `passed`, `operationKeys`, `fieldScope`, credential identity, spec identity, upstream URL, or evidence result.
3. The trusted service chooses passive read probes server-side and validates the target operation scope against the pinned manifest without executing side-effect operations.
4. `inputs[operationKey].customerId` is rejected before any gateway call. The probe service always overwrites/owns the top-level Customer identity.
5. A trusted Passive evidence row is `verified` only when all server-selected passive probes succeed and every server-selected target operation exists, is runtime allowlisted, and is in the expected public verification tier. Failed probes may still be recorded immutably as `failed`, but failed evidence can never activate.
6. Evidence stores only sanitized probe metadata: operation key, support state, upstream status/request ID, timestamps. Raw credential/access license/signature/secret and raw response payloads are not stored.
7. Activation requests accept exactly `{ "evidenceId": "..." }`. Customer, operation keys, field scope, expiry, spec, credential fingerprint, upstream base URL, and evidence type are copied from the immutable evidence row.
8. Activation never flips the global SearchAd write/create/delete flags. It creates a narrow durable grant only.
9. Passive Capability activation proves preconditions only. Normal side-effect write execution requires an activation grant backed by `active_canary` evidence. `passive_capability` evidence cannot directly authorize a normal write.
10. In Issue #16, the normal write guard supports update-family activation only. Generic create/delete/batch remain blocked until Issue #17 provides lifecycle-specific safety policy.
11. Every activation/execution check re-reads durable account/grant/evidence state and revalidates current spec, credential fingerprint, upstream base URL, operation scope, field scope, and expiry.
12. Account suspension is an overriding kill switch. It blocks new normal writes and new Active Canary starts, but does not block read-only status/reconcile.
13. Account suspend/resume changes are mutable current state plus immutable principal-bound state-change events.
14. No client-supplied actor is trusted. HTTP handlers use the authenticated SearchAd principal ID.

## 3. PostgreSQL model

Migration `0008_searchad_activation_control.sql` extends the existing 0007 control plane.

### `searchad_verification_evidence` additions

- `details_json jsonb NOT NULL DEFAULT '{}'::jsonb`
- `created_by_principal_id text`
- `source_request_id text`

The existing immutable trigger continues to make evidence append-only.

### `searchad_activation_grants`

Immutable grant rows:

- `activation_id uuid PRIMARY KEY`
- `evidence_id text NOT NULL REFERENCES searchad_verification_evidence(evidence_id)`
- `evidence_type text NOT NULL`
- `customer_id text NOT NULL`
- `spec_sha text NOT NULL`
- `credential_fingerprint text NOT NULL`
- `upstream_base_url text NOT NULL`
- `operation_keys_json jsonb NOT NULL`
- `field_scope_json jsonb NOT NULL`
- `activated_by_principal_id text NOT NULL`
- `activated_at timestamptz NOT NULL`
- `expires_at timestamptz NOT NULL`

`evidence_id` is unique so one immutable evidence object has one canonical activation grant. The row is protected by the immutable mutation trigger.

### `searchad_account_state_events`

Append-only audit rows:

- `event_id uuid PRIMARY KEY`
- `customer_id text NOT NULL`
- `action text CHECK (action IN ('suspend','resume'))`
- `actor_principal_id text NOT NULL`
- `request_id text`
- `created_at timestamptz NOT NULL`

The table is protected by the immutable mutation trigger.

## 4. Trusted Passive evidence flow

New `PassiveCapabilityEvidenceService` consumes:

- `SearchAdCapabilityService`
- pinned `SearchAdOperationGateway`
- PostgreSQL activation repository
- Customer credential fingerprint resolver
- current gateway context `{specSha, upstreamBaseUrl}`
- server-controlled target scope

For the current stopped-WEB_SITE Canary precondition, the server target scope is exported as a constant from the production Canary recipe:

- operation keys: current stopped campaign create/read/update/delete + single-entity stats operation
- field scope: `campaign.userLock`, `campaign.dailyBudget`

The service performs server-selected read-only probes via `SearchAdCapabilityService.runPassive()`. It never sends the target side-effect operations. If all passive probes succeed and all target operation descriptors pass pinned manifest checks, it writes immutable `passive_capability` evidence.

The trusted evidence route is:

- `POST /api/v1/searchad/capabilities/passive-evidence` — Operator+
- body: `{ "customerId": "..." }` only

Read routes are Reader+ and Customer-scoped.

## 5. Activation flow

New `SearchAdActivationService.activateEvidence(evidenceId, context)`:

1. Requires Admin principal.
2. Loads immutable evidence by ID.
3. Projects missing or cross-Customer evidence as 404.
4. Requires `result=verified` and non-expired evidence.
5. Resolves current Customer credential fingerprint.
6. Resolves current pinned spec and upstream base URL.
7. Requires exact Customer/spec/credential/upstream match.
8. Requires every operation in evidence to still exist and remain runtime allowlisted/public-verification tier.
9. Creates one immutable activation grant copying the evidence scope and authenticated principal ID.
10. Returns only a public grant projection without credential fingerprint or secrets.

HTTP route:

- `POST /api/v1/searchad/activations` — Admin
- body: `{ "evidenceId": "..." }` only

Reader+ may list/get grants, restricted to explicit Customer grants.

## 6. Write-time activation guard

`SearchAdActivationGuard.assertMutationAllowed({ customerId, descriptor })` executes immediately before the one-time approval token is claimed and before `remote.mutate()`.

Checks:

- account exists and is not suspended;
- operation exists in pinned registry and is a supported update-family operation for Issue #16;
- latest usable grant for the Customer contains the exact operation key;
- grant is backed by `active_canary` evidence;
- grant/evidence are not expired;
- grant and evidence exactly match current Customer/spec/credential/upstream identity;
- mutable fields derived server-side from the descriptor are a subset of evidence `field_scope`.

For the current proven campaign budget update, field derivation maps the pinned campaign update operation and `fields=budget`/body leaves to `campaign.dailyBudget` and `campaign.userLock`. Unknown field mappings fail closed. Generic create/delete/batch operations fail closed here and are deferred to Issue #17.

`ProductionSearchAdExecutionService.execute()` calls this guard after the existing drift read and before `approvalService.claim()` / remote mutation. This preserves the existing one-time token when activation is missing or stale.

Read-only `reconcile()` remains usable during suspension and does not require an activation grant.

## 7. Account suspend/resume

`SearchAdAccountControlService` uses the existing `searchad_canary_accounts` current-state table.

Admin routes:

- `POST /api/v1/searchad/accounts/{customerId}/suspend`
- `POST /api/v1/searchad/accounts/{customerId}/resume`

Reader+ route:

- `GET /api/v1/searchad/accounts/control-status`

All account endpoints use SearchAd role principals and explicit Customer grants. Each state change records an immutable `searchad_account_state_events` row with authenticated principal and request ID. Repeating the current state is idempotent and may record no duplicate state-change event.

## 8. Existing write HTTP role/customer isolation

The existing SearchAd write endpoints are upgraded to the same SearchAd role-key system:

- Reader+: status/list/get
- Operator+: create plan
- Executor+: approve/execute/reconcile/rollback
- Admin inherits all by role rank

Plan creation ignores/rejects body `createdBy` and binds `created_by` to the authenticated principal. Approval ignores/rejects body actor and binds approval actor to the authenticated principal. Plan lookup/action first loads the plan and checks its `customer_id` against the principal grant; inaccessible plans are projected as 404.

The existing generic HAAR API key does not become a SearchAd role key.

## 9. Runtime and failure behavior

A separate `searchAdActivationRuntime` is bootstrapped in `bootstrap-v05.js` from `DATABASE_URL`, the SearchAd gateway, and credential registry. It is fail-closed for trusted evidence/activation/write enforcement. If unavailable:

- existing read-only SearchAd gateway endpoints still work;
- trusted Passive evidence/activation/account-control endpoints return 503;
- normal SearchAd write execution must not fail open when `allowWrites=true`; it is blocked if the activation guard is unavailable;
- Active Canary remains governed by its existing independent runtime and account state table.

No migration, runtime, or activation change enables live SearchAd writes by itself.

## 10. Verification

Issue #16 is complete only when fresh CI proves:

- nested Customer override rejected before gateway I/O;
- fabricated/failed/expired/mismatched evidence cannot activate;
- wrong operation/field scope cannot execute;
- passive evidence cannot authorize a normal write;
- active-canary activation is revalidated immediately before mutation;
- missing activation does not consume the one-time approval token;
- suspend persists across repository/runtime restart and blocks write/Canary start;
- read-only reconcile remains available while suspended;
- cross-Customer evidence/grant/plan/account access is hidden or denied as specified;
- evidence/grant/account event immutability is enforced in PostgreSQL;
- migrations through 0008 are repeat-idempotent;
- existing Active Canary and SearchAd write regression suites remain green;
- real Naver SearchAd mutation count remains zero in CI.
