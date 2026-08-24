# v0.3.0 — Google Drive full-write integration

## Added

- Google Drive service-account and user OAuth authentication
- HAAR allowed-root boundary validation
- Drive file/folder search, download, create, upload, replace, rename, move, copy, trash, restore, permanent delete, and permissions
- Google native document/spreadsheet/presentation creation
- Drive write canary
- Lazy Google Drive catalog materialization for 1,515 Queen Silver products
- Drive-aware product validate, preview, register, and batch routes
- Drive OpenAPI operations
- Local OAuth refresh-token setup helper
- Remote Drive smoke test
- Drive deployment runbook
- 10 new Drive test cases plus 4 HTTP Drive integration tests

## Security

- All Drive targets are constrained to configured HAAR root IDs
- Destructive root-folder operations are blocked
- Explicit confirmation strings are required
- Trash/restore/delete/permission changes require a second target-ID confirmation
- Local file upload is limited to configured work/cache roots
- My Drive creation is blocked in service-account mode and requires user OAuth or a Shared Drive
- OAuth helper stores secrets in a local 0600 file and does not print them by default

## Verification

- `npm run check`: PASS
- `npm test`: 35 passed, 0 failed
- Live Hostinger canary remains pending until OAuth secrets are installed
