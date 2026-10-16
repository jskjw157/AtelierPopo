# Threads, TikTok, X implementation plan and design

Goal: extend HAAR with user-authorized channel uploads and one-shot scheduled dispatch, preserving the existing Instagram/Facebook deployment and flows.

Execution: native implementation in an isolated clone, followed by an independent whole-change reviewer as requested by the user. Base: `origin/feat/haar-meta-ads-phase1` (`9ac7674`). No AGENTS.md or .agents/skills exists in this revision (recursive tracked-file and filesystem checks).

## Design

Use an additive `channels` subsystem with separate connection, OAuth-state, post and attempt tables. Existing Meta tables and publish adapters stay unchanged. A new authenticated `/channels` workspace uses the existing private media library; accounts also expose the new connection cards. This avoids extending the old two-channel schemas and their per-campaign assumptions. The existing cron endpoint invokes the new queue after its existing queue, with failure isolation.

OAuth starts by CSRF-protected POST, is bound to the active owner and provider, uses single-use expiring hashed state, and S256 PKCE for X. All access/refresh credentials and verifier material are encrypted server-side; callbacks never echo provider errors or tokens. Threads uses its own app credentials, not the Facebook app ID. User reauthorization changes a connection generation: an older queued post cannot silently target another account. Disconnect cancels unsent jobs.

Each platform has explicit connection and write-enable switches, off by default. X also needs billing approval. TikTok is upload-to-inbox only: the current internal-team product is explicitly ineligible for Direct Post under the official intended-use guidelines. Do not provide a setting that evades that restriction. Inbox delivery is `awaiting_user`, never `published`, and requires the user to finish in TikTok. A future broadly available, audited Direct Post product needs a separate compliance/UX review and implementation.

Threads supports text, single image, image carousel and video containers with persisted reference, readiness checks, and a persisted publish-request checkpoint. X supports standard text and up to four images via v2 media upload; videos/long posts are rejected explicitly. TikTok supports one video, PULL_FROM_URL only under a configured verified origin, to the inbox endpoint. No scraped sessions or browser-cookie automation.

New immutable posts have a client request UUID + canonical payload hash, explicit content/target/schedule consent, account generation, provider reference, and states draft/scheduled/publishing/processing/published/awaiting_user/failed/uncertain/cancelled. Database advisory locks serialize connection changes, refresh, dispatch and polls. Persist dispatch start before any external write. A timeout/crash after a remote write is uncertain and never automatically resent. Processing jobs resume only from persisted safe checkpoints; a publish request with unknown outcome never runs again. No recurring post rule or bulk-repeat feature.

MCP is a future boundary: no new MCP endpoint or claim of assistant connectivity. Future read tools may wrap sanitized status/history; future write tools must bind a server-side owner and use explicit immutable approval records. Existing ads MCP is unaffected.

## Tasks

- [ ] Add policy/validation and provider HTTP clients/adapters; test supported payloads, rejected formats, secret-safe failures, network uncertainty and pending results.
- [ ] Add additive schema and owner-only OAuth/runtime APIs; test state replay/cross-user/provider mismatches, PKCE, encrypted rotation, revoked/expired scopes, generation changes and disconnected queues.
- [ ] Add immutable posts, serialized dispatch/polling, cron integration and safe media reads; test double clicks, UUID conflicts, concurrent workers, timeout/checkpoint persistence, disabled writes/billing, stale account and cancellation.
- [ ] Add connection cards and `/channels` composition/history UI with no automatic OAuth; test default locks, explicit consent, TikTok completion label and request UUID retention on retry.
- [ ] Run syntax, mock tests, isolated PostgreSQL tests, build, existing Python tests; independent review and fixes; Draft PR and CI. Never trigger any deployment workflow.

## Approval boundary and verification

Implementation, mocks, local test DB, branch push and Draft PR are authorized by the task. Production deploy, app registration/permissions, real credentials, account OAuth, paid credits and actual remote uploads/posts remain separately unapproved. No VPS mutation is needed for this branch. Every new provider HTTP call in tests is injected/mocked. Local DB is a disposable dedicated cluster, never the VPS database.
