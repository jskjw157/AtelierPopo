# SearchAd Passive Capability / Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild trusted immutable Passive Capability evidence, evidence-ID activation, write-time activation enforcement, and durable SearchAd account suspend/resume without enabling live SearchAd mutations.

**Architecture:** Keep the existing diagnostic `SearchAdCapabilityService` and 0007 Active Canary control plane, then add a separate PostgreSQL activation control plane in migration 0008. Trusted evidence and activation are server-derived; normal writes receive an injected activation guard that revalidates durable account/grant/evidence state immediately before the one-time approval token is claimed and before remote mutation.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`, PostgreSQL 16 / `pg`, existing SearchAd gateway/spec registry, existing HTTP role-key access control, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-11-searchad-passive-activation-design.md`

## Global Constraints

- `ATELIER_SEARCHAD_ALLOW_ACTIVE_CANARY=false` remains the default.
- No task may enable generic SearchAd write/create/delete gates in CI.
- Trusted evidence must never accept client `passed`, `operationKeys`, `fieldScope`, credential fingerprint, spec SHA, or upstream URL.
- Passive evidence cannot directly authorize normal side-effect writes; write enforcement requires `active_canary` evidence.
- `inputs[operationKey].customerId` must be rejected before gateway/network I/O.
- Activation request body is exactly `{evidenceId}`.
- Every activation/execution check revalidates Customer/spec/credential/upstream/operation/field scope/expiry.
- Account suspension overrides write activation but never blocks read-only reconcile/status.
- Generic create/delete/batch remain blocked by the Issue #16 activation guard; Issue #17 owns lifecycle activation.
- Generic HAAR API keys must not become SearchAd role keys.
- Evidence, activation grants, and account state events contain no raw credentials/secrets/signatures.
- Real Naver SearchAd mutations remain zero until the live-validation issue.

---

### Task 1: Harden Passive Probe Identity and Export Server Target Scope

**Files:**
- Modify: `src/naver/searchad/capability.js`
- Modify: `src/naver/searchad/canary/production-recipe.js`
- Test: `test/searchad-passive-evidence.test.js`

**Interfaces:**
- Produces: `STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE` with `{ operationKeys: string[], fieldScope: string[] }`.
- Produces: `SearchAdCapabilityService.runPassive()` that rejects per-operation `customerId` overrides before calling `gateway.execute()`.

- [ ] **Step 1: Write the failing Customer-override test**

```js
test('passive probe rejects nested Customer override before remote I/O', async () => {
  let executes = 0;
  const service = new SearchAdCapabilityService({ gateway: fakeGateway(() => { executes += 1; }), config });
  await assert.rejects(
    service.runPassive({
      customerId: '100',
      operations: ['campaign.list'],
      inputs: { 'campaign.list': { customerId: '200' } }
    }),
    error => error?.code === 'SEARCHAD_PASSIVE_CUSTOMER_OVERRIDE_FORBIDDEN'
  );
  assert.equal(executes, 0);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:
```bash
node --test test/searchad-passive-evidence.test.js
```
Expected: FAIL because the current spread order permits the nested Customer override.

- [ ] **Step 3: Implement strict Customer ownership before the loop**

```js
function assertNoCustomerOverride(inputs = {}) {
  for (const [operationKey, value] of Object.entries(inputs || {})) {
    if (value && typeof value === 'object' && Object.hasOwn(value, 'customerId')) {
      const error = new Error('Passive probe Customer identity is server-owned.');
      error.code = 'SEARCHAD_PASSIVE_CUSTOMER_OVERRIDE_FORBIDDEN';
      error.status = 400;
      error.details = { operationKey };
      throw error;
    }
  }
}
```

Call `assertNoCustomerOverride(inputs)` before any `gateway.get()` or `gateway.execute()`, and construct the execute input as:

```js
await this.gateway.execute(operationKey, {
  ...(inputs[operationKey] || {}),
  customerId: String(customerId)
});
```

- [ ] **Step 4: Export immutable server target scope**

In `production-recipe.js`:

```js
export const STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE = Object.freeze({
  operationKeys: Object.freeze(Object.values(CANARY_OPERATION_KEYS)),
  fieldScope: Object.freeze(['campaign.userLock', 'campaign.dailyBudget'])
});
```

Use this constant when constructing the recipe `requiredOperationKeys` and `verifiedOperationScope` so the evidence service and Canary recipe cannot drift.

- [ ] **Step 5: Run focused tests and commit**

Run:
```bash
node --test test/searchad-passive-evidence.test.js test/searchad-active-canary-production-recipe.test.js
```
Expected: PASS.

Commit message:
```text
fix: lock Passive Probe Customer identity
```

---

### Task 2: Add PostgreSQL Activation Schema and Repository

**Files:**
- Create: `migrations/postgres/0008_searchad_activation_control.sql`
- Create: `src/naver/searchad/activation/postgres-repository.js`
- Test: `test/postgres-searchad-activation.integration.test.js`

**Interfaces:**
- Produces repository methods:
  - `createEvidence(evidence)` / `getEvidence(evidenceId)` / `listEvidence({customerIds,evidenceType,limit})`
  - `createActivation(grant)` / `getActivation(activationId)` / `getActivationByEvidence(evidenceId)` / `findUsableActivation({customerId,operationKey,now})`
  - `getAccount(customerId)` / `setAccountSuspended({customerId,suspended,actorPrincipalId,requestId,createdAt})`
  - `listAccounts(customerIds)`

- [ ] **Step 1: Write integration RED for schema and restart persistence**

The test must migrate a fresh PostgreSQL 16 database twice, insert a passive evidence row, activation row, and suspend event, recreate the repository, and verify all remain readable. It must also assert UPDATE/DELETE fail for evidence, activation grants, and account state events.

Example core assertions:

```js
assert.equal((await repo2.getEvidence('ev-1')).customerId, '100');
assert.equal((await repo2.getActivationByEvidence('ev-1')).activatedByPrincipalId, 'admin-100');
assert.equal((await repo2.getAccount('100')).suspended, true);
await assert.rejects(pool.query("UPDATE searchad_activation_grants SET customer_id='200' WHERE evidence_id='ev-1'"));
await assert.rejects(pool.query("DELETE FROM searchad_account_state_events WHERE customer_id='100'"));
```

- [ ] **Step 2: Run integration test and verify RED**

Run:
```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" node --test test/postgres-searchad-activation.integration.test.js
```
Expected: FAIL because migration 0008/tables do not exist.

- [ ] **Step 3: Implement migration 0008**

Add columns to existing evidence table:

```sql
ALTER TABLE searchad_verification_evidence
  ADD COLUMN IF NOT EXISTS details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by_principal_id text,
  ADD COLUMN IF NOT EXISTS source_request_id text;
```

Create immutable activation grants:

```sql
CREATE TABLE IF NOT EXISTS searchad_activation_grants (
  activation_id uuid PRIMARY KEY,
  evidence_id text NOT NULL UNIQUE REFERENCES searchad_verification_evidence(evidence_id),
  evidence_type text NOT NULL,
  customer_id text NOT NULL,
  spec_sha text NOT NULL,
  credential_fingerprint text NOT NULL,
  upstream_base_url text NOT NULL,
  operation_keys_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  field_scope_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  activated_by_principal_id text NOT NULL,
  activated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
```

Create `searchad_account_state_events` exactly as the design specifies. Apply `searchad_reject_immutable_mutation()` triggers to the two new append-only tables and indexes for `(customer_id, expires_at)` plus operation lookup.

- [ ] **Step 4: Implement repository row mappers and parameterized queries**

No repository method may return raw SQL rows directly. JSONB arrays/objects are cloned before return. `setAccountSuspended()` must use one transaction/client so current-state update and immutable event append are atomic when state changes.

- [ ] **Step 5: Run migration twice and integration GREEN**

Run:
```bash
node scripts/postgres-migrate.mjs
node scripts/postgres-migrate.mjs
TEST_DATABASE_URL="$TEST_DATABASE_URL" node --test test/postgres-searchad-activation.integration.test.js
```
Expected: second migration reports no newly applied migrations; test PASS.

Commit message:
```text
feat: add durable SearchAd activation control schema
```

---

### Task 3: Build Trusted Passive Evidence Service

**Files:**
- Create: `src/naver/searchad/activation/passive-evidence-service.js`
- Test: `test/searchad-passive-evidence.test.js`

**Interfaces:**
- Consumes: `capabilityService`, `gateway`, activation repository, `credentialFingerprintResolver`, `gatewayContext`, `targetScope`.
- Produces: `issue({customerId}, {principal,requestId}) -> immutable evidence public object`.

- [ ] **Step 1: Add RED tests for fabricated scope and failed probe**

Tests must assert:

```js
await assert.rejects(
  service.issue({ customerId: '100', passed: true }, ctx),
  error => error?.code === 'SEARCHAD_PASSIVE_EVIDENCE_INPUT_INVALID'
);
```

and that no caller input can set `operationKeys`, `fieldScope`, `specSha`, `credentialFingerprint`, or `upstreamBaseUrl`. A passive probe result containing any `supported:false` must create `result:'failed'` evidence and never report verified.

- [ ] **Step 2: Run RED**

Run:
```bash
node --test test/searchad-passive-evidence.test.js
```
Expected: module/method missing failures.

- [ ] **Step 3: Implement server-derived evidence issuance**

Use an exact input allowlist:

```js
const ISSUE_KEYS = new Set(['customerId']);
```

Validate principal Customer access, choose `capabilityService.defaultPassiveOperations()` server-side, run them, then validate every `targetScope.operationKeys` descriptor:

```js
const operation = gateway.get(operationKey);
if (!operation.runtimeAllowlisted || operation.state !== 'public_documented' || operation.tier !== 'B') {
  verified = false;
}
```

Resolve fingerprint and gateway context server-side. Persist sanitized details only:

```js
details: {
  checkedAt: probe.checkedAt,
  probeOperations: probe.results.map(item => ({
    operationKey: item.operationKey,
    state: item.state,
    supported: item.supported,
    upstreamStatus: item.upstreamStatus ?? null,
    requestId: item.requestId ?? null
  }))
}
```

- [ ] **Step 4: Verify evidence has exact server target scope**

Assert persisted evidence `operationKeys` and `fieldScope` deep-equal `STOPPED_WEB_SITE_CANARY_PASSIVE_SCOPE`, regardless of client payload.

- [ ] **Step 5: Run GREEN and commit**

Run:
```bash
node --test test/searchad-passive-evidence.test.js
```
Expected: PASS.

Commit message:
```text
feat: issue trusted Passive Capability evidence
```

---

### Task 4: Implement Evidence-ID Activation, Account Control, and Write Guard

**Files:**
- Create: `src/naver/searchad/activation/activation-service.js`
- Create: `src/naver/searchad/activation/account-control-service.js`
- Create: `src/naver/searchad/activation/activation-guard.js`
- Test: `test/searchad-activation-service.test.js`
- Test: `test/searchad-account-control.test.js`
- Test: `test/searchad-activation-guard.test.js`

**Interfaces:**
- Produces: `SearchAdActivationService.activate({evidenceId}, context)`.
- Produces: `SearchAdAccountControlService.suspend(customerId, context)`, `.resume(customerId, context)`, `.list(context)`.
- Produces: `SearchAdActivationGuard.assertMutationAllowed({customerId,descriptor})`.

- [ ] **Step 1: Write activation RED matrix**

Cover fabricated fields, expired evidence, failed evidence, wrong Customer access, current spec mismatch, credential mismatch, upstream mismatch, operation no longer allowlisted, and duplicate evidence activation.

Activation input test:

```js
await assert.rejects(
  service.activate({ evidenceId: 'ev-1', customerId: '200' }, adminCtx),
  error => error?.code === 'SEARCHAD_ACTIVATION_INPUT_INVALID'
);
```

Cross-Customer missing/access must be indistinguishable to the caller as 404.

- [ ] **Step 2: Write account control RED**

Suspend -> restart repository -> still suspended; resume -> false. Repeated suspend/resume with unchanged state is idempotent. Events record only authenticated `principalId`, never a body actor.

- [ ] **Step 3: Write activation guard RED**

Required cases:

```js
await assert.rejects(
  guard.assertMutationAllowed({ customerId: '100', descriptor: campaignBudgetDescriptor }),
  error => error?.code === 'SEARCHAD_ACTIVATION_REQUIRED'
);
```

Passive-backed activation must fail normal writes with `SEARCHAD_ACTIVE_CANARY_ACTIVATION_REQUIRED`. Active-Canary-backed activation with exact operation/fields passes. Wrong field, expired grant, changed credential, or suspended account fails before any mutation.

- [ ] **Step 4: Implement activation service**

Exact input allowlist `{evidenceId}`. Re-read immutable evidence and current context. Grant copies evidence scope and expiry. Public projection omits credential fingerprint.

- [ ] **Step 5: Implement account service**

Require Admin + explicit Customer grant. Call repository atomic state setter with `actorPrincipalId=context.principal.principalId` and `requestId=context.requestId`.

- [ ] **Step 6: Implement update-family guard**

For Issue #16, allow only the pinned campaign update operation. Derive field scope from the descriptor without trusting a caller-provided `fieldScope`:

```js
if (descriptor.operationKey === CANARY_OPERATION_KEYS.updateCampaign) {
  const fields = new Set();
  if (String(descriptor.query?.fields || '') === 'budget' || Object.hasOwn(descriptor.body || {}, 'dailyBudget')) {
    fields.add('campaign.dailyBudget');
  }
  if (Object.hasOwn(descriptor.body || {}, 'userLock')) fields.add('campaign.userLock');
  return [...fields];
}
throw blockedLifecycleOperation();
```

Ignore identity field `nccCampaignId` for mutable-field scope. Empty or unknown mapping fails closed.

- [ ] **Step 7: Run all three suites and commit**

Run:
```bash
node --test test/searchad-activation-service.test.js test/searchad-account-control.test.js test/searchad-activation-guard.test.js
```
Expected: PASS.

Commit message:
```text
feat: enforce evidence scoped SearchAd activation
```

---

### Task 5: Bootstrap the Activation Runtime Fail-Closed

**Files:**
- Create: `src/naver/searchad/activation/runtime-production.js`
- Create: `src/naver/searchad/activation/bootstrap.js`
- Modify: `src/bootstrap-v05.js`
- Modify: `src/http/server-v05.js`
- Test: `test/searchad-activation-runtime.test.js`

**Interfaces:**
- Produces app fields: `searchAdActivationRuntime`, `searchAdActivationStartupError`.
- Runtime exposes `{repository, passiveEvidenceService, activationService, accountControlService, guard, status(), close()}`.

- [ ] **Step 1: Write runtime RED**

Cases:
- `DATABASE_URL` absent -> activation runtime unavailable/fail-closed.
- gateway or credential registry absent -> unavailable.
- 0008 schema absent -> unavailable.
- valid dependencies -> ready with PostgreSQL storage and current gateway context.

- [ ] **Step 2: Run RED**

Run:
```bash
node --test test/searchad-activation-runtime.test.js
```
Expected: missing runtime/bootstrap module failures.

- [ ] **Step 3: Implement runtime**

Use the existing PostgreSQL pool helper and schema readiness query for:

```sql
SELECT
  to_regclass('searchad_verification_evidence')::text AS evidence,
  to_regclass('searchad_activation_grants')::text AS activations,
  to_regclass('searchad_canary_accounts')::text AS accounts,
  to_regclass('searchad_account_state_events')::text AS account_events;
```

Create the fingerprint resolver from `credentialFingerprintForCustomer()` and gateway context from pinned registry status. Do not create evidence if the runtime is not ready.

- [ ] **Step 4: Wire bootstrap/readiness/close**

`bootstrap-v05.js` initializes activation after the SearchAd gateway, independent of whether Active Canary is enabled. `server-v05.js` reports only readiness/count metadata, never keys or fingerprints, and closes the runtime pool.

- [ ] **Step 5: Run GREEN and commit**

Run:
```bash
node --test test/searchad-activation-runtime.test.js test/searchad-active-canary-bootstrap.test.js
```
Expected: PASS.

Commit message:
```text
feat: bootstrap SearchAd activation runtime
```

---

### Task 6: Enforce Activation in Normal Write Execution and Bind Principal Actors

**Files:**
- Modify: `src/naver/searchad/write/execution-service.js`
- Modify: `src/naver/searchad/write/runtime-production.js`
- Modify: `src/http/searchad-write-runtime.js`
- Modify: `src/http/routes-searchad-write-v3.js`
- Test: `test/searchad-write-activation.test.js`
- Test: `test/searchad-write-access.test.js`

**Interfaces:**
- `SearchAdExecutionService` constructor gains optional `activationGuard` but production runtime requires it before writes can proceed.
- `getSearchAdWriteRuntime(context)` injects `app.searchAdActivationRuntime?.guard`.

- [ ] **Step 1: Write RED proving missing activation does not consume approval**

Prepare an approved plan and one-time token. With `allowWrites=true` but guard rejection, call execute twice after adding a valid grant. The first rejected call must not consume the token; the second valid call must use the same token exactly once.

Critical ordering assertion: activation guard executes after drift read but before:

```js
this.approvalService.claim(planId, input.executionToken);
```

and before `remote.mutate()`.

- [ ] **Step 2: Write suspended-account/reconcile RED**

When suspended:
- `execute()` rejects before token claim/mutation.
- `reconcile()` still performs read-only remote read and completes its existing classification.

- [ ] **Step 3: Implement guard injection and execution check**

In `execute()`:

```js
if (!this.activationGuard) {
  throw new SearchAdWriteError('SEARCHAD_ACTIVATION_GUARD_NOT_READY', 'SearchAd activation guard is required for writes.', {}, 503);
}
await this.activationGuard.assertMutationAllowed({
  customerId: plan.customer_id,
  descriptor: plan.mutation_json
});
this.approvalService.claim(planId, input.executionToken);
```

Do not add this requirement to read-only `reconcile()`.

- [ ] **Step 4: Upgrade legacy write HTTP routes to SearchAd roles**

Route metadata:
- GET status/list/get: `searchAdRole:'reader'`
- POST plan: `searchAdRole:'operator'`
- approve/execute/reconcile/rollback: `searchAdRole:'executor'`

For every plan-specific route, load the plan first and if its `customer_id` is outside `principal.customerIds`, return 404. For plan creation, reject/ignore body `createdBy` and pass `actor: principal.principalId`. For approval, replace body actor with `principal.principalId` and reject a conflicting supplied actor.

- [ ] **Step 5: Run focused write/access tests and commit**

Run:
```bash
node --test test/searchad-write-activation.test.js test/searchad-write-access.test.js test/searchad-write-*.test.js
```
Expected: focused tests PASS and existing write regression remains PASS after fixtures are updated to SearchAd role keys.

Commit message:
```text
feat: require activation before SearchAd write execution
```

---

### Task 7: Add Trusted Evidence / Activation / Account HTTP APIs

**Files:**
- Create: `src/http/routes-searchad-activation.js`
- Create: `src/http/openapi-searchad-activation.js`
- Modify: `src/http/server-v05.js`
- Test: `test/searchad-http-activation.test.js`

**Interfaces:**
- Operator+: `POST /api/v1/searchad/capabilities/passive-evidence`
- Reader+: evidence/grant/account control-status reads
- Admin: `POST /api/v1/searchad/activations`, account suspend/resume

- [ ] **Step 1: Write HTTP RED matrix**

Assert:
- Reader cannot issue evidence.
- Operator can issue evidence only for a granted Customer.
- Admin activation body with anything besides `evidenceId` returns 400.
- cross-Customer evidence/grant get returns 404.
- Admin suspend/resume acts only on granted Customer.
- response JSON contains no `credentialFingerprint`, `secret`, `accessLicense`, `signature`, or raw role key.

- [ ] **Step 2: Run RED**

Run:
```bash
node --test test/searchad-http-activation.test.js
```
Expected: route not found/missing module failures.

- [ ] **Step 3: Implement routes with principal-only actor identity**

Public evidence projection may include:

```js
{
  evidenceId,
  evidenceType,
  customerId,
  operationKeys,
  fieldScope,
  result,
  createdAt,
  expiresAt,
  details
}
```

It must omit credential fingerprint even though the durable row contains it.

- [ ] **Step 4: Add role-specific OpenAPI**

Generate surfaces from the same role rank:
- Reader: read paths only.
- Operator: adds passive-evidence issue.
- Executor: same as Operator for this subsystem.
- Admin: adds activation and suspend/resume.

- [ ] **Step 5: Run HTTP GREEN and commit**

Run:
```bash
node --test test/searchad-http-activation.test.js test/searchad-http-access.test.js test/searchad-http-canary-server.test.js
```
Expected: PASS.

Commit message:
```text
feat: expose role scoped SearchAd activation APIs
```

---

### Task 8: Final Issue #16 Regression and Evidence

**Files:**
- Modify: `.github/workflows/searchad-active-canary-ci.yml`
- Modify only if needed for test registration: `package.json`

**Interfaces:**
- CI becomes the fresh evidence for closing Issue #16; old 247-test history is not reused.

- [ ] **Step 1: Extend CI paths and jobs**

Include `src/naver/searchad/activation/**`, migration 0008, activation HTTP files, and new tests. PostgreSQL job runs both Active Canary and activation integration suites.

- [ ] **Step 2: Run focused contract suite**

Run:
```bash
node --test \
  test/searchad-passive-evidence.test.js \
  test/searchad-activation-*.test.js \
  test/searchad-account-control.test.js \
  test/searchad-write-activation.test.js \
  test/searchad-write-access.test.js \
  test/searchad-http-activation.test.js
```
Expected: all PASS.

- [ ] **Step 3: Run PostgreSQL integration**

Run:
```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" node --test \
  test/postgres-searchad-active-canary.integration.test.js \
  test/postgres-searchad-activation.integration.test.js
```
Expected: all PASS and migrations through 0008 repeat cleanly.

- [ ] **Step 4: Run existing regressions and syntax/safety checks**

Run:
```bash
node --test test/searchad-active-canary-*.test.js test/searchad-gateway-active-canary.test.js test/searchad-http-*.test.js
node --test test/searchad-write-*.test.js
node --check src/bootstrap-v05.js
node --check src/http/server-v05.js
node --check src/naver/searchad/activation/runtime-production.js
```
Expected: zero failures.

- [ ] **Step 5: Verify no live mutation configuration**

CI must not contain real SearchAd secrets. Confirm test gateways/fetch fixtures are used and generic write/create/delete production gates remain OFF by default.

- [ ] **Step 6: Close Issue #16 only from fresh final commit evidence**

Record exact commit SHA, workflow run ID, per-suite pass/fail/skip counts, migration repeat result, and real Naver mutation count `0` in Issue #16. Update Master Issue #23 checkbox and set the resume point to Issue #17.

Commit message:
```text
ci: verify SearchAd passive evidence activation layer
```
