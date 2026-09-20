# HAAR Meta Ads Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend HAAR Social Studio with Meta ad-account connection, read-only campaign/performance views, local ad drafts, immutable approval-gated spend actions, and a remote ChatGPT tool bridge that shares the same domain rules.

**Architecture:** Keep the current Node/Express/React/PostgreSQL monolith. Add a focused `server/meta/ads/` domain with one shared service layer used by browser routes and the remote tool bridge. Persist the long-lived Meta user credential separately from Page tokens, keep all new Meta objects paused until an approved execution reaches its final activation step, and store immutable approval payload hashes before any spend-impacting mutation.

**Tech Stack:** Node.js >=20.19, Express 5, PostgreSQL/pg, React 19, React Router 7, Zod 4, Vitest 3, existing AES-256-GCM secret encryption, Meta Graph/Marketing API v26.0, MCP/Apps SDK compatible Streamable HTTP bridge.

**Spec:** `docs/superpowers/specs/2026-09-16-haar-meta-ads-phase1-design.md`

## Global Constraints

- Existing Social Studio auth, publishing, products, media, analytics, audit logs, Hostinger deployment, and Meta Page/Instagram integration must stay working.
- Read access requires `ads_read`; write access requires `ads_management`; `business_management` is requested only when the live discovery path needs it.
- Never expose or log Meta access tokens, Meta app secrets, connector credentials, or raw sensitive provider payloads.
- Currency and timezone come from the selected Meta ad account; do not hard-code KRW/KST.
- Purchases, purchase value, and ROAS are displayed only when Meta returns compatible conversion measurements; missing metrics remain unavailable, never zero-filled or inferred.
- Creating/editing a local draft must never perform a Meta delivery/spend mutation.
- Launch, resume, pause/stop, budget changes, and deliverable schedule/targeting/objective/creative changes require a fresh explicit approval for the exact canonical payload.
- Approval is one-time, expiring, hash-bound, audited, and non-replayable.
- Partial/ambiguous Meta writes must reconcile before retry; no blind duplicate create.
- Automated CI and deployment smoke tests must never activate a real paid ad.
- Current ChatGPT Pro client limitation: custom MCP read/fetch is usable; direct custom-MCP write/modify actions must not be promised or bypassed. Server-side write tools may exist behind the same approval gate for future Business/Enterprise/Edu or later Pro support.
- Meta Marketing API list endpoints are paginated; clients must follow cursors with bounded page counts instead of silently truncating.
- Campaign hierarchy creation must start paused/non-delivering and activate only after the full approved hierarchy is persisted and verified.

## Review Focus

- **Ad-account currency with zero-decimal vs two-decimal behavior:** budget conversion must be explicit and round-trip safe; tests pin KRW and USD examples to the account minor-unit exponent.
- **Duplicate/replayed execution after a network timeout:** execution must reconcile by stored external IDs/idempotency metadata and refuse blind recreation.
- **Partially granted OAuth scopes:** Page/Instagram publishing may remain healthy while Ads is read-only or disconnected; UI/API must show capabilities separately.
- **Insights payloads with missing or duplicate action rows:** purchase/ROAS normalization must return unavailable rather than double-count or invent a value.
- **Draft modified after approval:** any material field change must invalidate the previous payload hash and require a new action request before Meta is contacted.

---

### Task 1: Ads schema and deterministic domain primitives

**Files:**
- Modify: `social-studio/server/schema.sql`
- Create: `social-studio/server/meta/ads/money.js`
- Create: `social-studio/server/meta/ads/canonical.js`
- Test: `social-studio/test/meta-ads-money.test.js`
- Test: `social-studio/test/meta-ads-canonical.test.js`

**Interfaces:**
- Produces: `currencyExponent(currency: string): number`
- Produces: `toMinorUnits(amount: string|number, currency: string): number`
- Produces: `fromMinorUnits(amountMinor: number, currency: string): number`
- Produces: `canonicalize(value: unknown): string`
- Produces: `payloadHash(value: unknown): string`
- Produces DB tables: `meta_ad_connections`, `meta_ad_accounts`, `meta_ad_drafts`, `meta_ad_action_requests`, `meta_ad_insight_snapshots`

- [ ] **Step 1: Write failing money/hash tests**

```js
import { describe, expect, it } from 'vitest';
import { toMinorUnits, fromMinorUnits } from '../server/meta/ads/money.js';
import { canonicalize, payloadHash } from '../server/meta/ads/canonical.js';

describe('Meta ads money', () => {
  it('keeps KRW as zero-decimal minor units', () => {
    expect(toMinorUnits(20000, 'KRW')).toBe(20000);
    expect(fromMinorUnits(20000, 'KRW')).toBe(20000);
  });

  it('converts USD to cents without float drift', () => {
    expect(toMinorUnits('19.99', 'USD')).toBe(1999);
    expect(fromMinorUnits(1999, 'USD')).toBe(19.99);
  });
});

describe('approval payload canonicalization', () => {
  it('hashes equivalent object key order identically', () => {
    expect(payloadHash({ b: 2, a: 1 })).toBe(payloadHash({ a: 1, b: 2 }));
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-money.test.js meta-ads-canonical.test.js
```

Expected: FAIL because `server/meta/ads/money.js` and `canonical.js` do not exist.

- [ ] **Step 3: Add schema and minimal primitives**

Add tables with foreign keys to existing `users`, `products`, and `post_variants`. Use partial unique index to enforce at most one selected ad account.

```sql
CREATE TABLE IF NOT EXISTS meta_ad_connections (
  id TEXT PRIMARY KEY,
  facebook_user_id TEXT,
  access_token_encrypted TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'connected',
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id TEXT PRIMARY KEY,
  external_account_id TEXT NOT NULL UNIQUE,
  name TEXT,
  currency TEXT NOT NULL,
  timezone_name TEXT,
  account_status INTEGER,
  business_id TEXT,
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_ad_accounts_one_selected
  ON meta_ad_accounts ((selected)) WHERE selected = TRUE;

CREATE TABLE IF NOT EXISTS meta_ad_drafts (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  post_variant_id TEXT REFERENCES post_variants(id) ON DELETE SET NULL,
  media_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  campaign_name TEXT NOT NULL,
  objective TEXT NOT NULL,
  landing_url TEXT,
  call_to_action TEXT,
  primary_text TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  audience JSONB NOT NULL DEFAULT '{}'::jsonb,
  placements JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  budget_type TEXT NOT NULL,
  budget_amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL,
  tracking JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  external_campaign_id TEXT,
  external_adset_id TEXT,
  external_creative_id TEXT,
  external_ad_id TEXT,
  last_error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_ad_action_requests (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_local_id TEXT,
  target_external_id TEXT,
  canonical_payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  summary JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  external_response JSONB,
  sanitized_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meta_ad_insight_snapshots (
  id TEXT PRIMARY KEY,
  external_account_id TEXT NOT NULL,
  level TEXT NOT NULL,
  external_object_id TEXT,
  date_start DATE NOT NULL,
  date_stop DATE NOT NULL,
  spend_minor BIGINT,
  impressions BIGINT,
  reach BIGINT,
  clicks BIGINT,
  ctr NUMERIC(18,6),
  cpc_minor BIGINT,
  cpm_minor BIGINT,
  purchases NUMERIC(18,4),
  purchase_value_minor BIGINT,
  roas NUMERIC(18,6),
  raw_supported_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_error TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Implement deterministic sort/canonical JSON and SHA-256 with Node crypto. Currency exponent map starts with zero-decimal currencies needed for robust provider data (`KRW`, `JPY`) and defaults to 2.

- [ ] **Step 4: Run tests and full migration test path**

Run:
```bash
cd social-studio
npm test -- meta-ads-money.test.js meta-ads-canonical.test.js
npm run check:syntax
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/server/schema.sql social-studio/server/meta/ads/money.js social-studio/server/meta/ads/canonical.js social-studio/test/meta-ads-money.test.js social-studio/test/meta-ads-canonical.test.js
git commit -m "feat(social): add Meta ads schema and approval primitives"
```

---

### Task 2: Preserve Meta user credential and discover/select ad accounts

**Files:**
- Modify: `social-studio/server/config.js`
- Modify: `social-studio/server/meta/oauth.js`
- Create: `social-studio/server/meta/ads/auth.js`
- Test: `social-studio/test/meta-ads-auth.test.js`

**Interfaces:**
- Consumes: existing `encryptSecret`, `decryptSecret`, `debugToken`, `graphGet`, `query`, `transaction`, `audit`
- Produces: `saveAdsUserCredential({ userAccessToken, tokenInfo, actorUserId }): Promise<void>`
- Produces: `discoverAdAccounts(actorUserId): Promise<{accounts: AdAccountSummary[]}>`
- Produces: `selectAdAccount(externalAccountId, actorUserId): Promise<AdAccountSummary>`
- Produces: `adsConnectionStatus(): Promise<AdsConnectionStatus>`

- [ ] **Step 1: Write failing auth/account tests with injected Graph transport**

```js
it('keeps Page publishing healthy when ads scopes are only read-capable', async () => {
  const status = await adsConnectionStatusFixture({
    scopes: ['pages_show_list', 'pages_read_engagement', 'ads_read']
  });
  expect(status.readable).toBe(true);
  expect(status.writable).toBe(false);
  expect(status.missingWriteScopes).toContain('ads_management');
});

it('discovers and stores account currency/timezone from Meta', async () => {
  const result = await discoverAdAccountsFixture([
    { id: 'act_123', name: 'HAAR', currency: 'KRW', timezone_name: 'Asia/Seoul', account_status: 1 }
  ]);
  expect(result.accounts[0]).toMatchObject({ externalAccountId: 'act_123', currency: 'KRW' });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-auth.test.js
```

Expected: FAIL because `server/meta/ads/auth.js` does not exist.

- [ ] **Step 3: Implement credential persistence and discovery**

Change default scopes to include the ads permissions while preserving existing publishing scopes:

```js
'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,ads_read,ads_management'
```

Do **not** add `business_management` by default; surface it as conditionally missing only if discovery returns a provider error that requires that path.

In `finishMetaOAuth()`, persist the long-lived **user** token separately before Page selection, encrypted with `encryptSecret`. Store token-debug scopes/expiry. Ad-account discovery calls:

```js
graphGet('/me/adaccounts', userAccessToken, {
  fields: 'id,name,currency,timezone_name,account_status,business{id,name}',
  limit: 100
});
```

Normalize `act_...` IDs exactly once and upsert into `meta_ad_accounts`.

- [ ] **Step 4: Run focused and regression tests**

Run:
```bash
cd social-studio
npm test -- meta-ads-auth.test.js
npm test
npm run check:syntax
```

Expected: all PASS; existing Meta/Page tests (if present later) and password/security tests remain green.

- [ ] **Step 5: Commit**

```bash
git add social-studio/server/config.js social-studio/server/meta/oauth.js social-studio/server/meta/ads/auth.js social-studio/test/meta-ads-auth.test.js
git commit -m "feat(social): connect Meta advertising identity and ad accounts"
```

---

### Task 3: Marketing API read client with bounded pagination

**Files:**
- Create: `social-studio/server/meta/ads/client.js`
- Test: `social-studio/test/meta-ads-client.test.js`

**Interfaces:**
- Consumes: `graphGet`, `graphPost`
- Produces: `normalizeActId(id: string): string`
- Produces: `listPaged(path, token, params, { maxPages = 10 }): Promise<any[]>`
- Produces: `listCampaignHierarchy({ accountId, accessToken }): Promise<{campaigns, adsets, ads}>`
- Produces: `getTrackingSources({ accountId, accessToken }): Promise<{pixels: any[]}>`

- [ ] **Step 1: Write failing pagination/hierarchy tests**

```js
it('follows Meta paging cursors but stops at maxPages', async () => {
  const pages = [
    { data: [{ id: '1' }], paging: { cursors: { after: 'A' }, next: 'x' } },
    { data: [{ id: '2' }] }
  ];
  expect((await listPagedFixture(pages)).map(x => x.id)).toEqual(['1', '2']);
});

it('normalizes bare and act_ account IDs to act_', () => {
  expect(normalizeActId('123')).toBe('act_123');
  expect(normalizeActId('act_123')).toBe('act_123');
});
```

- [ ] **Step 2: Run and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-client.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement client**

Use explicit field lists instead of `fields=*`. Campaign hierarchy fields:

```js
const campaignFields = 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time,updated_time';
const adsetFields = 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal,billing_event,targeting';
const adFields = 'id,name,adset_id,campaign_id,status,effective_status,creative{id,name},updated_time';
```

Pagination must use Meta cursors, not arbitrary `paging.next` host URLs, and must cap pages to prevent unbounded provider loops.

- [ ] **Step 4: Run tests**

Run:
```bash
cd social-studio
npm test -- meta-ads-client.test.js
npm run check:syntax
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/server/meta/ads/client.js social-studio/test/meta-ads-client.test.js
git commit -m "feat(social): add paginated Meta Marketing API reader"
```

---

### Task 4: Ads insights normalization and history

**Files:**
- Create: `social-studio/server/meta/ads/insights.js`
- Test: `social-studio/test/meta-ads-insights.test.js`

**Interfaces:**
- Consumes: selected ad account, encrypted ads credential, `listPaged`, money helpers, `query`, `audit`
- Produces: `normalizeInsightsRow(row, currency): NormalizedAdInsight`
- Produces: `syncAdsInsights({ level, since, until, actorUserId }): Promise<NormalizedAdInsight[]>`
- Produces: `listLatestAdsInsights({ level, since, until }): Promise<NormalizedAdInsight[]>`

- [ ] **Step 1: Write failing metrics tests**

```js
it('leaves purchase metrics unavailable when Meta does not return purchase actions', () => {
  const row = normalizeInsightsRow({
    spend: '12000',
    impressions: '1000',
    clicks: '20',
    ctr: '2',
    cpc: '600',
    cpm: '12000',
    actions: []
  }, 'KRW');
  expect(row.purchases).toBeNull();
  expect(row.purchaseValueMinor).toBeNull();
  expect(row.roas).toBeNull();
});

it('does not double count duplicate non-purchase action rows', () => {
  const row = normalizeInsightsRow({
    spend: '1000',
    actions: [{ action_type: 'link_click', value: '10' }, { action_type: 'purchase', value: '2' }],
    action_values: [{ action_type: 'purchase', value: '5000' }],
    purchase_roas: [{ action_type: 'omni_purchase', value: '5' }]
  }, 'KRW');
  expect(row.purchases).toBe(2);
  expect(row.purchaseValueMinor).toBe(5000);
});
```

- [ ] **Step 2: Run and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-insights.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement Insights API normalization**

Request only supported fields:

```js
const fields = [
  'account_id','campaign_id','campaign_name','adset_id','adset_name','ad_id','ad_name',
  'date_start','date_stop','spend','impressions','reach','clicks','ctr','cpc','cpm',
  'actions','action_values','purchase_roas'
].join(',');
```

Accept `level` only from `account|campaign|adset|ad`. Parse action arrays by explicit purchase action type allowlist; if ambiguous/multiple incompatible purchase rows exist, store raw rows and set normalized purchase fields to null with a sync warning instead of guessing.

Persist one snapshot row per returned insight row/date range.

- [ ] **Step 4: Run tests and regression**

Run:
```bash
cd social-studio
npm test -- meta-ads-insights.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/server/meta/ads/insights.js social-studio/test/meta-ads-insights.test.js
git commit -m "feat(social): sync Meta ads insights without synthetic ROAS"
```

---

### Task 5: Local ad drafts and launch validation

**Files:**
- Create: `social-studio/server/meta/ads/drafts.js`
- Test: `social-studio/test/meta-ads-drafts.test.js`

**Interfaces:**
- Consumes: selected ad account, `products`, `media_assets`, `post_variants`, money helpers, tracking-source client
- Produces: `createAdDraft(input, actorUserId): Promise<AdDraft>`
- Produces: `updateAdDraft(id, input, actorUserId): Promise<AdDraft>`
- Produces: `listAdDrafts(): Promise<AdDraft[]>`
- Produces: `getAdDraft(id): Promise<AdDraft>`
- Produces: `validateDraftForLaunch(draft, context): Promise<{ok:boolean, errors:string[], summary:object}>`

- [ ] **Step 1: Write failing draft tests**

```js
it('creates a local draft without any Meta write call', async () => {
  const graphPost = vi.fn();
  const draft = await createDraftFixture({ graphPost, objective: 'TRAFFIC', budgetAmount: 20000 });
  expect(draft.status).toBe('draft');
  expect(graphPost).not.toHaveBeenCalled();
});

it('defaults landing URL from the selected HAAR product', async () => {
  const draft = await createDraftFixture({ productUrl: 'https://haar.co.kr/product/x/1', landingUrl: '' });
  expect(draft.landingUrl).toBe('https://haar.co.kr/product/x/1');
});

it('blocks SALES when no compatible tracking source is discovered', async () => {
  const result = await validateLaunchFixture({ objective: 'SALES', pixels: [] });
  expect(result.ok).toBe(false);
  expect(result.errors).toContain('SALES_TRACKING_REQUIRED');
});
```

- [ ] **Step 2: Run and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-drafts.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement local-only drafts**

Supported Phase 1 objective enum:
```js
const OBJECTIVES = {
  TRAFFIC: 'OUTCOME_TRAFFIC',
  ENGAGEMENT: 'OUTCOME_ENGAGEMENT',
  SALES: 'OUTCOME_SALES'
};
```

Validate source types `media|post|upload`, non-empty creative, valid HTTP(S) landing URL, dates, budget type `daily|lifetime`, and selected account currency. Store audience/placements/tracking exactly as JSON; no silent targeting expansion.

- [ ] **Step 4: Run tests**

Run:
```bash
cd social-studio
npm test -- meta-ads-drafts.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/server/meta/ads/drafts.js social-studio/test/meta-ads-drafts.test.js
git commit -m "feat(social): add non-spending Meta ad drafts"
```

---

### Task 6: Immutable approval requests and replay-safe action executor

**Files:**
- Create: `social-studio/server/meta/ads/actions.js`
- Test: `social-studio/test/meta-ads-actions.test.js`

**Interfaces:**
- Consumes: canonical/hash helpers, draft validator, Marketing client, DB transaction/audit
- Produces: `prepareAdAction({ actionType, targetType, targetId, payload }, actorUserId): Promise<ActionRequest>`
- Produces: `approveAdAction(actionId, actorUserId): Promise<ActionRequest>`
- Produces: `executeApprovedAdAction(actionId, actorUserId): Promise<ActionExecutionResult>`
- Produces: `listAdActions(): Promise<ActionRequest[]>`

- [ ] **Step 1: Write failing approval/execution tests**

```js
it('refuses execution before approval and does not call Meta', async () => {
  const graphPost = vi.fn();
  await expect(executeFixture({ status: 'pending', graphPost })).rejects.toMatchObject({ code: 'AD_ACTION_NOT_APPROVED' });
  expect(graphPost).not.toHaveBeenCalled();
});

it('rejects an expired or replayed approval before Meta call', async () => {
  for (const status of ['expired', 'executed']) {
    const graphPost = vi.fn();
    await expect(executeFixture({ status, graphPost })).rejects.toBeTruthy();
    expect(graphPost).not.toHaveBeenCalled();
  }
});

it('rejects when current payload hash differs from approved payload', async () => {
  const graphPost = vi.fn();
  await expect(executeFixture({ approvedPayload: { budget: 20000 }, currentPayload: { budget: 30000 }, graphPost }))
    .rejects.toMatchObject({ code: 'AD_ACTION_PAYLOAD_CHANGED' });
  expect(graphPost).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-actions.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement exact approval gate and safe launch sequence**

Canonical action payload must include at least:
```js
{
  accountId,
  actionType,
  targetType,
  targetId,
  objective,
  budgetType,
  budgetAmountMinor,
  currency,
  startAt,
  endAt,
  audience,
  placements,
  creative,
  landingUrl
}
```

Launch execution sequence:
1. Re-read action row `FOR UPDATE`.
2. Verify `status=approved`, expiry, unused state, and current canonical payload hash.
3. Verify live ads scopes and selected account.
4. Create campaign with `status: 'PAUSED'`.
5. Persist returned campaign ID immediately.
6. Create ad set paused; persist ID.
7. Create creative; persist ID.
8. Create ad paused; persist ID.
9. Re-read created hierarchy.
10. Only then apply activation statuses required by the approved request.
11. Mark action executed once and audit.

If any create returns an external ID but local persistence fails, retain/recover that ID before any retry. If provider result is ambiguous, set action `verification_required` and do not auto-retry.

Pause/resume/budget updates each use a separate fresh action request.

- [ ] **Step 4: Run tests including partial failure/reconciliation**

Add tests proving:
- partial create leaves hierarchy paused;
- duplicate client/action request does not duplicate Meta objects;
- timeout/ambiguous response produces `verification_required`;
- pause/resume/change-budget each need their own approval.

Run:
```bash
cd social-studio
npm test -- meta-ads-actions.test.js
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/server/meta/ads/actions.js social-studio/test/meta-ads-actions.test.js
git commit -m "feat(social): gate Meta ad mutations behind immutable approval"
```

---

### Task 7: Ads HTTP API with shared domain services

**Files:**
- Create: `social-studio/server/meta/ads/routes.js`
- Modify: `social-studio/server/index.js`
- Test: `social-studio/test/meta-ads-routes.test.js`

**Interfaces:**
- Consumes: auth/session/CSRF middleware and Tasks 2-6 domain functions
- Produces browser endpoints:
  - `GET /api/meta/ads/status`
  - `GET /api/meta/ads/accounts`
  - `POST /api/meta/ads/accounts/:id/select`
  - `POST /api/meta/ads/test`
  - `GET /api/meta/ads/campaigns`
  - `GET /api/meta/ads/insights`
  - `GET /api/meta/ads/drafts`
  - `POST /api/meta/ads/drafts`
  - `PUT /api/meta/ads/drafts/:id`
  - `POST /api/meta/ads/drafts/:id/request-launch`
  - `GET /api/meta/ads/actions`
  - `POST /api/meta/ads/actions/:id/approve`
  - `POST /api/meta/ads/actions/:id/execute`

- [ ] **Step 1: Write failing route security tests**

```js
it('requires auth for ads reads', async () => {
  expect((await request('/api/meta/ads/status')).status).toBe(401);
});

it('requires CSRF for draft/action mutations', async () => {
  expect((await authenticatedRequest('/api/meta/ads/drafts', { method: 'POST', csrf: false })).status).toBe(403);
});

it('cannot execute a pending action via route', async () => {
  const response = await authenticatedRequest('/api/meta/ads/actions/action-1/execute', { method: 'POST', csrf: true });
  expect(response.status).toBe(409);
});
```

- [ ] **Step 2: Run and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-routes.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement isolated ads router**

Do not add another several-hundred-line block to existing `server/routes.js`. Mount focused router in `server/index.js`:

```js
import metaAdsRoutes from './meta/ads/routes.js';
// after optionalAuth and password routes
app.use(metaAdsRoutes);
app.use(routes);
```

Use Zod request schemas at the route boundary; domain modules remain callable by the future tool bridge without HTTP recursion.

- [ ] **Step 4: Run route/full tests and syntax/build**

Run:
```bash
cd social-studio
npm test -- meta-ads-routes.test.js
npm test
npm run check:syntax
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/server/meta/ads/routes.js social-studio/server/index.js social-studio/test/meta-ads-routes.test.js
git commit -m "feat(social): expose approval-gated Meta ads API"
```

---

### Task 8: Ads UI and ad-account connection block

**Files:**
- Create: `social-studio/src/pages/AdsPage.jsx`
- Modify: `social-studio/src/pages/AccountsPage.jsx`
- Modify: `social-studio/src/App.jsx`
- Modify: `social-studio/src/components/AppShell.jsx`
- Modify: `social-studio/src/styles/04-haar.css`
- Test: `social-studio/test/meta-ads-ui-contract.test.js`

**Interfaces:**
- Consumes: Task 7 HTTP endpoints through existing `api()`
- Produces route: `/ads`
- Produces nav label: `광고 관리`
- Produces UI tabs: Overview, Campaigns, Drafts, Approvals

- [ ] **Step 1: Write failing UI contract test**

Use source-level contract assertions because the project currently has no React DOM test harness:

```js
it('registers /ads and approval-only execution controls', async () => {
  const app = await fs.readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const ads = await fs.readFile(new URL('../src/pages/AdsPage.jsx', import.meta.url), 'utf8');
  expect(app).toContain('path="/ads"');
  expect(ads).toContain('승인 요청');
  expect(ads).toContain('/api/meta/ads/actions/');
  expect(ads).not.toContain('바로 집행');
});
```

- [ ] **Step 2: Run and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-ui-contract.test.js
```

Expected: FAIL because AdsPage does not exist.

- [ ] **Step 3: Implement Ads page**

Overview shows:
- selected account name/currency/timezone/status;
- spend/impressions/clicks/CTR/CPC/CPM;
- purchases/value/ROAS only when non-null;
- last sync and permission/tracking warnings.

Campaigns shows campaign → ad set → ad with effective status and budget.

Drafts form must show source product/media/post, destination, objective, dates, budget and effective account currency. Launch button text is `승인 요청`, not `게시/집행`.

Approvals tab shows exact summary, expiry, hash-short-id, status, and two separate actions:
- `승인`
- `승인된 작업 실행`

No direct Meta mutation control may bypass an action request.

Accounts page adds ad-account permission/read/write status, discovery list, and selected account control.

- [ ] **Step 4: Run test/build**

Run:
```bash
cd social-studio
npm test -- meta-ads-ui-contract.test.js
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/src/pages/AdsPage.jsx social-studio/src/pages/AccountsPage.jsx social-studio/src/App.jsx social-studio/src/components/AppShell.jsx social-studio/src/styles/04-haar.css social-studio/test/meta-ads-ui-contract.test.js
git commit -m "feat(social): add HAAR Meta ads console"
```

---

### Task 9: Remote ChatGPT/MCP bridge sharing the same policy layer

**Files:**
- Modify: `social-studio/package.json`
- Create: `social-studio/server/tool-auth.js`
- Create: `social-studio/server/mcp.js`
- Modify: `social-studio/server/index.js`
- Modify: `social-studio/.env.example`
- Modify: `social-studio/.env.docker.example`
- Test: `social-studio/test/meta-ads-mcp.test.js`

**Interfaces:**
- Consumes: Tasks 2-6 domain functions directly; never calls browser routes
- Produces remote Streamable HTTP MCP endpoint: `/mcp`
- Produces initial read tools:
  - `haar_ads_status`
  - `haar_ads_accounts`
  - `haar_ads_campaigns`
  - `haar_ads_insights`
  - `haar_ads_pending_actions`
- Produces server-side write tools behind the identical approval policy for future client availability:
  - `haar_ads_create_draft`
  - `haar_ads_update_draft`
  - `haar_ads_prepare_action`
  - `haar_ads_approve_action`
  - `haar_ads_execute_approved_action`

- [ ] **Step 1: Write failing bridge/auth tests**

```js
it('rejects unauthenticated MCP requests', async () => {
  const response = await mcpRequest({ authorization: '' });
  expect(response.status).toBe(401);
});

it('never returns connector or Meta secrets', async () => {
  const result = await callTool('haar_ads_status', {});
  const text = JSON.stringify(result);
  expect(text).not.toContain('access_token');
  expect(text).not.toContain('app_secret');
  expect(text).not.toContain(process.env.HAAR_TOOL_BEARER_TOKEN || '__unset__');
});

it('cannot execute a non-approved action through the tool layer', async () => {
  await expect(callTool('haar_ads_execute_approved_action', { actionId: 'pending-id' }))
    .rejects.toMatchObject({ code: 'AD_ACTION_NOT_APPROVED' });
});
```

- [ ] **Step 2: Run and verify RED**

Run:
```bash
cd social-studio
npm test -- meta-ads-mcp.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add MCP dependency and implementation**

Install the official MCP JS SDK and mount a Streamable HTTP transport under `/mcp`:

```bash
cd social-studio
npm install @modelcontextprotocol/sdk
```

Use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` and `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`. Commit the exact resolved version in `package-lock.json`.

Use a dedicated bearer credential:
```dotenv
HAAR_TOOL_BEARER_TOKEN=<32+ byte random secret>
```

`tool-auth.js` compares bearer tokens with constant-time semantics and never logs the supplied token.

Every tool handler calls the same domain function as the browser route. No tool may contain direct `graphPost()` calls.

**Current Pro behavior:** follow OpenAI's current developer-mode limitation documented at `https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt`: expose/read-test the read/fetch-compatible tools in ChatGPT developer mode. Do not claim that Pro can invoke custom MCP write tools. Keep server-side write tool definitions tested and disabled/not relied on for the current Pro client; the browser UI remains the supported write path until the client/plan supports full MCP writes.

- [ ] **Step 4: Run bridge/full tests**

Run:
```bash
cd social-studio
npm test -- meta-ads-mcp.test.js
npm test
npm run check:syntax
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add social-studio/package.json social-studio/package-lock.json social-studio/server/tool-auth.js social-studio/server/mcp.js social-studio/server/index.js social-studio/.env.example social-studio/.env.docker.example social-studio/test/meta-ads-mcp.test.js
git commit -m "feat(social): expose Meta ads domain through secure MCP bridge"
```

---

### Task 10: Setup docs, Meta reauthorization, CI, and read-only production rollout

**Files:**
- Modify: `social-studio/docs/META_SETUP_KO.md`
- Modify: `social-studio/README.md`
- Modify: `.github/workflows/social-studio-ci.yml`
- Modify: `.github/workflows/social-studio-hostinger-deploy.yml`
- Create: `social-studio/test/meta-ads-schema-contract.test.js`

**Interfaces:**
- Consumes: all prior tasks
- Produces: documented OAuth scope upgrade/reconnect procedure, deployment env setup, CI proof, production read-only smoke path
- Does **not** launch a paid ad

- [ ] **Step 1: Add failing schema/config contract test**

```js
it('ships all Phase 1 tables and ads scopes', async () => {
  const schema = await fs.readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  const config = await fs.readFile(new URL('../server/config.js', import.meta.url), 'utf8');
  for (const table of ['meta_ad_connections','meta_ad_accounts','meta_ad_drafts','meta_ad_action_requests','meta_ad_insight_snapshots']) {
    expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
  }
  expect(config).toContain('ads_read');
  expect(config).toContain('ads_management');
});
```

- [ ] **Step 2: Run and verify expected state, then update CI/deploy**

Run:
```bash
cd social-studio
npm test -- meta-ads-schema-contract.test.js
```

Expected: PASS only after prior tasks exist. Then add the test to the standard CI suite (the existing `npm test` already discovers it) and extend deployment validation to require `HAAR_TOOL_BEARER_TOKEN` only when MCP is enabled.

Do not print the bearer token or Meta secrets in Actions logs.

- [ ] **Step 3: Update operational documentation**

Document:
- Meta App needs ads capability/Marketing API product as applicable in current dashboard.
- Reconnect OAuth so the user token actually grants `ads_read` and `ads_management`.
- Existing Page/Instagram permissions remain listed.
- Ads connection can be read-only while publishing remains connected.
- Select one HAAR ad account after reconnect.
- Purchase/ROAS requires a compatible tracking source; otherwise UI shows unavailable.
- ChatGPT Pro currently supports custom MCP read/fetch but not full custom write/modify; web UI remains the supported write path.
- No CI test ever activates paid delivery.

- [ ] **Step 4: Run complete local verification**

Run:
```bash
cd social-studio
npm ci
npm test
npm run check:syntax
npm run build
cd ..
python -m unittest social-studio/test/test_ensure_caddy_route.py
```

Expected: 0 failures and build exit 0.

- [ ] **Step 5: Commit**

```bash
git add social-studio/docs/META_SETUP_KO.md social-studio/README.md .github/workflows/social-studio-ci.yml .github/workflows/social-studio-hostinger-deploy.yml social-studio/test/meta-ads-schema-contract.test.js
git commit -m "docs(social): document and verify Meta ads Phase 1 rollout"
```

---

### Task 11: Production verification without paid delivery

**Files:**
- No product-code changes unless verification exposes a defect.
- Update if needed: `social-studio/docs/DEPLOYMENT_STATUS.md`

**Interfaces:**
- Consumes: deployed Phase 1 build, Meta reauthorization by the user, selected HAAR ad account
- Produces: evidence that production can read ads state and create a local non-spending draft; no paid delivery

- [ ] **Step 1: Deploy the feature branch through the existing Hostinger path**

Use the existing deployment workflow for `social-studio`. Verify schema migration is idempotent and app/database health remain `ok`.

- [ ] **Step 2: Re-authorize Meta and select the real HAAR ad account**

In production Accounts:
1. reconnect Meta OAuth;
2. verify granted scopes contain `ads_read` and `ads_management` if Meta/app access permits them;
3. discover accounts;
4. select the intended HAAR account;
5. verify currency/timezone/account status shown by the app match Meta.

If write scope is not granted, continue read-only rollout and report the missing permission; do not fake writable status.

- [ ] **Step 3: Verify live read-only hierarchy and insights**

Exercise:
```text
GET /api/meta/ads/status
GET /api/meta/ads/accounts
GET /api/meta/ads/campaigns
GET /api/meta/ads/insights?level=campaign&since=<date>&until=<date>
```

Expected: authenticated production responses, no tokens, no synthetic metrics.

- [ ] **Step 4: Verify a local draft creates no paid Meta object**

Create one HAAR test draft with a known product/media/link and a tiny illustrative budget. Before and after, re-fetch live campaign hierarchy.

Expected:
- local draft exists;
- no new Meta campaign/ad set/ad was created;
- no spend-impacting action executes;
- approval request summary shows exact account/currency/schedule/budget/creative/destination.

Delete/cancel the local draft if the UI supports it; otherwise leave it clearly named as a non-live test draft.

- [ ] **Step 5: Verify current ChatGPT connection capability**

On the user's current Pro plan:
- connect/scan the custom remote app if the UI permits;
- verify one read-only tool call such as `haar_ads_status`;
- do not claim custom MCP write execution support on Pro;
- if the ChatGPT client refuses write tools, record that as expected product-plan behavior, not an app defect.

- [ ] **Step 6: Record evidence and commit only documentation changes**

Update deployment status with date, deployed SHA, health result, ad-account read status, insights read status, local-draft non-spend result, and ChatGPT read-tool status.

```bash
git add social-studio/docs/DEPLOYMENT_STATUS.md
git commit -m "docs(social): record Meta ads Phase 1 production verification"
```

**Stop condition:** do not launch the first paid HAAR ad as part of this plan. A live launch is a separate user-approved operation after the implementation and read-only production verification are complete.
