# v0.5.0 — Naver SearchAd foundation and passive read gateway

## Added

- Official pinned SearchAd source manifest for 9 Swagger bundles
- Git blob SHA and size verification before spec generation
- Raw/public/internal/deprecated operation classification
- Runtime allowlist that excludes internal and deprecated operations
- Stable SearchAd operation keys and coverage report
- HMAC-SHA256 authentication with the official four headers
- Principal 1 : Customer N credential topology
- Customer-scoped credential isolation
- Retry-safe GET/HEAD client with 429/5xx backoff
- SearchAd operation preview and read execution gateway
- Passive Capability Probe
- SearchAd-specific OpenAPI document
- PostgreSQL platform/SearchAd foundation migrations
- SearchAd spec sync, coverage, status and remote smoke scripts
- Unit tests for authentication, configuration, client, spec, gateway and capability evidence

## Safe defaults

- Reads enabled
- Writes, creates, batches, rollback, deletes and active canary disabled
- Automation mode `observe`

## Not yet included

- Report ingestion and versioned TSV parser
- Commerce-to-SearchAd profitability pipeline
- Recommendation engine
- Production write execution, create/batch/delete and active canary
- Automatic bid/budget optimization
