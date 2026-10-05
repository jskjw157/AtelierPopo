# HAAR Meta Ads — verified implementation and production status

Verified: 2026-09-23 UTC.
Application version: 0.2.0.
Production URL: https://social.haarapp.tech/ads
Implementation source: d59bc2bc10f7588b012a228d389c1dd3737c55e1.
Development branch: feat/haar-meta-ads-phase1.

## Actual completed work

- Protected /ads route and sidebar label 광고 관리 are deployed on Hostinger.
- Advertising-specific Meta OAuth, account discovery/selection, campaign/ad-set/ad reads, date-bounded insights, local drafts, immutable approval records, and guarded launch/pause/resume/budget-change services are implemented.
- Selecting a product supplies its purchase URL. The current creative creation format is a single image. Existing post sources copy the image/caption into a separate advertisement; original likes/comments are not inherited.
- Approval requests bind account, source, URL, copy, targeting, schedule, currency and budget. Domain-level hash checking, expiry, replay prevention, account execution locks, paused-first creation and provider read-back checks are covered by tests.
- A read-only MCP transport is implemented and protocol-tested. It is NOT registered or authenticated in the user's ChatGPT account and remains disabled in production.

## Independent execution environments, not an independent code review

Local verification and GitHub Actions both passed:
- 115 Vitest tests in 20 files, including real isolated PostgreSQL, HTTP, actual server boot, MCP protocol and React DOM tests. No skipped database tests in the Actions verification.
- 3 existing Python Caddy regression tests.
- JavaScript syntax checks and Vite build.
- 4 additional deployment-helper tests passed locally and in the rollout workflow.

Implementation verification run: https://github.com/jskjw157/AtelierPopo/actions/runs/35806837367
Job: 107009476485; conclusion success.
Artifact: 10727079881 (haar-meta-ads-implementation-verification).

Code review was performed by the author, not by an independent reviewer. Provider mutations in tests used an injected simulator, not a live Meta advertising account. Standalone Chromium visual inspection was blocked by the execution environment's browser policy; React DOM behavior and build were verified, not a visual screenshot review.

## Production rollout evidence

Read-only preflight: https://github.com/jskjw157/AtelierPopo/actions/runs/35807304087
Guarded rollout: https://github.com/jskjw157/AtelierPopo/actions/runs/35807809868
Rollout job: 107012423414; conclusion success.
Rollout artifact: 10728337441 (haar-meta-ads-hostinger-rollout).
Artifact ZIP SHA256: befa93250391b39727a0db1807a87f455142e62abc4588d554c9d7415222213b.
The downloaded report and its checksum were verified.

Observed both from the VPS and a separate Actions network:

```json
{"status":"ok","database":"ok","coreMissing":[],"coreErrors":[],"metaMissing":[],"version":"0.2.0","features":{"metaAds":true,"adsExecutionEnabled":false}}
```

Additional public checks:
- /login: HTTP 200.
- /ads: HTTP 200; the served JavaScript bundle contains the new 광고 관리 menu and Meta ads API integration.
- /api/meta/ads/status without authentication: HTTP 401.
- /mcp without configured integration credentials: HTTP 503.

Preservation checks passed:
- Existing PostgreSQL container unchanged.
- Existing uploaded-media volume unchanged.
- Stored owner credentials/password hashes unchanged.
- Stored Facebook/Instagram connection credentials unchanged.
- Product/media/post record counts did not decrease.
- A database backup and previous application directory remain privately on the VPS.

No Caddy/DNS changes, database-volume replacement, live Meta advertising mutations, paid-ad activation or advertising budget changes were performed by this rollout.

## Safety defaults and remaining work

Production settings:

```dotenv
META_ADS_WRITES_ENABLED=false
HAAR_TOOL_BEARER_TOKEN=
HAAR_TOOL_ACTOR_ID=
```

The user's next required authorization is in 광고 관리 → Meta 광고 권한 연결. That requests advertising permissions separately from the existing publishing connection. After authorization, the real account, currency, timezone, permissions and tracking configuration still need live verification.

The execution master gate remains closed even if a local approval is recorded. Development approval is not approval to spend on an advertisement. A first paid action needs its own exact, budgeted user approval after provider prerequisites are verified.

The original goal of full chat-to-draft/approve/execute is NOT complete: production MCP is not configured, actual ChatGPT client authentication/registration is unverified, and the current MCP surface exposes only read tools. Do not describe the entire Phase 1 scope as fully finished.

## Resume instructions

Resume from source d59bc2bc10f7588b012a228d389c1dd3737c55e1 and this report; do not reimplement the old schema/primitives based on stale conversation claims. The original SNS branch was not merged or rewritten. It still points to the older source, so do not deploy that older branch over the verified 0.2.0 application.

The production Compose manifest differs from the source only by an explicit immutable app image tag: haar-social-studio:meta-ads-d59bc2bc10f7. Keep project app, loopback port 3100, and the existing named database/upload volumes. The guarded rollout preserved existing environment settings except the explicit ads/MCP safety gates. Previous application location: /opt/haar-social-studio/rollouts/meta-ads-35807809868/previous-app. Do not delete that rollback or its adjacent private database backup as routine cleanup.

Design rulings retained: strict supported-currency budgets rather than rounding, advertising OAuth separate from publishing, missing purchase metrics kept unavailable, existing post content cloned explicitly, single-image creation first, no claim of perfect network exactly-once, and read-only/unconfigured MCP until actual client authorization is verified. Costs: unsupported formats/currencies and direct ChatGPT write operations remain deferred; unknown provider results require explicit reconciliation rather than automatic retry.


## 2026-10-05 live read-only validation checkpoint

The user completed Meta advertising reauthorization. Live production verification then confirmed:

- Selected account: HAAR 광고 계정; KRW; Asia/Seoul; active advertising permissions.
- Meta advertising execution master gate remains disabled.
- A HAAR Meta pixel is accessible and has a recent event timestamp.
- Current live Meta hierarchy remains 0 campaigns / 0 ad sets / 0 ads.
- Orbit Silver Earring was restored into the local product table at 120000 KRW and mapped to the published Instagram post "차분한 룩에, 선명한 디테일.".
- One local-only traffic draft exists for that product/post at 20000 KRW daily. Before/after live Meta hierarchy counts were identical and no external campaign/ad-set/ad IDs were created.

### Live MCP E2E

Run 37280639255 passed against live HAAR production data using an ephemeral loopback-only MCP router inside the production application container. Production MCP configuration was not changed.

Verified read-only tool surface:

- haar_ads_status
- haar_ads_accounts
- haar_ads_campaigns
- haar_ads_insights
- haar_ads_drafts
- haar_ads_pending_actions

The selected HAAR account, zero live Meta delivery objects, local Orbit draft and zero pending approval requests were readable through MCP. All tools declared readOnlyHint=true / destructiveHint=false. No create/approve/execute mutation tool was exposed.

### Live insights roundtrip

Run 37280810132 passed. Meta account insights for 2026-09-29 through 2026-10-05 were fetched read-only, stored in the local snapshot table and read back through haar_ads_insights over MCP. The live account returned zero insight rows because no ads are currently running; the system preserved this as an empty result rather than inventing zero-valued purchase or ROAS metrics.

### MCP security boundary

Run 37280985758 passed using the production code path in an ephemeral loopback-only test endpoint:

- missing bearer credential -> HTTP 401
- incorrect bearer credential -> HTTP 401
- foreign Origin -> HTTP 403
- valid scoped credential -> HTTP 200
- unsupported GET -> HTTP 405
- credential was not returned in responses
- no write-like tools were exposed
- paid-delivery execution remained disabled
- the public production /mcp endpoint remains HTTP 503 because HAAR_TOOL_BEARER_TOKEN and HAAR_TOOL_ACTOR_ID are still intentionally unconfigured

Next security-sensitive step: enabling the public production read-only MCP endpoint and registering/authenticating it with the user's ChatGPT client. Do not perform that exposure/configuration without explicit user approval. Paid-ad execution remains a separate later approval and must stay disabled.
