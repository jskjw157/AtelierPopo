# Channel Product Import and Exact Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import every existing Naver SmartStore and HAAR Cafe24 product into HAAR's internal product model, preserve channel-specific snapshots, and connect only exact, unique identifiers under a shared `haar_product_id` without cross-channel synchronization.

**Architecture:** Read-only channel adapters page through Naver Commerce and Cafe24 Admin APIs and emit a common `ImportedChannelProduct` model. A PostgreSQL-backed registrar stores immutable snapshots, identifiers, provisional HAAR products, import checkpoints, exact-match previews, reviews, and reversible internal merge history. Matching is preview-first and exact-only; it never writes to either sales channel.

**Tech Stack:** Node.js 22 ESM, PostgreSQL, built-in `node:test`, existing Naver Commerce client/gateway, Cafe24 OAuth 2.0 adapter, HTTP/OpenAPI routes, GitHub Actions.

**Spec:** `smartstore-bridge/docs/superpowers/specs/2026-08-28-channel-product-import-mapping-design.md`

## Global Constraints

- `HAAR 자사몰 = Cafe24 = haar.co.kr` and is one channel: `haar_own_mall`.
- Importers may perform remote reads only; no Naver or Cafe24 POST/PUT/PATCH/DELETE operation is available to this subsystem.
- Do not synchronize price, stock, name, options, detail content, or sale status between channels.
- Auto-match only exact, unique, non-empty identifiers; similarity is review metadata only.
- Every successfully imported remote product receives a `haar_product_id` even when unmatched.
- Partial imports never mark products missing.
- Original remote snapshots are immutable.
- All write-like internal operations require the exact confirmation phrase and an idempotency key.
- All persisted channel records are scoped by `channel_id`; Cafe24 and Naver identifiers must never share a namespace.

---

### Task 1: Add PostgreSQL channel-import schema and migration runtime

**Files:**
- Create: `smartstore-bridge/migrations/postgres/0005_channel_product_import_mapping.sql`
- Create: `smartstore-bridge/src/infrastructure/postgres.js`
- Create: `smartstore-bridge/src/infrastructure/postgres-migrations.js`
- Test: `smartstore-bridge/test/postgres-migrations.test.js`
- Modify: `smartstore-bridge/package.json`

**Interfaces:**
- Produces: `createPostgresPool(env)`, `runPostgresMigrations(pool, directory)`, schema tables from the approved spec.

- [ ] Write a failing migration discovery/order/idempotency test using a fake pool.
- [ ] Run `node --test test/postgres-migrations.test.js` and verify failure.
- [ ] Implement the pool and migration runner; add `pg` dependency.
- [ ] Add migration tables: `channel_import_runs`, `channel_product_snapshots`, `channel_product_identifiers`, `channel_match_runs`, `channel_match_candidates`, `channel_match_reviews`, `haar_product_merge_history`; extend `channel_products` with snapshot/missing/import metadata without deleting legacy columns.
- [ ] Run the focused test and `npm run check`.
- [ ] Commit `feat: add channel import persistence schema`.

### Task 2: Define the common imported-channel-product contract

**Files:**
- Create: `smartstore-bridge/src/channels/import/model.js`
- Create: `smartstore-bridge/src/channels/import/identifiers.js`
- Create: `smartstore-bridge/src/channels/import/hash.js`
- Test: `smartstore-bridge/test/channel-import-model.test.js`

**Interfaces:**
- Produces: `normalizeExactCode(value, policy)`, `normalizeImportedChannelProduct(input)`, `channelProductContentHash(product)`, `identifierRows(product)`.

- [ ] Write failing tests for Unicode/case/space normalization, prohibited semantic rewriting, stable hashes, variant SKU set canonicalization, and channel scoping.
- [ ] Run the focused tests and verify failure.
- [ ] Implement the minimal model and validators.
- [ ] Run focused tests and commit `feat: add channel import product model`.

### Task 3: Add Cafe24 OAuth and a read-only Admin API client

**Files:**
- Create: `smartstore-bridge/src/cafe24/config.js`
- Create: `smartstore-bridge/src/cafe24/token-store.js`
- Create: `smartstore-bridge/src/cafe24/auth.js`
- Create: `smartstore-bridge/src/cafe24/client.js`
- Test: `smartstore-bridge/test/cafe24-client.test.js`
- Modify: `smartstore-bridge/.env.example`

**Interfaces:**
- Produces: `loadCafe24Config(env)`, `EncryptedCafe24TokenStore`, `Cafe24TokenProvider`, `Cafe24ReadClient.get(path, options)`.

- [ ] Write failing tests for token encryption, atomic rotation, refresh coalescing, 401 refresh, GET-only enforcement, same-origin redirects, 429/5xx read retry, and secret redaction.
- [ ] Run focused tests and verify failure.
- [ ] Implement the minimal read-only client; reject non-GET methods before network I/O.
- [ ] Add exact environment variables and run tests.
- [ ] Commit `feat: add read-only Cafe24 client`.

### Task 4: Implement Naver SmartStore existing-product importer

**Files:**
- Create: `smartstore-bridge/src/channels/import/naver-importer.js`
- Test: `smartstore-bridge/test/naver-channel-importer.test.js`
- Modify: `smartstore-bridge/src/naver/products.js`

**Interfaces:**
- Produces: `NaverChannelProductImporter.preview(options)`, `.pages(options)`, `.fetchOne(channelProductNo)`, each returning the common model from Task 2.

- [ ] Write failing tests for pagination, product detail hydration, seller-management code and option SKU extraction, empty pages, retry-safe reads, and zero remote writes.
- [ ] Run focused tests and verify failure.
- [ ] Add explicit read helpers to `NaverProductsApi`; implement importer.
- [ ] Run tests and commit `feat: import existing Naver products read-only`.

### Task 5: Implement Cafe24 existing-product importer

**Files:**
- Create: `smartstore-bridge/src/channels/import/cafe24-importer.js`
- Test: `smartstore-bridge/test/cafe24-channel-importer.test.js`

**Interfaces:**
- Produces: `Cafe24ChannelProductImporter.preview(options)`, `.pages(options)`, `.fetchOne(productNo)` using the Task 3 client and Task 2 model.

- [ ] Write failing tests for product paging, mall scoping, variants/items paging, configured product-code field extraction, URL construction, missing optional fields, and zero remote writes.
- [ ] Run focused tests and verify failure.
- [ ] Implement importer with response-shape adapters isolated in this file.
- [ ] Run tests and commit `feat: import existing Cafe24 products read-only`.

### Task 6: Register imported products, snapshots, identifiers, and provisional HAAR products

**Files:**
- Create: `smartstore-bridge/src/channels/import/repository.js`
- Create: `smartstore-bridge/src/channels/import/registrar.js`
- Test: `smartstore-bridge/test/channel-product-registrar.test.js`

**Interfaces:**
- Produces: `ChannelImportRepository` transaction methods and `ChannelProductRegistrar.register(importRunId, product)`.

- [ ] Write failing tests for immutable snapshot append, same-hash unchanged behavior, changed-hash update, channel-key idempotency, provisional `haar_product_id`, identifiers, and no cross-channel overwrite.
- [ ] Run focused tests and verify failure.
- [ ] Implement repository and registrar transactions.
- [ ] Run tests and commit `feat: register imported channel products`.

### Task 7: Orchestrate full/incremental/single imports with checkpoints

**Files:**
- Create: `smartstore-bridge/src/channels/import/service.js`
- Test: `smartstore-bridge/test/channel-import-service.test.js`

**Interfaces:**
- Produces: `ChannelImportService.preview(channelId, input)`, `.run(channelId, input)`, `.resume(importRunId)`, `.get(importRunId)`.

- [ ] Write failing tests for full paging, checkpoint resume, idempotent repeat, partial state, counts, single import, and missing-flag rules.
- [ ] Run focused tests and verify failure.
- [ ] Implement service; only succeeded full runs may update `missing_from_latest_full_import`.
- [ ] Run tests and commit `feat: orchestrate channel product imports`.

### Task 8: Implement reversible HAAR-internal product merge

**Files:**
- Create: `smartstore-bridge/src/channels/matching/merge-service.js`
- Test: `smartstore-bridge/test/haar-product-merge.test.js`

**Interfaces:**
- Produces: `HaarProductMergeService.preview()`, `.merge()`, `.revert()`.

- [ ] Write failing tests for channel-link move, history capture, revert, self-merge rejection, conflicting internal SKU, supplier/variant/SearchAd guardrails, and zero remote calls.
- [ ] Run focused tests and verify failure.
- [ ] Implement transactional merge/revert.
- [ ] Run tests and commit `feat: add reversible HAAR product merge`.

### Task 9: Build exact-only match previews and review queue

**Files:**
- Create: `smartstore-bridge/src/channels/matching/exact-match-engine.js`
- Create: `smartstore-bridge/src/channels/matching/review-service.js`
- Test: `smartstore-bridge/test/exact-channel-match.test.js`

**Interfaces:**
- Produces: `ExactChannelMatchEngine.preview(input)`, `ChannelMatchReviewService.list/get/record`.

- [ ] Write failing tests for priority order, exact unique matches, duplicate conflicts, variant-set mismatch, name/price/image non-matches, and manual mapping precedence.
- [ ] Run focused tests and verify failure.
- [ ] Implement engine and persisted candidates/reviews.
- [ ] Run tests and commit `feat: preview exact channel matches`.

### Task 10: Apply exact matches and manual review decisions

**Files:**
- Create: `smartstore-bridge/src/channels/matching/service.js`
- Test: `smartstore-bridge/test/channel-match-service.test.js`

**Interfaces:**
- Produces: `ChannelMatchService.applyExact()`, `.confirmReview()`, `.keepSeparate()`.

- [ ] Write failing tests for preview-before-apply, stale snapshot detection, exact candidate application, manual confirmation, keep-separate, idempotency, and zero remote calls.
- [ ] Run focused tests and verify failure.
- [ ] Implement service using Task 8 merge transactions.
- [ ] Run tests and commit `feat: apply channel product matches`.

### Task 11: Expose import/match/review HTTP and OpenAPI endpoints

**Files:**
- Create: `smartstore-bridge/src/http/routes-channel-imports.js`
- Create: `smartstore-bridge/src/http/openapi-channel-imports.js`
- Modify: `smartstore-bridge/src/bootstrap-v05.js`
- Modify: `smartstore-bridge/src/http/server-v05.js`
- Modify: `smartstore-bridge/src/http/errors-v05.js`
- Modify: `smartstore-bridge/package.json`
- Test: `smartstore-bridge/test/channel-import-http.test.js`

**Interfaces:**
- Produces all approved `/api/v1/channel-imports`, `/api/v1/channel-products`, `/api/v1/channel-matches`, `/api/v1/channel-match-reviews`, merge/revert, and `/openapi-channel-imports.json` routes.

- [ ] Write failing authenticated HTTP tests for preview, async run, status, exact preview/apply, reviews, merge/revert, confirmation strings, idempotency, size limits, and disabled dependencies.
- [ ] Run focused tests and verify failure.
- [ ] Wire services and routes without adding any cross-channel sync endpoint.
- [ ] Run tests and commit `feat: expose channel import and matching API`.

### Task 12: Add PostgreSQL CI, read-only remote smoke tests, and runbook

**Files:**
- Create: `.github/workflows/channel-product-import-ci.yml`
- Create: `smartstore-bridge/scripts/channel-import-remote-smoke.mjs`
- Create: `smartstore-bridge/docs/CHANNEL_PRODUCT_IMPORT_RUNBOOK.md`
- Create: `smartstore-bridge/TEST_REPORT_CHANNEL_IMPORT.md`
- Modify: `smartstore-bridge/.env.example`
- Modify: `smartstore-bridge/README.md`

**Interfaces:**
- Produces CI evidence and an operator procedure that starts with preview/read-only smoke tests.

- [ ] Add a PostgreSQL service and migration/test/coverage workflow.
- [ ] Add a smoke script that only previews or imports to the internal DB and rejects any remote mutation method.
- [ ] Document secrets, OAuth setup, preview, full import, resume, exact apply, review, rollback, and incident recovery.
- [ ] Run `npm run check`, `npm test`, Commerce coverage, SearchAd coverage, migration tests, and the dry-run smoke test.
- [ ] Commit `docs: add channel import operations runbook`.

## Final Verification

- [ ] Inspect the diff for any Naver/Cafe24 mutation call introduced by this subsystem; expected count: 0.
- [ ] Run the complete test suite and both API coverage scripts.
- [ ] Run PostgreSQL migrations twice against a clean database; second run must be a no-op success.
- [ ] Run exact-match fixtures proving name/price/image similarity never auto-merges.
- [ ] Verify Cafe24 appears only as `haar_own_mall` and no `OWN_SITE` duplicate is created.
- [ ] Verify failed/partial full imports do not update missing flags.
- [ ] Verify every imported product has a `haar_product_id`.
- [ ] Review all confirmation phrases and OpenAPI operation IDs.
- [ ] Open a PR with one commit per task and require CI success before merge.
