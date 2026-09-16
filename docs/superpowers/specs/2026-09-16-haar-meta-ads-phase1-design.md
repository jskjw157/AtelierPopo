# HAAR Social Studio — Meta Ads Phase 1 Design

Date: 2026-09-16
Status: Approved scope, design for implementation planning
Branch: `feat/haar-meta-ads-phase1`

## 1. Context

HAAR Social Studio already manages HAAR products, uploaded media, Facebook/Instagram publishing, scheduling, post analytics, audit logs, and a Meta OAuth connection. The current Meta OAuth flow persists Page and Instagram credentials but does not preserve a Marketing API user credential or an advertising account. The UI has no Ads area.

The goal of Phase 1 is to extend the same application into a small HAAR Meta Ads console rather than build a separate service.

User-approved scope:

- Connect/select a Meta ad account.
- Read current campaigns, ad sets, ads, and performance.
- Create local ad drafts using HAAR products, media, or an existing published post as source material.
- Require explicit approval before every action that can change spend or delivery.
- After approval, create/activate, pause/resume, or change budgets.
- Do not add automatic optimization in Phase 1.

## 2. Alternatives considered

### A. Extend the existing Social Studio — selected

Add a Marketing API module, ads database tables, Ads UI, and guarded mutation endpoints to the current Node/React/PostgreSQL application.

Advantages: reuses products/media/posts, existing encrypted secret storage, audit trail, authentication, deployment, and Meta connection. Lowest operational complexity.

### B. Separate ads microservice

Would isolate advertising credentials and logic, but duplicates authentication, deployment, database coordination, and UI integration. Not justified for HAAR's current single-brand/single-owner scale.

### C. Browser automation of Meta Ads Manager

Rejected. It is brittle, difficult to make idempotent, and unnecessary because Meta exposes programmatic advertising APIs.

## 3. Architecture

### 3.1 Existing pieces retained

- `server/meta/client.js`: low-level Graph GET/POST transport and sanitized API errors.
- `server/meta/oauth.js`: Meta OAuth entry point.
- `server/security.js`: encryption/decryption for stored credentials.
- `server/db.js` + PostgreSQL: persistence and transactions.
- `audit_logs`: all connection and advertising mutations remain auditable.
- Existing `products`, `media_assets`, `campaigns`, `post_variants`: source material for ads.
- Existing session + CSRF protection for browser-admin endpoints.

### 3.2 New backend modules

- `server/meta/ads/auth.js`
  - persist and validate the long-lived Meta user credential needed for advertising access;
  - discover accessible ad accounts;
  - select one HAAR ad account;
  - report granted/missing advertising scopes without exposing credentials.

- `server/meta/ads/client.js`
  - Marketing API domain wrapper over the existing Graph transport;
  - ad-account, campaign, ad-set, ad, creative, tracking source, and insights calls;
  - all monetary amounts normalized through account currency/minor units.

- `server/meta/ads/insights.js`
  - fetch and normalize spend, impressions, reach, clicks, CTR, CPC, CPM, purchase count/value, and ROAS when Meta supplies the necessary conversion data;
  - never fabricate purchase/ROAS values when tracking is unavailable.

- `server/meta/ads/drafts.js`
  - create/update local drafts only;
  - resolve product landing URL and selected HAAR media/post;
  - validate objective, budget, dates, targeting, creative, and conversion prerequisites.

- `server/meta/ads/actions.js`
  - prepare immutable approval requests;
  - execute approved create/activate, pause, resume, or budget-change operations exactly once;
  - reconcile partial/ambiguous Meta responses before retrying.

### 3.3 Frontend

Add `/ads` and a sidebar item `광고 관리`.

The page has four sections/tabs:

1. **Overview** — spend and performance summary, date filter, last sync, connection warnings.
2. **Campaigns** — Meta campaign/ad-set/ad hierarchy, delivery status, budgets, key metrics.
3. **Drafts** — local HAAR ad drafts and creative preview.
4. **Approvals** — pending/approved/executed/failed spend-impacting actions with exact budget and action summary.

The existing Account page gains an `광고 계정` block for permission status and ad-account selection.

## 4. Meta authentication and account selection

The existing OAuth flow currently exchanges a user token and then stores Page tokens. Phase 1 preserves the long-lived user credential separately, encrypted with the existing token encryption key. Page credentials continue to serve publishing; the user credential serves advertising APIs.

Advertising scope handling:

- require/read `ads_read` for account and performance reads;
- require `ads_management` before any advertising mutation;
- treat `business_management` as conditional: use it when the connected business/account discovery path requires it, rather than making unrelated business access a hidden assumption.

The app must show the exact granted and missing scopes returned by Meta. It must not report the ads connection as writable until a live read/write capability check succeeds.

Ad-account discovery is lazy after OAuth. The user selects one HAAR account. Persist account ID, name, currency, timezone, account status, and business identifier when available. Currency and timezone come from Meta and are not hard-coded to KRW/KST.

## 5. Data model

### `meta_ad_connections`

One active Meta advertising identity for the current single-owner app.

Important fields:

- `id`
- `facebook_user_id`
- `access_token_encrypted`
- `scopes` JSONB
- `token_expires_at`
- `status`
- `last_checked_at`
- timestamps

### `meta_ad_accounts`

Accessible accounts plus the selected HAAR account.

Important fields:

- local `id`
- `external_account_id`
- `name`
- `currency`
- `timezone_name`
- `account_status`
- `business_id`
- `selected`
- `last_synced_at`
- timestamps

Only one account is selected in Phase 1.

### `meta_ad_drafts`

A local, non-spending advertisement plan. Creating or editing this table does not call a Meta mutation endpoint.

Important fields:

- local `id`
- `client_request_id` unique/idempotent
- source type: HAAR media, published Social Studio post, or uploaded creative
- optional `product_id`, `post_variant_id`
- media IDs JSONB
- campaign name/objective
- landing URL/CTA/copy
- audience and placement JSONB
- start/end time
- budget type and amount in account minor units
- conversion/tracking configuration JSONB
- local status
- external campaign/ad-set/ad/creative IDs once executed
- last error
- creator/timestamps

### `meta_ad_action_requests`

One-time approval gate for spend-impacting mutations.

Important fields:

- `id`
- `action_type`: launch, pause, resume, change_budget
- target local/external IDs
- canonical payload JSONB
- SHA-256 `payload_hash`
- human-readable summary JSONB
- requested by/at
- approved by/at
- expiration
- executed at
- status
- external response IDs and sanitized error

Approval is valid only for the exact payload hash. Any changed budget, dates, targeting, objective, creative, or target ID invalidates the approval and requires a new approval.

### `meta_ad_insight_snapshots`

Store normalized time-bounded insights for audit/history.

Fields include date range/level plus spend, impressions, reach, clicks, CTR, CPC, CPM, purchases, purchase value, ROAS, raw supported metrics, sync error, and capture time.

## 6. Draft and creative flow

1. User or assistant selects a HAAR product, media/post, objective, budget, dates, audience, and destination.
2. Server creates a **local draft** only.
3. Draft validation resolves:
   - destination URL, defaulting to `products.product_url` when present;
   - creative source;
   - compatible objective;
   - account currency/timezone;
   - conversion prerequisites.
4. UI/assistant presents a fixed execution summary: account, objective, audience, placement mode, schedule, daily/lifetime budget, maximum expected spend for the scheduled period when calculable, destination, and creative.
5. User explicitly approves that exact summary.
6. Server creates Meta objects in a safe sequence. Until the full hierarchy is successfully created, objects remain non-delivering/paused.
7. The final activation step occurs only inside the same approved execution. If any prerequisite fails, the app leaves created objects paused and reports reconciliation details.

For existing Social Studio posts, use the original Meta post/media as an ad source when the Marketing API accepts that source. If it is incompatible with the chosen objective/placement, Phase 1 clones the approved media/copy into a new ad creative instead of silently failing or modifying the organic post.

## 7. Objectives and conversion tracking

Phase 1 exposes a small supported objective set rather than every Ads Manager option:

- Traffic
- Engagement
- Sales, only when a compatible Meta tracking source and required configuration are detected

Tracking sources are discovered from the selected ad account. If purchase tracking is missing, the UI disables Sales launch and explains the missing prerequisite. It must not show a synthetic ROAS.

Targeting and placement are stored explicitly in each draft. Phase 1 can offer broad/automatic placements as a default, but the final execution summary always shows the effective configuration before approval.

## 8. Read-only performance sync

Read operations never require a spend approval.

Support:

- account/campaign/ad-set/ad listing;
- common date ranges plus explicit start/end dates;
- normalized spend, impressions, reach, clicks, CTR, CPC, CPM;
- purchase count/value and ROAS only if Meta returns compatible conversion measurements;
- status and budget values from the live object rather than stale local assumptions.

A failed metric does not zero-fill the metric. It is stored/displayed as unavailable with a sync warning.

## 9. Spend-impacting approval policy

The following require explicit approval every time:

- launch/activate a new draft;
- resume an existing campaign/ad set/ad;
- pause/stop delivery;
- any daily or lifetime budget change;
- any schedule/targeting/objective/creative edit to a currently deliverable ad hierarchy.

The following are allowed without approval:

- connection/account discovery;
- performance reads;
- creating/editing a purely local draft;
- generating copy/creative suggestions;
- calculating projected maximum spend from the draft.

Approval records are one-time, expire, and cannot be replayed. Mutation endpoints are idempotent and audited.

## 10. Error and ambiguity handling

- Never log Meta access tokens, app secrets, or raw sensitive API payloads.
- Normalize Meta errors through existing sanitized error handling.
- Missing scopes: downgrade capability and show reconnect/re-authorize guidance.
- Expired credential: mark ads connection expired; do not attempt writes.
- Insufficient ad-account role: read/write capability displayed separately.
- Partial create: retain external IDs, keep all objects paused, and present reconciliation state.
- Ambiguous timeout after a create/update call: query Meta for the object/reconciliation key before any retry. Do not blindly create duplicates.
- Budget unit mismatch: reject before external call.
- Conversion metric unavailable: mark unavailable, never infer purchase or ROAS.

## 11. API surface

Browser-admin endpoints remain behind existing authenticated session + CSRF rules.

Representative endpoints:

- `GET /api/meta/ads/status`
- `GET /api/meta/ads/accounts`
- `POST /api/meta/ads/accounts/:id/select`
- `POST /api/meta/ads/test`
- `GET /api/meta/ads/campaigns`
- `GET /api/meta/ads/insights`
- `GET/POST/PUT /api/meta/ads/drafts...`
- `POST /api/meta/ads/drafts/:id/request-launch`
- `GET /api/meta/ads/actions`
- `POST /api/meta/ads/actions/:id/approve`
- `POST /api/meta/ads/actions/:id/execute`

Mutation execution must compare the stored approved payload hash immediately before calling Meta.

A future/parallel ChatGPT tool surface should wrap the same domain services rather than bypass them. That ensures an assistant-triggered action obeys the identical approval, audit, idempotency, and safety logic as the web UI.

## 12. Testing strategy

Implementation follows TDD.

Unit tests:

- budget/currency minor-unit conversion;
- objective/conversion prerequisite validation;
- metric normalization and missing-metric behavior;
- payload canonicalization/hash;
- approval expiration/replay rejection;
- mutation capability checks by granted scope;
- ambiguous response reconciliation decisions.

Service tests with mocked Graph transport:

- account discovery and selection;
- read-only insights;
- local draft causes no Meta write;
- launch cannot execute before approval;
- modified payload cannot reuse old approval;
- approved launch creates hierarchy in non-delivering state before final activation;
- partial failure never activates the hierarchy;
- duplicate client request does not duplicate Meta objects;
- pause/resume/budget change each require their own approval.

Frontend/build tests:

- Ads route/nav renders;
- unavailable permissions/tracking are visible;
- exact budget/period shown before approval;
- no direct activation control bypasses approval.

Deployment verification:

- existing Social Studio auth/publishing tests stay green;
- schema migration is idempotent;
- health endpoint remains healthy;
- production can read selected ad account before enabling writes;
- no real paid ad is launched as part of automated CI.

## 13. Deployment and rollout

1. Deploy schema, OAuth/account discovery, and read-only ads views first.
2. Re-authorize Meta connection with advertising scopes and select HAAR ad account.
3. Verify read access and live metrics.
4. Verify write capability with non-spending capability checks/local drafts; automated CI never activates an ad.
5. Enable approval-gated mutations.
6. First live advertising action is a user-approved, explicitly budgeted HAAR test; verify Meta IDs and delivery state afterward.

## 14. Phase 1 non-goals

- automatic budget optimization;
- autonomous pausing or scaling based on ROAS/CTR;
- automatic audience expansion decisions outside the approved draft;
- cross-platform TikTok/X advertising;
- billing/payment-method management;
- modifying Business Manager roles;
- attempting to infer purchases/ROAS when tracking data is absent.

Those can be evaluated after Phase 1 has reliable read/write history and audit data.
