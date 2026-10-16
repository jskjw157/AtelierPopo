# Channel implementation verification

Base: `9ac7674d9f3d352afda7f370a84af06387690b88` on `feat/haar-meta-ads-phase1`. Isolated branch: `codex/social-threads-tiktok-x`.

Local final validation on 2026-10-16 UTC:

- 26 JavaScript test files, **152 tests passed**, with an isolated local PostgreSQL 16 `_test` database. This includes the existing 115 tests and 37 channel tests. No database tests skipped.
- Real local server boot: additive migration, protected channel status, authenticated local draft save and default remote-write lock confirmed; existing Meta HTTP/MCP checks preserved.
- `npm run check:syntax`: pass.
- `npm run build`: pass.
- Existing Caddy Python tests: 3 passed.
- `git diff --check`: pass.
- All provider requests in channel tests use injected mocks. No app registration, real account OAuth, paid API calls, uploads, posts or production deployment was performed.

An independent reviewer inspected the complete feature and independently ran the channel tests. Three P2 issues were reproduced, fixed and rechecked:

1. An expired access token with usable refresh rights blocked the UI. Status now distinguishes `refresh_available`, while dispatch refreshes under the existing connection lock. Threads already-expired tokens still require reauthorization.
2. Replaying an immutable scheduled request after its due time failed validation. Existing ID/payload lookup now precedes future-time checks, which apply only to new requests.
3. A transient status-only read error terminated processing. Safe timeout/429/5xx reads now remain processing; any ambiguous parent-container/final-publish write remains terminal uncertain. The reviewer independently injected an HTTP 503, resumed the queue and confirmed exactly one final Threads publish call.

Additional regression: a known provider result already persisted in the DB survives a later audit insertion failure. No credentials or upstream raw errors appear in UI/status output.

One earlier full run returned HTTP 400 instead of 403 in the pre-existing MCP foreign-origin test; targeted rerun and final complete run passed without changing its transport implementation. No remaining reproducible failure was found locally. GitHub CI is the separate final PR gate.

Live integration remains unverified and unapproved. Threads app review/roles, TikTok Upload scope and verified media origin, X developer billing/credits and each user's OAuth are required before any authorized live test. TikTok Direct Post for the current internal-team use case is excluded under its official intended-use restriction; inbox delivery remains user-completed posting. See `CHANNELS_SETUP_KO.md` for official sources and exact setup boundaries.
